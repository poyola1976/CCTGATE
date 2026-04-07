const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const CryptoJS = require("crypto-js");
const fetch = require("node-fetch");
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

if (admin.apps.length === 0) {
    admin.initializeApp();
}
const db = getFirestore();

// CONFIGURACIÓN DE MERCADO PAGO (PRODUCCIÓN REAL)
const mpClient = new MercadoPagoConfig({
    accessToken: "APP_USR-963547969533010-040219-ce265fa18c447be6cb21601a08a202bd-315720244",
    options: { timeout: 5000 }
});

// --- MERCADO PAGO: GENERAR PREFERENCIA ---

exports.createPaymentPreference = onCall(async (request) => {
    const { plan, userId, doorId, userEmail } = request.data;
    if (!plan || !userId || !doorId) throw new HttpsError("invalid-argument", "Faltan parámetros.");
    try {
        // 1. OBTENER PRECIOS DINÁMICOS
        // Intentar leer precio específico de la puerta
        const doorDoc = await db.collection("doors").doc(doorId).get();
        const doorData = doorDoc.exists ? doorDoc.data() : {};

        // Intentar leer precios globales (Por defecto 8000/10000 si no existe el config)
        const configDoc = await db.collection("config").doc("pricing").get();
        const globalPricing = configDoc.exists ? configDoc.data() : { semestral: 8000, anual: 10000 };

        const isAnnual = plan === 'anual';
        let amount = isAnnual ? globalPricing.anual : globalPricing.semestral;

        // Si la puerta tiene un precio personalizado, lo usamos (vence al global)
        if (isAnnual && doorData.price_anual) amount = doorData.price_anual;
        if (!isAnnual && doorData.price_semestral) amount = doorData.price_semestral;

        const preference = new Preference(mpClient);
        const body = {
            items: [{
                id: plan,
                title: `CCTGATE - Plan ${isAnnual ? 'Anual' : 'Semestral'}`,
                unit_price: Number(amount),
                quantity: 1,
                currency_id: 'CLP'
            }],
            payer: { email: userEmail || "" },
            external_reference: `${userId}::${doorId}::${plan}`,
            back_urls: {
                success: "https://api-gate-af1a9.web.app/payment-success",
                failure: "https://api-gate-af1a9.web.app/payment-failure",
                pending: "https://api-gate-af1a9.web.app/payment-pending"
            },
            auto_return: "approved",
            // URL a la que MP avisará el éxito del pago
            // URL definitiva de Webhook (confirmada con éxito)
            notification_url: "https://us-central1-api-gate-af1a9.cloudfunctions.net/mercadopagoWebhook"
        };
        const result = await preference.create({ body });
        return { id: result.id, init_point: result.init_point, sandbox_init_point: result.sandbox_init_point };
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }
});

// --- MERCADO PAGO: WEBHOOK DE RESULTADO ---

exports.mercadopagoWebhook = onRequest(async (req, res) => {
    // 1. Obtener ID del pago
    const paymentId = req.query['data.id'] || (req.body && req.body.data && req.body.data.id);
    const type = req.query.type || (req.body && req.body.type);

    console.log(`> MP Webhook Recibido: ${type} ID: ${paymentId}`);

    // Solo procesamos NOTIFICACIONES DE PAGO
    if (type === 'payment' && paymentId) {
        try {
            const payment = new Payment(mpClient);
            const pData = await payment.get({ id: paymentId });

            if (pData.status === 'approved') {
                // AQUÍ OCURRE LA MAGIA: 
                // Recuperamos UserId, DoorId y Plan de la referencia externa
                const [uid, deviceId, plan] = pData.external_reference.split('::');
                console.log(`✅ Pago Aprobado: ${plan} para User ${uid} en Puerta ${deviceId}`);

                // Llamamos a la lógica de extensión de licencia
                await extendUserLicenseInFirestore(uid, deviceId, plan);
            }
        } catch (e) {
            console.error("Error procesando pago MP:", e);
        }
    }

    res.status(200).send("OK");
});

/**
 * LÓGICA DE BACKEND: Extiende la licencia directamente en la base de datos
 */
async function extendUserLicenseInFirestore(uid, deviceId, plan) {
    const months = plan === 'anual' ? 12 : 6;
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
        console.error(`User ${uid} no encontrado para habilitar.`);
        return;
    }

    const userData = userSnap.data();
    let baseDate = new Date(); // Si ya venció, sumamos desde HOY

    // Si tiene una fecha de expiración futura, sumamos a partir de ella
    const currentExp = userData.deviceAccess?.[deviceId]?.expirationDate;
    if (currentExp && currentExp.toDate) {
        const currentExpDate = currentExp.toDate();
        if (currentExpDate > baseDate) {
            baseDate = currentExpDate;
        }
    }

    const newExpDate = new Date(baseDate);
    newExpDate.setMonth(newExpDate.getMonth() + months);
    newExpDate.setHours(23, 59, 59, 999);

    const updateData = {};
    updateData[`deviceAccess.${deviceId}`] = {
        startDate: userData.deviceAccess?.[deviceId]?.startDate || FieldValue.serverTimestamp(),
        expirationDate: Timestamp.fromDate(newExpDate),
        updatedAt: FieldValue.serverTimestamp(),
        lastPaymentPlan: plan,
        lastPaymentStatus: 'approved'
    };

    await userRef.update(updateData);
    console.log(`🚀 Licencia extendida hasta ${newExpDate.toISOString()} para ${uid}`);

    // LOG HISTORIAL DE ACCESO
    await db.collection('access_logs').add({
        doorId: deviceId,
        userName: userData.name || userData.email || "Usuario Pago",
        action: `PAGO_${plan.toUpperCase()}`,
        timestamp: FieldValue.serverTimestamp(),
        details: `Auto-renovación exitosa hasta ${newExpDate.toLocaleDateString()}`
    });
}

// --- ORIGINAL FUNCTIONS (SHELLY & TUYA) ---

exports.forceCheck = onRequest(async (req, res) => {
    try {
        const doorsSnapshot = await db.collection('doors').get();
        for (const doc of doorsSnapshot.docs) {
            const door = doc.data();
            await db.collection('doors').doc(doc.id).update({ "status.lastCheck": FieldValue.serverTimestamp() });
        }
        res.status(200).json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

exports.checkDoors = onSchedule({
    schedule: "every 1 minutes",
    timeoutSeconds: 60,
    memory: "256MiB"
}, async (event) => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 4 RONDAS DE 15 SEGUNDOS CADA UNA
    for (let round = 1; round <= 4; round++) {
        console.log(`🎬 RONDA ${round}/4 - Monitoreo Blindado...`);
        const startTime = Date.now();

        try {
            const doorsSnapshot = await db.collection('doors').get();
            if (doorsSnapshot.empty) break;

            // EJECUCIÓN SECUENCIAL CON PAUSA DE SEGURIDAD (Cura de Rotación)
            for (const doc of doorsSnapshot.docs) {
                const door = doc.data();
                const doorId = doc.id;

                if (!door.serverUrl || !door.deviceId || !door.authKey) continue;

                try {
                    let baseUrl = door.serverUrl.trim();
                    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

                    let targetUrl = baseUrl.includes('/relay/control')
                        ? baseUrl.replace(/\/relay\/control/i, '/status')
                        : `${baseUrl}/device/status`;

                    const body = new URLSearchParams();
                    body.append('id', door.deviceId);
                    body.append('auth_key', door.authKey);

                    const response = await fetch(targetUrl, {
                        method: 'POST',
                        body: body,
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        timeout: 5000
                    });

                    const res = await response.json();

                    if (res.isok && res.data) {
                        const isOnline = res.data.online === true ||
                            res.data.status?.online === true ||
                            res.data.connected === true;

                        // SOLO ACTUALIZAMOS SI LA RESPUESTA ES VÁLIDA
                        await db.collection('doors').doc(doorId).update({
                            "status.online": isOnline,
                            "status.ip": res.data?.device_status?.wifi_sta?.ip || res.data?.wifi_sta?.ip || null,
                            "status.error": isOnline ? null : 'Offline en Shelly Cloud',
                            "status.lastCheck": FieldValue.serverTimestamp()
                        });
                        console.log(`✅ ${door.name || doorId}: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
                    } else {
                        // SI SHELLY RESPONDE ERROR (ej: 429), NO CAMBIAMOS EL ESTADO ONLINE
                        await db.collection('doors').doc(doorId).update({
                            "status.lastCheck": FieldValue.serverTimestamp(),
                            "status.error": `Shelly API: ${res.message || 'Error'}`
                        });
                        console.log(`🟠 ${door.name || doorId}: Saltado (Error de API)`);
                    }

                } catch (err) {
                    console.error(`❌ Error en ${doorId}:`, err.message);
                    // EN CASO DE TIMEOUT O red, manteniendo el timestamp sin cambiar online
                    await db.collection('doors').doc(doorId).update({
                        "status.lastCheck": FieldValue.serverTimestamp()
                    });
                }

                // --- PAUSA CRÍTICA DE 2 SEGUNDOS ---
                await sleep(2000);
            }
        } catch (e) {
            console.error("💥 Error en ronda:", e);
        }

        // CONTROL DE TIEMPO PARA RONDAS DE 15S
        const elapsed = Date.now() - startTime;
        const waitTime = 15000 - elapsed;
        if (round < 4 && waitTime > 0) {
            console.log(`⏳ Esperando ráfaga...`);
            await sleep(waitTime);
        }
    }
});

exports.verifyTuyaCredentials = onCall(async (request) => {
    const { deviceId, accessId, accessSecret } = request.data;
    const contentSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const t = Date.now().toString();
    const sign = CryptoJS.HmacSHA256(accessId + t + `GET\n${contentSha256}\n\n/v1.0/token?grant_type=1`, accessSecret).toString(CryptoJS.enc.Hex).toUpperCase();
    try {
        const tokenRes = await fetch(`https://openapi.tuyaus.com/v1.0/token?grant_type=1`, { headers: { 'client_id': accessId, 'sign': sign, 't': t, 'sign_method': 'HMAC-SHA256' } });
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.result.access_token;
        const t2 = Date.now().toString();
        const sign2 = CryptoJS.HmacSHA256(accessId + accessToken + t2 + `GET\n${contentSha256}\n\n/v1.0/devices/${deviceId}`, accessSecret).toString(CryptoJS.enc.Hex).toUpperCase();
        const devRes = await fetch(`https://openapi.tuyaus.com/v1.0/devices/${deviceId}`, { headers: { 'client_id': accessId, 'access_token': accessToken, 'sign': sign2, 't': t2, 'sign_method': 'HMAC-SHA256' } });
        const devData = await devRes.json();
        return { success: true, name: devData.result.name, online: devData.result.online };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

exports.getTuyaHlsUrl = onCall(async (request) => {
    const { deviceId, accessId, accessSecret, uid } = request.data;
    try {
        const calculateSign = (method, path, body = "", t, accessToken = "") => {
            const contentSha256 = CryptoJS.SHA256(body).toString(CryptoJS.enc.Hex);
            return CryptoJS.HmacSHA256(accessId + accessToken + t + [method, contentSha256, "", path].join("\n"), accessSecret).toString(CryptoJS.enc.Hex).toUpperCase();
        };
        let t = Date.now().toString();
        let sign = calculateSign("GET", "/v1.0/token?grant_type=1", "", t);
        const tokenRes = await fetch(`https://openapi.tuyaus.com/v1.0/token?grant_type=1`, { headers: { client_id: accessId, sign, t, sign_method: "HMAC-SHA256" } });
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.result.access_token;
        const bodyStr = JSON.stringify({ "type": "hls" });
        t = Date.now().toString();
        const path = `/v1.0/users/${uid}/devices/${deviceId}/stream/actions/allocate`;
        sign = calculateSign("POST", path, bodyStr, t, accessToken);
        const hlsRes = await fetch(`https://openapi.tuyaus.com${path}`, { method: "POST", headers: { 'client_id': accessId, 'access_token': accessToken, 'sign': sign, 't': t, 'sign_method': 'HMAC-SHA256', "Content-Type": "application/json" }, body: bodyStr });
        const hlsData = await hlsRes.json();
        return { success: true, url: hlsData.result.url };
    } catch (e) {
        return { success: false, message: e.message };
    }
});
