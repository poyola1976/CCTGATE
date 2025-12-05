import { useState, useEffect } from 'react';
import './App.css';
import UnlockButton from './components/UnlockButton';
import ConfigScreen from './components/ConfigScreen';
import { ShellyService } from './services/shellyService';

function App() {
  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);

  // Cargar dispositivos al iniciar
  useEffect(() => {
    try {
      const saved = localStorage.getItem('shelly_app_devices');
      if (saved) {
        const parsed = JSON.parse(saved);
        setDevices(parsed);
        // Seleccionar el primero por defecto o el último usado
        const lastUsed = localStorage.getItem('shelly_last_active_id');
        if (lastUsed && parsed.find(d => d.id === lastUsed)) {
          setActiveDeviceId(lastUsed);
        } else if (parsed.length > 0) {
          setActiveDeviceId(parsed[0].id);
        } else {
          setIsConfiguring(true); // Si no hay dispositivos, ir a config
        }
      } else {
        setIsConfiguring(true);
      }
    } catch (e) {
      console.error("Error cargando configuración", e);
      setIsConfiguring(true);
    }
  }, []);

  // Guardar active device cuando cambia
  useEffect(() => {
    if (activeDeviceId) {
      localStorage.setItem('shelly_last_active_id', activeDeviceId);
    }
  }, [activeDeviceId]);

  const handleSaveDevice = (newDevice) => {
    const updatedDevs = [...devices, newDevice];
    setDevices(updatedDevs);
    localStorage.setItem('shelly_app_devices', JSON.stringify(updatedDevs));

    // Si es el primero, lo seleccionamos y vamos al control
    if (devices.length === 0) {
      setActiveDeviceId(newDevice.id);
      setIsConfiguring(false);
    }
  };

  const handleDeleteDevice = (id) => {
    const updated = devices.filter(d => d.id !== id);
    setDevices(updated);
    localStorage.setItem('shelly_app_devices', JSON.stringify(updated));

    if (activeDeviceId === id) {
      setActiveDeviceId(updated.length > 0 ? updated[0].id : null);
    }
  };

  const handleUnlock = async () => {
    const activeDevice = devices.find(d => d.id === activeDeviceId);

    if (!activeDevice) {
      return { success: false, message: 'No hay puerta seleccionada' };
    }

    const result = await ShellyService.openDoor(activeDevice);

    if (!result.success) {
      setLastMessage({ type: 'error', text: result.message });
    } else {
      setLastMessage({ type: 'success', text: result.message });
      setTimeout(() => setLastMessage(null), 3000);
    }

    return result;
  };

  const getActiveDevice = () => devices.find(d => d.id === activeDeviceId);

  return (
    <div className="app-container">
      <header>
        {!isConfiguring && (
          <button
            className="settings-btn"
            onClick={() => setIsConfiguring(true)}
            aria-label="Configurar"
          >
            ⚙️
          </button>
        )}
      </header>

      <main>
        {isConfiguring ? (
          <ConfigScreen
            devices={devices}
            onSaveDevice={handleSaveDevice}
            onDeleteDevice={handleDeleteDevice}
            onBack={() => setIsConfiguring(false)}
          />
        ) : (
          <div className="control-panel">
            <h1>Control Acceso</h1>

            {/* Selector de Dispositivos */}
            {devices.length > 0 ? (
              <div className="device-selector">
                <select
                  value={activeDeviceId || ''}
                  onChange={(e) => setActiveDeviceId(e.target.value)}
                >
                  {devices.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {/* ID oculto por privacidad */}
              </div>
            ) : (
              <p className="warn-text">⚠️ Sin configurar</p>
            )}

            <div className="button-wrapper">
              <UnlockButton
                onUnlock={handleUnlock}
                disabled={devices.length === 0}
              />
            </div>

            {lastMessage && (
              <div className={`status-toast ${lastMessage.type}`}>
                {lastMessage.text}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Estilos inline para el selector por simplicidad */}
      <style>{`
        .device-selector { margin-bottom: 30px; }
        .device-selector select {
          background: transparent;
          color: white;
          border: 1px solid rgba(255,255,255,0.3);
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 1.2rem;
          font-weight: bold;
          text-align: center;
          cursor: pointer;
          -webkit-appearance: none; /* Remover flecha nativa en algunos browsers */
        }
        .server-info {
          font-size: 0.8rem;
          color: rgba(255,255,255,0.4);
          margin-top: 5px;
        }
        .warn-text { color: orange; font-weight: bold; }
      `}</style>
    </div>
  );
}

export default App;
