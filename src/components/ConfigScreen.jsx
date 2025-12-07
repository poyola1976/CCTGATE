import { useState } from 'react';

export default function ConfigScreen({ devices, onSaveDevice, onUpdateDevice, onDeleteDevice, onBack }) {
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        serverUrl: 'https://shelly-112-eu.shelly.cloud',
        deviceId: '',
        authKey: '',
        allowedEmails: '' // String separado por comas para la UI
    });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleEditClick = (device) => {
        setFormData({
            name: device.name,
            serverUrl: device.serverUrl,
            deviceId: device.deviceId,
            authKey: device.authKey,
            // Convertir array de DB a string para el input
            allowedEmails: device.allowedEmails ? device.allowedEmails.join(', ') : ''
        });
        setEditingId(device.id);
        // Scroll to form (simple implementation)
        window.scroll({ top: document.body.scrollHeight, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setFormData({
            name: '',
            serverUrl: 'https://shelly-112-eu.shelly.cloud',
            deviceId: '',
            authKey: '',
            allowedEmails: ''
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name || !formData.deviceId || !formData.authKey) {
            alert("Por favor completa todos los campos requeridos");
            return;
        }

        // Procesar emails: String -> Array
        // 1. Quitar espacios, 2. Split por comas, 3. Filtrar vacíos
        const emailsArray = formData.allowedEmails
            ? formData.allowedEmails.split(',').map(e => e.trim()).filter(e => e.length > 0)
            : [];

        const dataToSave = {
            name: formData.name,
            serverUrl: formData.serverUrl,
            deviceId: formData.deviceId,
            authKey: formData.authKey,
            allowedEmails: emailsArray
        };

        if (editingId) {
            // ACTUALIZAR
            await onUpdateDevice({ ...dataToSave, id: editingId });
            handleCancelEdit(); // Limpiar y salir de modo edición
        } else {
            // CREAR
            await onSaveDevice(dataToSave);
            // Limpiar formulario se mantiene
            setFormData(prev => ({ ...prev, name: '', deviceId: '', authKey: '', allowedEmails: '' }));
        }
    };

    return (
        <div className="card config-screen" style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2>Gestión de Puertas</h2>
                <button onClick={onBack} style={{ padding: '5px 10px', fontSize: '0.9em' }}>Cerrar</button>
            </div>

            {/* Lista de dispositivos existentes */}
            <div className="device-list" style={{ marginBottom: '2rem' }}>
                {devices.length === 0 ? (
                    <p style={{ color: '#666', fontStyle: 'italic' }}>No hay dispositivos configurados.</p>
                ) : (
                    devices.map(dev => (
                        <div key={dev.id} style={{
                            background: editingId === dev.id ? 'rgba(46, 204, 113, 0.1)' : 'rgba(255,255,255,0.05)',
                            border: editingId === dev.id ? '1px solid #2ecc71' : 'none',
                            padding: '10px',
                            borderRadius: '8px',
                            marginBottom: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div>
                                <strong>{dev.name}</strong>
                                <div style={{ fontSize: '0.7em', color: '#999' }}>ID: {dev.deviceId}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <button
                                    onClick={() => handleEditClick(dev)}
                                    style={{ background: '#3498db33', color: '#3498db', border: 'none', padding: '5px 10px' }}
                                >
                                    ✏️
                                </button>
                                <button
                                    onClick={() => onDeleteDevice(dev.id)}
                                    style={{ background: '#e74c3c33', color: '#e74c3c', border: 'none', padding: '5px 10px' }}
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '20px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>{editingId ? 'Editar Puerta' : 'Agregar Nueva Puerta'}</h3>
                {editingId && (
                    <button onClick={handleCancelEdit} style={{ fontSize: '0.8em', background: 'transparent', border: '1px solid #fff' }}>
                        Cancelar
                    </button>
                )}
            </div>

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>Nombre (Ej: Casa)</label>
                    <input name="name" value={formData.name} onChange={handleChange} placeholder="Nombre identificativo" required />
                </div>

                <div className="form-group">
                    <label>Servidor Shelly</label>
                    <input name="serverUrl" value={formData.serverUrl} onChange={handleChange} placeholder="https://api.shelly.cloud" required />
                </div>

                <div className="form-group">
                    <label>Device ID</label>
                    <input name="deviceId" value={formData.deviceId} onChange={handleChange} placeholder="Ej: 84CCA8..." required />
                </div>

                <div className="form-group">
                    <label>Auth Key</label>
                    <input name="authKey" value={formData.authKey} onChange={handleChange} placeholder="Pegar clave larga..." required type={editingId ? "text" : "password"} />
                </div>

                <div className="form-group">
                    <label>Usuarios Autorizados (Emails)</label>
                    <input
                        name="allowedEmails"
                        value={formData.allowedEmails}
                        onChange={handleChange}
                        placeholder="ej: juan@gmail.com, maria@hotmail.com"
                        style={{ borderColor: '#3498db' }}
                    />
                    <small style={{ color: '#888', display: 'block', marginTop: '5px' }}>
                        Separa los emails con comas. Dejar vacío para uso personal.
                    </small>
                </div>

                <button type="submit" style={{
                    width: '100%',
                    marginTop: '10px',
                    background: editingId ? '#f39c12' : 'var(--primary-color)'
                }}>
                    {editingId ? 'Actualizar Cambios' : 'Guardar Puerta'}
                </button>
            </form>

            <style>{`
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; margin-bottom: 5px; font-size: 0.9em; color: #ccc; }
        .form-group input { 
          width: 100%; 
          padding: 10px; 
          border-radius: 6px; 
          border: 1px solid #444; 
          background: #2a2a2a; 
          color: white; 
          box-sizing: border-box;
        }
      `}</style>
        </div>
    );
}
