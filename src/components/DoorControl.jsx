import { useState, useEffect, useRef, useCallback } from 'react';
import UnlockButton from './UnlockButton';
import { ShellyService } from '../services/shellyService';
import { FirebaseService } from '../services/firebase';

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

    const [showLogs, setShowLogs] = useState(false);
    const [logs, setLogs] = useState([]);

    const handleUnlock = async () => {
        if (connectionState === 'offline') {
            const confirmForce = confirm(`"${device.name}" parece desconectada (${offlineReason}). ¿Forzar intento?`);
            if (!confirmForce) return { success: false, message: 'Cancelado' };
        }

        const result = await ShellyService.openDoor(device);

        if (result.success) {
            // Registrar acceso exitoso
            const user = FirebaseService.auth.currentUser;
            if (user) {
                FirebaseService.addAccessLog({
                    doorId: device.id,
                    doorName: device.name,
                    userId: user.uid,
                    userEmail: user.email,
                    userName: user.displayName || 'Usuario',
                    success: true
                }).catch(e => console.error("Log error:", e));
            }
        }

        if (onMessage) onMessage(result);
        return result;
    };

    const toggleLogs = async () => {
        if (!showLogs) {
            // Cargar logs al abrir
            const history = await FirebaseService.getLogsForDoor(device.id);
            setLogs(history);
        }
        setShowLogs(!showLogs);
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
                    style={{ display: 'flex', alignItems: 'center' }}
                >
                    <WifiStatusIcon state={connectionState} />
                </div>
            </div>

            <UnlockButton
                onUnlock={handleUnlock}
                onlineState={connectionState}
            />

            <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                    onClick={toggleLogs}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#aaa',
                        cursor: 'pointer',
                        fontSize: '0.9em',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                    }}
                >
                    📜 {showLogs ? 'Ocultar Historial' : 'Ver Historial'}
                </button>

                {connectionState === 'offline' && (
                    <span style={{ fontSize: '0.7em', color: '#e74c3c' }}>
                        ⚠️ {offlineReason || 'Sin conexión'}
                    </span>
                )}
            </div>

            {showLogs && (
                <div style={{ marginTop: '15px', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                    <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9em', color: '#ccc' }}>Últimos Accesos</h4>
                    {logs.length === 0 ? (
                        <p style={{ fontSize: '0.8em', color: '#666' }}>No hay registros recientes.</p>
                    ) : (
                        <table style={{ width: '100%', fontSize: '0.8em', borderCollapse: 'collapse', color: '#ddd' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #444', textAlign: 'left' }}>
                                    <th style={{ padding: '5px' }}>Usuario</th>
                                    <th style={{ padding: '5px' }}>Fecha</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map(log => (
                                    <tr key={log.id} style={{ borderBottom: '1px solid #333' }}>
                                        <td style={{ padding: '5px' }}>{log.userName || log.userEmail?.split('@')[0]}</td>
                                        <td style={{ padding: '5px' }}>
                                            {log.timestamp?.seconds ? new Date(log.timestamp.seconds * 1000).toLocaleString() : 'Reciente'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}
const WifiStatusIcon = ({ state }) => {
    const color = state === 'online' ? '#2ecc71' : (state === 'offline' ? '#e74c3c' : '#f1c40f');

    // Icono base de WiFi
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: state === 'online' ? 'drop-shadow(0 0 2px rgba(46, 204, 113, 0.5))' : 'none' }}
        >
            {state === 'offline' ? (
                // WiFi Off / Error
                <>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
                    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
                    <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
                    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                </>
            ) : (
                // WiFi Normal
                <>
                    <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
                    <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
                    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
                    <line x1="12" y1="20" x2="12.01" y2="20"></line>
                </>
            )}
        </svg>
    );
};
