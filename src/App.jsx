import { useState, useEffect } from 'react';
import './App.css';
import ConfigScreen from './components/ConfigScreen';
import DoorControl from './components/DoorControl';
import LoginScreen from './components/LoginScreen';
import UserProfileModal from './components/UserProfileModal';
import AdminUsersScreen from './components/AdminUsersScreen';
import AdminPricingScreen from './components/AdminPricingScreen';
import { FirebaseService } from './services/firebase';
import { UserService } from './services/userService';
import { onAuthStateChanged } from 'firebase/auth';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import PaymentSuccess from './components/PaymentSuccess';

function App() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessStatus, setAccessStatus] = useState({ allowed: true, message: '' }); // Global fallback
  const [expirationDate, setExpirationDate] = useState(null);
  const [userProfile, setUserProfile] = useState(null); // Perfil completo

  const [devices, setDevices] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [globalPricing, setGlobalPricing] = useState({ semestral: 8000, anual: 10000 });
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [lastPaymentDate, setLastPaymentDate] = useState(null);

  // 2d. Detección de Pago Exitoso (Vía URL)
  useEffect(() => {
    const success = searchParams.get('payment_success');
    if (success === 'true') {
      setShowPaymentSuccess(true);
      // Limpiamos la URL después de un momento para que no salga siempre
      setTimeout(() => {
        setSearchParams({});
      }, 1000);
    }
  }, [searchParams]);

  // Helper para agrupar
  const groupDevices = (allDevices) => {
    const groups = {};
    const noGroup = [];

    allDevices.forEach(d => {
      if (d.group && d.group.trim() !== '') {
        if (!groups[d.group]) groups[d.group] = [];
        groups[d.group].push(d);
      } else {
        noGroup.push(d);
      }
    });

    return { groups, noGroup };
  };

  const { groups, noGroup } = groupDevices(devices);
  const sortedGroupNames = Object.keys(groups).sort();
  const hasMultipleGroups = sortedGroupNames.length > 0;

  // View State: 'home', 'config', 'users'
  const [currentView, setCurrentView] = useState('home');
  const [lastMessage, setLastMessage] = useState(null);

  // Estado para el modal de perfil
  const [showProfileModal, setShowProfileModal] = useState(false);

  // 1. Gestión de Sesión
  useEffect(() => {
    if (!FirebaseService.auth) {
      setAuthLoading(false);
      return;
    }

    const unsubscribeAuth = onAuthStateChanged(FirebaseService.auth, async (currentUser) => {
      if (currentUser) {
        // NO setear usuario todavía. Validar primero para evitar "flash" de la App y desmontaje de LoginScreen.

        // 1. Cargar Rol (Check Whitelist)
        try {
          const role = await UserService.getUserRole(currentUser);

          // Si pasa la validación, entonces sí actualizamos el estado
          setUserRole(role);
          setUser(currentUser);

          // Perfil se cargará dinámicamente en el useEffect de Sync
        } catch (e) {
          console.error("Error fetching role", e);
          if (e.message === 'UNAUTHORIZED_REGISTRATION') {
            console.warn("Usuario no autorizado detectado en App.jsx. Eliminando...");
            sessionStorage.setItem('auth_error', 'Usuario sin permiso para registrarse. Contactar al administrador.');
            // Borrar usuario. Esto disparará onAuthStateChanged nuevamente con null.
            await currentUser.delete().catch(err => console.error("Error deleting unauthorized user", err));
            // NO seteamos user(currentUser), así que LoginScreen sigue montado (o se remonta con error)
            return;
          }
          // Fallback para otros errores (ej. red) - Permitimos entrar como user básico o manejamos error
          setUserRole('user');
          setUser(currentUser);
        }
      } else {
        setUser(null);
        setUserRole(null);
        setAccessStatus({ allowed: true, message: '' });
        setExpirationDate(null);
      }

      setAuthLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  // 2. Suscripciones en tiempo real (Solo si hay usuario logueado)
  useEffect(() => {
    if (!user) {
      setUserProfile(null);
      setExpirationDate(null);
      return;
    }

    // 2a. Sincronización del Perfil de Usuario (Vigencias, etc)
    const unsubProfile = UserService.subscribeToUserProfile(user.uid, (profile) => {
      setUserProfile(profile);
      // Actualizar fecha de expiración visual si corresponde
      if (userRole === 'admin' || userRole === 'validador') {
        setExpirationDate(null);
      } else if (profile?.expirationDate?.seconds) {
        setExpirationDate(new Date(profile.expirationDate.seconds * 1000));
      } else {
        setExpirationDate(null);
      }
    });

    return () => unsubProfile();
  }, [user, userRole]);
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
        if (updatedDevices.length === 0 && (userRole === 'admin' || userRole === 'validador') && currentView === 'home') {
          // Opcional: setCurrentView('config'); 
        }
      }, userRole, user?.email?.toLowerCase()); // <--- Argumentos nuevos
    } catch (e) {
      console.error("Firebase connection error", e);
    }
    return () => unsubscribe();
  }, [user, userRole]);

  // 2b. Sincronización Cámaras (Solo si logueado)
  useEffect(() => {
    if (!user) return;
    const unsub = FirebaseService.subscribeToCameras(setCameras);
    return () => unsub();
  }, [user]);

  // 2c. Sincronización Precios (Solo si logueado)
  useEffect(() => {
    if (!user) return;
    return FirebaseService.subscribeToGlobalPricing(setGlobalPricing);
  }, [user]);

  // 3. Cálculo de Permisos por Dispositivo (REMOVIDO EN REVERT)
  /*
  useEffect(() => {
    // ... lógica removida ...
  }, [userProfile, devices, userRole]);
  */

  const handleLogin = async () => {
    await FirebaseService.loginWithGoogle();
  };

  const handleLogout = async () => {
    await FirebaseService.logout();
    setCurrentView('home');
    setShowProfileModal(false);
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

  // --- CAMERA ACTIONS ---
  const handleSaveCamera = async (newCam) => {
    try {
      await FirebaseService.addCamera(newCam);
      setLastMessage({ type: 'success', text: 'Cámara guardada' });
    } catch (e) { setLastMessage({ type: 'error', text: e.message }); }
  };
  const handleUpdateCamera = async (newCam) => {
    try {
      const { id, ...data } = newCam;
      await FirebaseService.updateCamera(id, data);
      setLastMessage({ type: 'success', text: 'Cámara actualizada' });
    } catch (e) { setLastMessage({ type: 'error', text: e.message }); }
  };
  const handleDeleteCamera = async (id) => {
    try {
      await FirebaseService.deleteCamera(id);
      setLastMessage({ type: 'success', text: 'Cámara eliminada' });
    } catch (e) { setLastMessage({ type: 'error', text: e.message }); }
  };

  const checkLicenseStatus = () => {
    if (!expirationDate) {
      alert("✅ Licencia Permanente\nTu acceso no tiene fecha de vencimiento.");
      return;
    }
    const now = new Date();
    if (now > expirationDate) {
      alert(`🔴 Licencia Vencida\nExpiró el: ${expirationDate.toLocaleDateString()}`);
    } else {
      const diffTime = Math.abs(expirationDate - now);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      alert(`📅 Estado de Licencia\nVence el: ${expirationDate.toLocaleDateString()}\nQuedan: ${diffDays} días.`);
    }
  };

  const getLicenseColor = () => {
    if (!expirationDate) return '#2ecc71'; // Verde (Permanente)
    const now = new Date();
    if (now > expirationDate) return '#e74c3c'; // Rojo (Vencido)

    // Calcular diferencia en milisegundos de forma explícita
    const diffTime = expirationDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    console.log(`License Check: ${diffDays} days remaining.`);

    if (diffDays > 10) {
      return '#2ecc71'; // Verde
    } else {
      return '#f1c40f'; // Amarillo
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

  // --- RUTA: PAGO EXITOSO (Prioritaria) ---
  if (window.location.pathname === '/payment-success') {
    return <PaymentSuccess />;
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // 2.5 UI Expirado / No Iniciado
  if (!accessStatus.allowed && userRole !== 'admin') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100vh', padding: '20px', textAlign: 'center', color: '#fff', background: '#2c3e50'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⌛</div>
        <h2>Acceso Restringido</h2>
        <p style={{ color: '#aaa', margin: '20px 0', fontSize: '1.2em' }}>
          {accessStatus.message}
        </p>
        <p style={{ color: '#aaa', marginBottom: '30px' }}>
          Por favor, contacta al administrador.
        </p>
        <button
          onClick={handleLogout}
          style={{ padding: '10px 20px', background: 'transparent', border: '1px solid #aaa', color: '#aaa', borderRadius: '6px' }}
        >
          Cerrar Sesión
        </button>
      </div>
    );
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
          {user.photoURL ?
            <img src={user.photoURL} alt="User" style={{ width: '32px', borderRadius: '50%' }} /> :
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>👤</div>
          }
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.2' }}>
            <span style={{ fontSize: '0.9em', fontWeight: 'bold' }}>
              {user.displayName?.split(' ')[0] || user.email.split('@')[0]}
            </span>
            <span style={{ fontSize: '0.7em', color: userRole === 'admin' ? '#f39c12' : '#ccc' }}>
              {userRole === 'admin' ? 'ADMINISTRADOR' : 'Usuario'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {currentView === 'home' && (userRole === 'admin' || userRole === 'validador') && (
            <>
              {userRole === 'admin' && (
                <button
                  className="settings-btn"
                  onClick={() => setCurrentView('users')}
                  aria-label="Usuarios"
                  title="Gestión de Usuarios"
                  style={{ fontSize: '1.2rem' }}
                >
                  👥
                </button>
              )}
              {userRole === 'admin' && (
                <button
                  className="settings-btn"
                  onClick={() => setCurrentView('pricing')}
                  aria-label="Precios"
                  title="Gestión de Tarifas"
                  style={{ fontSize: '1.2rem', marginLeft: '5px' }}
                >
                  💰
                </button>
              )}
              <button
                className="settings-btn"
                onClick={() => setCurrentView('config')}
                aria-label="Configurar"
                title="Configurar Puertas"
              >
                ⚙️
              </button>
            </>
          )}



          <button
            onClick={() => setShowProfileModal(true)}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)',
              fontSize: '0.8em',
              padding: '5px 10px',
              borderRadius: '4px',
              color: '#ddd',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            👤 <span style={{ display: 'none', '@media (min-width: 400px)': { display: 'inline' } }}>Perfil</span>
          </button>

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
        {currentView === 'config' && (userRole === 'admin' || userRole === 'validador') ? (
          <ConfigScreen
            userRole={userRole}
            devices={devices}
            onSaveDevice={handleSaveDevice}
            onUpdateDevice={handleUpdateDevice}
            onDeleteDevice={handleDeleteDevice}
            // CCTV Props
            cameras={cameras}
            onSaveCamera={handleSaveCamera}
            onUpdateCamera={handleUpdateCamera}
            onDeleteCamera={handleDeleteCamera}

            onBack={() => setCurrentView('home')}
          />
        ) : currentView === 'users' && userRole === 'admin' ? (
          <AdminUsersScreen devices={devices} onBack={() => setCurrentView('home')} />
        ) : currentView === 'pricing' && userRole === 'admin' ? (
          <AdminPricingScreen onBack={() => setCurrentView('home')} />
        ) : (
          <div className="control-panel">
            {showPaymentSuccess && (
              <div className="renewal-modal-overlay">
                <div className="renewal-modal" style={{ textAlign: 'center', border: '2px solid #2ecc71', animation: 'scaleUp 0.3s' }}>
                  <div style={{ fontSize: '4em', marginBottom: '10px' }}>✅</div>
                  <h2 style={{ color: '#2ecc71', marginBottom: '10px' }}>¡Licencia Extendida!</h2>
                  <p style={{ opacity: 0.8, marginBottom: '20px' }}>
                    Su pago ha sido procesado con éxito. Su licencia está ahora actualizada y activa.
                  </p>
                  <div style={{ background: 'rgba(46,204,113,0.1)', padding: '15px', borderRadius: '15px', marginBottom: '20px' }}>
                    <span style={{ fontSize: '0.9em', opacity: 0.7 }}>Nueva Vigencia (general):</span><br />
                    <strong style={{ fontSize: '1.2em' }}>Consultar en lista de accesos</strong>
                  </div>
                  <button
                    onClick={() => setShowPaymentSuccess(false)}
                    className="pay-btn"
                    style={{ background: '#2ecc71', width: '100%' }}
                  >
                    ¡ENTENDIDO!
                  </button>
                </div>
              </div>
            )}
            <h1 style={{ marginBottom: '20px' }}>Accesos</h1>
            <style>{`
  @keyframes scaleUp {
    from { transform: scale(0.8); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
`}</style>

            {devices.length > 0 ? (
              <div className="doors-grid">

                {/* 1. Grupos con Nombre (Acordeones) */}
                {sortedGroupNames.map(groupName => (
                  <details key={groupName} style={{ width: '100%', marginBottom: '10px' }}>
                    <summary style={{
                      cursor: 'pointer',
                      color: '#fff',
                      fontWeight: 'bold',
                      padding: '12px',
                      background: 'rgba(255,255,255,0.08)',
                      borderRadius: '12px',
                      marginBottom: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>📂 {groupName}</span>
                      <span style={{ fontSize: '0.8em', opacity: 0.6, background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '10px' }}>
                        {groups[groupName].length}
                      </span>
                    </summary>
                    <div style={{ paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                      {groups[groupName].map(device => (
                        <DoorControl
                          key={device.id}
                          device={device}
                          onMessage={handleChildMessage}
                          isAdmin={userRole === 'admin'}
                          userProfile={userProfile}
                          // Pass associated camera object if exists
                          camera={cameras.find(c => c.id === (device.associatedCameraId || device.cameraId))}
                          globalPricing={globalPricing}
                        />
                      ))}
                    </div>
                  </details>
                ))}

                {/* 2. Dispositivos "Sueltos" (Sin Grupo) */}
                {noGroup.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '100%' }}>
                    {hasMultipleGroups && <h3 style={{ margin: '15px 0 10px', fontSize: '0.9rem', color: '#999', textTransform: 'uppercase', letterSpacing: '1px' }}>Otros Dispositivos</h3>}
                    {noGroup.map(device => (
                      <DoorControl
                        key={device.id}
                        device={device}
                        onMessage={handleChildMessage}
                        isAdmin={userRole === 'admin'}
                        // Pass associated camera object if exists
                        camera={cameras.find(c => c.id === device.associatedCameraId)}
                      />
                    ))}
                  </div>
                )}

              </div>
            ) : (
              <div style={{ textAlign: 'center', marginTop: '50px' }}>
                <p className="warn-text">⚠️ Sin puertas configuradas</p>
                {userRole === 'admin' && (
                  <button onClick={() => setCurrentView('config')} style={{ marginTop: '10px' }}>
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

      <UserProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        user={user}
      />

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
