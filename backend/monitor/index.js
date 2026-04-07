import admin from 'firebase-admin';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import fs from 'fs';
import fetch from 'node-fetch'; // Aseguramos compatibilidad 2026

dotenv.config();

const POLLING_INTERVAL_MS = 20000;
const SHELLY_TIMEOUT_MS = 10000;
const INTER_DEVICE_DELAY_MS = 1000;

let db;

try {
    const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
    initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    db = getFirestore();
    console.log("🔥 Firebase Admin conectado.");
} catch (error) {
    console.error("❌ Error Firebase Admin.");
    process.exit(1);
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function checkShellyStatus(door) {
    if (!door.serverUrl || !door.deviceId || !door.authKey) {
        return { online: false, error: 'Config incompleta' };
    }

    let baseUrl = door.serverUrl.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    // FORZAMOS EL ENDPOINT DE LA IMAGEN: /device/status
    let statusUrl = baseUrl.includes('/relay/control')
        ? baseUrl.replace(/\/relay\/control/i, '/status')
        : `${baseUrl}/device/status`;

    // CUERPO EXACTO SEGÚN POSTMAN: x-www-form-urlencoded
    const body = new URLSearchParams();
    body.append('id', door.deviceId);
    body.append('auth_key', door.authKey);

    try {
        const response = await fetch(statusUrl, {
            method: 'POST',
            body: body,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: SHELLY_TIMEOUT_MS
        });

        if (!response.ok) return { online: false, error: `HTTP ${response.status}` };

        const res = await response.json();

        // --- LÓGICA DE DETECCIÓN EXACTA ---
        let isOnline = false;
        if (res.isok && res.data) {
            // Buscamos 'online' en la raíz de 'data' o en 'device_status' según el modelo
            isOnline = res.data.online === true ||
                res.data.status?.online === true ||
                res.data.connected === true;
        }

        return {
            online: isOnline,
            ip: res.data?.device_status?.wifi_sta?.ip || res.data?.wifi_sta?.ip || null,
            error: res.isok ? (isOnline ? null : 'Reportado Offline por Shelly') : 'Respuesta API Inválida',
            lastSeen: new Date().toISOString()
        };

    } catch (error) {
        return { online: false, error: `Error: ${error.message}` };
    }
}

async function runMonitor() {
    console.log(`\n🔍 Verificando estados... (${new Date().toLocaleTimeString()})`);
    try {
        const snap = await db.collection('doors').get();
        for (const doc of snap.docs) {
            const door = doc.data();
            const status = await checkShellyStatus(door);
            console.log(`   > ${door.name || doc.id}: ${status.online ? '✅ ONLINE' : '🔴 OFF'} (${status.error || 'OK'})`);

            await db.collection('doors').doc(doc.id).update({
                status: {
                    ...status,
                    lastCheck: admin.firestore.FieldValue.serverTimestamp()
                }
            });
            await delay(INTER_DEVICE_DELAY_MS);
        }
    } catch (e) {
        console.error("💥 Error en ciclo:", e.message);
    }
    setTimeout(runMonitor, POLLING_INTERVAL_MS);
}

runMonitor();
console.log("🚀 Monitor Shelly v2.2 (Final Fix) Iniciado");
