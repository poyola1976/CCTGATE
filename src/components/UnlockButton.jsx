import { useState } from 'react';
import './UnlockButton.css'; // Crearemos este CSS específico luego si hace falta, o usamos index.css

export default function UnlockButton({ onUnlock, disabled }) {
    const [status, setStatus] = useState('idle'); // idle, loading, success, error

    const handleClick = async () => {
        if (status === 'loading' || disabled) return;

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

    return (
        <div className="unlock-container">
            <button
                className={`unlock-btn ${status}`}
                onClick={handleClick}
                disabled={disabled}
            >
                <div className="icon-container">
                    {status === 'idle' && <span className="material-icon">🔓</span>}
                    {status === 'loading' && <div className="spinner"></div>}
                    {status === 'success' && <span className="material-icon">✅</span>}
                    {status === 'error' && <span className="material-icon">❌</span>}
                </div>
                <span className="label">
                    {status === 'idle' && "ABRIR PUERTA"}
                    {status === 'loading' && "ABRIENDO..."}
                    {status === 'success' && "ABIERTO"}
                    {status === 'error' && "ERROR"}
                </span>
            </button>
        </div>
    );
}
