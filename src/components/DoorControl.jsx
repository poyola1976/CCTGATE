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

    const [showLogs, setShowLogs] = useState(false);
    const [logs, setLogs] = useState([]);
    const [showUsers, setShowUsers] = useState(false);
    const [showLicenseModal, setShowLicenseModal] = useState(false);

    const [authorizedUsersData, setAuthorizedUsersData] = useState({});

    // --- LÓGICA DE LICENCIA PARA EL ÍCONO ---
    const getLicenseInfo = () => {
        if (isAdmin || (userProfile && (userProfile.role === 'admin' || userProfile.role === 'validador'))) {
            return { color: '#2ecc71', daysLeft: 999, statusText: 'Permanente' };
        }

        if (!userProfile) return { color: '#e74c3c', daysLeft: 0, statusText: 'No registrado' };

        const now = new Date();
        let expDate = null;

        if (userProfile.deviceAccess && userProfile.deviceAccess[device.id]) {
            const rule = userProfile.deviceAccess[device.id];
            expDate = rule.expirationDate ? new Date(rule.expirationDate.seconds * 1000) : null;
        } else {
            expDate = userProfile.expirationDate ? new Date(userProfile.expirationDate.seconds * 1000) : null;
        }

        if (!expDate) return { color: '#2ecc71', daysLeft: 999, statusText: 'Permanente' };

        const diffTime = expDate.getTime() - now.getTime();
        const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (daysLeft <= 0) return { color: '#ff0000', daysLeft, statusText: 'Vencida' };
        if (daysLeft <= 15) return { color: '#ffff00', daysLeft, statusText: 'Próxima a vencer' };
        return { color: '#2ecc71', daysLeft, statusText: 'Vigente' };
    };

    const licenseInfo = getLicenseInfo();

    const handleUnlock = async () => {
        if (!accessCheck.allowed) {
            return { success: false, message: 'Licencia inválida' };
        }

        if (connectionState === 'offline') {
            const confirmForce = confirm(`"${device.name}" parece desconectada (${offlineReason}). ¿Forzar intento?`);
            if (!confirmForce) return { success: false, message: 'Cancelado' };
        }

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
        setShowUsers(false);
        const history = await FirebaseService.getLogsForDoor(device.id);
        setLogs(history);
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
            const port = 8443;
            const serverDomain = 'cctgate.i2r.cl';
            const streamKey = camera.rtmpStreamKey || 'cam1';
            const flvUrl = `https://${serverDomain}:${port}/live/${streamKey}.flv`;

            if (flvjs && flvjs.isSupported()) {
                if (playerRef.current) {
                    if (typeof playerRef.current.destroy === 'function') playerRef.current.destroy();
                    playerRef.current = null;
                }

                try {
                    setStreamStatus('loading');
                    const flvPlayer = flvjs.createPlayer({
                        type: 'flv', url: flvUrl, isLive: true, hasAudio: false, cors: true
                    });
                    flvPlayer.attachMediaElement(videoRef.current);
                    flvPlayer.load();
                    flvPlayer.play().then(() => {
                        setStreamStatus('playing');
                        setStreamError('');
                    }).catch(err => console.warn("FLV Play Warning:", err));

                    flvPlayer.on(flvjs.Events.ERROR, (type, details) => {
                        setStreamStatus('error');
                        setStreamError(`Error Stream: ${type}`);
                    });
                    playerRef.current = flvPlayer;
                } catch (err) {
                    setStreamStatus('error');
                    setStreamError('Error al iniciar reproductor');
                }
            }
        }
        return () => {
            if (playerRef.current && playerRef.current.destroy) playerRef.current.destroy();
        };
    }, [showCamera, camera]);

    useEffect(() => {
        if (showCamera && camera && camera.type === 'tuya') {
            let hls = null;
            const initHls = async () => {
                setStreamStatus('loading');
                try {
                    const devId = camera.tuyaDeviceId || camera.tuyaId || camera.id;
                    const uId = camera.tuyaUid || camera.uid || camera.userId;
                    const response = await FirebaseService.getTuyaHlsUrl({ deviceId: devId, userId: uId });

                    if (response.data && response.data.success && Hls.isSupported()) {
                        hls = new Hls();
                        hls.loadSource(response.data.url);
                        hls.attachMedia(videoRef.current);
                        hls.on(Hls.Events.MANIFEST_PARSED, () => {
                            setStreamStatus('playing');
                            videoRef.current.play().catch(e => console.error("AutoPlay blocked", e));
                        });
                        playerRef.current = hls;
                    }
                } catch (error) {
                    setStreamStatus('error');
                    setStreamError(error.message);
                }
            };
            initHls();
            return () => { if (hls) hls.destroy(); };
        }
    }, [showCamera, camera]);

    return (
        <div className="door-control-card" style={{
            marginBottom: '20px', padding: '15px', background: 'rgba(255,255,255,0.05)',
            borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)',
            position: 'relative', opacity: (!accessCheck.allowed && !showLicenseModal) ? 0.7 : 1
        }}>
            {!accessCheck.allowed && (
                <div style={{
                    position: 'absolute', top: 10, right: 10, background: '#ff0000',
                    color: 'white', padding: '2px 8px', borderRadius: '12px',
                    fontSize: '0.7em', fontWeight: 'bold', zIndex: 10,
                    boxShadow: '0 0 10px rgba(255,0,0,0.5)'
                }}>⛔ VENCIDO</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>{device.name}</h2>
                <div title={connectionState === 'offline' ? `Offline: ${offlineReason}` : `Online`}>
                    <WifiStatusIcon state={connectionState} />
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px', minHeight: '160px' }}>
                {device.customImage && (
                    <div style={{
                        width: '130px', height: '130px', borderRadius: '50%', overflow: 'hidden',
                        border: '2px solid rgba(255,255,255,0.05)', background: '#1e1e1e'
                    }}>
                        <img src={device.customImage} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                )}
                <UnlockButton onUnlock={handleUnlock} onlineState={connectionState} disabled={!accessCheck.allowed} />
            </div>

            {/* BOTONES INFERIORES EQUIDISTANTES */}
            <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-around', alignItems: 'center', width: '100%' }}>
                <button
                    onClick={accessCheck.allowed ? toggleLogs : null}
                    style={{ ...btnStyle(showLogs, !accessCheck.allowed), flex: 1, textAlign: 'center' }}
                    disabled={!accessCheck.allowed}
                >
                    📜 {showLogs ? 'Ocultar' : 'Historial'}
                </button>

                {camera && (
                    <button
                        onClick={accessCheck.allowed ? (() => setShowCamera(!showCamera)) : null}
                        style={{ ...camBtnStyle(showCamera, !accessCheck.allowed), flex: 1, textAlign: 'center' }}
                        disabled={!accessCheck.allowed}
                    >
                        📹 {showCamera ? 'Ocultar' : 'Cámara'}
                    </button>
                )}

                {userProfile && (
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                        <button
                            onClick={() => setShowLicenseModal(true)}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '5px',
                                position: 'relative',
                                animation: !accessCheck.allowed ? 'pulse-heavy 1.5s infinite' : 'none',
                                borderRadius: '50%',
                                filter: `drop-shadow(0 0 8px ${licenseInfo.color}80)`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            <style>{`
                                @keyframes pulse-heavy {
                                    0% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.7); transform: scale(1); }
                                    50% { box-shadow: 0 0 0 15px rgba(255, 0, 0, 0); transform: scale(1.1); }
                                    100% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0); transform: scale(1); }
                                }
                            `}</style>
                            <svg xmlns="http://www.w3.org/2000/svg" height="28px" viewBox="0 0 24 24" width="28px" fill={licenseInfo.color}>
                                <path d="M0 0h24v24H0V0z" fill="none" />
                                <path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-6h-8.35zM7 15c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z" />
                            </svg>
                            {licenseInfo.daysLeft >= 0 && licenseInfo.daysLeft <= 15 && (
                                <span style={badgeStyle}>!</span>
                            )}
                        </button>
                    </div>
                )}
            </div>

            {connectionState === 'offline' && (
                <div style={{ marginTop: '10px', textAlign: 'center' }}>
                    <span style={{ fontSize: '0.7em', color: '#ff0000' }}>⚠️ {offlineReason}</span>
                </div>
            )}

            {/* SECCIONES EXPANDIBLES */}
            {showCamera && camera && (
                <div style={camAreaStyle}>
                    <div style={camStatusStyle(streamStatus)}>
                        <span style={dotStyle(streamStatus)}></span>
                        {streamStatus === 'playing' ? 'LIVE STREAM' : (streamStatus === 'loading' ? 'CONECTANDO...' : 'OFFLINE')}
                    </div>
                    {streamStatus === 'error' && <div style={errAreaStyle}>{streamError}</div>}
                    <video ref={videoRef} controls autoPlay muted playsInline style={{ width: '100%', height: '100%', display: streamStatus === 'playing' ? 'block' : 'none' }} />
                </div>
            )}

            {showLogs && (
                <div style={logsAreaStyle}>
                    {logs.length === 0 ? <p>No hay registros.</p> : (
                        <table style={{ width: '100%', fontSize: '0.8em' }}>
                            <thead><tr><th>#</th><th>Usuario</th><th>Fecha</th></tr></thead>
                            <tbody>{logs.map((log, i) => (
                                <tr key={log.id}><td>{i + 1}</td><td>{log.userEmail}</td><td>{log.timestamp?.seconds ? new Date(log.timestamp.seconds * 1000).toLocaleString() : 'Reciente'}</td></tr>
                            ))}</tbody>
                        </table>
                    )}
                </div>
            )}

            {showUsers && (
                <div style={logsAreaStyle}>
                    <h4>Usuarios Autorizados</h4>
                    <ul>{device.allowedEmails?.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
            )}

            {/* MODAL DE VIGENCIA Y PAGO */}
            {showLicenseModal && (
                <div style={licenseModalStyle}>
                    <div style={licenseCardStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                            <h3 style={{ margin: 0, fontSize: '1.1em' }}>🔒 Estado de Vigencia</h3>
                            <button onClick={() => setShowLicenseModal(false)} style={closeBtnStyle}>✕</button>
                        </div>

                        <div style={{ textAlign: 'center', margin: '20px 0' }}>
                            <div style={{ fontSize: '0.9em', color: '#aaa', marginBottom: '5px' }}>Estado de Licencia</div>
                            <div style={{ fontSize: '1.6em', fontWeight: '900', color: licenseInfo.color, textShadow: `0 0 15px ${licenseInfo.color}80` }}>
                                {licenseInfo.statusText.toUpperCase()}
                            </div>
                            <div style={{ fontSize: '0.85em', color: '#888', marginTop: '10px' }}>
                                {licenseInfo.daysLeft > 365 ? 'Acceso Permanente' : (licenseInfo.daysLeft <= 0 ? 'Expiró' : `Restan ${licenseInfo.daysLeft} días de acceso`)}
                            </div>
                        </div>

                        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <button
                                onClick={() => alert("Redirigiendo a WebPay: Plan 6 Meses ($8.000 + IVA)")}
                                style={{
                                    ...payBtnStyle,
                                    background: 'linear-gradient(135deg, #2ecc71 0%, #27ae60 100%)',
                                    boxShadow: '0 0 20px rgba(46, 204, 113, 0.6)',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                }}
                            >
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ fontSize: '0.8em', opacity: 0.9, letterSpacing: '1px', fontWeight: 'bold' }}>PLAN SEMESTRAL (6 MESES)</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: '900', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>$8.000 <span style={{ fontSize: '0.6em', fontWeight: 'normal' }}>+ IVA</span></div>
                                </div>
                                <svg xmlns="http://www.w3.org/2000/svg" height="32px" viewBox="0 0 24 24" width="32px" fill="white" style={{ marginLeft: 'auto', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
                                    <path d="M15.55 13c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.37-.66-.11-1.48-.87-1.48H5.21l-.94-2H1v2h2l3.6 7.59-1.35 2.44C4.52 15.33 5.48 17 7 17h12v-2H7l1.1-2h7.45zM6.16 5h12.15l-2.76 5H8.53L6.16 5zM7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" />
                                </svg>
                            </button>

                            <button
                                onClick={() => alert("Redirigiendo a WebPay: Plan Anual ($10.000 + IVA)")}
                                style={{
                                    ...payBtnStyle,
                                    background: 'linear-gradient(135deg, #3498db 0%, #2980b9 100%)',
                                    boxShadow: '0 0 20px rgba(52, 152, 219, 0.6)',
                                    border: '1px solid rgba(255,255,255,0.1)'
                                }}
                            >
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ fontSize: '0.8em', opacity: 0.9, letterSpacing: '1px', fontWeight: 'bold' }}>PLAN ANUAL (1 AÑO)</div>
                                    <div style={{ fontSize: '1.4em', fontWeight: '900', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>$10.000 <span style={{ fontSize: '0.6em', fontWeight: 'normal' }}>+ IVA</span></div>
                                </div>
                                <svg xmlns="http://www.w3.org/2000/svg" height="32px" viewBox="0 0 24 24" width="32px" fill="white" style={{ marginLeft: 'auto', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
                                    <path d="M15.55 13c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.37-.66-.11-1.48-.87-1.48H5.21l-.94-2H1v2h2l3.6 7.59-1.35 2.44C4.52 15.33 5.48 17 7 17h12v-2H7l1.1-2h7.45zM6.16 5h12.15l-2.76 5H8.53L6.16 5zM7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z" />
                                </svg>
                            </button>
                        </div>

                        <p style={{ fontSize: '0.75em', color: '#666', textAlign: 'center', marginTop: '15px' }}>
                            Selecciona un plan para extender tu vigencia.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

// ICONO DE WIFI ESTÉTICO
const WifiStatusIcon = ({ state }) => {
    const color = state === 'online' ? '#2ecc71' : (state === 'busy' ? '#f1c40f' : '#e74c3c');
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '0.6em', color: color, fontWeight: 'bold' }}>
                {state.toUpperCase()}
            </span>
            <div style={{
                width: '10px', height: '10px', borderRadius: '50%', background: color,
                boxShadow: `0 0 8px ${color}`
            }} />
        </div>
    );
};

// ESTILOS ADICIONALES
const licenseModalStyle = { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: '#000', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' };
const licenseCardStyle = { width: '90%', background: '#111', padding: '20px', borderRadius: '12px', border: '1px solid #333', boxShadow: '0 0 40px rgba(0,0,0,1)' };
const closeBtnStyle = { background: 'none', border: 'none', color: '#666', fontSize: '1.2em', cursor: 'pointer' };
const payBtnStyle = {
    width: '100%',
    padding: '14px',
    background: '#2ecc71',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '1em',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 15px rgba(46, 204, 113, 0.4)',
    transition: 'all 0.3s ease',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
};

// ESTILOS AUXILIARES
const btnStyle = (active, disabled) => ({
    background: 'none',
    border: 'none',
    color: active ? '#fff' : '#aaa',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.85em',
    opacity: disabled ? 0.3 : 1
});
const camBtnStyle = (active, disabled) => ({
    background: active ? '#e67e22' : 'rgba(230, 126, 34, 0.2)',
    border: '1px solid #e67e22',
    color: active ? 'white' : '#e67e22',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '0.85em',
    borderRadius: '4px',
    padding: '4px 8px',
    opacity: disabled ? 0.3 : 1,
    filter: disabled ? 'grayscale(100%)' : 'none'
});
const camAreaStyle = { marginTop: '15px', width: '100%', minHeight: '250px', background: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' };
const camStatusStyle = (s) => ({ position: 'absolute', top: 10, left: 10, background: s === 'playing' ? 'rgba(0,0,0,0.6)' : 'rgba(255,0,0,0.6)', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7em', display: 'flex', alignItems: 'center', gap: '5px', zIndex: 10 });
const dotStyle = (s) => ({ width: '8px', height: '8px', borderRadius: '50%', background: s === 'playing' ? '#0f0' : 'red' });
const badgeStyle = {
    position: 'absolute',
    top: '-2px',
    right: '-2px',
    background: '#ffff00',
    color: '#000',
    borderRadius: '50%',
    width: '18px',
    height: '18px',
    fontSize: '12px',
    fontWeight: '900',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid #000',
    boxShadow: '0 0 10px rgba(255, 255, 0, 0.8)',
    zIndex: 10
};
const logsAreaStyle = { marginTop: '15px', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', maxHeight: '200px', overflowY: 'auto' };
const errAreaStyle = { textAlign: 'center', color: '#e74c3c', fontSize: '0.8em' };
