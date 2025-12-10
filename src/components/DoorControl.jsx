import { useState, useRef } from 'react';
import UnlockButton from './UnlockButton';
import { ShellyService } from '../services/shellyService';
import { FirebaseService } from '../services/firebase';

export default function DoorControl({ device, onMessage, isAdmin }) {
    // Modo Enterprise: Leemos el estado directamente del objeto device (que viene de Firestore en tiempo real)
    // El Backend (Monitor Service) se encarga de actualizar device.status { online, error, ip, lastCheck }

    // Si no hay status reportado aún, asumimos "checking" o desconectado
    const isOnline = device.status?.online === true;
    let connectionState = isOnline ? 'online' : 'offline';
    const offlineReason = device.status?.error || 'Sin señal del Monitor';

    if (!isOnline && offlineReason && (offlineReason.includes('429') || offlineReason.includes('BUSY'))) {
        connectionState = 'busy';
    }

    // IP reportada por el monitor
    // const deviceIp = device.status?.ip; 

    // Referencia para el punto de estado (animación si quisiéramos, pero ahora es pasivo)
    const dotRef = useRef(null);

    const [showLogs, setShowLogs] = useState(false);
    const [showUsers, setShowUsers] = useState(false);
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
            setShowUsers(false); // Mutually exclusive
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
                    title={connectionState === 'offline' ? `Offline: ${offlineReason}` : `Online (Monitor Central)`}
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
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        onClick={toggleLogs}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: showLogs ? '#fff' : '#aaa',
                            cursor: 'pointer',
                            fontSize: '0.9em',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                        }}
                    >
                        📜 {showLogs ? 'Ocultar Historial' : 'Ver Historial'}
                    </button>
                    {isAdmin && (
                        <button
                            onClick={() => {
                                if (!showUsers) setShowLogs(false); // Mutually exclusive
                                setShowUsers(!showUsers);
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: showUsers ? '#fff' : '#aaa',
                                cursor: 'pointer',
                                fontSize: '0.9em',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px'
                            }}
                        >
                            👥 {showUsers ? 'Ocultar Usuarios' : 'Usuarios Autorizados'}
                        </button>
                    )}
                </div>

                {connectionState === 'offline' && (
                    <span style={{ fontSize: '0.7em', color: '#e74c3c' }}>
                        ⚠️ {offlineReason}
                    </span>
                )}
            </div>

            {
                showLogs && (
                    <div style={{ marginTop: '15px', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9em', color: '#ccc' }}>Últimos Accesos</h4>
                        {logs.length === 0 ? (
                            <p style={{ fontSize: '0.8em', color: '#666' }}>No hay registros recientes.</p>
                        ) : (
                            <table style={{ width: '100%', fontSize: '0.8em', borderCollapse: 'collapse', color: '#ddd' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid #444', textAlign: 'left' }}>
                                        <th style={{ padding: '5px', width: '30px' }}>#</th>
                                        <th style={{ padding: '5px' }}>Usuario</th>
                                        <th style={{ padding: '5px' }}>Fecha</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log, index) => (
                                        <tr key={log.id} style={{ borderBottom: '1px solid #333' }}>
                                            <td style={{ padding: '5px', color: '#888' }}>{index + 1}</td>
                                            <td style={{ padding: '5px' }}>{log.userEmail || log.userName}</td>
                                            <td style={{ padding: '5px' }}>
                                                {log.timestamp?.seconds ? new Date(log.timestamp.seconds * 1000).toLocaleString() : 'Reciente'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )
            }

            {
                showUsers && (
                    <div style={{ marginTop: '15px', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                        <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9em', color: '#ccc' }}>Usuarios Autorizados</h4>
                        {(!device.allowedEmails || device.allowedEmails.length === 0) ? (
                            <p style={{ fontSize: '0.8em', color: '#e74c3c' }}>⚠️ Lista vacía (Nadie asignado)</p>
                        ) : (
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.9em', color: '#ddd' }}>
                                {device.allowedEmails.map((email, i) => (
                                    <li key={i} style={{ padding: '5px 0', borderBottom: '1px solid #333' }}>
                                        <span style={{ color: '#888', marginRight: '5px' }}>{i + 1}.</span> {email}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )
            }
        </div >
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
