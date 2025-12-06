import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import UnlockButton from './components/UnlockButton';
import ConfigScreen from './components/ConfigScreen';
import { ShellyService } from './services/shellyService';

function App() {
  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);

  // Estado de conexión
  const [connectionState, setConnectionState] = useState('checking');
  const [offlineReason, setOfflineReason] = useState(null);

  // Refs para loop estable
  const savedCallback = useRef();

  // Cargar dispositivos al iniciar
  useEffect(() => {
    try {
      const saved = localStorage.getItem('shelly_app_devices');
      if (saved) {
        const parsed = JSON.parse(saved);
        setDevices(parsed);
        const lastUsed = localStorage.getItem('shelly_last_active_id');
        if (lastUsed && parsed.find(d => d.id === lastUsed)) {
          setActiveDeviceId(lastUsed);
        } else if (parsed.length > 0) {
          setActiveDeviceId(parsed[0].id);
        } else {
          setIsConfiguring(true);
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

  // Lógica de Polling encapsulada
  const performCheck = useCallback(async () => {
    if (!activeDeviceId || isConfiguring) return;

    const device = devices.find(d => d.id === activeDeviceId);
    if (!device) return;

    try {
      // Feedback visual SUTIL: Parpadeo del punto
      const statusDot = document.querySelector('.status-dot');
      if (statusDot) {
        statusDot.style.transition = 'opacity 0.2s';
        statusDot.style.opacity = '0.3'; // Dim
      }

      const result = await ShellyService.checkStatus(device);

      if (statusDot) statusDot.style.opacity = '1'; // Restore

      const isOnline = result.online;

      // Actualización de estado inteligente
      setConnectionState(prev => {
        if (prev !== (isOnline ? 'online' : 'offline')) {
          return isOnline ? 'online' : 'offline';
        }
        return prev;
      });
      setOfflineReason(isOnline ? null : result.error);

    } catch (e) {
      console.error("Polling error", e);
    }
  }, [activeDeviceId, devices, isConfiguring]);

  // Mantener ref actualizado siempre
  useEffect(() => {
    savedCallback.current = performCheck;
  }, [performCheck]);

  // MOTOR DE POLLING (Recursivo & Robusto)
  useEffect(() => {
    let timerId;
    let isActive = true;

    const loop = async () => {
      if (!isActive) return;

      // Ejecutar check si existe callback válida
      if (savedCallback.current && !isConfiguring && activeDeviceId) {
        await savedCallback.current();
      }

      // Programar siguiente ciclo SOLO cuando termine este (Evita solapamiento)
      if (isActive) {
        timerId = setTimeout(loop, 5000); // 5s loop
      }
    };

    // Iniciar
    loop();

    return () => {
      isActive = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [activeDeviceId, isConfiguring]); // Reinicia loop solo si cambia contexto mayor

  const handleSaveDevice = (newDevice) => {
    const updatedDevs = [...devices, newDevice];
    setDevices(updatedDevs);
    localStorage.setItem('shelly_app_devices', JSON.stringify(updatedDevs));

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
    if (connectionState === 'offline') {
      const confirmForce = confirm(`Dispositivo sin conexión (${offlineReason || 'Error'}). ¿Intentar forzar?`);
      if (!confirmForce) return { success: false, message: 'Cancelado' };
    }

    const activeDevice = devices.find(d => d.id === activeDeviceId);
    if (!activeDevice) return { success: false, message: 'No hay puerta seleccionada' };

    const result = await ShellyService.openDoor(activeDevice);

    if (!result.success) {
      setLastMessage({ type: 'error', text: result.message });
    } else {
      setLastMessage({ type: 'success', text: result.message });
      setTimeout(() => setLastMessage(null), 3000);
    }

    return result;
  };

  return (
    <div className="app-container">
      <header>
        {!isConfiguring && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              className={`status-dot ${connectionState}`}
              title={connectionState === 'offline' ? `Offline: ${offlineReason}` : connectionState}
              style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: connectionState === 'online' ? '#2ecc71' : (connectionState === 'offline' ? '#e74c3c' : '#f1c40f'),
                boxShadow: connectionState === 'online' ? '0 0 5px #2ecc71' : 'none'
              }}
            />
            <button
              className="settings-btn"
              onClick={() => setIsConfiguring(true)}
              aria-label="Configurar"
            >
              ⚙️
            </button>
          </div>
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
              </div>
            ) : (
              <p className="warn-text">⚠️ Sin configurar</p>
            )}

            <div className="button-wrapper">
              <UnlockButton
                onUnlock={handleUnlock}
                disabled={devices.length === 0}
                onlineState={connectionState}
              />
            </div>

            {connectionState === 'offline' && (
              <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '10px' }}>
                Estado: {offlineReason || 'Sin conexión'}
              </p>
            )}

            {lastMessage && (
              <div className={`status-toast ${lastMessage.type}`}>
                {lastMessage.text}
              </div>
            )}
          </div>
        )}
      </main>

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
          -webkit-appearance: none;
        }
        .warn-text { color: orange; font-weight: bold; }
        .status-dot { transition: all 0.3s ease; }
      `}</style>
    </div>
  );
}

export default App;
