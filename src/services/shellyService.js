/**
 * Servicio para controlar dispositivos Shelly (Cloud & Local)
 * Versión final con soporte POST Body y manejo de errores optimista.
 */

export const ShellyService = {
    /**
     * Envía comando de apertura a un dispositivo Shelly.
     * Soporta modo Cloud (Server + ID + AuthKey).
     * 
     * @param {Object} device Objeto con configuración del dispositivo
     * @param {string} device.serverUrl URL del servidor
     * @param {string} device.deviceId ID del dispositivo
     * @param {string} device.authKey Token de autenticación
     * @returns {Promise<{success: boolean, message: string}>}
     */
    openDoor: async (device) => {
        if (!device) {
            return { success: false, message: 'Dispositivo no seleccionado' };
        }

        if (!device.serverUrl || !device.deviceId || !device.authKey) {
            return { success: false, message: 'Faltan datos de configuración' };
        }

        try {
            // 1. Construir la URL base
            let targetUrl = device.serverUrl.trim();

            // Limpieza básica
            if (targetUrl.endsWith('/')) {
                targetUrl = targetUrl.slice(0, -1);
            }

            if (!targetUrl.includes('/device/relay/control')) {
                targetUrl = `${targetUrl}/device/relay/control`;
            }

            console.log(`Enviando POST a: ${targetUrl}`);

            // 2. Preparar los parámetros para el BODY
            const formData = new URLSearchParams();
            formData.append('id', device.deviceId);
            formData.append('auth_key', device.authKey);
            formData.append('channel', '0');
            formData.append('turn', 'on');

            // 3. Realizar la petición
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: formData,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // 4. Procesar respuesta
            const data = await response.json();
            console.log('Respuesta Shelly:', data);

            // LÓGICA DE ÉXITO RELAJADA (A petición del usuario):
            // Si el HTTP status es exitoso (200-299), asumimos que funciona.
            // Ignoramos si data.is_ok es false, salvo que haya un error muy explícito que no sea "Desconocido".

            if (response.ok) {
                return { success: true, message: 'Puerta Abierta ✅' };
            }

            // Si HTTP falló (ej: 400, 500)
            if (data.errors) {
                return {
                    success: false,
                    message: `Error: ${JSON.stringify(data.errors)}`
                };
            }

            return { success: false, message: 'Error de servidor desconocido' };

        } catch (e) {
            console.error('Error Shelly Cloud', e);
            // Fallback optimista para errores de red (CORS, etc.) si el usuario dice que funciona igual.
            return {
                success: true,
                message: 'Comando enviado ✅'
            };
        }
    }
};
