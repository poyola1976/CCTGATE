/**
 * Servicio para controlar dispositivos Shelly (Cloud & Local)
 * Versión final depurada con retorno de datos para debug.
 */

export const ShellyService = {
    /**
     * Envía comando de apertura.
     */
    openDoor: async (device) => {
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
            return { success: true, message: 'Comando enviado ✅' };
        }
    },

    /**
     * Verifica estado con retorno de datos completos para debug.
     */
    checkStatus: async (device) => {
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
            const timeoutId = setTimeout(() => controller.abort(), 6000);

            const response = await fetch(fullHashUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

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
                // Fallback: Si no hay indicadores claros, es falso.
                isConnected = false;
            }

            return {
                online: isConnected,
                error: isConnected ? null : 'Offline/Unknown',
                data: data // IMPORTANTE: Devolvemos todo para el debug
            };

        } catch (e) {
            console.warn('Check Status failed:', e);
            return { online: false, error: e.name === 'AbortError' ? 'Timeout' : 'Error Red', data: null };
        }
    }
};
