import { useState, useEffect } from 'react';
import { UserService } from '../services/userService';

export default function AdminUsersScreen({ devices, onBack }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState(null);

    // Estado para modal de expiración
    const [editingExpirationUser, setEditingExpirationUser] = useState(null);
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

    const openExpirationModal = (user) => {
        setEditingExpirationUser(user);

        // Pre-cargar valores actuales (Globales)
        if (user.startDate) {
            setTempStart(new Date(user.startDate.seconds * 1000).toISOString().split('T')[0]);
        } else {
            setTempStart(new Date().toISOString().split('T')[0]);
        }

        if (user.expirationDate) {
            setTempEnd(new Date(user.expirationDate.seconds * 1000).toISOString().split('T')[0]);
        } else {
            setTempEnd('');
        }
    };

    const handleRoleChange = async (uid, newRole) => {
        if (!confirm(`¿Seguro que quieres cambiar el rol a "${newRole}"?`)) return;

        try {
            await UserService.updateUserRole(uid, newRole);
            setMsg({ type: 'success', text: `Rol actualizado a ${newRole}` });
            loadUsers();
        } catch (e) {
            console.error(e);
            setMsg({ type: 'error', text: 'Error actualizando rol' });
        }
        setTimeout(() => setMsg(null), 3000);
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

            // Modo Global siempre
            await UserService.updateUserExpiration(editingExpirationUser.uid, startDate, endDate);

            setMsg({ type: 'success', text: 'Vigencia actualizada' });
            setEditingExpirationUser(null);
            loadUsers();
        } catch (e) {
            console.error(e);
            setMsg({ type: 'error', text: 'Error guardando vigencia' });
        }
    };

    // --- LÓGICA DE AGRUPACIÓN ---
    const admins = users.filter(u => u.role === 'admin');

    const deviceGroups = devices.map(device => {
        const allowedEmails = device.allowedEmails || [];
        const deviceUsers = users.filter(u => u.role !== 'admin' && allowedEmails.includes(u.email));
        return { device, users: deviceUsers };
    });

    const unassignedUsers = users.filter(u => {
        if (u.role === 'admin') return false;
        const isInAnyDoor = devices.some(d => (d.allowedEmails || []).includes(u.email));
        return !isInAnyDoor;
    });

    // --- COMPONENTES AUXILIARES ---

    const UserRow = ({ u }) => {
        const now = new Date();
        let statusNode = <span style={{ color: '#2ecc71' }}>Permanente</span>;

        if (u.role !== 'admin' && (u.expirationDate || u.startDate)) {
            // Lógica de visualización
            const start = u.startDate ? new Date(u.startDate.seconds * 1000) : null;
            const end = u.expirationDate ? new Date(u.expirationDate.seconds * 1000) : null;

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
            const start = u.startDate ? new Date(u.startDate.seconds * 1000) : null;
            const end = u.expirationDate ? new Date(u.expirationDate.seconds * 1000) : null;

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
                    <div style={{ marginTop: '5px', fontSize: '0.8em' }}>{statusNode}</div>
                    {rangeText && <div style={{ fontSize: '0.75em', color: '#aaa', marginTop: '2px' }}>{rangeText}</div>}
                </td>
                <td style={{ padding: '12px', textAlign: 'center' }}>
                    {u.role === 'admin' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                            <span style={{ background: '#f39c12', color: 'black', padding: '4px 8px', borderRadius: '12px', fontSize: '0.8em', fontWeight: 'bold' }}>👑 Admin</span>
                            <button onClick={() => handleRoleChange(u.uid, 'user')} style={{ background: 'transparent', color: '#e74c3c', border: '1px solid #e74c3c', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7em', cursor: 'pointer' }}>Degradar</button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                            <span style={{ background: '#34495e', color: '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '0.8em' }}>👤 User</span>
                            <button onClick={() => handleRoleChange(u.uid, 'admin')} style={{ background: 'transparent', color: '#2ecc71', border: '1px solid #2ecc71', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7em', cursor: 'pointer' }}>Ascender</button>
                        </div>
                    )}
                </td>
                <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px' }}>
                        {u.role !== 'admin' && (
                            <button
                                onClick={() => openExpirationModal(u)}
                                style={{ background: 'transparent', border: '1px solid #3498db', color: '#3498db', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
                                title="Configurar Vigencia"
                            >
                                📅
                            </button>
                        )}
                        <button
                            onClick={() => handleDeleteUser(u.uid, u.displayName || u.email)}
                            style={{ background: 'rgba(231, 76, 60, 0.1)', color: '#c0392b', border: '1px solid #c0392b', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
                            title="Eliminar datos"
                        >
                            🗑️
                        </button>
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

    return (
        <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto', color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px', gap: '15px' }}>
                <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>←</button>
                <h2 style={{ margin: 0 }}>Gestión de Usuarios</h2>
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
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}><TableHeader /><tbody>{group.users.map(u => <UserRow key={u.uid} u={u} />)}</tbody></table>
                                }
                            </div>
                        </div>
                    ))}

                    {unassignedUsers.length > 0 && (
                        <div className="user-group">
                            <h3 style={{ borderBottom: '1px solid #95a5a6', paddingBottom: '10px', color: '#95a5a6', margin: '0 0 10px 0' }}>⚠️ Sin Asignar</h3>
                            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '10px' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}><TableHeader /><tbody>{unassignedUsers.map(u => <UserRow key={u.uid} u={u} />)}</tbody></table>
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
                        <h3>📅 Vigencia Global</h3>
                        <p style={{ color: '#fff', fontWeight: 'bold' }}>{editingExpirationUser.displayName || 'Usuario'}</p>
                        <p style={{ color: '#aaa', fontSize: '0.9em' }}>
                            Configurando acceso global.
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
                                <div style={{ fontSize: '0.7em', color: '#666', marginTop: '2px' }}>Si se deja vacío, es acceso inmediato.</div>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8em', color: '#aaa', marginBottom: '5px' }}>Fecha Fin (Opcional):</label>
                                <input
                                    type="date"
                                    value={tempEnd}
                                    onChange={(e) => setTempEnd(e.target.value)}
                                    style={inputStyle}
                                />
                                <div style={{ fontSize: '0.7em', color: '#666', marginTop: '2px' }}>Si se deja vacío, es acceso indefinido.</div>
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
                                onClick={handleSaveExpiration}
                                style={{ flex: 1, padding: '10px', background: '#3498db', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const presetBtnStyle = {
    padding: '10px', background: '#34495e', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', textAlign: 'left', width: '100%'
};

const inputStyle = {
    padding: '10px', background: '#333', border: '1px solid #555', color: '#fff', borderRadius: '4px', width: '100%'
};
