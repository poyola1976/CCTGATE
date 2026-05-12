import { useState } from 'react';
import './UnlockButton.css';

export default function UnlockButton({ onUnlock, disabled, onlineState = 'online' }) {
    const [status, setStatus] = useState('idle'); // idle, loading, success, error

    // Determinar si está deshabilitado visualmente
    // 'checking' -> deshabilitado pero mostrando spinner pequeño o gris
    // 'offline' -> deshabilitado totalmente
    const isInteractive = !disabled && onlineState === 'online';

    const handleClick = async () => {
        if (status === 'loading' || !isInteractive) return;

        // Haptic feedback si está disponible
        if (navigator.vibrate) navigator.vibrate(50);

        setStatus('loading');

        // Llamar a la función padre
        const result = await onUnlock();

        if (result.success) {
            setStatus('success');
            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
            setTimeout(() => setStatus('idle'), 2000);
        } else {
            setStatus('error');
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            // Mostrar error visualmente por 2s
            setTimeout(() => setStatus('idle'), 2000);
        }
    };

    // Texto del botón según estado de conexión
    const getLabel = () => {
        if (status === 'loading') return "ABRIENDO...";
        if (status === 'success') return "";
        if (status === 'error') return "ERROR";

        if (onlineState === 'checking') return "CONECTANDO...";
        if (onlineState === 'offline') return "OFFLINE 🔴";

        return "ACCIONAR PUERTA";
    };

    return (
        <div className="unlock-container">
            <button
                className={`unlock-btn ${status} ${onlineState}`}
                onClick={handleClick}
                disabled={!isInteractive}
            >
                <div className="icon-container">
                    {status === 'idle' && (onlineState === 'online' || onlineState === 'busy') && <span className="material-icon">🔓</span>}
                    {status === 'idle' && onlineState === 'offline' && <span className="material-icon">🚫</span>}
                    {status === 'idle' && onlineState === 'checking' && <div className="spinner mini"></div>}

                    {status === 'loading' && <div className="spinner"></div>}
                    {status === 'success' && (
                        <svg className="material-icon" xmlns="http://www.w3.org/2000/svg" height="48px" viewBox="0 0 24 24" width="48px" fill="#FFFFFF" style={{ filter: 'drop-shadow(0 0 5px rgba(255,255,255,0.5))' }}>
                            <path d="M0 0h24v24H0V0z" fill="none" />
                            <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                        </svg>
                    )}
                    {status === 'error' && <span className="material-icon">❌</span>}
                </div>
                <span className="label">
                    {getLabel()}
                </span>
            </button>
        </div>
    );
}
