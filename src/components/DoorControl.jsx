import { useState, useRef, useEffect } from 'react';
import UnlockButton from './UnlockButton';
import { ShellyService } from '../services/shellyService';
import { FirebaseService } from '../services/firebase';
import { UserService } from '../services/userService';
import flvjs from 'flv.js';
import Hls from 'hls.js';

export default function DoorControl({ device, onMessage, isAdmin, userProfile, camera }) {
    // Modo Enterprise: Leemos el estado directamente del objeto device

    // Si no hay status reportado aún, asumimos "checking" o desconectado
    let isOnline = device.status?.online === true;
    let offlineReason = device.status?.error || 'Sin señal del Monitor';

    // VERIFICACIÓN DE OBSOLESCENCIA (Stale Check)
    if (device.status?.lastCheck?.seconds) {
        const lastCheckDate = new Date(device.status.lastCheck.seconds * 1000);
        const now = new Date();
        const diffSeconds = (now - lastCheckDate) / 1000;

        if (diffSeconds > 300) { // 5 minutos
            isOnline = false;
            offlineReason = `Monitor Detenido (${Math.floor(diffSeconds / 60)} min)`;
        }
    }

    let connectionState = isOnline ? 'online' : 'offline';

    if (!isOnline && offlineReason && (offlineReason.includes('429') || offlineReason.includes('BUSY'))) {
        connectionState = 'busy';
    }

    // --- CHECK DE LICENCIA ---
    const accessCheck = (!isAdmin && userProfile)
        ? UserService.checkUserAccess(userProfile, device.id)
        : { allowed: true };

    const [showCamera, setShowCamera] = useState(false);
    const [streamStatus, setStreamStatus] = useState('init'); // init, loading, playing, error
    const [streamError, setStreamError] = useState('');
    const videoRef = useRef(null);
    const playerRef = useRef(null);
    const dotRef = useRef(null);

    const [showLogs, setShowLogs] = useState(false);
    const [logs, setLogs] = useState([]);
    const [showUsers, setShowUsers] = useState(false);

    const [authorizedUsersData, setAuthorizedUsersData] = useState({});

    const handleUnlock = async () => {
        // 1. Verificación básica de licencia (redundante pero segura)
        if (!accessCheck.allowed) {
            return { success: false, message: 'Licencia inválida' };
        }

        // 2. Bloqueo por Offline (Optimista: Avisar pero permitir forzar)
        if (connectionState === 'offline') {
            const confirmForce = confirm(`"${device.name}" parece desconectada (${offlineReason}). ¿Forzar intento?`);
            if (!confirmForce) return { success: false, message: 'Cancelado' };
        }

        // 3. Enviar comando de apertura directamente (Optimistic)
        const result = await ShellyService.openDoor(device);

        if (result.success) {
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
            setShowUsers(false);
            const history = await FirebaseService.getLogsForDoor(device.id);
            setLogs(history);
        }
        setShowLogs(!showLogs);
    };

    const toggleUsers = async () => {
        if (!showUsers) {
            setShowLogs(false);
            if (isAdmin && device.allowedEmails && device.allowedEmails.length > 0) {
                try {
                    const fetchedUsers = await UserService.getUsersByEmails(device.allowedEmails);
                    const userMap = {};
                    fetchedUsers.forEach(u => {
                        if (u.email) userMap[u.email.toLowerCase()] = u;
                    });
                    setAuthorizedUsersData(userMap);
                } catch (e) {
                    console.error("Error fetching authorized users details", e);
                }
            }
        }
        setShowUsers(!showUsers);
    };

    useEffect(() => {
        if (showCamera && camera && camera.type === 'rtmp') {
            // Safety check for library availability
            if (flvjs && flvjs.isSupported()) {
                // Cleanup previous player
                if (playerRef.current) {
                    playerRef.current.destroy();
                    playerRef.current = null;
                }

                try {
                    // Construct URL
                    const port = 8000;

                    // Restore Dynamic URL logic
                    const serverIp = camera.rtmpServerIp || '64.176.19.27';
                    // Fallback to 'cam1' only if no stream key is present, but prefer the object's key
                    const streamKey = camera.rtmpStreamKey || 'cam1';
                    const url = `http://${serverIp}:${port}/live/${streamKey}.flv`;

                    setStreamStatus('loading');

                    // Default configuration
                    const flvPlayer = flvjs.createPlayer({
                        type: 'flv',
                        url: url,
                        isLive: true,
                        hasAudio: false,
                        cors: true
                    });

                    flvPlayer.attachMediaElement(videoRef.current);
                    flvPlayer.load();

                    const playPromise = flvPlayer.play();
                    if (playPromise !== undefined) {
                        playPromise.then(() => {
                            setStreamStatus('playing');
                            setStreamError('');
                        }).catch(err => {
                            console.error("FLV Play Warning:", err);
                        });
                    }

                    flvPlayer.on(flvjs.Events.STATISTICS_INFO, () => {
                        if (streamStatus !== 'playing') setStreamStatus('playing');
                    });

                    flvPlayer.on(flvjs.Events.ERROR, (type, details) => {
                        console.error("FLV Error:", type, details);
                        setStreamStatus('error');
                        setStreamError(`Error Stream: ${type}`);
                    });

                    playerRef.current = flvPlayer;

                } catch (err) {
                    console.error("CRITICAL FLV INIT ERROR:", err);
                    setStreamStatus('error');
                    setStreamError('Error crítico al iniciar video: ' + err.message);
                }
            } else {
                setStreamStatus('error');
                setStreamError('Navegador no soporta FLV (o librería no cargada)');
            }
        }

        return () => {
            if (playerRef.current) {
                // Check if destroy exists (it might be null if init failed)
                if (playerRef.current.destroy) playerRef.current.destroy();
                playerRef.current = null;
            }
        };
    }, [showCamera, camera]);

    // --- EFFECT: HLS (Tuya) ---
    useEffect(() => {
        if (showCamera && camera) {
            console.log("DoorControl: Cámara activada", { type: camera.type, id: camera.id });

            if (camera.type === 'tuya') {
                let hls = null;
                const initHls = async () => {
                    setStreamStatus('loading');
                    try {
                        const devId = camera.tuyaDeviceId || camera.tuyaId || camera.id;
                        const uId = camera.tuyaUid || camera.uid || camera.userId;

                        console.log("Solicitando URL HLS para Tuya...", { devId, uId });

                        if (!devId || !uId) {
                            throw new Error(`Datos de cámara Tuya incompletos. DevID: ${devId}, UID: ${uId}`);
                        }

                        const response = await FirebaseService.getTuyaHlsUrl({
                            deviceId: devId,
                            tuyaId: devId,
                            userId: uId,
                            uid: uId
                        });

                        if (!response.data || !response.data.success) {
                            throw new Error(response.data?.message || "Error al obtener Stream URL");
                        }

                        const hlsUrl = response.data.url;
                        console.log("URL HLS recibida:", hlsUrl);

                        if (Hls.isSupported()) {
                            hls = new Hls();
                            hls.loadSource(hlsUrl);
                            hls.attachMedia(videoRef.current);

                            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                                setStreamStatus('playing');
                                videoRef.current.play().catch(e => console.error("AutoPlay blocked", e));
                            });

                            hls.on(Hls.Events.ERROR, (event, data) => {
                                if (data.fatal) {
                                    setStreamStatus('error');
                                    setStreamError(`Error Fatal: ${data.details}`);
                                    switch (data.type) {
                                        case Hls.ErrorTypes.NETWORK_ERROR:
                                            hls.startLoad();
                                            break;
                                        case Hls.ErrorTypes.MEDIA_ERROR:
                                            hls.recoverMediaError();
                                            break;
                                        default:
                                            hls.destroy();
                                            break;
                                    }
                                }
                            });

                            playerRef.current = hls;

                        } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
                            videoRef.current.src = hlsUrl;
                            videoRef.current.addEventListener('loadedmetadata', () => {
                                setStreamStatus('playing');
                                videoRef.current.play();
                            });
                        } else {
                            throw new Error("Navegador no soporta HLS");
                        }

                    } catch (error) {
                        console.error("Error Tuya Stream:", error);
                        setStreamStatus('error');
                        setStreamError(error.message);
                    }
                };

                initHls();

                return () => {
                    if (hls) {
                        hls.destroy();
                    }
                    if (playerRef.current && typeof playerRef.current.destroy === 'function') {
                        if (camera.type === 'tuya') playerRef.current = null;
                    }
                    setStreamStatus('init');
                };
            }
        }
    }, [showCamera, camera]);

    return (
        <div className="door-control-card" style={{
            marginBottom: '20px',
            padding: '15px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '12px',
            border: '1px solid rgba(255,255,255,0.1)',
            position: 'relative',
            opacity: !accessCheck.allowed ? 0.7 : 1
        }}>
            {!accessCheck.allowed && (
                <div style={{
                    position: 'absolute', top: 10, right: 10,
                    background: '#c0392b', color: 'white',
                    padding: '2px 8px', borderRadius: '12px',
                    fontSize: '0.7em', fontWeight: 'bold', zIndex: 10
                }}>
                    ⛔ VENCIDO
                </div>
            )}

            {/* HEADER: TITLE & STATUS */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>{device.name}</h2>
                <div
                    ref={dotRef}
                    title={connectionState === 'offline' ? `Offline: ${offlineReason}` : `Online`}
                    style={{ display: 'flex', alignItems: 'center' }}
                >
                    <WifiStatusIcon state={connectionState} />
                </div>
            </div>

            {/* TWIN CIRCLES LAYOUT: IMAGE & BUTTON */}
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '40px',
                minHeight: '160px'
            }}>
                {/* 1. CUSTOM IMAGE CIRCLE */}
                {device.customImage && (
                    <div style={{
                        width: '130px', height: '130px', borderRadius: '50%',
                        background: 'linear-gradient(145deg, #1e1e1e, #2a2a2a)',
                        boxShadow: '10px 10px 30px #1a1a1a, -10px -10px 30px #323232',
                        overflow: 'hidden', position: 'relative', flexShrink: 0,
                        border: '2px solid rgba(255,255,255,0.05)'
                    }}>
                        <img src={device.customImage} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </div>
                )}

                {/* 2. UNLOCK BUTTON */}
                <UnlockButton onUnlock={handleUnlock} onlineState={connectionState} />
            </div>

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
                            onClick={toggleUsers}
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
                            👥 {showUsers ? 'Ocultar Usuarios' : 'Usuarios'}
                        </button>
                    )}

                    {/* BOTÓN CÁMARA CCTV */}
                    {camera && (
                        <button
                            onClick={() => setShowCamera(!showCamera)}
                            style={{
                                background: showCamera ? '#e67e22' : 'rgba(230, 126, 34, 0.2)',
                                border: '1px solid #e67e22',
                                color: showCamera ? 'white' : '#e67e22',
                                cursor: 'pointer',
                                fontSize: '0.9em',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '5px',
                                borderRadius: '4px',
                                padding: '5px 10px',
                                transition: 'all 0.3s ease'
                            }}
                        >
                            📹 {showCamera ? 'Ocultar Cámara' : 'Ver Cámara'}
                        </button>
                    )}
                </div>

                {connectionState === 'offline' && (
                    <span style={{ fontSize: '0.7em', color: '#e74c3c' }}>
                        ⚠️ {offlineReason}
                    </span>
                )}
            </div>

            {/* ÁREA DE VISUALIZACIÓN DE CÁMARA */}
            {
                showCamera && camera && (
                    <div style={{
                        marginTop: '15px',
                        width: '100%',
                        height: 'auto',
                        minHeight: '250px',
                        background: '#000',
                        borderRadius: '8px',
                        border: '1px solid #333',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        overflow: 'hidden',
                        position: 'relative'
                    }}>
                        <div style={{
                            position: 'absolute', top: 10, left: 10,
                            background: streamStatus === 'playing' ? 'rgba(0,0,0,0.6)' : 'rgba(255,0,0,0.6)',
                            color: streamStatus === 'playing' ? '#0f0' : '#fff',
                            padding: '2px 6px', borderRadius: '4px',
                            fontSize: '0.7em', display: 'flex', alignItems: 'center', gap: '5px', zIndex: 10
                        }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: streamStatus === 'playing' ? '#0f0' : 'red', display: 'block' }}></span>
                            {streamStatus === 'playing' ? 'LIVE STREAM' : (streamStatus === 'loading' ? 'CONECTANDO...' : 'OFFLINE')}
                        </div>

                        {/* ERROR MESSAGE */}
                        {streamStatus === 'error' && (
                            <div style={{ textAlign: 'center', color: '#e74c3c', padding: '20px' }}>
                                <p style={{ fontSize: '2em', margin: 0 }}>⚠️</p>
                                <p style={{ margin: '10px 0', fontWeight: 'bold' }}>Error de Conexión</p>
                                <p style={{ fontSize: '0.8em', maxWidth: '80%', margin: '0 auto' }}>{streamError}</p>
                            </div>
                        )}

                        {/* LOADING INDICATOR */}
                        {streamStatus === 'loading' && (
                            <div style={{ textAlign: 'center', color: '#aaa' }}>
                                <p style={{ fontSize: '0.9em' }}>Estableciendo conexión...</p>
                                <p style={{ fontSize: '0.8em', fontStyle: 'italic' }}>Esto puede tardar unos segundos.</p>
                            </div>
                        )}

                        {/* VIDEO PLAYER */}
                        <video
                            ref={videoRef}
                            controls
                            autoPlay
                            muted
                            playsInline
                            style={{
                                width: '100%',
                                height: '100%',
                                display: streamStatus === 'playing' ? 'block' : 'none'
                            }}
                        />
                    </div>
                )
            }

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
                                {device.allowedEmails.map((emailRaw, i) => {
                                    const email = emailRaw.toLowerCase();
                                    const userDetails = authorizedUsersData[email] || {};

                                    // Calcular fechas específicas o globales
                                    // Admin/Validador = Permanente (Return null expiration, que significa permanente aquí)
                                    if (userDetails.role === 'admin' || userDetails.role === 'validador') {
                                        // Force permanent
                                        return (
                                            <button style={{ background: 'transparent', border: 'none', padding: '0 5px' }} title="Licencia Permanente (Rol)">
                                                <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill="#2ecc71">
                                                    <path d="M0 0h24v24H0z" fill="none" />
                                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                                                </svg>
                                            </button>
                                        );
                                    }


                                    let expirationDate = userDetails.expirationDate ? new Date(userDetails.expirationDate.seconds * 1000) : null;

                                    // Regla específica mata global
                                    if (userDetails.deviceAccess && userDetails.deviceAccess[device.id]) {
                                        const rule = userDetails.deviceAccess[device.id];
                                        if (rule.expirationDate) {
                                            expirationDate = new Date(rule.expirationDate.seconds * 1000);
                                        }
                                    }

                                    const checkStatus = () => {
                                        if (!expirationDate) {
                                            alert("✅ Licencia Permanente\nAcceso sin vencimiento para esta puerta.");
                                            return;
                                        }
                                        const now = new Date();
                                        const diffTime = expirationDate.getTime() - now.getTime();
                                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                                        if (diffDays <= 0) {
                                            alert(`🔴 VENCIDO\nExpiró el: ${expirationDate.toLocaleDateString()}`);
                                        } else {
                                            alert(`📅 Vence el: ${expirationDate.toLocaleDateString()}\nQuedan: ${diffDays} días.`);
                                        }
                                    };

                                    let color = '#2ecc71'; // Verde (Default/Permanente)
                                    if (expirationDate) {
                                        const now = new Date();
                                        const diffTime = expirationDate.getTime() - now.getTime();
                                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                        if (diffDays <= 0) color = '#e74c3c'; // Rojo
                                        else if (diffDays <= 10) color = '#f1c40f'; // Amarillo
                                    }

                                    return (
                                        <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '2px' }}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '10px' }} title={email}>
                                                {userDetails.displayName || userDetails.email || email}
                                            </span>
                                            <button
                                                onClick={checkStatus}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    padding: '0 5px',
                                                    display: 'flex',
                                                    alignItems: 'center'
                                                }}
                                                title="Ver Vigencia"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 0 24 24" width="20px" fill={color}>
                                                    <path d="M0 0h24v24H0z" fill="none" />
                                                    <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-6h-8.35zM7 15c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" />
                                                    <path d="M0 0h24v24H0z" fill="none" />
                                                </svg>
                                            </button>
                                        </li>
                                    );
                                })}
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


