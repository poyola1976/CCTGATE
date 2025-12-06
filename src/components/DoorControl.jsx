import { useState, useEffect, useRef, useCallback } from 'react';
import UnlockButton from './UnlockButton';
import { ShellyService } from '../services/shellyService';

export default function DoorControl({ device, onMessage }) {
    const [connectionState, setConnectionState] = useState('checking'); // checking, online, offline
    const [offlineReason, setOfflineReason] = useState(null);
    const [deviceIp, setDeviceIp] = useState(null);

    // Referencia para la lógica del loop
    const savedCallback = useRef();

    // Referencia para el punto de estado (animación)
    const dotRef = useRef(null);

    // Lógica de Chequeo
    const performCheck = useCallback(async () => {
        if (!device) return;

        try {
            // Feedback visual sutil (Parpadeo)
            if (dotRef.current) {
                dotRef.current.style.transition = 'opacity 0.2s';
                dotRef.current.style.opacity = '0.3';
            }

            // Ya no nos preocupamos por 429 aquí, el servicio tiene una COLA FIFO.
            // Simplemente esperamos nuestro turno.
            const result = await ShellyService.checkStatus(device);

            // Restaurar opacidad
            if (dotRef.current) {
                dotRef.current.style.opacity = '1';
            }

            const isOnline = result.online;

            // Actualizar estados
            setConnectionState(prev => {
                const newState = isOnline ? 'online' : 'offline';
                return prev !== newState ? newState : prev;
            });
            setOfflineReason(isOnline ? null : result.error);

            // Gestionar IP
            if (result.ip) {
                setDeviceIp(result.ip);
            } else if (!isOnline) {
                setDeviceIp(null);
            }

        } catch (e) {
            console.error("Polling error for " + device.name, e);
        }
    }, [device]);

    // Mantener la callback fresca
    useEffect(() => {
        savedCallback.current = performCheck;
    }, [performCheck]);

    // MOTOR DE POLLING SIMPLIFICADO (Delegamos el Rate Limit al Servicio)
    useEffect(() => {
        let timerId;
        let isActive = true;

        const loop = async () => {
            if (!isActive) return;

            // Ejecutar check (se encolará en el servicio)
            if (savedCallback.current) {
                await savedCallback.current();
            }

            // Intervalo regular de 15s. 
            // Si hay mucha cola en el servicio, esta función simplemente se pausará en el 'await' anterior.
            // Añadimos un pequeño jitter (0-2s) solo para naturalidad.
            const nextDelay = 15000 + (Math.random() * 2000);

            if (isActive) {
                timerId = setTimeout(loop, nextDelay);
            }
        };

        // Inicio con JITTER (Retraso inicial aleatorio 0-4s)
        const initialDelay = Math.random() * 4000;
        timerId = setTimeout(loop, initialDelay);

        return () => {
            isActive = false;
            if (timerId) clearTimeout(timerId);
        };
    }, [device]);

    const handleUnlock = async () => {
        if (connectionState === 'offline') {
            const confirmForce = confirm(`"${device.name}" parece desconectada (${offlineReason}). ¿Forzar intento?`);
            if (!confirmForce) return { success: false, message: 'Cancelado' };
        }

        const result = await ShellyService.openDoor(device);
        if (onMessage) onMessage(result);
        return result;
    };

    return (
        <div className="door-control-card" style={{
            marginBottom: '20px',
            padding: '15px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.1)'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>{device.name}</h2>
                <div
                    ref={dotRef}
                    title={connectionState === 'offline' ? `Offline: ${offlineReason}` : connectionState}
                    style={{
                        width: '10px', height: '10px', borderRadius: '50%',
                        background: connectionState === 'online' ? '#2ecc71' : (connectionState === 'offline' ? '#e74c3c' : '#f1c40f'),
                        boxShadow: connectionState === 'online' ? '0 0 5px #2ecc71' : 'none'
                    }}
                />
            </div>

            <UnlockButton
                onUnlock={handleUnlock}
                onlineState={connectionState}
            />

            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                {connectionState === 'offline' ? (
                    <span style={{ fontSize: '0.7em', color: '#e74c3c' }}>
                        ⚠️ {offlineReason || 'Sin conexión'}
                    </span>
                ) : (
                    deviceIp && (
                        <span style={{ fontSize: '0.75em', color: '#2ecc71', fontFamily: 'monospace' }}>
                            IP: {deviceIp}
                        </span>
                    )
                )}
            </div>
        </div>
    );
}
