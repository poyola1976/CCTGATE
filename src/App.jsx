import { useState, useEffect } from 'react';
import './App.css';
import ConfigScreen from './components/ConfigScreen';
import DoorControl from './components/DoorControl';
import LoginScreen from './components/LoginScreen';
import { FirebaseService } from './services/firebase';
import { UserService } from './services/userService';
import { onAuthStateChanged } from 'firebase/auth';

function App() {
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [devices, setDevices] = useState([]);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);

  // 1. Gestión de Sesión
  useEffect(() => {
    if (!FirebaseService.auth) {
      setAuthLoading(false);
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(FirebaseService.auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Cargar Rol
        try {
          const role = await UserService.getUserRole(currentUser);
          setUserRole(role);
        } catch (e) {
          console.error("Error fetching role", e);
          setUserRole('user'); // Fallback seguro
        }
      } else {
        setUser(null);
        setUserRole(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  // 2. Sincronización Realtime (Solo si logueado)
  useEffect(() => {
    if (!user) {
      setDevices([]);
      return;
    }

    let unsubscribe = () => { };
    try {
      // Pasamos rol y email para filtrar correos
      unsubscribe = FirebaseService.subscribeToDoors((updatedDevices) => {
        setDevices(updatedDevices);
        // NO forzamos ir a config si está vacío, eso es solo para admin
        if (updatedDevices.length === 0 && userRole === 'admin' && !isConfiguring) {
          // Opcional: setIsConfiguring(true); 
        }
      }, userRole, user?.email); // <--- Argumentos nuevos
    } catch (e) {
      console.error("Firebase connection error", e);
    }
    return () => unsubscribe();
  }, [user, userRole]); // Re-sync si cambia usuario

  const handleLogin = async () => {
    await FirebaseService.loginWithGoogle();
  };

  const handleLogout = async () => {
    await FirebaseService.logout();
    setIsConfiguring(false);
  };

  // --- ACTIONS (Protegidas por UI, backend rules deben reforzar) ---

  const handleSaveDevice = async (newDevice) => {
    try {
      await FirebaseService.addDoor(newDevice);
      setLastMessage({ type: 'success', text: 'Dispositivo guardado en Nube ☁️' });
      setTimeout(() => setLastMessage(null), 3000);
    } catch (error) {
      console.error("Save error", error);
      setLastMessage({ type: 'error', text: `Error: ${error.message}` });
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

  const handleDeleteDevice = async (id) => {
    try {
      await FirebaseService.deleteDoor(id);
      setLastMessage({ type: 'success', text: 'Dispositivo eliminado' });
      setTimeout(() => setLastMessage(null), 3000);
    } catch (error) {
      setLastMessage({ type: 'error', text: 'Error al eliminar' });
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

  // --- RENDER ---

  if (authLoading) {
    return <div style={{ color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Cargando sesión...</div>;
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // 3. UI Bloqueo: Si no es admin y no tiene puertas asignadas
  if (userRole !== 'admin' && devices.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', padding: '20px', textAlign: 'center', color: '#fff'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⛔</div>
        <h2>Acceso Restringido</h2>
        <p style={{ color: '#aaa', margin: '20px 0' }}>
          Tu usuario (<strong>{user.email}</strong>) no tiene dispositivos asignados.
        </p>
        <p style={{ color: '#aaa', marginBottom: '30px' }}>
          Por favor, pide al administrador que agregue tu email en la configuración de la puerta.
        </p>
        <button
          onClick={handleLogout}
          style={{ padding: '10px 20px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px' }}
        >
          Cerrar Sesión
        </button>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 20px',
        background: 'rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {user.photoURL && <img src={user.photoURL} alt="User" style={{ width: '32px', borderRadius: '50%' }} />}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
            <span style={{ fontSize: '0.9em', fontWeight: 'bold' }}>
              {user.displayName?.split(' ')[0]}
            </span>
            <span style={{ fontSize: '0.7em', color: userRole === 'admin' ? '#f39c12' : '#ccc' }}>
              {userRole === 'admin' ? 'ADMINISTRADOR' : 'Usuario'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          {!isConfiguring && userRole === 'admin' && (
            <button
              className="settings-btn"
              onClick={() => setIsConfiguring(true)}
              aria-label="Configurar"
              title="Configurar Puertas"
            >
              ⚙️
            </button>
          )}
          <button
            onClick={handleLogout}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)',
              fontSize: '0.8em',
              padding: '5px 10px',
              borderRadius: '4px',
              color: '#ddd'
            }}
          >
            Salir
          </button>
        </div>
      </header>

      <main>
        {isConfiguring && userRole === 'admin' ? (
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
                {userRole === 'admin' && (
                  <button onClick={() => setIsConfiguring(true)} style={{ marginTop: '10px' }}>
                    Configurar ahora
                  </button>
                )}
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
        .settings-btn { 
            background: transparent; 
            border: none; 
            font-size: 1.5rem; 
            cursor: pointer; 
            padding: 0;
            line-height: 1;
        }
        main { padding-top: 20px; }
      `}</style>
    </div>
  );
}

export default App;
