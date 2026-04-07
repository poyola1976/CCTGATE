import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const PaymentSuccess = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

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
                    width: '100px',
                    height: '100px',
                    background: '#2ecc71',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 30px',
                    boxShadow: '0 0 40px rgba(46, 204, 113, 0.6)',
                    animation: 'pulse 2s infinite'
                }}>
                    <svg xmlns="http://www.w3.org/2000/svg" height="50px" viewBox="0 0 24 24" width="50px" fill="white">
                        <path d="M0 0h24v24H0V0z" fill="none" /><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                    </svg>
                </div>

                <h1 style={{ fontSize: '2.5em', fontWeight: '900', marginBottom: '15px', color: '#fff' }}>¡Pago Exitoso!</h1>
                <p style={{ fontSize: '1.1em', opacity: 0.8, marginBottom: '50px', lineHeight: '1.5' }}>
                    Tu licencia ha sido renovada automáticamente. <br />
                    Ya puedes volver al panel principal.
                </p>

                <button
                    onClick={() => {
                        const ref = searchParams.get('external_reference') || '';
                        const deviceId = ref.split('::')[1] || '';
                        navigate(`/?payment_success=true${deviceId ? '&device_id=' + deviceId : ''}`);
                    }}
                    style={{
                        width: '100%',
                        padding: '20px',
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '18px',
                        fontWeight: '900',
                        fontSize: '1.2em',
                        cursor: 'pointer',
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: '0 10px 20px rgba(37, 99, 235, 0.4)',
                        textTransform: 'uppercase',
                        letterSpacing: '1px'
                    }}
                    onMouseEnter={(e) => {
                        e.target.style.transform = 'translateY(-3px)';
                        e.target.style.boxShadow = '0 15px 30px rgba(37, 99, 235, 0.5)';
                    }}
                    onMouseLeave={(e) => {
                        e.target.style.transform = 'translateY(0)';
                        e.target.style.boxShadow = '0 10px 20px rgba(37, 99, 235, 0.4)';
                    }}
                >
                    Volver al Panel de Control
                </button>

                <div style={{ marginTop: '40px', opacity: 0.3, fontSize: '0.8em' }}>
                    Recibo # {searchParams.get('payment_id') || '---'}
                </div>
            </div>

            <style>{`
                @keyframes pulse {
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.7); }
                    70% { transform: scale(1); box-shadow: 0 0 0 20px rgba(46, 204, 113, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(46, 204, 113, 0); }
                }
            `}</style>
        </div>
    );
};

export default PaymentSuccess;
