import { useState, useEffect } from 'react';
import { UserService } from '../services/userService';
import { FirebaseService } from '../services/firebase';

export default function AdminUsersScreen({ devices, onBack }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState(null);

    // Estado para modal de expiración
    const [editingExpirationUser, setEditingExpirationUser] = useState(null);
    const [editingContextDevice, setEditingContextDevice] = useState(null); // Nuevo: Contexto de dispositivo
    const [tempStart, setTempStart] = useState('');
    const [tempEnd, setTempEnd] = useState('');

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const list = await UserService.getAllUsers();
            setUsers(list);
        } catch (e) {
            console.error("Error loading users", e);
            setMsg({ type: 'error', text: 'Error cargando usuarios: ' + e.message });
        } finally {
            setLoading(false);
        }
    };

    /**
     * Muestra el modal de expiración.
     * @param {*} user Usuario a editar
     * @param {*} contextDevice Dispositivo específico (o null para Global)
     */
    const openExpirationModal = (user, contextDevice = null) => {
        setEditingExpirationUser(user);
        setEditingContextDevice(contextDevice);

        let userStart = user.startDate;
        let userEnd = user.expirationDate;

        // Si hay contexto de dispositivo, buscar regla específica
        if (contextDevice && user.deviceAccess && user.deviceAccess[contextDevice.id]) {
            const rule = user.deviceAccess[contextDevice.id];
            userStart = rule.startDate;
            userEnd = rule.expirationDate;
        }

        // Pre-cargar valores
        if (userStart) {
            setTempStart(new Date(userStart.seconds * 1000).toISOString().split('T')[0]);
        } else {
            // Si es regla específica y no existe, dejamo vacio. Si es Global y no existe, hoy.
            setTempStart('');
        }

        if (userEnd) {
            setTempEnd(new Date(userEnd.seconds * 1000).toISOString().split('T')[0]);
        } else {
            setTempEnd('');
        }
    };



    const handleDeleteUser = async (uid, name) => {
        if (!confirm(`¿Estás seguro de ELIMINAR al usuario "${name}"?\nEsta acción es irreversible y borrará sus datos de la App.`)) return;

        try {
            await UserService.deleteUser(uid);
            setMsg({ type: 'success', text: 'Usuario eliminado correctamente' });
            loadUsers();
        } catch (e) {
            console.error("Delete error", e);
            setMsg({ type: 'error', text: 'Error al eliminar usuario' });
        }
    };

    const handleSaveExpiration = async (overrideStart = undefined, overrideEnd = undefined) => {
        if (!editingExpirationUser) return;

        try {
            // Usar overrides si existen, si no usar estado
            const startStr = overrideStart !== undefined ? overrideStart : tempStart;
            const endStr = overrideEnd !== undefined ? overrideEnd : tempEnd;

            // Convertir strings YYYY-MM-DD a Date objects
            const startDate = startStr ? new Date(startStr + 'T00:00:00') : null;
            const endDate = endStr ? new Date(endStr + 'T23:59:59') : null;

            if (startDate && endDate && startDate > endDate) {
                alert("La fecha de inicio no puede ser posterior a la de fin.");
                return;
            }

            // Guardar (Pasando ID de dispositivo si aplica)
            await UserService.updateUserExpiration(
                editingExpirationUser.uid,
                startDate,
                endDate,
                editingContextDevice ? editingContextDevice.id : null
            );

            setMsg({ type: 'success', text: editingContextDevice ? 'Vigencia Específica Guardada' : 'Vigencia Global Guardada' });
            setEditingExpirationUser(null);
            setEditingContextDevice(null);
            loadUsers();
        } catch (e) {
            console.error(e);
            setMsg({ type: 'error', text: 'Error guardando vigencia' });
        }
    };

    // --- LÓGICA DE AGRUPACIÓN ---
    // --- LÓGICA DE AGRUPACIÓN ---
    const admins = users.filter(u => u.role === 'admin');

    const deviceGroups = devices.map(device => {
        // Robustez: Separar por comas/espacios/puntos y coma y limpiar
        const allowedEmails = (device.allowedEmails || [])
            .flatMap(e => e.split(/[,;\s]+/))
            .map(e => e.toLowerCase().trim())
            .filter(e => e.length > 0 && e.includes('@'));

        // 1. Usuarios Registrados que están en la lista
        const registeredUsers = users.filter(u => {
            if (u.role === 'admin') return false;
            const userEmail = (u.email || '').toLowerCase().trim();
            return allowedEmails.includes(userEmail);
        });

        // 2. Emails en lista blanca pero NO en base de datos (Pendientes)
        const registeredEmails = users.map(u => (u.email || '').toLowerCase().trim());
        const pendingEmails = allowedEmails.filter(e => !registeredEmails.includes(e));

        const pendingUsers = pendingEmails.map(email => ({
            uid: `pending-${email}-${device.id}`,
            email: email,
            displayName: 'Usuario Pendiente',
            role: 'pending',
            isPending: true
        }));

        // Combinar
        return { device, users: [...registeredUsers, ...pendingUsers] };
    });

    const unassignedUsers = users.filter(u => {
        if (u.role === 'admin') return false;
        const isInAnyDoor = devices.some(d => ((d.allowedEmails || []).map(e => e.toLowerCase().trim())).includes((u.email || '').toLowerCase().trim()));
        return !isInAnyDoor;
    });

    // --- COMPONENTES AUXILIARES ---

    const handleRoleCycle = async (user) => {
        // Cycle: user -> validador -> admin -> user
        const currentRole = user.role || 'user';
        let nextRole = 'user';
        let label = 'Usuario';

        if (currentRole === 'user') { nextRole = 'validador'; label = 'Validador'; }
        else if (currentRole === 'validador') { nextRole = 'admin'; label = 'Administrador'; }
        else if (currentRole === 'admin') { nextRole = 'user'; label = 'Usuario'; }

        if (!confirm(`¿Cambiar rol de "${user.displayName || user.email}" a ${label}?`)) return;

        try {
            await UserService.updateUserRole(user.uid, nextRole);
            setMsg({ type: 'success', text: `Rol actualizado a ${label}` });
            // Optimistic update or reload
            loadUsers();
        } catch (e) {
            console.error(e);
            setMsg({ type: 'error', text: 'Error actualizando rol' });
        }
    };

    const UserRow = ({ u, contextDevice }) => {
        const now = new Date();
        let statusNode = <span style={{ color: '#2ecc71' }}>Permanente</span>;

        // Visualización para PENDIENTES
        if (u.isPending) {
            return (
                <tr key={u.uid} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '12px' }}>
                        <div style={{ color: '#aaa', fontStyle: 'italic' }}>{u.email}</div>
                        <div style={{ fontSize: '0.8em', color: '#666' }}>No registrado en App</div>
                    </td>
                    <td style={{ padding: '12px', fontSize: '0.9em', color: '#888' }}>
                        <span style={{ border: '1px dashed #7f8c8d', padding: '2px 6px', borderRadius: '4px' }}>
                            ⏳ Esperando Registro
                        </span>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                        <span style={{ background: '#34495e', color: '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '0.8em', opacity: 0.7 }}>User</span>
                    </td>
                    <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px' }}>
                            <button
                                onClick={() => alert(`⏳ Usuario Pendiente\n\nEste usuario aún no se ha registrado.\n\nLa licencia se activará automáticamente (30 días) cuando inicie sesión por primera vez.\nNo se puede editar antes del registro.`)}
                                style={{ opacity: 0.8, background: 'transparent', border: '1px solid #3498db', color: '#3498db', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
                                title="Ver inforamción de vigencia"
                            >
                                📅
                            </button>
                            {/* No mostramos botón eliminar aquí porque se gestiona en Configuración de Puerta (Lista Blanca) */}
                            {/* O podríamos permitir eliminar de la lista blanca directamete? Sería muy complejo. Mejor que vayan a config. */}
                            <div style={{ fontSize: '0.7em', color: '#555', maxWidth: '80px', textAlign: 'right' }}>
                                Gestionar en Puerta
                            </div>
                        </div>
                    </td>
                </tr>
            );
        }

        // Determinar fechas basado en contexto (EXISTENTE)
        let start = u.startDate ? new Date(u.startDate.seconds * 1000) : null;
        let end = u.expirationDate ? new Date(u.expirationDate.seconds * 1000) : null;
        let isSpecific = false;

        if (contextDevice && u.deviceAccess && u.deviceAccess[contextDevice.id]) {
            const rule = u.deviceAccess[contextDevice.id];
            start = rule.startDate ? new Date(rule.startDate.seconds * 1000) : null;
            end = rule.expirationDate ? new Date(rule.expirationDate.seconds * 1000) : null;
            isSpecific = true;
        }

        if (u.role !== 'admin' && (end || start)) {
            // Lógica de visualización
            if (end && now > end) {
                statusNode = <span style={{ color: '#e74c3c', fontWeight: 'bold', border: '1px solid #e74c3c', borderRadius: '4px', padding: '2px 4px' }}>EXPIRO: {end.toLocaleDateString()}</span>;
            } else if (start && now < start) {
                statusNode = <span style={{ color: '#f39c12', fontWeight: 'bold' }}>INICIA: {start.toLocaleDateString()}</span>;
            } else if (end) {
                statusNode = <span style={{ color: '#3498db' }}>VENCE: {end.toLocaleDateString()}</span>;
            }
        } else if (u.role === 'admin') {
            statusNode = <span style={{ color: '#f39c12' }}>∞ Siempre Activo</span>;
        }

        // Texto del Rango
        let rangeText = "";
        if (u.role !== 'admin') {
            if (start && end) {
                rangeText = `${start.toLocaleDateString()} ➜ ${end.toLocaleDateString()}`;
            } else if (start) {
                rangeText = `Desde: ${start.toLocaleDateString()}`;
            } else if (end) {
                rangeText = `Hasta: ${end.toLocaleDateString()}`;
            }
        }

        return (
            <tr key={u.uid} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '12px' }}>
                    <div style={{ fontWeight: 'bold' }}>{u.displayName || 'Sin Nombre'}</div>
                    <div style={{ fontSize: '0.8em', color: '#ccc' }}>{u.email}</div>
                </td>
                <td style={{ padding: '12px', fontSize: '0.9em' }}>
                    <div>{u.phone || '-'}</div>
                    <div style={{ marginTop: '5px', fontSize: '0.8em' }}>
                        {isSpecific && <span title="Regla específica para este dispositivo" style={{ marginRight: '5px' }}>🎯</span>}
                        {statusNode}
                    </div>
                    {rangeText && <div style={{ fontSize: '0.75em', color: '#aaa', marginTop: '2px' }}>{rangeText}</div>}
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                    <button
                        onClick={() => handleRoleCycle(u)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                        title="Clic para cambiar rol"
                    >
                        {u.role === 'admin' ? (
                            <span style={{ background: '#f39c12', color: 'black', padding: '4px 8px', borderRadius: '12px', fontSize: '0.8em', fontWeight: 'bold' }}>Admin</span>
                        ) : u.role === 'validador' ? (
                            <span style={{ background: '#9b59b6', color: 'white', padding: '4px 8px', borderRadius: '12px', fontSize: '0.8em', fontWeight: 'bold' }}>Validador</span>
                        ) : (
                            <span style={{ background: '#34495e', color: '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '0.8em' }}>User</span>
                        )}
                    </button>
                </td>
                <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px' }}>
                        {u.role !== 'admin' && (
                            <button
                                onClick={() => openExpirationModal(u, contextDevice)}
                                style={{ background: 'transparent', border: '1px solid #3498db', color: '#3498db', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
                                title={contextDevice ? `Configurar Vigencia en ${contextDevice.name}` : "Configurar Vigencia Global"}
                            >
                                📅
                            </button>
                        )}
                        {u.role !== 'admin' && (
                            <button
                                onClick={() => handleDeleteUser(u.uid, u.displayName || u.email)}
                                style={{ background: 'rgba(231, 76, 60, 0.1)', color: '#c0392b', border: '1px solid #c0392b', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
                                title="Eliminar datos"
                            >
                                🗑️
                            </button>
                        )}
                    </div>
                </td>
            </tr>
        );
    };

    const TableHeader = () => (
        <thead>
            <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.1)', color: '#aaa', fontSize: '0.9em' }}>
                <th style={{ padding: '10px', textAlign: 'left', width: '30%' }}>Usuario</th>
                <th style={{ padding: '10px', textAlign: 'left', width: '25%' }}>Contacto / Vigencia</th>
                <th style={{ padding: '10px', textAlign: 'center', width: '15%' }}>Rol</th>
                <th style={{ padding: '10px', textAlign: 'right', width: '30%' }}>Acciones</th>
            </tr>
        </thead>
    );

    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [defaultDays, setDefaultDays] = useState(30);

    const openSettings = async () => {
        try {
            const s = await UserService.getSystemSettings();
            if (s.defaultLicenseDays) setDefaultDays(s.defaultLicenseDays);
            setShowSettingsModal(true);
        } catch (e) {
            console.error(e);
            alert("Error cargando configuración");
        }
    };

    const saveSettings = async () => {
        try {
            await UserService.updateSystemSettings({ defaultLicenseDays: parseInt(defaultDays) });
            setMsg({ type: 'success', text: 'Configuración guardada' });
            setShowSettingsModal(false);
            setTimeout(() => setMsg(null), 3000);
        } catch (e) {
            alert("Error guardando");
        }
    };

    return (
        <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>←</button>
                    <h2 style={{ margin: 0 }}>Gestión de Usuarios</h2>
                </div>
                <button
                    onClick={openSettings}
                    style={{ background: '#34495e', color: '#fff', border: 'none', padding: '10px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', fontSize: '1.2rem' }}
                    title="Configuración Global"
                >
                    ⚙️
                </button>
            </div>

            {msg && (
                <div style={{ padding: '10px', marginBottom: '15px', borderRadius: '8px', background: msg.type === 'error' ? '#e74c3c' : msg.type === 'success' ? '#2ecc71' : '#3498db', color: 'white', textAlign: 'center' }}>
                    {msg.text}
                </div>
            )}

            {loading ? (
                <p style={{ textAlign: 'center', color: '#aaa' }}>Cargando usuarios...</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                    <div className="user-group">
                        <h3 style={{ borderBottom: '1px solid #f39c12', paddingBottom: '10px', color: '#f39c12', margin: '0 0 10px 0' }}>👑 Administradores</h3>
                        <div style={{ background: 'rgba(243, 156, 18, 0.05)', borderRadius: '8px', padding: '10px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}><TableHeader /><tbody>{admins.map(u => <UserRow key={u.uid} u={u} contextDevice={null} />)}</tbody></table>
                        </div>
                    </div>

                    {deviceGroups.map(group => (
                        <div key={group.device.id} className="user-group">
                            <h3 style={{ borderBottom: '1px solid #3498db', paddingBottom: '10px', color: '#3498db', margin: '0 0 10px 0' }}>🚪 {group.device.name}</h3>
                            <div style={{ background: 'rgba(52, 152, 219, 0.05)', borderRadius: '8px', padding: '10px' }}>
                                {group.users.length === 0 ? <p style={{ color: '#aaa', fontStyle: 'italic', margin: '10px' }}>Sin usuarios asignados.</p> :
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}><TableHeader /><tbody>{group.users.map(u => <UserRow key={u.uid} u={u} contextDevice={group.device} />)}</tbody></table>
                                }
                            </div>
                        </div>
                    ))}

                    {unassignedUsers.length > 0 && (
                        <div className="user-group">
                            <h3 style={{ borderBottom: '1px solid #95a5a6', paddingBottom: '10px', color: '#95a5a6', margin: '0 0 10px 0' }}>⚠️ Sin Asignar</h3>
                            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '10px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}><TableHeader /><tbody>{unassignedUsers.map(u => <UserRow key={u.uid} u={u} contextDevice={null} />)}</tbody></table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* MODAL DE RANGO DE FECHAS */}
            {editingExpirationUser && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }}>
                    <div style={{ background: '#222', padding: '20px', borderRadius: '10px', width: '90%', maxWidth: '400px', border: '1px solid #444' }}>
                        <h3>{editingContextDevice ? `📅 Vigencia: ${editingContextDevice.name}` : `📅 Vigencia Global`}</h3>
                        <p style={{ color: '#fff', fontWeight: 'bold', margin: '5px 0' }}>{editingExpirationUser.displayName || 'Usuario'}</p>
                        <p style={{ color: '#aaa', fontSize: '0.9em', marginBottom: '15px' }}>
                            {editingContextDevice ? 'Configurando acceso exclusivo para esta puerta.' : 'Configurando acceso por defecto para todas las puertas.'}
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', margin: '20px 0' }}>
                            {/* BOTONES RÁPIDOS */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <button onClick={() => {
                                    const now = new Date();
                                    const future = new Date(); future.setMonth(future.getMonth() + 1);
                                    setTempStart(now.toISOString().split('T')[0]);
                                    setTempEnd(future.toISOString().split('T')[0]);
                                }} style={presetBtnStyle}>📅 +1 Mes</button>

                                <button onClick={() => {
                                    const now = new Date();
                                    const future = new Date(); future.setFullYear(future.getFullYear() + 1);
                                    setTempStart(now.toISOString().split('T')[0]);
                                    setTempEnd(future.toISOString().split('T')[0]);
                                }} style={presetBtnStyle}>📅 +1 Año</button>
                            </div>

                            <hr style={{ width: '100%', borderColor: '#444', margin: '0' }} />

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8em', color: '#aaa', marginBottom: '5px' }}>Fecha Inicio (Opcional):</label>
                                <input
                                    type="date"
                                    value={tempStart}
                                    onChange={(e) => setTempStart(e.target.value)}
                                    style={inputStyle}
                                />
                                <div style={{ fontSize: '0.7em', color: '#666', marginTop: '2px' }}>Vacio = Inmediato</div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8em', color: '#aaa', marginBottom: '5px' }}>Fecha Fin (Opcional):</label>
                                <input
                                    type="date"
                                    value={tempEnd}
                                    onChange={(e) => setTempEnd(e.target.value)}
                                    style={inputStyle}
                                />
                                <div style={{ fontSize: '0.7em', color: '#666', marginTop: '2px' }}>Vacio = Indefinido</div>
                            </div>

                            <button onClick={() => {
                                setTempStart('');
                                setTempEnd('');
                                handleSaveExpiration('', '');
                            }} style={{ ...presetBtnStyle, background: '#2ecc71', color: '#fff' }}>
                                ∞ Hacer Permanente (Borrar Fechas)
                            </button>

                            <button onClick={() => {
                                const yesterday = new Date();
                                yesterday.setDate(yesterday.getDate() - 1);
                                const yStr = yesterday.toISOString().split('T')[0];

                                setTempStart(yStr);
                                setTempEnd(yStr);
                                handleSaveExpiration(yStr, yStr);
                            }} style={{ ...presetBtnStyle, background: '#e74c3c', color: '#fff', marginTop: '10px' }}>
                                🚫 Eliminar Vigencia (Revocar)
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                            <button
                                onClick={() => setEditingExpirationUser(null)}
                                style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid #555', color: '#ccc', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => handleSaveExpiration()}
                                style={{ flex: 1, padding: '10px', background: '#3498db', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* MODAL CONFIGURACIÓN */}
            {showSettingsModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
                }}>
                    <div style={{ background: '#222', padding: '25px', borderRadius: '10px', width: '90%', maxWidth: '350px', border: '1px solid #444' }}>
                        <h3 style={{ marginTop: 0 }}>⚙️ Configuración Global</h3>

                        <div style={{ margin: '20px 0' }}>
                            <label style={{ display: 'block', fontSize: '0.9em', color: '#ccc', marginBottom: '5px' }}>
                                Vigencia por Defecto (Nuevos Usuarios)
                            </label>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <input
                                    type="number"
                                    min="1"
                                    value={defaultDays}
                                    onChange={(e) => setDefaultDays(e.target.value)}
                                    style={{ ...inputStyle, width: '80px', textAlign: 'center', fontSize: '1.2em' }}
                                />
                                <span style={{ color: '#aaa' }}>días</span>
                            </div>
                            <p style={{ fontSize: '0.8em', color: '#666', marginTop: '10px' }}>
                                Al registrarse un nuevo usuario, se le asignará esta duración automáticamente.
                            </p>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                            <button
                                onClick={() => setShowSettingsModal(false)}
                                style={{ flex: 1, padding: '10px', background: 'none', border: '1px solid #555', color: '#ccc', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={saveSettings}
                                style={{ flex: 1, padding: '10px', background: '#2ecc71', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* DEBUG AREA */}
            <details style={{ marginTop: '50px', color: '#555', cursor: 'pointer' }}>
                <summary>🛠️ Debug: Lista cruda de usuarios en DB ({users.length})</summary>
                <div style={{ padding: '10px', background: '#111', borderRadius: '8px', wordBreak: 'break-all', fontSize: '0.8em' }}>
                    {users.map(u => (
                        <div key={u.uid} style={{ marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ color: u.role === 'admin' ? '#f39c12' : '#ccc' }}>
                                {u.email} ({u.role}) [{u.deviceAccess ? Object.keys(u.deviceAccess).length : 0} rules]
                            </span>
                            <button
                                onClick={async () => {
                                    if (confirm(`¿Regenerar licencias para ${u.email}?`)) {
                                        await UserService.regenerateLicenses(u.uid, u.email);
                                        alert("Regeneración solicitada. Recarga la página para ver cambios.");
                                    }
                                }}
                                style={{ background: '#3498db', border: 'none', color: 'white', borderRadius: '4px', padding: '2px 5px', cursor: 'pointer', fontSize: '0.8em' }}
                            >
                                🔄
                            </button>
                        </div>
                    ))}

                    <hr style={{ borderColor: '#333', margin: '15px 0' }} />

                    <button
                        onClick={async () => {
                            if (!confirm("⚠️ ¿Sincronizar Listas?\n\nEsto eliminará de TODAS las puertas a cualquier usuario que no esté registrado en la base de datos (excepto tú).\n\nLos usuarios 'Pendientes' serán borrados permanentemente.")) return;

                            try {
                                const validEmails = users.map(u => u.email.toLowerCase().trim());
                                const currentUserEmail = FirebaseService.auth.currentUser?.email?.toLowerCase();
                                if (!validEmails.includes(currentUserEmail)) validEmails.push(currentUserEmail);

                                let updatedCount = 0;

                                for (const device of devices) {
                                    const currentAllowed = (device.allowedEmails || []).map(e => e.toLowerCase().trim());
                                    const newAllowed = currentAllowed.filter(email => validEmails.includes(email));

                                    // Solo actualizar si hay cambios
                                    if (newAllowed.length !== currentAllowed.length) {
                                        console.log(`Cleaning device ${device.name}:`, currentAllowed, '->', newAllowed);
                                        await FirebaseService.updateDoor(device.id, { allowedEmails: newAllowed });
                                        updatedCount++;
                                    }
                                }

                                alert(`Proceso completado.\nSe actualizaron ${updatedCount} puertas.`);
                            } catch (e) { console.error(e); alert("Error: " + e.message); }
                        }}
                        style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', marginTop: '10px' }}
                    >
                        🧹 Limpiar Usuarios Fantasma
                    </button>
                </div>
            </details>
        </div>
    );
}

const presetBtnStyle = {
    padding: '10px', background: '#34495e', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', textAlign: 'left', width: '100%'
};

const inputStyle = {
    padding: '10px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '4px', width: '100%'
};
