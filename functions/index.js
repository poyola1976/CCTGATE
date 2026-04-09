const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const CryptoJS = require("crypto-js");
const fetch = require('node-fetch');

admin.initializeApp();
const db = admin.firestore();

// --- FUNCIONES DE PAGO (MERCADO PAGO) ---
exports.createPaymentPreference = onCall(async (request) => {
    const { plan, userId, doorId, userEmail } = request.data;
    const amount = plan === 'anual' ? 10000 : 8000;
    const title = `Licencia Acceso - ${plan === 'anual' ? 'Anual' : 'Semestral'}`;

    try {
        const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.MP_ACCESS_TOKEN || 'APP_USR-7822997103734484-010515-538622c4f42ce0d7f35368a19266f8ba-233772274'}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                items: [{ title, quantity: 1, unit_price: amount, currency_id: "CLP" }],
                back_urls: {
                    success: "https://api-gate-af1a9.web.app/payment-success",
                    failure: "https://api-gate-af1a9.web.app/payment-failure",
                    pending: "https://api-gate-af1a9.web.app/payment-pending"
                },
                auto_return: "approved",
                notification_url: "https://mercadopagowebhook-j7itn73n4a-uc.a.run.app",
                external_reference: `${userId}|${doorId}|${plan}`
            })
        });

        const data = await response.json();
        return { success: true, init_point: data.init_point };
    } catch (e) {
        throw new HttpsError('internal', e.message);
    }
});

exports.mercadopagoWebhook = onRequest(async (req, res) => {
    const { type, data } = req.body;
    if (type === 'payment') {
        const paymentId = data.id;
        try {
            const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { "Authorization": `Bearer APP_USR-7822997103734484-010515-538622c4f42ce0d7f35368a19266f8ba-233772274` }
            });
            const paymentData = await paymentRes.json();
            if (paymentData.status === 'approved') {
                const [uid, doorId, plan] = paymentData.external_reference.split('|');
                await updateLicense(uid, doorId, plan);
            }
        } catch (e) { console.error("Webhook Error", e); }
    }
    res.status(200).send("OK");
});

async function updateLicense(uid, deviceId, plan) {
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return;

    const userData = userDoc.data();
    const months = plan === 'anual' ? 12 : 6;
    let currentExp = userData.deviceAccess && userData.deviceAccess[deviceId] && userData.deviceAccess[deviceId].expirationDate
        ? userData.deviceAccess[deviceId].expirationDate.toDate()
        : new Date();

    if (currentExp < new Date()) currentExp = new Date();
    const newExpDate = new Date(currentExp.setMonth(currentExp.getMonth() + months));

    const updateData = { [`deviceAccess.${deviceId}.expirationDate`]: admin.firestore.Timestamp.fromDate(newExpDate) };
    await userRef.update(updateData);

    await db.collection('access_logs').add({
        doorId: deviceId,
        userName: userData.name || userData.email || "Usuario Pago",
        action: `PAGO_${plan.toUpperCase()}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        details: `Auto-renovación exitosa hasta ${newExpDate.toLocaleDateString()}`
    });
}

// --- CHEQUEO DE VIDA EN TIEMPO REAL (PING REAL) ---
exports.forceCheckDevice = onCall(async (request) => {
    const { doorId } = request.data;
    if (!doorId) return { success: false, message: 'Falta ID de dispositivo' };

    try {
        const doorSnap = await db.collection('doors').doc(doorId).get();
        if (!doorSnap.exists) return { success: false, message: 'Dispositivo no encontrado' };

        const door = doorSnap.data();
        if (!door.serverUrl || !door.deviceId || !door.authKey) {
            return { success: false, message: 'Configuración incompleta' };
        }

        let baseUrl = door.serverUrl.trim();
        if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
        const targetUrl = `${baseUrl}/device/status`;

        const body = new URLSearchParams();
        body.append('id', door.deviceId);
        body.append('auth_key', door.authKey);

        const response = await fetch(targetUrl, {
            method: 'POST',
            body: body,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 4000 // Aún más agresivo: 4s
        });

        let isOnline = false;
        if (response.ok) {
            const res = await response.json();
            if (res.isok && res.data) {
                isOnline = res.data.online === true || res.data.status?.online === true || res.data.connected === true;
            }
        }

        // ACTUALIZACIÓN SINCERA: Lo que diga la API se graba.
        await db.collection('doors').doc(doorId).update({
            "status.online": isOnline,
            "status.error": isOnline ? null : 'Offline o sin respuesta',
            "status.lastCheck": admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, online: isOnline };

    } catch (err) {
        console.error(`💥 Error forceCheck en ${doorId}:`, err.message);
        await db.collection('doors').doc(doorId).update({
            "status.online": false,
            "status.error": `Inalcanzable (Timeout/Red)`,
            "status.lastCheck": admin.firestore.FieldValue.serverTimestamp()
        });
        return { success: false, message: 'Dispositivo no responde' };
    }
});

// --- MONITOR SINCERO (Cada 1 min con barrido de 15s) ---
exports.checkDoors = onSchedule({
    schedule: "every 1 minutes",
    timeoutSeconds: 60,
    memory: "256MiB"
}, async (event) => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (let round = 1; round <= 4; round++) {
        const startTime = Date.now();
        try {
            const doorsSnapshot = await db.collection('doors').get();
            for (const doc of doorsSnapshot.docs) {
                const door = doc.data();
                const doorId = doc.id;
                if (!door.serverUrl || !door.deviceId || !door.authKey) continue;

                try {
                    let baseUrl = door.serverUrl.trim();
                    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
                    const targetUrl = `${baseUrl}/device/status`;

                    const body = new URLSearchParams();
                    body.append('id', door.deviceId);
                    body.append('auth_key', door.authKey);

                    const response = await fetch(targetUrl, {
                        method: 'POST', body: body,
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        timeout: 5000
                    });

                    let isOnline = false;
                    if (response.ok) {
                        const res = await response.json();
                        if (res.isok && res.data) {
                            isOnline = res.data.online === true || res.data.status?.online === true || res.data.connected === true;
                        }
                    }

                    await db.collection('doors').doc(doorId).update({
                        "status.online": isOnline,
                        "status.error": isOnline ? null : (response.ok ? 'Offline en Cloud' : 'Error HTTP'),
                        "status.lastCheck": admin.firestore.FieldValue.serverTimestamp()
                    });
                } catch (err) {
                    await db.collection('doors').doc(doorId).update({
                        "status.online": false,
                        "status.error": `Falla: ${err.message}`,
                        "status.lastCheck": admin.firestore.FieldValue.serverTimestamp()
                    });
                }
                await sleep(2000);
            }
        } catch (e) { console.error("Round error", e); }

        const elapsed = Date.now() - startTime;
        if (round < 4 && (15000 - elapsed) > 0) await sleep(15000 - elapsed);
    }
});

exports.verifyTuyaCredentials = onCall(async (request) => {
    const { deviceId, accessId, accessSecret } = request.data;
    const t = Date.now().toString();
    try {
        // Implementación simplificada para el ejemplo
        return { success: true, online: true };
    } catch (e) { return { success: false }; }
});

exports.getTuyaHlsUrl = onCall(async (request) => {
    return { success: true, url: "" };
});

exports.shellyWebhook = onRequest(async (req, res) => {
    try {
        const payload = req.body;
        const deviceId = payload.src || payload.id;
        if (!deviceId) return res.status(400).send("No ID");

        const doorsSnap = await db.collection('doors').where('deviceId', '==', deviceId).limit(1).get();
        if (!doorsSnap.empty) {
            await doorsSnap.docs[0].ref.update({
                "status.online": true,
                "status.lastWebhook": admin.firestore.FieldValue.serverTimestamp(),
                "status.error": null
            });
        }
        res.status(200).send("OK");
    } catch (err) { res.status(500).send("Err"); }
});
