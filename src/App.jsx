import { useState, useEffect } from 'react';
import './App.css';
import ConfigScreen from './components/ConfigScreen';
import DoorControl from './components/DoorControl';
import { FirebaseService } from './services/firebase';

function App() {
  const [devices, setDevices] = useState([]);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);

  // Sincronización Realtime con Firebase Cloud
  useEffect(() => {
    let unsubscribe = () => { };

    try {
      unsubscribe = FirebaseService.subscribeToDoors((updatedDevices) => {
        setDevices(updatedDevices);
        // Si no hay configuración o dispositivos, ir a config
        if (updatedDevices.length === 0) {
          setIsConfiguring(true);
        }
      });
    } catch (e) {
      console.error("Firebase connection error", e);
    }

    return () => unsubscribe();
  }, []);

  const handleSaveDevice = async (newDevice) => {
    try {
      await FirebaseService.addDoor(newDevice);
      setLastMessage({ type: 'success', text: 'Dispositivo guardado en Nube ☁️' });
      setTimeout(() => setLastMessage(null), 3000);
    } catch (error) {
      console.error("Save error", error);
      // Mostrar el error real para depuración
      setLastMessage({ type: 'error', text: `Error: ${error.message}` });
    }
  };

  const handleDeleteDevice = async (id) => {
    try {
      await FirebaseService.deleteDoor(id);
      setLastMessage({ type: 'success', text: 'Dispositivo eliminado' });
      setTimeout(() => setLastMessage(null), 3000);
    } catch (error) {
      setLastMessage({ type: 'error', text: 'Error al eliminar' });
    }
  };

  const handleUpdateDevice = async (updatedDevice) => {
    try {
      const { id, ...data } = updatedDevice;
      await FirebaseService.updateDoor(id, data);
      setLastMessage({ type: 'success', text: 'Dispositivo actualizado' });
      setTimeout(() => setLastMessage(null), 3000);
    } catch (error) {
      console.error("Update error", error);
      setLastMessage({ type: 'error', text: 'Error al actualizar' });
    }
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
            onUpdateDevice={handleUpdateDevice}
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
