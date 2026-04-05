import React, { useEffect, useState } from 'react';
import { FirebaseService } from '../services/firebase';
import { useNavigate, useSearchParams } from 'react-router-dom';

const PaymentSuccess = () => {
    const [searchParams] = useSearchParams();
    const [newExpiration, setNewExpiration] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchUpdatedLicense = async () => {
            const user = FirebaseService.auth.currentUser;
            const externalRef = searchParams.get('external_reference');

            if (user && externalRef) {
                const [uid, deviceId] = externalRef.split('::');

                // Consultamos Firestore para ver la fecha actualizada que el Webhook ya debería haber puesto
                const userRef = FirebaseService.getUserRef(user.uid); // Asumiendo este helper existe o lo creamos
                // Por ahora usamos una vía directa si no existe el helper
                const q = await FirebaseService.getUserData(user.uid);

                if (q && q.deviceAccess && q.deviceAccess[deviceId]) {
                    const exp = q.deviceAccess[deviceId].expirationDate;
                    setNewExpiration(exp?.toDate ? exp.toDate() : new Date(exp));
                }
            }
            setLoading(false);
        };

        // Esperamos un momento para que el Webhook procese (2-3 segundos)
        const timer = setTimeout(fetchUpdatedLicense, 3000);
        return () => clearTimeout(timer);
    }, [searchParams]);

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            color: 'white',
            textAlign: 'center',
            fontFamily: "'Inter', sans-serif"
        }}>
            <div style={{
                background: 'rgba(255, 255, 255, 0.05)',
                backdropFilter: 'blur(20px)',
                padding: '40px',
                borderRadius: '30px',
                border: '1px solid rgba(255,255,255,0.1)',
                maxWidth: '450px',
                width: '100%',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}>
                <div style={{
                    width: '80px',
                    height: '80px',
                    background: '#2ecc71',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px',
                    boxShadow: '0 0 30px rgba(46, 204, 113, 0.5)',
                    animation: 'pulse 2s infinite'
                }}>
                    <svg xmlns="http://www.w3.org/2000/svg" height="40px" viewBox="0 0 24 24" width="40px" fill="white">
                        <path d="M0 0h24v24H0V0z" fill="none" /><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                    </svg>
                </div>

                <h1 style={{ fontSize: '1.8em', fontWeight: '800', marginBottom: '10px' }}>¡Pago Exitoso!</h1>
                <p style={{ opacity: 0.7, marginBottom: '30px' }}>Tu licencia ha sido renovada automáticamente.</p>

                <div style={{
                    background: 'rgba(0,0,0,0.2)',
                    padding: '20px',
                    borderRadius: '20px',
                    marginBottom: '30px',
                    border: '1px dashed rgba(255,255,255,0.2)'
                }}>
                    <span style={{ fontSize: '0.9em', opacity: 0.6, display: 'block', marginBottom: '5px' }}>Nueva fecha de vencimiento:</span>
                    {loading ? (
                        <div className="spinner-small" style={{ margin: '10px auto' }}></div>
                    ) : (
                        <strong style={{ fontSize: '1.3em', color: '#2ecc71' }}>
                            {newExpiration ? newExpiration.toLocaleDateString() : 'Pendiente de confirmación'}
                        </strong>
                    )}
                </div>

                <button
                    onClick={() => navigate('/')}
                    style={{
                        width: '100%',
                        padding: '15px',
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '15px',
                        fontWeight: 'bold',
                        fontSize: '1em',
                        cursor: 'pointer',
                        transition: 'transform 0.2s',
                        boxShadow: '0 10px 15px -3px rgba(37, 99, 235, 0.4)'
                    }}
                    onMouseOver={(e) => e.target.style.transform = 'scale(1.02)'}
                    onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
                >
                    VOLVER AL PANEL DE CONTROL
                </button>

                <p style={{ fontSize: '0.7em', marginTop: '20px', opacity: 0.4 }}>
                    Recibo # {searchParams.get('payment_id')}
                </p>
            </div>

            <style>{`
                @keyframes pulse {
                    0% { transform: scale(0.95); opacity: 1; }
                    50% { transform: scale(1.05); opacity: 0.8; }
                    100% { transform: scale(0.95); opacity: 1; }
                }
                .spinner-small {
                    width: 20px;
                    height: 20px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-radius: 50%;
                    border-top-color: white;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default PaymentSuccess;
