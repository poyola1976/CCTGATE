import { useState } from 'react';

export default function ConfigScreen({ devices, onSaveDevice, onDeleteDevice, onBack }) {
    const [formData, setFormData] = useState({
        name: '',
        serverUrl: 'https://shelly-112-eu.shelly.cloud',
        deviceId: '',
        authKey: ''
    });

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!formData.name || !formData.deviceId || !formData.authKey) {
            alert("Por favor completa todos los campos requeridos");
            return;
        }

        // Crear nuevo dispositivo con ID único
        // Usamos Date.now() para evitar problemas con crypto.randomUUID en HTTP local
        const newDevice = {
            id: Date.now().toString() + Math.floor(Math.random() * 1000),
            ...formData
        };

        onSaveDevice(newDevice);
        // Limpiar formulario (excepto server que suele ser fijo)
        setFormData(prev => ({ ...prev, name: '', deviceId: '', authKey: '' }));
    };

    return (
        <div className="card config-screen" style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2>Mis Puertas</h2>
                <button onClick={onBack} style={{ padding: '5px 10px', fontSize: '0.9em' }}>Cerrar</button>
            </div>

            {/* Lista de dispositivos existentes */}
            <div className="device-list" style={{ marginBottom: '2rem' }}>
                {devices.length === 0 ? (
                    <p style={{ color: '#666', fontStyle: 'italic' }}>No hay dispositivos configurados.</p>
                ) : (
                    devices.map(dev => (
                        <div key={dev.id} style={{
                            background: 'rgba(255,255,255,0.05)',
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
                            <button
                                onClick={() => onDeleteDevice(dev.id)}
                                style={{ background: '#e74c3c33', color: '#e74c3c', border: 'none', padding: '5px 10px' }}
                            >
                                Eliminar
                            </button>
                        </div>
                    ))
                )}
            </div>

            <hr style={{ borderColor: 'rgba(255,255,255,0.1)', margin: '20px 0' }} />

            <h3>Agregar Nueva Puerta</h3>
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
                    <input name="authKey" value={formData.authKey} onChange={handleChange} placeholder="Pegar clave larga..." required type="password" />
                </div>

                <button type="submit" style={{ width: '100%', marginTop: '10px', background: 'var(--primary-color)' }}>
                    Guardar Puerta
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
