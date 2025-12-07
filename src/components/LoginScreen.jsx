import { useState } from 'react';
import { FirebaseService } from '../services/firebase';
import { UserService } from '../services/userService';

export default function LoginScreen({ onLogin }) {
    const [mode, setMode] = useState('login'); // 'login', 'register', 'recovery'
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    // Form inputs
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        confirmPassword: '',
        fullName: '',
        phone: ''
    });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleGoogleLogin = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await onLogin(); // Llama a FirebaseService.loginWithGoogle() desde App.jsx o directo
        } catch (err) {
            console.error("Login failed", err);
            setError(`Error: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEmailAction = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (mode === 'login') {
                await FirebaseService.loginWithEmail(formData.email, formData.password);
                // Auth state change in App.jsx handles the rest
            }
            else if (mode === 'register') {
                if (!formData.fullName || !formData.phone) {
                    throw new Error("Nombre y teléfono son obligatorios.");
                }
                if (formData.password !== formData.confirmPassword) {
                    throw new Error("Las contraseñas no coinciden.");
                }

                // 1. Crear usuario en Auth
                const userCredential = await FirebaseService.registerWithEmail(formData.email, formData.password);
                const user = userCredential.user;

                // 2. Actualizar perfil auth (DisplayName)
                await FirebaseService.updateUserProfile(user, { displayName: formData.fullName });

                // 3. Guardar datos extra en Firestore (Teléfono)
                // Se invoca saveUserProfile. El rol se crea auto en getUserRole si no existe, 
                // pero aquí podemos forzar los datos iniciales.
                await UserService.saveUserProfile(user.uid, {
                    displayName: formData.fullName,
                    phone: formData.phone,
                    email: formData.email,
                    role: 'user' // Default explícito
                });

                // 4. Enviar email de verificación
                await FirebaseService.sendUserVerification(user);

                // 5. Notificar y Auto-login
                setMessage("¡Cuenta creada! Se ha enviado un correo de verificación a tu email.");
                // Login automático ocurre por Auth state change en App.jsx, 
                // pero el mensaje quedará visible un momento o se desmontará si App redirige.
            }
            else if (mode === 'recovery') {
                await FirebaseService.resetPassword(formData.email);
                setMessage("Correo de recuperación enviado. Revisa tu bandeja.");
                setMode('login');
            }
        } catch (err) {
            console.error(mode + " error", err);
            let msg = err.message;
            if (err.code === 'auth/email-already-in-use') msg = "Este correo ya está registrado.";
            if (err.code === 'auth/weak-password') msg = "La contraseña debe tener al menos 6 caracteres.";
            if (err.code === 'auth/user-not-found') msg = "Usuario no encontrado.";
            if (err.code === 'auth/wrong-password') msg = "Contraseña incorrecta.";
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '20px',
            textAlign: 'center',
            background: '#1a1a1a',
            color: '#fff'
        }}>
            <h1 style={{ marginBottom: '1.5rem', color: 'var(--primary-color)' }}>🔐 Control de Acceso</h1>

            <div className="card" style={{ maxWidth: '400px', width: '100%', padding: '2rem', background: '#222', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.3)' }}>
                <h2 style={{ marginBottom: '1.5rem', fontSize: '1.2rem' }}>
                    {mode === 'login' && 'Iniciar Sesión'}
                    {mode === 'register' && 'Crear Cuenta'}
                    {mode === 'recovery' && 'Recuperar Contraseña'}
                </h2>

                {error && <div style={{ background: 'rgba(231, 76, 60, 0.2)', color: '#e74c3c', padding: '10px', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9em' }}>{error}</div>}
                {message && <div style={{ background: 'rgba(46, 204, 113, 0.2)', color: '#2ecc71', padding: '10px', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9em' }}>{message}</div>}

                <form onSubmit={handleEmailAction} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>

                    {mode === 'register' && (
                        <>
                            <input
                                name="fullName"
                                placeholder="Nombre Completo *"
                                value={formData.fullName}
                                onChange={handleChange}
                                required
                                style={inputStyle}
                            />
                            <input
                                name="phone"
                                placeholder="Teléfono *"
                                type="tel"
                                value={formData.phone}
                                onChange={handleChange}
                                required
                                style={inputStyle}
                            />
                        </>
                    )}

                    <input
                        name="email"
                        placeholder="Correo Electrónico"
                        type="email"
                        value={formData.email}
                        onChange={handleChange}
                        required
                        style={inputStyle}
                    />

                    {mode !== 'recovery' && (
                        <>
                            <div style={{ position: 'relative' }}>
                                <input
                                    name="password"
                                    placeholder="Contraseña"
                                    type={showPassword ? "text" : "password"}
                                    value={formData.password}
                                    onChange={handleChange}
                                    required
                                    minLength={6}
                                    style={{ ...inputStyle, width: '100%' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={eyeButtonStyle}
                                    title={showPassword ? "Ocultar" : "Mostrar"}
                                >
                                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                                </button>
                            </div>

                            {mode === 'register' && (
                                <div style={{ position: 'relative' }}>
                                    <input
                                        name="confirmPassword"
                                        placeholder="Repetir Contraseña"
                                        type={showConfirmPassword ? "text" : "password"}
                                        value={formData.confirmPassword}
                                        onChange={handleChange}
                                        required
                                        minLength={6}
                                        style={{ ...inputStyle, width: '100%' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        style={eyeButtonStyle}
                                        title={showConfirmPassword ? "Ocultar" : "Mostrar"}
                                    >
                                        {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                            )}
                        </>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        style={{
                            background: 'var(--primary-color)',
                            color: 'white',
                            padding: '12px',
                            border: 'none',
                            borderRadius: '6px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            marginTop: '10px'
                        }}
                    >
                        {isLoading ? 'Procesando...' : (
                            mode === 'login' ? 'Entrar' :
                                mode === 'register' ? 'Registrarse' : 'Enviar Enlace'
                        )}
                    </button>
                </form>

                {mode === 'login' && (
                    <>
                        <div style={{ margin: '1.5rem 0', position: 'relative' }}>
                            <hr style={{ borderColor: '#333' }} />
                            <span style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', background: '#222', padding: '0 10px', color: '#666', fontSize: '0.8em' }}>O</span>
                        </div>

                        <button
                            onClick={handleGoogleLogin}
                            disabled={isLoading}
                            style={{
                                background: '#fefefe',
                                color: '#333',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '10px',
                                width: '100%',
                                padding: '10px',
                                border: 'none',
                                borderRadius: '6px',
                                fontWeight: 'bold',
                                cursor: 'pointer'
                            }}
                        >
                            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="18" />
                            Entrar con Google
                        </button>
                    </>
                )}

                <div style={{ marginTop: '1.5rem', fontSize: '0.9em', color: '#888' }}>
                    {mode === 'login' && (
                        <>
                            <p onClick={() => setMode('recovery')} style={linkStyle}>¿Olvidaste tu contraseña?</p>
                            <p>¿No tienes cuenta? <span onClick={() => setMode('register')} style={linkStyle}>Regístrate aquí</span></p>
                        </>
                    )}
                    {(mode === 'register' || mode === 'recovery') && (
                        <p onClick={() => setMode('login')} style={linkStyle}>← Volver al inicio</p>
                    )}
                </div>
            </div>

            <p style={{ marginTop: '2rem', fontSize: '0.8em', color: '#444' }}>
                Shelly Access Control v3.2
            </p>
        </div>
    );
}

const inputStyle = {
    padding: '12px',
    borderRadius: '6px',
    border: '1px solid #444',
    background: '#333',
    color: 'white',
    fontSize: '1rem',
    boxSizing: 'border-box'
};

const linkStyle = {
    color: 'var(--primary-color)',
    cursor: 'pointer',
    textDecoration: 'underline',
    display: 'inline-block',
    margin: '5px 0'
};

const eyeButtonStyle = {
    position: 'absolute',
    right: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    padding: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
};

const EyeIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
    </svg>
);

const EyeOffIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>
);
