import admin from 'firebase-admin';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// --- CONFIGURACIÓN ---
const POLLING_INTERVAL_MS = 30000; // 30 segundos (Rate Limit Friendly)
const SHELLY_TIMEOUT_MS = 5000;
const INTER_DEVICE_DELAY_MS = 2000; // 2 segundos entre peticiones

// Inicialización de Firebase
// NOTA: Se requiere el archivo 'serviceAccountKey.json' en este directorio
// O las variables de entorno configuradas.
let db;

try {
    const serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
    initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    db = getFirestore();
    console.log("🔥 Firebase Admin conectado exitosamente.");
} catch (error) {
    console.error("❌ Error iniciando Firebase Admin. Verifica que 'serviceAccountKey.json' exista.");
    console.error(error.message);
    process.exit(1);
}

// Helper de espera
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- LÓGICA DE SHELLY ---

/**
 * Consulta el estado de un dispositivo Shelly a través de la nube
 */
async function checkShellyStatus(door) {
    if (!door.serverUrl || !door.deviceId || !door.authKey) {
        return { online: false, error: 'Config incomplète' };
    }

    // Construir URL (Cloud API)
    let baseUrl = door.serverUrl.trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

    // Normalizar a /device/status
    let targetUrl;
    if (baseUrl.toLowerCase().includes('/device/relay/control')) {
        targetUrl = baseUrl.replace(/\/device\/relay\/control/i, '/device/status');
    } else {
        targetUrl = `${baseUrl}/device/status`;
    }

    const params = new URLSearchParams();
    params.append('id', door.deviceId);
    params.append('auth_key', door.authKey);
    params.append('_t', Date.now()); // Anti-cache

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
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        clearTimeout(timeout);

        if (response.status === 429) {
            return { online: false, error: '⚠️ BUSY (429)' };
        }

        if (!response.ok) {
            return { online: false, error: `HTTP ${response.status}` };
        }

        const data = await response.json();

        // Determinar "Online" basado en la respuesta de Shelly Cloud
        // La API suele devolver "data: { online: true, ... }" o directamente "{ isok: true, data: { ... } }"
        let isOnline = false;

        if (data.data && typeof data.data.online !== 'undefined') {
            isOnline = data.data.online;
        } else if (data.data && typeof data.data.connected !== 'undefined') {
            isOnline = data.data.connected;
        } else {
            // Fallback: Si responde JSON válido, asumimos que "el servidor responde", 
            // pero para estar "Online" el dispositivo debe estar conectado a la nube.
            // Shelly Cloud devuelve { isok: true, data: { online: false } } si el dispositivo está desconectado.
            isOnline = false;
        }

        return {
            online: isOnline,
            ip: data.data?.ip || null,
            lastSeen: new Date().toISOString()
        };

    } catch (error) {
        return { online: false, error: error.name === 'AbortError' ? 'Timeout' : error.message };
    }
}

// --- BUCLE PRINCIPAL ---

async function runMonitor() {
    console.log(`\n🔍 Iniciando ciclo de monitoreo... (${new Date().toLocaleTimeString()})`);

    try {
        const doorsSnapshot = await db.collection('doors').get();
        if (doorsSnapshot.empty) {
            console.log("⚠️ No hay puertas configuradas en la base de datos.");
            return;
        }

        const updates = [];

        for (const doc of doorsSnapshot.docs) {
            const door = doc.data();
            const doorId = doc.id;

            console.log(`   > Verificando: ${door.name || doorId}...`);

            // Petición a Shelly
            const status = await checkShellyStatus(door);

            // Pausa entre dispositivos para evitar 429 en ráfaga
            await delay(INTER_DEVICE_DELAY_MS);

            // Logging amigable
            let logSymbol = status.online ? '✅' : '🔴';
            if (status.error && status.error.includes('429')) logSymbol = '🟠';

            console.log(`     ${logSymbol} Estado: ${status.online ? 'ONLINE' : 'OFFLINE'} (${status.error || status.ip})`);

            // Preparar actualización en Firestore
            // Guardamos en un campo 'status' separado para no sobreescribir la config
            const updatePromise = db.collection('doors').doc(doorId).update({
                status: {
                    ...status,
                    lastCheck: admin.firestore.FieldValue.serverTimestamp()
                }
            }).catch(err => console.error(`❌ Error actualizando ${door.name}:`, err.message));

            updates.push(updatePromise);
        }

        await Promise.all(updates);
        console.log("💾 Estados actualizados en Firestore.");

    } catch (error) {
        console.error("💥 Error en el ciclo principal:", error);
    }

    // Programar siguiente ciclo
    setTimeout(runMonitor, POLLING_INTERVAL_MS);
}

// Arrancar
console.log("🚀 Door Monitor Service v1.1 (Rate Limit Optimized) Iniciado");
console.log(`🕒 Intervalo: ${POLLING_INTERVAL_MS / 1000}s | Delay entre puertas: ${INTER_DEVICE_DELAY_MS}ms`);
runMonitor();
