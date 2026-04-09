/**
 * Servicio para controlar dispositivos Shelly (Cloud & Local)
 * Versión v2.3.0: RETORNO A ESTABILIDAD (Legacy Universal).
 * Se eliminan protocolos RPC y verificaciones extra para garantizar apertura inmediata.
 */

const REQUEST_QUEUE = [];
let IS_PROCESSING_QUEUE = false;
const RATE_LIMIT_DELAY = 1200; // Velocidad óptima

const processQueue = async () => {
    if (REQUEST_QUEUE.length === 0) {
        IS_PROCESSING_QUEUE = false;
        return;
    }
    IS_PROCESSING_QUEUE = true;
    const currentRequest = REQUEST_QUEUE.shift();
    try {
        await currentRequest();
    } catch (e) {
        console.error("Queue execution error", e);
    }
    setTimeout(() => { processQueue(); }, RATE_LIMIT_DELAY);
};

const enqueueRequest = (requestFn) => {
    return new Promise((resolve, reject) => {
        const wrappedRequest = async () => {
            try {
                const result = await requestFn();
                resolve(result);
            } catch (e) { reject(e); }
        };
        REQUEST_QUEUE.push(wrappedRequest);
        if (!IS_PROCESSING_QUEUE) processQueue();
    });
};

export const ShellyService = {
    /**
     * Envía comando de apertura con protocolo Legacy (Máxima compatibilidad).
     */
    openDoor: async (device) => {
        return enqueueRequest(async () => {
            if (!device) return { success: false, message: 'Dispositivo no seleccionado' };
            if (!device.serverUrl || !device.deviceId || !device.authKey) return { success: false, message: 'Faltan datos' };

            try {
                let baseUrl = device.serverUrl.trim();
                if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

                // --- PROTOCOLO UNIVERSAL LEGACY ---
                const targetUrl = `${baseUrl}/device/relay/control`;
                const formData = new URLSearchParams();
                formData.append('id', device.deviceId);
                formData.append('auth_key', device.authKey);
                formData.append('channel', '0');
                formData.append('turn', 'on');

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000);

                const response = await fetch(targetUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);
                const data = await response.json();

                // SI LA NUBE NOS DA EL OK (COMO ANTES)
                if (response.ok && data.isok === true) {
                    return { success: true, message: 'Comando enviado ✅' };
                }

                // MANEJO BÁSICO DE ERRORES DE LA NUBE
                const msg = data.errors ? 'Límite o Error Genérico' : (data.message || 'Error Shelly');
                return { success: false, message: `¡Algo salió mal!: ${msg} ❌` };

            } catch (e) {
                console.error('Error Shelly Cloud', e);
                // En modo alta disponibilidad, incluso si hay un error de red pequeño, 
                // pero response fue exitoso, podríamos considerar que la orden se envió.
                return { success: false, message: 'Fallo de red 🚫' };
            }
        }, true);
    },

    /**
     * Verifica estado (Encolado).
     */
    checkStatus: async (device) => {
        return enqueueRequest(async () => {
            if (!device || !device.serverUrl || !device.deviceId || !device.authKey) {
                return { online: false };
            }
            try {
                let baseUrl = device.serverUrl.trim();
                if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

                const targetUrl = `${baseUrl}/device/status`;
                const params = new URLSearchParams();
                params.append('id', device.deviceId);
                params.append('auth_key', device.authKey);

                const fullUrl = `${targetUrl}?${params.toString()}`;
                const response = await fetch(fullUrl, { method: 'GET' });

                if (!response.ok) return { online: false };
                const data = await response.json();

                let isOnline = false;
                if (data.data && typeof data.data.online !== 'undefined') isOnline = data.data.online === true;
                else if (typeof data.connected !== 'undefined') isOnline = data.connected === true;

                return { online: isOnline };
            } catch (e) {
                return { online: false };
            }
        });
    }
};
