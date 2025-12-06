import { useState, useEffect } from 'react';
import './App.css';
import ConfigScreen from './components/ConfigScreen';
import DoorControl from './components/DoorControl';

function App() {
  const [devices, setDevices] = useState([]);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);

  // Cargar dispositivos al iniciar
  useEffect(() => {
    try {
      const saved = localStorage.getItem('shelly_app_devices');
      if (saved) {
        setDevices(JSON.parse(saved));
      } else {
        setIsConfiguring(true);
      }
    } catch (e) {
      console.error("Error cargando configuración", e);
      setIsConfiguring(true);
    }
  }, []);

  const handleSaveDevice = (newDevice) => {
    const updatedDevs = [...devices, newDevice];
    setDevices(updatedDevs);
    localStorage.setItem('shelly_app_devices', JSON.stringify(updatedDevs));

    if (devices.length === 0) {
      setIsConfiguring(false);
    }
  };

  const handleDeleteDevice = (id) => {
    const updated = devices.filter(d => d.id !== id);
    setDevices(updated);
    localStorage.setItem('shelly_app_devices', JSON.stringify(updated));
  };

  // Callback para mostrar mensajes toast globales desde los hijos
  const handleChildMessage = (result) => {
    if (!result.success) {
      setLastMessage({ type: 'error', text: result.message });
    } else {
      setLastMessage({ type: 'success', text: result.message });
      // Auto ocultar mensaje
      setTimeout(() => setLastMessage(null), 3000);
    }
  };

  return (
    <div className="app-container">
      <header>
        {!isConfiguring && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', padding: '0 10px' }}>
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
            <h1 style={{ marginBottom: '20px' }}>Accesos</h1>

            {devices.length > 0 ? (
              <div className="doors-grid">
                {devices.map(device => (
                  <DoorControl
                    key={device.id}
                    device={device}
                    onMessage={handleChildMessage}
                  />
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', marginTop: '50px' }}>
                <p className="warn-text">⚠️ Sin puertas configuradas</p>
                <button onClick={() => setIsConfiguring(true)} style={{ marginTop: '10px' }}>
                  Configurar ahora
                </button>
              </div>
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
        .doors-grid {
            display: flex;
            flex-direction: column;
            gap: 15px;
            width: 100%;
            max-width: 400px;
            margin: 0 auto;
        }
        .warn-text { color: orange; font-weight: bold; }
      `}</style>
    </div>
  );
}

export default App;
