import { useState, useEffect } from 'react';
import { FirebaseService } from '../services/firebase';
import { UserService } from '../services/userService';

// Iconos (mismos que LoginScreen)
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

export default function UserProfileModal({ isOpen, onClose, user }) {
    const [displayName, setDisplayName] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [currentPassword, setCurrentPassword] = useState(''); // Para re-auth

    const [showPassword, setShowPassword] = useState(false); // Para nueva clave
    const [showCurrentPassword, setShowCurrentPassword] = useState(false); // Para clave actual

    const [isLoading, setIsLoading] = useState(false);
    const [status, setStatus] = useState({ type: '', msg: '' });

    useEffect(() => {
        if (isOpen && user) {
            setDisplayName(user.displayName || '');
            loadExtraData(user);
        } else {
            // Reset state
            setPassword('');
            setConfirmPassword('');
            setCurrentPassword('');
            setStatus({ type: '', msg: '' });
            setShowPassword(false);
            setShowCurrentPassword(false);
        }
    }, [isOpen, user]);

    const loadExtraData = async (currentUser) => {
        try {
            // Intentar obtener perfil de firestore
            const profile = await UserService.getUserProfile(currentUser.uid);
            if (profile && profile.phone) {
                setPhone(profile.phone);
            }
        } catch (e) {
            console.error("Error cargando perfil", e);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setStatus({ type: '', msg: '' });
        setIsLoading(true);

        try {
            const updates = [];

            // 1. Actualizar Datos Básicos (Nombre, Teléfono)
            if (displayName !== user.displayName) {
                updates.push(FirebaseService.updateUserProfile(user, { displayName }));
            }

            // Guardar o actualizar teléfono en Firestore
            updates.push(UserService.saveUserProfile(user.uid, {
                phone,
                displayName,
                email: user.email // redundancia util
            }));

            // 2. Actualizar Contraseña (si se escribió algo)
            if (password) {
                if (password !== confirmPassword) {
                    throw new Error("Las contraseñas no coinciden.");
                }
                if (password.length < 6) {
                    throw new Error("La contraseña debe tener al menos 6 caracteres.");
                }

                // Re-autenticación OBLIGATORIA
                if (!currentPassword) {
                    throw new Error("Por seguridad, ingresa tu contraseña actual.");
                }

                // Intentar Re-auth
                try {
                    await FirebaseService.reauthenticate(user, currentPassword);
                } catch (e) {
                    console.error("Reauth error", e);
                    if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
                        throw new Error("La contraseña actual es incorrecta.");
                    }
                    throw e; // Lanzar otros errores
                }

                updates.push(FirebaseService.updateUserPassword(user, password));
            }

            await Promise.all(updates);

            setStatus({ type: 'success', msg: 'Perfil actualizado correctamente.' });

            // Limpiar claves
            setPassword('');
            setConfirmPassword('');
            setCurrentPassword('');

            setTimeout(() => {
                onClose();
            }, 1500);

        } catch (error) {
            console.error("Error updating profile:", error);
            if (error.code === 'auth/requires-recent-login') {
                setStatus({ type: 'error', msg: 'Por seguridad, debes volver a iniciar sesión.' });
            } else {
                setStatus({ type: 'error', msg: error.message || 'Error al actualizar.' });
            }
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
            <div style={{
                background: '#222', padding: '20px', borderRadius: '12px',
                width: '90%', maxWidth: '400px', border: '1px solid #444', color: '#fff'
            }}>
                <h2 style={{ marginTop: 0 }}>Mi Perfil</h2>

                <form onSubmit={handleSave}>
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#aaa' }}>Email</label>
                        <input type="text" value={user?.email} disabled style={{
                            width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #444',
                            background: '#333', color: '#888', cursor: 'not-allowed'
                        }} />
                    </div>

                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em' }}>Nombre</label>
                        <input
                            type="text"
                            value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            required
                            style={inputStyle}
                        />
                    </div>

                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em' }}>Teléfono</label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={e => setPhone(e.target.value)}
                            placeholder="+56 9 1234 5678"
                            required
                            style={inputStyle}
                        />
                    </div>

                    <hr style={{ borderColor: '#444', margin: '20px 0' }} />
                    <h3 style={{ fontSize: '1em', marginBottom: '15px' }}>Cambiar Contraseña</h3>

                    {/* Input Contraseña Actual */}
                    <div style={{ marginBottom: '15px', position: 'relative' }}>
                        <input
                            type={showCurrentPassword ? "text" : "password"}
                            placeholder="Contraseña ACTUAL (requerida)"
                            value={currentPassword}
                            onChange={e => setCurrentPassword(e.target.value)}
                            style={{ ...inputStyle, borderColor: '#d35400' }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                            style={eyeButtonStyle}
                        >
                            {showCurrentPassword ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                    </div>

                    <div style={{ marginBottom: '15px', position: 'relative' }}>
                        <input
                            type={showPassword ? "text" : "password"}
                            placeholder="Nueva contraseña (opcional)"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            style={inputStyle}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            style={eyeButtonStyle}
                        >
                            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                    </div>

                    {password && (
                        <div style={{ marginBottom: '15px' }}>
                            <input
                                type={showPassword ? "text" : "password"}
                                placeholder="Repetir nueva contraseña"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                required={!!password}
                                style={inputStyle}
                            />
                        </div>
                    )}

                    {status.msg && (
                        <div style={{
                            padding: '10px', borderRadius: '6px', marginBottom: '15px',
                            background: status.type === 'error' ? 'rgba(231, 76, 60, 0.2)' : 'rgba(46, 204, 113, 0.2)',
                            color: status.type === 'error' ? '#e74c3c' : '#2ecc71',
                            fontSize: '0.9em', textAlign: 'center'
                        }}>
                            {status.msg}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                flex: 1, padding: '12px', borderRadius: '8px', border: 'none',
                                background: '#444', color: '#fff', fontSize: '1em', cursor: 'pointer'
                            }}
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={isLoading}
                            style={{
                                flex: 1, padding: '12px', borderRadius: '8px', border: 'none',
                                background: isLoading ? '#555' : '#3498db', color: '#fff', fontSize: '1em', cursor: 'pointer',
                                fontWeight: 'bold'
                            }}
                        >
                            {isLoading ? 'Guardando...' : 'Guardar Cambios'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

const inputStyle = {
    width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #555',
    background: '#111', color: '#fff', fontSize: '1em', boxSizing: 'border-box'
};

const eyeButtonStyle = {
    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
    background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex'
};
