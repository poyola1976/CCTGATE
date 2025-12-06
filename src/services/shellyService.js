/**
 * Servicio para controlar dispositivos Shelly (Cloud & Local)
 * Versión v1.3.1: Con Cola Global de Requests (Rate Limiter Integrado)
 */

// --- GLOBAL REQUEST QUEUE ---
const REQUEST_QUEUE = [];
let IS_PROCESSING_QUEUE = false;
const RATE_LIMIT_DELAY = 2200; // 2.2s entre peticiones (Seguridad)

// Procesador de Cola Recursivo
const processQueue = async () => {
    if (REQUEST_QUEUE.length === 0) {
        IS_PROCESSING_QUEUE = false;
        return;
    }

    IS_PROCESSING_QUEUE = true;
    const currentRequest = REQUEST_QUEUE.shift(); // FIFO

    try {
        await currentRequest(); // Ejecutar petición
    } catch (e) {
        console.error("Queue execution error", e);
    }

    // Esperar antes de la siguiente (Throttling)
    setTimeout(() => {
        processQueue();
    }, RATE_LIMIT_DELAY);
};

// Encolador de peticiones (Devuelve Promesa)
const enqueueRequest = (requestFn) => {
    return new Promise((resolve, reject) => {
        const wrappedRequest = async () => {
            try {
                const result = await requestFn();
                resolve(result);
            } catch (e) {
                reject(e);
            }
        };

        REQUEST_QUEUE.push(wrappedRequest);

        if (!IS_PROCESSING_QUEUE) {
            processQueue();
        }
    });
};

export const ShellyService = {
    /**
     * Envía comando de apertura (Encolado).
     */
    openDoor: async (device) => {
        return enqueueRequest(async () => {
            if (!device) return { success: false, message: 'Dispositivo no seleccionado' };
            if (!device.serverUrl || !device.deviceId || !device.authKey) return { success: false, message: 'Faltan datos' };

            try {
                let targetUrl = device.serverUrl.trim();
                if (targetUrl.endsWith('/')) targetUrl = targetUrl.slice(0, -1);
                if (!targetUrl.includes('/device/relay/control')) targetUrl = `${targetUrl}/device/relay/control`;

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

                if (response.ok) return { success: true, message: 'Puerta Abierta ✅' };
                if (data.errors) return { success: false, message: `Error: ${JSON.stringify(data.errors)}` };
                return { success: false, message: 'Error de servidor desconocido' };

            } catch (e) {
                console.error('Error Shelly Cloud', e);
                return { success: true, message: 'Comando enviado ✅' }; // Optimistic
            }
        });
    },

    /**
     * Verifica estado (Encolado).
     */
    checkStatus: async (device) => {
        return enqueueRequest(async () => {
            if (!device || !device.serverUrl || !device.deviceId || !device.authKey) {
                return { online: false, error: 'Config incompleta', data: null };
            }

            try {
                let baseUrl = device.serverUrl.trim();
                if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);

                let targetUrl;
                if (baseUrl.toLowerCase().includes('/device/relay/control')) {
                    targetUrl = baseUrl.replace(/\/device\/relay\/control/i, '/device/status');
                } else {
                    targetUrl = `${baseUrl}/device/status`;
                }

                const params = new URLSearchParams();
                params.append('id', device.deviceId);
                params.append('auth_key', device.authKey);
                params.append('_t', Date.now());

                const fullHashUrl = `${targetUrl}?${params.toString()}`;

                const formData = new URLSearchParams();
                formData.append('id', device.deviceId);
                formData.append('auth_key', device.authKey);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout para permitir cola

                const response = await fetch(fullHashUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.status === 429) {
                    console.warn("429 Rate Limit hit inside Queue");
                    // Opcional: Podríamos pausar la cola más tiempo aquí, pero el delay base debería bastar.
                    return { online: false, error: 'BUSY (429)', data: null };
                }

                if (!response.ok) {
                    return { online: false, error: `HTTP ${response.status}`, data: null };
                }

                const data = await response.json();

                // VALIDACIÓN ESTRICTA
                let isConnected = false;

                if (data.data && typeof data.data.connected !== 'undefined') {
                    isConnected = data.data.connected === true;
                } else if (typeof data.connected !== 'undefined') {
                    isConnected = data.connected === true;
                } else if (data.data && typeof data.data.online !== 'undefined') {
                    isConnected = data.data.online === true;
                } else {
                    isConnected = false;
                }

                // INTENTAR EXTRAER IP
                let deviceIp = null;
                const findIp = (obj) => {
                    if (!obj) return null;
                    if (obj.wifi_sta && obj.wifi_sta.ip) return obj.wifi_sta.ip;
                    if (obj.wifi && obj.wifi.sta_ip) return obj.wifi.sta_ip;
                    if (obj.wifi && obj.wifi.ip) return obj.wifi.ip;
                    if (obj.device_status) return findIp(obj.device_status);
                    if (obj.data) return findIp(obj.data);
                    return null;
                };

                deviceIp = findIp(data);

                return {
                    online: isConnected,
                    ip: deviceIp,
                    error: isConnected ? null : 'Offline/Unknown',
                    data: data
                };

            } catch (e) {
                console.warn('Check Status failed:', e);
                return { online: false, error: e.name === 'AbortError' ? 'Timeout' : 'Error Red', data: null };
            }
        });
    }
};
