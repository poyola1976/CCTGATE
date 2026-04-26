import { useState, useEffect } from 'react';
import { FirebaseService } from '../services/firebase';
import { UserService } from '../services/userService';

export default function ConfigScreen({
    userRole, devices, onSaveDevice, onUpdateDevice, onDeleteDevice,
    cameras, onSaveCamera, onUpdateCamera, onDeleteCamera, onBack
}) {
    const doors = devices || [];
    const [editingId, setEditingId] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        group: '',
        serverUrl: 'https://shelly-112-eu.shelly.cloud',
        deviceId: '',
        authKey: '',
        allowedEmails: [],
        associatedCameraId: '',
        generation: 'gen4',
        grantDays: 0,
        customImage: ''
    });

    const [newEmail, setNewEmail] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Filtered doors based on search
    const filteredDoors = doors.filter(d =>
        d.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.group?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        d.deviceId?.includes(searchTerm)
    );

    // Email status checking
    const [emailStatuses, setEmailStatuses] = useState({});

    useEffect(() => {
        if (formData.allowedEmails.length > 0) {
            const checkStatuses = async () => {
                const statuses = {};
                try {
                    const allUsers = await UserService.getAllUsers();
                    const registeredEmails = new Set(allUsers.map(u => u.email?.toLowerCase()));
                    for (const email of formData.allowedEmails) {
                        statuses[email] = registeredEmails.has(email.toLowerCase()) ? 'registered' : 'pending';
                    }
                } catch {
                    for (const email of formData.allowedEmails) {
                        statuses[email] = 'unknown';
                    }
                }
                setEmailStatuses(statuses);
            };
            const timeoutId = setTimeout(checkStatuses, 500);
            return () => clearTimeout(timeoutId);
        }
    }, [formData.allowedEmails]);

    const handleEditClick = (device) => {
        setFormData({
            name: device.name,
            group: device.group || '',
            serverUrl: device.serverUrl,
            deviceId: device.deviceId,
            authKey: device.authKey,
            allowedEmails: Array.isArray(device.allowedEmails) ? device.allowedEmails : (device.allowedEmails ? [device.allowedEmails] : []),
            associatedCameraId: device.associatedCameraId || '',
            generation: device.generation || 'gen1',
            grantDays: device.grantDays ?? 0,
            customImage: device.customImage || ''
        });
        setEditingId(device.id);
        window.scroll({ top: document.body.scrollHeight, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setFormData({
            name: '',
            group: '',
            serverUrl: 'https://shelly-112-eu.shelly.cloud',
            deviceId: '',
            authKey: '',
            allowedEmails: [],
            associatedCameraId: '',
            generation: 'gen4',
            grantDays: 0,
            customImage: ''
        });
        setNewEmail('');
        setSearchTerm('');
    };

    const handleImageSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            alert("⚠️ La imagen es demasiado grande (>5MB). Intenta con una más pequeña.");
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            setFormData({ ...formData, customImage: event.target.result });
        };
        reader.readAsDataURL(file);
    };

    const addEmail = () => {
        const email = newEmail.trim().toLowerCase();
        if (email && !formData.allowedEmails.includes(email)) {
            setFormData({
                ...formData,
                allowedEmails: [...formData.allowedEmails, email]
            });
            setNewEmail('');
        }
    };

    const removeEmail = (email) => {
        setFormData({
            ...formData,
            allowedEmails: formData.allowedEmails.filter(e => e !== email)
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            const deviceData = {
                name: formData.name,
                group: formData.group,
                serverUrl: formData.serverUrl,
                deviceId: formData.deviceId,
                authKey: formData.authKey,
                allowedEmails: formData.allowedEmails,
                associatedCameraId: formData.associatedCameraId,
                generation: formData.generation || 'gen1',
                grantDays: parseInt(formData.grantDays) || 0,
                customImage: formData.customImage || ''
            };

            if (editingId) {
                await onUpdateDevice({ id: editingId, ...deviceData });
            } else {
                await onSaveDevice(deviceData);
            }
            handleCancelEdit();
        } catch (error) {
            alert("Error: " + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm("¿Seguro que quieres borrar esta puerta?")) {
            await onDeleteDevice(id);
        }
    };

    const inputStyle = {
        width: '100%',
        padding: '12px',
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        color: '#fff',
        fontSize: '0.9em',
        boxSizing: 'border-box',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
    };

    return (
        <div style={{ padding: '10px', width: '100%', maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
            {/* HEADER CON BOTÓN VOLVER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
                <h2 style={{ color: '#fff', display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                    <span style={{ fontSize: '1.2em' }}>⚙️</span> Configuración de Puertas
                </h2>
                <button
                    onClick={onBack}
                    style={{
                        background: 'rgba(255,255,255,0.1)',
                        border: 'none',
                        color: '#fff',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '0.9em'
                    }}
                >
                    ← Volver
                </button>
            </div>

            {/* BUSCADOR */}
            <div style={{ marginBottom: '20px' }}>
                <input
                    type="text"
                    placeholder="🔍 Buscar por nombre, grupo o ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ ...inputStyle, background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}
                />
            </div>

            {/* LISTA DE PUERTAS EXISTENTES */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', marginBottom: '40px' }}>
                {filteredDoors.map(d => (
                    <div key={d.id} style={{
                        background: 'rgba(255,255,255,0.05)',
                        padding: '20px',
                        borderRadius: '15px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        position: 'relative',
                        backdropFilter: 'blur(10px)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <h4 style={{ color: '#fff', margin: 0, fontSize: '1.1em' }}>{d.name}</h4>
                                <p style={{ color: '#888', margin: '5px 0', fontSize: '0.8em' }}>{d.group || 'Sin grupo'}</p>
                                <span style={{
                                    fontSize: '0.7em',
                                    background: 'rgba(255,255,255,0.1)',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    color: '#aaa'
                                }}>{d.deviceId}</span>
                                <div style={{ marginTop: '8px', fontSize: '0.75em', color: '#2ecc71' }}>
                                    🎁 Días de Gracia: {d.grantDays ?? 0}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={() => handleEditClick(d)} style={{ background: '#3498db', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8em' }}>Editar</button>
                                <button onClick={() => handleDelete(d.id)} style={{ background: '#e74c3c', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8em' }}>Borrar</button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* FORMULARIO DE EDICIÓN / AGREGAR */}
            <div id="edit-form" style={{
                background: 'rgba(255,255,255,0.05)',
                padding: '15px',
                borderRadius: '20px',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                boxSizing: 'border-box',
                maxWidth: '100%'
            }}>
                <h3 style={{ color: '#fff', marginBottom: '20px', textAlign: 'center' }}>
                    {editingId ? `📝 Editar Puerta: ${formData.name}` : '➕ Añadir Nueva Puerta'}
                </h3>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '100%', boxSizing: 'border-box' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '5px' }}>Nombre Amigable:</label>
                            <input
                                required
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                style={inputStyle}
                                placeholder="Ej: Camión 1, Acceso Norte..."
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '5px' }}>Grupo:</label>
                            <input
                                value={formData.group}
                                onChange={(e) => setFormData({ ...formData, group: e.target.value })}
                                style={inputStyle}
                                placeholder="Ej: Sucursal Centro, Planta sur..."
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '5px' }}>URL del Servidor:</label>
                            <input
                                required
                                value={formData.serverUrl}
                                onChange={(e) => setFormData({ ...formData, serverUrl: e.target.value })}
                                style={inputStyle}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '5px' }}>Device ID (Shelly):</label>
                            <input
                                required
                                value={formData.deviceId}
                                onChange={(e) => setFormData({ ...formData, deviceId: e.target.value })}
                                style={inputStyle}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '5px' }}>Auth Key (Shelly):</label>
                            <input
                                required
                                value={formData.authKey}
                                onChange={(e) => setFormData({ ...formData, authKey: e.target.value })}
                                style={inputStyle}
                                type="password"
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '5px' }}>ID de Cámara Asociada:</label>
                            <input
                                value={formData.associatedCameraId}
                                onChange={(e) => setFormData({ ...formData, associatedCameraId: e.target.value })}
                                style={inputStyle}
                                placeholder="ID de la cámara en Firestore"
                            />
                        </div>
                    </div>

                    {/* GESTIÓN DE EMAILS AUTORIZADOS */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '15px' }}>
                        <label style={{ display: 'block', fontSize: '0.9em', color: '#3498db', marginBottom: '10px', fontWeight: 'bold' }}>📧 Emails Autorizados:</label>
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                            <input
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
                                style={{ ...inputStyle, flex: 1 }}
                                placeholder="email@ejemplo.com"
                            />
                            <button
                                type="button"
                                onClick={addEmail}
                                style={{ background: '#2ecc71', border: 'none', color: '#fff', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                +
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            {formData.allowedEmails.map(email => (
                                <div key={email} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: emailStatuses[email] === 'registered' ? 'rgba(46,204,113,0.2)' : 'rgba(255,255,255,0.1)',
                                    padding: '6px 12px',
                                    borderRadius: '20px',
                                    fontSize: '0.85em',
                                    border: emailStatuses[email] === 'registered' ? '1px solid rgba(46,204,113,0.4)' : '1px solid rgba(255,255,255,0.1)'
                                }}>
                                    <span style={{ color: emailStatuses[email] === 'registered' ? '#2ecc71' : '#f39c12' }}>
                                        {emailStatuses[email] === 'registered' ? '✅' : '⏳'}
                                    </span>
                                    <span style={{ color: '#ddd' }}>{email}</span>
                                    <button
                                        type="button"
                                        onClick={() => removeEmail(email)}
                                        style={{ background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontWeight: 'bold', padding: '0 2px' }}
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                        {formData.allowedEmails.length === 0 && (
                            <p style={{ fontSize: '0.75em', color: '#666', margin: '10px 0 0' }}>Sin emails autorizados. Agrega al menos uno.</p>
                        )}
                    </div>

                    {/* IMAGEN CUSTOM */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '15px' }}>
                        <label style={{ display: 'block', fontSize: '0.9em', color: '#2ecc71', marginBottom: '10px', fontWeight: 'bold' }}>🖼️ Imagen Personalizada del Dispositivo:</label>
                        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                            <div style={{
                                width: '100px',
                                height: '100px',
                                borderRadius: '12px',
                                background: 'rgba(255,255,255,0.05)',
                                border: '2px dashed rgba(255,255,255,0.2)',
                                overflow: 'hidden',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                {formData.customImage ? (
                                    <img src={formData.customImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <span style={{ fontSize: '2em', opacity: 0.3 }}>📷</span>
                                )}
                            </div>
                            <div style={{ flex: 1 }}>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageSelect}
                                    style={{ color: '#888', fontSize: '0.85em' }}
                                />
                                <p style={{ fontSize: '0.7em', color: '#666', marginTop: '8px' }}>Se recomienda formato cuadrado (PNG/JPG). Máximo 5MB.</p>
                                {formData.customImage && (
                                    <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, customImage: '' })}
                                        style={{ background: 'none', border: 'none', color: '#e74c3c', fontSize: '0.8em', padding: 0, marginTop: '5px', cursor: 'pointer', textDecoration: 'underline' }}
                                    >
                                        Quitar imagen
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '5px' }}>Generación:</label>
                            <select
                                value={formData.generation}
                                onChange={(e) => setFormData({ ...formData, generation: e.target.value })}
                                style={inputStyle}
                            >
                                <option value="gen1">Shelly Gen 1 (Legacy)</option>
                                <option value="gen2">Shelly Gen 2/3 (Pro/Plus)</option>
                                <option value="gen4">UNIVERSAL (Auto)</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '5px' }}>Días de Gracia (Nuevos Usuarios):</label>
                            <input
                                type="number"
                                min="0"
                                value={formData.grantDays}
                                onChange={(e) => setFormData({ ...formData, grantDays: e.target.value })}
                                style={inputStyle}
                                placeholder="0 = Sin regalo"
                            />
                        </div>
                    </div>

                    {/* CÁMARAS ASOCIADAS */}
                    {cameras && cameras.length > 0 && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '5px' }}>Cámara Asociada:</label>
                            <select
                                value={formData.associatedCameraId}
                                onChange={(e) => setFormData({ ...formData, associatedCameraId: e.target.value })}
                                style={inputStyle}
                            >
                                <option value="">Sin cámara</option>
                                {cameras.map(cam => (
                                    <option key={cam.id} value={cam.id}>{cam.name || cam.id}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
                        <button
                            type="submit"
                            disabled={isSaving}
                            style={{
                                flex: 2,
                                background: '#2ecc71',
                                color: '#fff',
                                border: 'none',
                                padding: '15px',
                                borderRadius: '10px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                fontSize: '1em'
                            }}
                        >
                            {isSaving ? 'Guardando...' : (editingId ? 'Actualizar Puerta' : 'Crear Puerta')}
                        </button>
                        {editingId && (
                            <button
                                type="button"
                                onClick={handleCancelEdit}
                                style={{
                                    flex: 1,
                                    background: 'rgba(255,255,255,0.1)',
                                    color: '#fff',
                                    border: 'none',
                                    padding: '15px',
                                    borderRadius: '10px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
}
