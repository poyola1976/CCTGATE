import { useState, useEffect } from 'react';
import { FirebaseService } from '../services/firebase';
import { UserService } from '../services/userService';
import { read, utils } from 'xlsx';

export default function ConfigScreen({
    devices = [], onSaveDevice, onUpdateDevice, onDeleteDevice,
    cameras = [], onSaveCamera, onUpdateCamera, onDeleteCamera,
    onBack, userRole // <--- New Prop
}) {
    const [activeTab, setActiveTab] = useState('doors'); // 'doors' | 'cameras'
    const [isVerifying, setIsVerifying] = useState(false);

    // --- DOORS STATE ---
    const [editingId, setEditingId] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        group: '',
        serverUrl: 'https://shelly-112-eu.shelly.cloud',
        deviceId: '',
        authKey: '',
        allowedEmails: [], // Changed to Array
        associatedCameraId: ''
    });
    const [newEmail, setNewEmail] = useState(''); // New input state
    const [userStatuses, setUserStatuses] = useState({}); // { email: { registered: boolean, uid: string } }
    const [searchTerm, setSearchTerm] = useState(''); // Search state

    // --- CAMERAS STATE ---
    const [editingCamId, setEditingCamId] = useState(null);
    const [camFormData, setCamFormData] = useState({
        name: '',
        type: 'tuya', // 'tuya' | 'rtmp'
        tuyaDeviceId: '',
        tuyaAccessId: '',
        tuyaAccessSecret: '',
        tuyaUid: '',
        rtmpStreamKey: '', // Key for the RTMP stream (e.g. 'cam1')
        rtmpServerIp: '' // Optional: External Video Server IP
    });

    // --- DOORS HANDLERS ---
    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    // User List Handlers
    const handleAddEmail = (e) => {
        e.preventDefault();
        const email = newEmail.trim().toLowerCase();
        if (!email) return;

        if (!email.includes('@') || !email.includes('.')) {
            alert("Formato de email inválido");
            return;
        }

        if (formData.allowedEmails.includes(email)) {
            alert("Este usuario ya está en la lista");
            return;
        }

        setFormData(prev => ({
            ...prev,
            allowedEmails: [...prev.allowedEmails, email]
        }));
        setNewEmail('');
    };

    const handleRemoveEmail = (indexToRemove) => {
        const emailToRemove = formData.allowedEmails[indexToRemove];
        if (window.confirm(`¿Estás seguro de que deseas eliminar a "${emailToRemove}" de la lista?`)) {
            setFormData(prev => ({
                ...prev,
                allowedEmails: prev.allowedEmails.filter((_, i) => i !== indexToRemove)
            }));
        }
    };

    // --- FILE UPLOAD HANDLER (Excel) ---
    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await file.arrayBuffer();
            const workbook = read(data);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = utils.sheet_to_json(worksheet, { header: 1 }); // Array of arrays

            // Flatten and Extract Emails
            const extractedEmails = [];
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            jsonData.forEach(row => {
                row.forEach(cell => {
                    if (typeof cell === 'string') {
                        const trimmed = cell.trim().toLowerCase();
                        if (emailRegex.test(trimmed)) {
                            extractedEmails.push(trimmed);
                        }
                    }
                });
            });

            if (extractedEmails.length === 0) {
                alert("⚠️ No se encontraron emails válidos en el archivo.");
                return;
            }

            // Deduplicate against existing list
            const currentEmails = new Set(formData.allowedEmails || []);
            let addedCount = 0;
            let duplicateCount = 0;

            const newAllowedEmails = [...formData.allowedEmails];

            extractedEmails.forEach(email => {
                if (!currentEmails.has(email)) {
                    newAllowedEmails.push(email);
                    currentEmails.add(email); // Prevent duplicates inside the file itself too
                    addedCount++;
                } else {
                    duplicateCount++;
                }
            });

            setFormData(prev => ({
                ...prev,
                allowedEmails: newAllowedEmails
            }));

            alert(`✅ Importación completada:\n- ${addedCount} emails agregados.\n- ${duplicateCount} duplicados ignorados.`);

        } catch (error) {
            console.error("Error parsing Excel:", error);
            alert("❌ Error al leer el archivo Excel. Asegúrate de que sea un formato válido (.xlsx, .xls).");
        }

        // Reset input
        e.target.value = '';
    };

    // Effect to check user registration status when allowedEmails changes
    useEffect(() => {
        const checkStatuses = async () => {
            if (!formData.allowedEmails || formData.allowedEmails.length === 0) {
                setUserStatuses({});
                return;
            }

            try {
                // Fetch registered users matching these emails
                const existingUsers = await UserService.getUsersByEmails(formData.allowedEmails);
                const statusMap = {};

                // Default all to not registered
                formData.allowedEmails.forEach(email => {
                    statusMap[email] = { registered: false };
                });

                // Mark found users as registered
                existingUsers.forEach(user => {
                    if (user.email) {
                        statusMap[user.email.toLowerCase()] = { registered: true, uid: user.uid };
                    }
                });

                setUserStatuses(statusMap);
            } catch (error) {
                console.error("Error checking user statuses:", error);
                // Fail gracefully
            }
        };

        // Safety check for UserService
        if (UserService && typeof UserService.getUsersByEmails === 'function') {
            const timeoutId = setTimeout(checkStatuses, 500); // Debounce slightly
            return () => clearTimeout(timeoutId);
        } else {
            console.warn("UserService not available for status check");
        }
    }, [formData.allowedEmails]);

    const handleEditClick = (device) => {
        setFormData({
            name: device.name,
            group: device.group || '',
            serverUrl: device.serverUrl,
            deviceId: device.deviceId,
            authKey: device.authKey,
            allowedEmails: Array.isArray(device.allowedEmails) ? device.allowedEmails : (device.allowedEmails ? [device.allowedEmails] : []), // Force Array
            associatedCameraId: device.associatedCameraId || '',
            customImage: device.customImage || '' // Load existing image
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
            customImage: '' // New Image Field
        });
        setNewEmail('');
        setSearchTerm(''); // Reset search
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
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_SIZE = 150; // Thumbnail size

                if (width > height) {
                    if (width > MAX_SIZE) {
                        height *= MAX_SIZE / width;
                        width = MAX_SIZE;
                    }
                } else {
                    if (height > MAX_SIZE) {
                        width *= MAX_SIZE / height;
                        height = MAX_SIZE;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Compress
                let quality = 0.8;
                let dataUrl = canvas.toDataURL('image/jpeg', quality);

                // Check size (approx < 200KB)
                while (dataUrl.length > 200 * 1024 && quality > 0.1) {
                    quality -= 0.1;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }

                if (dataUrl.length > 250 * 1024) { // Absolute hard limit slightly higher for base64 overhead
                    alert("⚠️ No se pudo comprimir la imagen lo suficiente (<200KB).");
                    return;
                }

                setFormData(prev => ({ ...prev, customImage: dataUrl }));
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    const handleSortEmails = () => {
        setFormData(prev => {
            const sorted = [...prev.allowedEmails].sort((a, b) => a.localeCompare(b));
            return { ...prev, allowedEmails: sorted };
        });
    };

    // Filter Logic
    const filteredEmails = (formData.allowedEmails || []).filter(email =>
        email.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.name || !formData.deviceId || !formData.authKey) {
            alert("Por favor completa todos los campos requeridos");
            return;
        }

        const isDuplicate = devices.some(dev => {
            if (editingId && dev.id === editingId) return false;
            return dev.deviceId === formData.deviceId;
        });

        if (isDuplicate) {
            alert(`⚠️ Error: El Device ID "${formData.deviceId}" ya está registrado.`);
            return;
        }

        // Use array directly
        const emailsArray = formData.allowedEmails;

        const dataToSave = {
            name: formData.name,
            group: formData.group,
            serverUrl: formData.serverUrl,
            deviceId: formData.deviceId,
            authKey: formData.authKey,
            allowedEmails: emailsArray,
            associatedCameraId: formData.associatedCameraId,
            customImage: formData.customImage || '' // Save image (base64)
        };

        if (editingId) {
            await onUpdateDevice({ ...dataToSave, id: editingId });
            handleCancelEdit();
        } else {
            await onSaveDevice(dataToSave);
            setFormData(prev => ({ ...prev, name: '', group: '', deviceId: '', authKey: '', allowedEmails: [], associatedCameraId: '' }));
        }
    };

    // --- CAMERAS HANDLERS ---
    const handleCamChange = (e) => {
        setCamFormData({ ...camFormData, [e.target.name]: e.target.value });
    };

    const handleEditCamClick = (cam) => {
        setCamFormData({
            name: cam.name,
            type: cam.type || 'tuya',
            tuyaDeviceId: cam.tuyaDeviceId || '',
            tuyaAccessId: cam.tuyaAccessId || '',
            tuyaAccessSecret: cam.tuyaAccessSecret || '',
            tuyaUid: cam.tuyaUid || '',
            rtmpStreamKey: cam.rtmpStreamKey || '',
            rtmpServerIp: cam.rtmpServerIp || ''
        });
        setEditingCamId(cam.id);
    };

    const handleCancelCamEdit = () => {
        setEditingCamId(null);
        setCamFormData({
            name: '',
            type: 'tuya',
            tuyaDeviceId: '',
            tuyaAccessId: '',
            tuyaAccessSecret: '',
            tuyaUid: '',
            rtmpStreamKey: '',
            rtmpServerIp: ''
        });
    };

    const handleCamSubmit = async (e) => {
        e.preventDefault();

        if (!camFormData.name) {
            alert("El nombre de la cámara es obligatorio.");
            return;
        }

        // TUYA SPECIFIC VALIDATION
        if (camFormData.type === 'tuya') {
            if (!camFormData.tuyaDeviceId || !camFormData.tuyaAccessId || !camFormData.tuyaAccessSecret || !camFormData.tuyaUid) {
                alert("Todos los campos de Tuya (Device ID, Access ID, Secret, User ID) son obligatorios.");
                return;
            }

            setIsVerifying(true);
            try {
                const verifyResult = await FirebaseService.verifyTuyaCamera({
                    deviceId: camFormData.tuyaDeviceId,
                    accessId: camFormData.tuyaAccessId,
                    accessSecret: camFormData.tuyaAccessSecret
                });

                const resultData = verifyResult.data;

                if (!resultData.success) {
                    alert(`❌ Error al conectar con cámara:\n${resultData.message}\n\nVerifique sus credenciales de Tuya.`);
                    setIsVerifying(false);
                    return;
                }

                alert(`✅ ¡Conexión Verificada!\nCámara: ${resultData.name}\nEstado: ${resultData.online ? 'Online' : 'Offline'}\n\nAgregada con soporte Streaming.`);
            } catch (error) {
                console.error("Verification error:", error);
                alert(`Error al intentar verificar: ${error.message}`);
                setIsVerifying(false);
                return;
            }
        }

        setIsVerifying(false);

        // SAVE (Common for both types)
        const dataToSave = { ...camFormData };

        if (editingCamId) {
            await onUpdateCamera({ ...dataToSave, id: editingCamId });
            handleCancelCamEdit();
        } else {
            await onSaveCamera(dataToSave);
            setCamFormData({
                name: '',
                type: 'tuya',
                tuyaDeviceId: '',
                tuyaAccessId: '',
                tuyaAccessSecret: '',
                tuyaUid: '',
                rtmpStreamKey: '',
                rtmpServerIp: ''
            });
        }
    };

    // --- RENDER ---
    return (
        <div className="card config-screen" style={{ textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h2>Configuración</h2>
                <button onClick={onBack} style={{ padding: '5px 10px', fontSize: '0.9em' }}>Cerrar</button>
            </div>

            {/* TABS HEADER */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid #444' }}>
                <button
                    onClick={() => setActiveTab('doors')}
                    style={{
                        background: activeTab === 'doors' ? 'var(--primary-color)' : 'transparent',
                        border: 'none',
                        padding: '10px 20px',
                        borderBottom: activeTab === 'doors' ? '2px solid white' : 'none'
                    }}
                >
                    🚪 Puertas
                </button>
                <button
                    onClick={() => setActiveTab('cameras')}
                    style={{
                        background: activeTab === 'cameras' ? 'var(--primary-color)' : 'transparent',
                        border: 'none',
                        padding: '10px 20px',
                        borderBottom: activeTab === 'cameras' ? '2px solid white' : 'none'
                    }}
                >
                    🎥 Cámaras
                </button>
            </div>

            {activeTab === 'doors' ? (
                // --- DOORS TAB CONTENT ---
                <>
                    <div className="device-list" style={{ marginBottom: '2rem' }}>
                        {devices.length === 0 ? <p style={{ color: '#666' }}>Sin puertas.</p> : devices.map(dev => (
                            <div key={dev.id} style={{
                                background: editingId === dev.id ? 'rgba(46, 204, 113, 0.1)' : 'rgba(255,255,255,0.05)',
                                border: editingId === dev.id ? '1px solid #2ecc71' : 'none',
                                padding: '10px',
                                borderRadius: '8px', marginBottom: '8px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}>
                                <div>
                                    <strong>{dev.name} </strong>
                                    {dev.group && <span style={{ fontSize: '0.7em', background: '#3498db', color: 'white', padding: '2px 6px', borderRadius: '4px', marginLeft: '5px' }}>{dev.group}</span>}
                                    {dev.associatedCameraId && <span style={{ fontSize: '0.7em', background: '#8e44ad', color: 'white', padding: '2px 6px', borderRadius: '4px', marginLeft: '5px' }}>📷</span>}
                                </div>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button onClick={() => handleEditClick(dev)} style={{ background: '#3498db33', color: '#3498db', border: 'none', padding: '5px 10px', cursor: 'pointer', borderRadius: '4px' }}>✏️</button>
                                    {userRole === 'admin' && (
                                        <button onClick={() => window.confirm(`Eliminar ${dev.name}?`) && onDeleteDevice(dev.id)} style={{ background: '#e74c3c33', color: '#e74c3c', border: 'none', padding: '5px 10px', cursor: 'pointer', borderRadius: '4px' }}>🗑️</button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <h3>{editingId ? 'Editar Puerta' : 'Agregar Nueva Puerta'}</h3>
                    <form onSubmit={handleSubmit}>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Nombre</label>
                            <input name="name" value={formData.name} onChange={handleChange} required disabled={userRole !== 'admin'}
                                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                            />
                        </div>

                        {/* CUSTOM IMAGE INPUT */}
                        {userRole === 'admin' && (
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>
                                    📷 Imagen del Dispositivo
                                </label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    {formData.customImage && (
                                        <div style={{ position: 'relative', width: '60px', height: '60px' }}>
                                            <img
                                                src={formData.customImage}
                                                alt="Preview"
                                                style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '6px', border: '1px solid #555' }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setFormData(prev => ({ ...prev, customImage: '' }))}
                                                style={{
                                                    position: 'absolute', top: -5, right: -5,
                                                    background: 'red', color: 'white', border: 'none',
                                                    borderRadius: '50%', width: '18px', height: '18px',
                                                    fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                }}
                                                title="Eliminar imagen"
                                            >
                                                X
                                            </button>
                                        </div>
                                    )}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleImageSelect}
                                        style={{ fontSize: '0.9em', color: '#ccc', flex: 1 }}
                                    />
                                </div>
                                <small style={{ color: '#666' }}>Máx 200KB. Se comprimirá automáticamente.</small>
                            </div>
                        )}
                        {userRole === 'admin' ? (
                            <>
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Server URL</label>
                                    <input name="serverUrl" value={formData.serverUrl} onChange={handleChange} required
                                        style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Device ID</label>
                                    <input name="deviceId" value={formData.deviceId} onChange={handleChange} required
                                        style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                    />
                                </div>
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Auth Key</label>
                                    <input name="authKey" value={formData.authKey} onChange={handleChange} required type={editingId ? "text" : "password"}
                                        style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                    />
                                </div>
                            </>
                        ) : (
                            <div style={{ marginBottom: '15px' }}>
                                <small style={{ color: '#aaa' }}>Datos técnicos ocultos (Modo Validador)</small>
                            </div>
                        )}

                        {/* GRUPO y CÁMARA: Solo Admin */}
                        {userRole === 'admin' && (
                            <>
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Grupo</label>
                                    <input name="group" value={formData.group} onChange={handleChange} list="group-suggestions"
                                        style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                    />
                                    <datalist id="group-suggestions">{[...new Set(devices.map(d => d.group).filter(Boolean))].map(g => <option key={g} value={g} />)}</datalist>
                                </div>

                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Asociar Cámara CCTV</label>
                                    <select
                                        name="associatedCameraId"
                                        value={formData.associatedCameraId}
                                        onChange={handleChange}
                                        style={{ width: '100%', padding: '10px', borderRadius: '6px', background: '#2a2a2a', color: 'white', border: '1px solid #444' }}
                                    >
                                        <option value="">(Ninguna)</option>
                                        {cameras.map(cam => (
                                            <option key={cam.id} value={cam.id}>{cam.name}</option>
                                        ))}
                                    </select>
                                    <small style={{ color: '#888' }}>Aparecerá el botón "Ver Cámara" en esta puerta.</small>
                                </div>
                            </>
                        )}

                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Usuarios Autorizados</label>

                            <div style={{ marginBottom: '10px', display: 'flex', gap: '10px' }}>
                                <input
                                    type="text"
                                    placeholder="🔍 Buscar usuario..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #444', background: '#222', color: 'white', fontSize: '0.9em' }}
                                />
                                <button
                                    type="button"
                                    onClick={handleSortEmails}
                                    style={{ background: '#34495e', color: 'white', border: 'none', borderRadius: '6px', padding: '0 12px', cursor: 'pointer', fontSize: '1.2em' }}
                                    title="Ordenar Alfabéticamente (A-Z)"
                                >
                                    🅰️
                                </button>
                            </div>

                            {/* LISTA ACTUAL (Filtrada) */}
                            {filteredEmails.length > 0 ? (
                                <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', maxHeight: '300px', overflowY: 'auto' }}>
                                    {filteredEmails.map((email, index) => (
                                        <li key={email} style={{ // Use email as key for filtered list integrity
                                            padding: '8px 10px',
                                            borderBottom: '1px solid #333',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}>
                                            <span>
                                                {/* STATUS INDICATOR */}
                                                <span style={{
                                                    marginRight: '10px',
                                                    fontSize: '0.8em',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    background: (typeof email === 'string' && userStatuses[email]?.registered) ? 'rgba(46, 204, 113, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                                                    color: (typeof email === 'string' && userStatuses[email]?.registered) ? '#2ecc71' : '#999',
                                                    border: (typeof email === 'string' && userStatuses[email]?.registered) ? '1px solid #2ecc71' : '1px solid #555'
                                                }}>
                                                    {(typeof email === 'string' && userStatuses[email]?.registered) ? '✅' : '⏳'}
                                                </span>
                                                {/* SAFE RENDER: Ensure email is a string */}
                                                {typeof email === 'string' ? email : String(email)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    // Find original index to remove correctly
                                                    const originalIndex = formData.allowedEmails.indexOf(email);
                                                    if (originalIndex !== -1) handleRemoveEmail(originalIndex);
                                                }}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1em' }}
                                                title="Eliminar Usuario"
                                            >
                                                🗑️
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p style={{ fontSize: '0.8em', color: '#666', fontStyle: 'italic', margin: '10px 0' }}>
                                    {formData.allowedEmails && formData.allowedEmails.length > 0 ? "No hay usuarios que coincidan con la búsqueda." : "La lista está vacía."}
                                </p>
                            )}

                            {/* AGREGAR NUEVO */}
                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                <input
                                    name="newEmail"
                                    value={newEmail}
                                    onChange={(e) => setNewEmail(e.target.value)}
                                    placeholder="nuevo@usuario.com"
                                    style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white' }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddEmail(e); }}
                                />
                                <button
                                    type="button"
                                    onClick={handleAddEmail}
                                    style={{ width: 'auto', padding: '10px 20px', background: '#2980b9', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
                                >
                                    + Agregar
                                </button>
                            </div>
                            <small style={{ color: '#888' }}>Presiona "+ Agregar" o Enter para incluir el email.</small>
                            <div style={{ marginTop: '15px', borderTop: '1px solid #444', paddingTop: '10px' }}>
                                <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>
                                    📥 Importación Masiva (Excel)
                                </label>
                                <input
                                    type="file"
                                    accept=".xlsx, .xls"
                                    onChange={handleFileUpload}
                                    style={{ fontSize: '0.9em', color: '#ccc' }}
                                />
                                <small style={{ display: 'block', color: '#666', marginTop: '2px' }}>
                                    Sube un archivo .xlsx con una lista de correos. Se validarán y agregarán los no duplicados.
                                </small>
                            </div>
                        </div>

                        <button type="submit" style={{ width: '100%', padding: '10px', background: 'var(--primary-color)', border: 'none', color: 'white', borderRadius: '6px', marginTop: '10px', cursor: 'pointer' }}>
                            {editingId ? 'Actualizar' : 'Guardar'}
                        </button>
                        {editingId && (
                            <button type="button" onClick={handleCancelEdit} style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px solid #666', color: '#ccc', borderRadius: '6px', marginTop: '5px', cursor: 'pointer' }}>
                                Cancelar
                            </button>
                        )}
                    </form>
                </>
            ) : (
                // --- CAMERAS TAB CONTENT ---
                <>
                    <div className="device-list" style={{ marginBottom: '2rem' }}>
                        {cameras.length === 0 ? <p style={{ color: '#666' }}>Sin cámaras configuradas.</p> : cameras.map(cam => (
                            <div key={cam.id} style={{
                                background: editingCamId === cam.id ? 'rgba(46, 204, 113, 0.1)' : 'rgba(255,255,255,0.05)',
                                border: editingCamId === cam.id ? '1px solid #2ecc71' : 'none',
                                padding: '10px', borderRadius: '8px', marginBottom: '8px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}>
                                <div>
                                    <strong>{cam.name}</strong>
                                    <span style={{
                                        fontSize: '0.7em', color: 'white',
                                        background: cam.type === 'rtmp' ? '#e67e22' : '#2980b9',
                                        padding: '2px 6px', borderRadius: '4px', marginLeft: '10px'
                                    }}>
                                        {cam.type === 'rtmp' ? 'RTMP' : 'TUYA'}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button onClick={() => handleEditCamClick(cam)} style={{ background: '#3498db33', color: '#3498db', border: 'none', padding: '5px 10px', cursor: 'pointer', borderRadius: '4px' }}>✏️</button>
                                    <button onClick={() => window.confirm(`Eliminar ${cam.name}?`) && onDeleteCamera(cam.id)} style={{ background: '#e74c3c33', color: '#e74c3c', border: 'none', padding: '5px 10px', cursor: 'pointer', borderRadius: '4px' }}>🗑️</button>
                                </div>
                            </div>
                        ))}
                    </div>

                    <h3>{editingCamId ? 'Editar Cámara' : 'Agregar Nueva Cámara'}</h3>
                    {userRole === 'admin' ? (
                        <form onSubmit={handleCamSubmit}>
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Nombre Cámara</label>
                                <input name="name" value={camFormData.name} onChange={handleCamChange} placeholder="Ej: Entrada Principal" required
                                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                />
                            </div>

                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Tipo / Protocolo</label>
                                <select name="type" value={camFormData.type} onChange={handleCamChange}
                                    style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white' }}
                                >
                                    <option value="tuya">Tuya Smart (Cloud API)</option>
                                    <option value="rtmp">RTMP Stream (Generic)</option>
                                </select>
                            </div>

                            {camFormData.type === 'tuya' ? (
                                <>
                                    <div style={{ padding: '15px', background: 'rgba(52, 152, 219, 0.1)', borderRadius: '8px', border: '1px solid #3498db', marginBottom: '15px' }}>
                                        <h4 style={{ margin: '0 0 10px 0', color: '#3498db' }}>Credenciales Tuya IoT</h4>
                                        <div style={{ marginBottom: '15px' }}>
                                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Tuya Device ID</label>
                                            <input name="tuyaDeviceId" value={camFormData.tuyaDeviceId} onChange={handleCamChange} placeholder="bf8..." required
                                                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ marginBottom: '15px' }}>
                                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Tuya Access ID</label>
                                            <input name="tuyaAccessId" value={camFormData.tuyaAccessId} onChange={handleCamChange} placeholder="" required
                                                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ marginBottom: '15px' }}>
                                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Tuya Secret</label>
                                            <input name="tuyaAccessSecret" type="password" value={camFormData.tuyaAccessSecret} onChange={handleCamChange} placeholder="" required
                                                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                            />
                                        </div>
                                        <div style={{ marginBottom: '15px' }}>
                                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Tuya User ID (UID)</label>
                                            <input name="tuyaUid" value={camFormData.tuyaUid} onChange={handleCamChange} placeholder="Requerido para Video HLS" required
                                                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                            />
                                            <small style={{ color: '#888' }}>Encuéntralo en Tuya IoT Platform &rarr; Cloud &rarr; Development &rarr; Project &rarr; User</small>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ padding: '15px', background: 'rgba(230, 126, 34, 0.1)', borderRadius: '8px', border: '1px solid #e67e22', marginBottom: '15px' }}>
                                        <h4 style={{ margin: '0 0 10px 0', color: '#e67e22' }}>Configuración RTMP (Stream Local)</h4>

                                        <div style={{ marginBottom: '15px' }}>
                                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>Stream Key (Nombre Único)</label>
                                            <input name="rtmpStreamKey" value={camFormData.rtmpStreamKey} onChange={handleCamChange} placeholder="ej: cam1" required
                                                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                            />
                                        </div>

                                        <div style={{ marginBottom: '15px' }}>
                                            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em', color: '#ccc' }}>IP Servidor de Video (Opcional)</label>
                                            <input name="rtmpServerIp" value={camFormData.rtmpServerIp} onChange={handleCamChange} placeholder={`Default: ${window.location.hostname}`}
                                                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #444', background: '#2a2a2a', color: 'white', boxSizing: 'border-box' }}
                                            />
                                            <small style={{ color: '#aaa', display: 'block', marginTop: '5px' }}>
                                                Déjalo vacío para usar el servidor local. Usa la IP pública (ej: 64.x.x.x) si usas un VPS.
                                            </small>
                                        </div>

                                        {camFormData.rtmpStreamKey && (
                                            <div style={{ background: '#00000066', padding: '10px', borderRadius: '6px', fontSize: '0.85em', fontFamily: 'monospace' }}>
                                                <div style={{ marginBottom: '8px', color: '#4cc9f0' }}>
                                                    <strong>🔗 URL para Cámara (RTMP):</strong><br />
                                                    rtmp://{camFormData.rtmpServerIp || window.location.hostname}:1935/live/{camFormData.rtmpStreamKey}
                                                </div>
                                                <div style={{ color: '#2ecc71' }}>
                                                    <strong>📺 URL de Visualización (HLS):</strong><br />
                                                    http://{camFormData.rtmpServerIp || window.location.hostname}:8000/live/{camFormData.rtmpStreamKey}/index.m3u8
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            <button type="submit" disabled={isVerifying} style={{ width: '100%', padding: '10px', background: 'var(--primary-color)', border: 'none', color: 'white', borderRadius: '6px', marginTop: '10px', cursor: 'pointer', opacity: isVerifying ? 0.7 : 1 }}>
                                {isVerifying ? 'Verificando conexión...' : (editingCamId ? 'Actualizar Cámara' : 'Guardar Cámara')}
                            </button>
                            {editingCamId && (
                                <button type="button" onClick={handleCancelCamEdit} style={{ width: '100%', padding: '10px', background: 'transparent', border: '1px solid #666', color: '#ccc', borderRadius: '6px', marginTop: '5px', cursor: 'pointer' }}>
                                    Cancelar
                                </button>
                            )}
                        </form>
                    ) : (
                        <p style={{ color: '#aaa', fontStyle: 'italic', textAlign: 'center', padding: '20px' }}>
                            🔒 Gestión de cámaras restringida a administradores.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
