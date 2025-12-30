const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const fetch = require("node-fetch");

// Inicialización de Firebase (Credenciales Automáticas en Cloud)
initializeApp();
const db = getFirestore();

// --- CONFIGURACIÓN ---
const SHELLY_TIMEOUT_MS = 5000;
const INTER_DEVICE_DELAY_MS = 1000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Consulta el estado de un dispositivo Shelly a través de la nube
 */
async function checkShellyStatus(door, retryCount = 0) {
    if (!door.serverUrl || !door.deviceId || !door.authKey) {
        return { online: false, error: 'Config incomplète' };
    }

    let baseUrl = door.serverUrl.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    let targetUrl;
    if (baseUrl.toLowerCase().includes('/device/relay/control')) {
        targetUrl = baseUrl.replace(/\/device\/relay\/control/i, '/device/status');
    } else {
        targetUrl = `${baseUrl}/device/status`;
    }

    const params = new URLSearchParams();
    params.append('id', door.deviceId);
    params.append('auth_key', door.authKey);
    params.append('_t', Date.now());

    const fullUrl = `${targetUrl}?${params.toString()}`;
    const formData = new URLSearchParams();
    formData.append('id', door.deviceId);
    formData.append('auth_key', door.authKey);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SHELLY_TIMEOUT_MS);

        const response = await fetch(fullUrl, {
            method: 'POST',
            body: formData,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'AccessControlApp/Functions'
            }
        });

        clearTimeout(timeout);

        if (response.status === 429) {
            if (retryCount < 1) {
                console.log(`⚠️ 429 Detectado en ${door.deviceId}. Reintentando...`);
                await delay(2000);
                return checkShellyStatus(door, retryCount + 1);
            }
            return { online: false, error: '⚠️ BUSY (429)' };
        }

        if (!response.ok) {
            return { online: false, error: `HTTP ${response.status}` };
        }

        const data = await response.json();
        let isOnline = false;

        if (data.data && typeof data.data.online !== 'undefined') {
            isOnline = data.data.online;
        } else if (data.data && typeof data.data.connected !== 'undefined') {
            isOnline = data.data.connected;
        }

        return {
            online: isOnline,
            ip: data.data?.ip || null,
            error: null,
            lastSeen: new Date().toISOString()
        };

    } catch (error) {
        return { online: false, error: error.name === 'AbortError' ? 'Timeout' : error.message };
    }
}

/**
 * FUNCIÓN PROGRAMADA: "checkDoors"
 * Se ejecuta automáticamente cada minuto.
 */
exports.checkDoors = onSchedule({
    schedule: "every 1 minutes",
    timeoutSeconds: 60,
    region: "us-central1" // O la región de tu proyecto
}, async (event) => {
    console.log(`⏰ Iniciando chequeo de puertas...`);

    try {
        const doorsSnapshot = await db.collection('doors').get();
        if (doorsSnapshot.empty) {
            console.log("⚠️ No hay puertas configuradas.");
            return;
        }

        const updates = [];
        for (const doc of doorsSnapshot.docs) {
            const door = doc.data();
            const doorId = doc.id;

            console.log(`> Checking: ${door.name || doorId}`);
            const status = await checkShellyStatus(door);
            await delay(INTER_DEVICE_DELAY_MS);

            console.log(`  Resultado: ${status.online ? 'ONLINE' : 'OFFLINE'} (${status.error || status.ip})`);

            const updatePromise = db.collection('doors').doc(doorId).update({
                status: {
                    ...status,
                    lastCheck: FieldValue.serverTimestamp()
                }
            }).catch(err => console.error(`❌ Error actualizando ${door.name}:`, err.message));

            updates.push(updatePromise);
        }

        await Promise.all(updates);
        console.log("✅ Ciclo completado.");

    } catch (error) {
        console.error("💥 Error fatal en checkDoors:", error);
    }
});
// --- DEBUG ---
const { onRequest } = require("firebase-functions/v2/https");

/**
 * TRIGGER MANUAL: "forceCheck"
 * Permite ejecutar el chequeo desde el navegador para debug.
 * URL: https://[region]-[projectID].cloudfunctions.net/forceCheck
 */
exports.forceCheck = onRequest(async (req, res) => {
    console.log(`🔧 Manual Force Check triggered from ${req.ip}`);

    // Reutilizamos la lógica del Scheduled (Copy-Paste de abajo para simplificar)
    // En producción se modulariza, aqui duplicamos para rápido debug.
    try {
        const doorsSnapshot = await db.collection('doors').get();
        const results = [];

        for (const doc of doorsSnapshot.docs) {
            const door = doc.data();
            const status = await checkShellyStatus(door);
            console.log(`> forceCheck: ${door.name} -> ${status.online ? 'ONLINE' : 'OFFLINE'}`);

            await db.collection('doors').doc(doc.id).update({
                status: { ...status, lastCheck: FieldValue.serverTimestamp() }
            });
            results.push({ id: doc.id, name: door.name, status });
        }
        res.status(200).json({ success: true, results });

    } catch (e) {
        console.error("ForceCheck error", e);
        res.status(500).json({ error: e.message });
    }
});

// --- TUYA INTEGRATION ---
const { onCall } = require("firebase-functions/v2/https");
const CryptoJS = require("crypto-js");

/**
 * Callable: "verifyTuyaCredentials"
 * Verifica si las credenciales de Tuya son válidas y si el dispositivo existe.
 */
exports.verifyTuyaCredentials = onCall(async (request) => {
    // onCall request.data contains the payload
    const { deviceId, accessId, accessSecret } = request.data;
    const region = "us"; // Default region for simplicity, maybe make configurable later

    if (!deviceId || !accessId || !accessSecret) {
        throw new Error("Faltan datos (ID, Access ID, Secret)");
    }

    // Tuya Signature Helper
    const signRequest = (method, path, body, t, accessToken = "") => {
        // StringToSign = Method + "\n" + Content-SHA256 + "\n" + Headers + "\n" + Url
        // Simplified for simple mode or token mode

        // 1. Calculate Content-SHA256 (Empty for GET)
        const contentHeader = ""; // Empty string hash or actual hash? 
        // Tuya V1.0: GET payload empty -> hash of empty string.
        const contentSha256 = CryptoJS.SHA256("").toString(CryptoJS.enc.Hex);

        const stringToSign = [
            method,
            contentSha256,
            "",
            path
        ].join("\n");

        const str = accessId + accessToken + t + stringToSign;
        const hash = CryptoJS.HmacSHA256(str, accessSecret).toString(CryptoJS.enc.Hex).toUpperCase();
        return hash;
    };

    // 1. Get Token (Simple Mode)
    // Actually Tuya V2 usually requires getting a token first.
    // Let's try to get a token first.
    const t = Date.now().toString();
    const method = 'GET';
    const path = '/v1.0/token?grant_type=1';

    // Sign for Token
    // Signature = HMAC-SHA256(AccessId + t + Method + "\n" + Content-SHA256 + "\n" + Headers + "\n" + Url, Secret)
    // Wait, the signature algorithm is complex. Let's simplify and use the standard one.
    // Standard: sign_string = Method + "\n" + HEX(SHA256(Body)) + "\n" + Headers + "\n" + Url
    // sign = HMAC-SHA256(AccessId + AccessToken + t + sign_string, Secret).toUpperCase() (AccessToken empty for token request)

    const contentSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // Empty string SHA256
    const stringToSign = `${method}\n${contentSha256}\n\n${path}`;
    const signStr = accessId + t + stringToSign;
    const sign = CryptoJS.HmacSHA256(signStr, accessSecret).toString(CryptoJS.enc.Hex).toUpperCase();

    const baseUrl = "https://openapi.tuyaus.com"; // US Region

    try {
        console.log(`> Tuya Auth: Requesting Token for ${accessId}...`);
        const tokenRes = await fetch(`${baseUrl}${path}`, {
            headers: {
                'client_id': accessId,
                'sign': sign,
                't': t,
                'sign_method': 'HMAC-SHA256'
            }
        });

        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            console.error("Tuya Token Error:", errText);
            throw new Error(`Error API Tuya (Token): ${tokenRes.statusText}`);
        }

        const tokenData = await tokenRes.json();
        if (!tokenData.success) {
            console.error("Tuya Token Logic Error:", tokenData);
            throw new Error(`Credenciales Inválidas: ${tokenData.msg}`);
        }

        const accessToken = tokenData.result.access_token;
        console.log(`> Tuya Token Obtained. Checking Device ${deviceId}...`);

        // 2. Get Device Details
        const devPath = `/v1.0/devices/${deviceId}`;
        const t2 = Date.now().toString();
        const stringToSign2 = `GET\n${contentSha256}\n\n${devPath}`;
        const signStr2 = accessId + accessToken + t2 + stringToSign2;
        const sign2 = CryptoJS.HmacSHA256(signStr2, accessSecret).toString(CryptoJS.enc.Hex).toUpperCase();

        const devRes = await fetch(`${baseUrl}${devPath}`, {
            headers: {
                'client_id': accessId,
                'access_token': accessToken,
                'sign': sign2,
                't': t2,
                'sign_method': 'HMAC-SHA256'
            }
        });

        const devData = await devRes.json();
        if (!devData.success) {
            console.error("Tuya Device Error:", devData);
            throw new Error(`Dispositivo no encontrado: ${devData.msg}`);
        }

        return {
            success: true,
            name: devData.result.name,
            online: devData.result.online
        };

    } catch (e) {
        console.error("Verify Tuya Exception:", e);
        return { success: false, message: e.message };
    }
});

/**
 * Callable: "getTuyaHlsUrl"
 * Obtiene la URL de streaming HLS temporal de Tuya.
 */
exports.getTuyaHlsUrl = onCall(async (request) => {
    const { deviceId, accessId, accessSecret, uid } = request.data;
    const region = "us";
    const baseUrl = "https://openapi.tuyaus.com"; // Adjust if needed

    if (!deviceId || !accessId || !accessSecret || !uid) {
        return { success: false, message: "Faltan credenciales (UID requerido)" };
    }

    try {
        const calculateSign = (method, path, body = "", t, accessToken = "") => {
            const contentSha256 = CryptoJS.SHA256(body).toString(CryptoJS.enc.Hex);
            const stringToSign = [method, contentSha256, "", path].join("\n");
            const signStr = accessId + accessToken + t + stringToSign;
            return CryptoJS.HmacSHA256(signStr, accessSecret).toString(CryptoJS.enc.Hex).toUpperCase();
        };

        // 1. Get Access Token
        let t = Date.now().toString();
        let path = "/v1.0/token?grant_type=1";
        let sign = calculateSign("GET", path, "", t);

        const tokenRes = await fetch(`${baseUrl}${path}`, {
            headers: { client_id: accessId, sign, t, sign_method: "HMAC-SHA256" }
        });

        const tokenData = await tokenRes.json();
        if (!tokenData.success) throw new Error("Token Error: " + tokenData.msg);
        const accessToken = tokenData.result.access_token;

        // 2. Allocate Stream (HLS)
        path = `/v1.0/users/${uid}/devices/${deviceId}/stream/actions/allocate`;
        const bodyObj = { "type": "hls" };
        const bodyStr = JSON.stringify(bodyObj); // CryptoJS.SHA256 needs string

        t = Date.now().toString();
        // IMPORTANT: Calculate sign using the BODY string
        sign = calculateSign("POST", path, bodyStr, t, accessToken);

        console.log(`> Requesting HLS for ${deviceId}...`);
        const hlsRes = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: {
                client_id: accessId,
                access_token: accessToken,
                sign,
                t,
                sign_method: "HMAC-SHA256",
                "Content-Type": "application/json"
            },
            body: bodyStr
        });

        const hlsData = await hlsRes.json();

        if (!hlsData.success) {
            console.error("Tuya HLS Error:", hlsData);
            // 1106 = Permission Deny (UID wrong or Device not bound to this UID)
            return { success: false, message: hlsData.msg || "Stream allocation failed" };
        }

        return { success: true, url: hlsData.result.url };

    } catch (e) {
        console.error("HLS Exception:", e);
        return { success: false, message: e.message };
    }
});
