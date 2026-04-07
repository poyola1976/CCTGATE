import React, { useState, useEffect } from 'react';
import { FirebaseService } from '../services/firebase';
import {
    collection,
    getDocs,
    doc,
    setDoc,
    onSnapshot,
    query
} from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const AdminPricingScreen = ({ onBack }) => {
    const [doors, setDoors] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [globalPricing, setGlobalPricing] = useState({ semestral: 8000, anual: 10000 });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        // Suscribirse a puertas y cámaras
        const unsubDoors = FirebaseService.subscribeToDoors((data) => {
            setDoors(data);
            setLoading(false);
        }, 'admin');

        const unsubCameras = FirebaseService.subscribeToCameras(setCameras);

        // Cargar precios globales
        const loadGlobalPricing = async () => {
            try {
                // Hago una lectura directa a la colección config
                const snap = await FirebaseService.getGlobalPricing();
                if (snap) setGlobalPricing(snap);
            } catch (e) { console.error("Error loading pricing", e); }
        };
        loadGlobalPricing();

        return () => { unsubDoors(); unsubCameras(); };
    }, []);

    // Clasificación de puertas con lógica más robusta
    const doorsWithCamera = doors.filter(d => d.cameraId || d.tuya_id || d.associatedCameraId);
    const doorsOnlyAccess = doors.filter(d => !d.cameraId && !d.tuya_id && !d.associatedCameraId);

    const handleSaveGlobal = async () => {
        setSaving(true);
        try {
            await FirebaseService.updateGlobalPricing(globalPricing);
            alert("✅ Precios globales actualizados con éxito");
        } catch (e) { alert("❌ Error: " + e.message); }
        setSaving(false);
    };

    const handleApplyToAll = async (targetDoors, prices) => {
        confirm(`¿Estás seguro de que quieres aplicar estos precios a ${targetDoors.length} puertas?`) &&
            setSaving(true);
        try {
            for (const d of targetDoors) {
                await FirebaseService.updateDoor(d.id, {
                    price_semestral: Number(prices.semestral),
                    price_anual: Number(prices.anual)
                });
            }
            alert("✅ Precios aplicados al grupo con éxito");
        } catch (e) { alert("❌ Error: " + e.message); }
        setSaving(false);
    };

    const handleUpdateIndividual = async (doorId, prices) => {
        setSaving(true);
        try {
            await FirebaseService.updateDoor(doorId, {
                price_semestral: Number(prices.semestral),
                price_anual: Number(prices.anual)
            });
        } catch (e) { alert("❌ Error: " + e.message); }
        setSaving(false);
    };

    const containerStyle = {
        padding: '30px',
        maxWidth: '1200px',
        margin: '0 auto',
        color: '#fff',
        fontFamily: "'Inter', sans-serif"
    };

    const cardStyle = {
        background: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(10px)',
        borderRadius: '15px',
        padding: '25px',
        border: '1px solid rgba(255,255,255,0.1)',
        marginBottom: '30px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
    };

    const inputStyle = {
        background: 'rgba(0,0,0,0.2)',
        border: '1px solid rgba(255,255,255,0.2)',
        color: '#fff',
        padding: '10px',
        borderRadius: '8px',
        width: '120px',
        marginRight: '10px',
        fontSize: '1em'
    };

    const btnStyle = {
        padding: '10px 20px',
        borderRadius: '8px',
        border: 'none',
        cursor: 'pointer',
        fontWeight: 'bold',
        transition: 'all 0.3s ease'
    };

    if (loading) return <div style={containerStyle}>Cargando configuración...</div>;

    return (
        <div style={containerStyle}>
            <h1 style={{ textAlign: 'center', marginBottom: '20px', background: 'linear-gradient(45deg, #3498db, #9b59b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontSize: '2.5em' }}>
                Gestión de Tarifas de Licencias
            </h1>

            <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                <button
                    onClick={onBack}
                    style={{ ...btnStyle, backgroundColor: 'transparent', color: '#aaa', border: '1px solid #aaa' }}
                >
                    ⬅️ Volver al Panel
                </button>
            </div>

            {/* PRECIOS GLOBALES */}
            <div style={cardStyle}>
                <h2 style={{ color: '#3498db', marginTop: 0 }}>🛡️ Tarifas Globales por Defecto</h2>
                <p style={{ opacity: 0.7, marginBottom: '20px' }}>Estos precios se aplicarán a cualquier puerta que no tenga una tarifa personalizada.</p>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8em', marginBottom: '5px' }}>Semestral (6 meses)</label>
                        <input
                            type="number"
                            style={inputStyle}
                            value={globalPricing.semestral}
                            onChange={(e) => setGlobalPricing({ ...globalPricing, semestral: e.target.value })}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8em', marginBottom: '5px' }}>Anual (1 año)</label>
                        <input
                            type="number"
                            style={inputStyle}
                            value={globalPricing.anual}
                            onChange={(e) => setGlobalPricing({ ...globalPricing, anual: e.target.value })}
                        />
                    </div>
                    <button
                        onClick={handleSaveGlobal}
                        style={{ ...btnStyle, backgroundColor: '#2ecc71', color: '#fff', marginTop: '18px' }}
                        disabled={saving}
                    >
                        {saving ? 'Guardando...' : 'Guardar Global'}
                    </button>
                    <button
                        onClick={() => handleApplyToAll(doors, globalPricing)}
                        style={{ ...btnStyle, backgroundColor: '#e67e22', color: '#fff', marginTop: '18px' }}
                        disabled={saving}
                    >
                        Aplicar a Todas las Puertas
                    </button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '20px' }}>

                {/* GRUPO: CON CÁMARA */}
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <h2 style={{ color: '#e74c3c', margin: 0 }}>📷 Puertas con Cámara ({doorsWithCamera.length})</h2>
                        <button
                            onClick={() => handleApplyToAll(doorsWithCamera, { semestral: 10000, anual: 15000 })}
                            style={{ ...btnStyle, backgroundColor: 'rgba(231, 76, 60, 0.2)', color: '#e74c3c', border: '1px solid #e74c3c', fontSize: '0.8em' }}
                        >
                            Masivo Grupo
                        </button>
                    </div>
                    <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                        {doorsWithCamera.map(d => (
                            <IndividualDoorItem key={d.id} door={d} onUpdate={handleUpdateIndividual} />
                        ))}
                    </div>
                </div>

                {/* GRUPO: SOLO ACCESO */}
                <div style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <h2 style={{ color: '#2ecc71', margin: 0 }}>🔑 Puertas Solo Acceso ({doorsOnlyAccess.length})</h2>
                        <button
                            onClick={() => handleApplyToAll(doorsOnlyAccess, { semestral: 5000, anual: 8000 })}
                            style={{ ...btnStyle, backgroundColor: 'rgba(46, 204, 113, 0.2)', color: '#2ecc71', border: '1px solid #2ecc71', fontSize: '0.8em' }}
                        >
                            Masivo Grupo
                        </button>
                    </div>
                    <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                        {doorsOnlyAccess.map(d => (
                            <IndividualDoorItem key={d.id} door={d} onUpdate={handleUpdateIndividual} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const IndividualDoorItem = ({ door, onUpdate }) => {
    const [prices, setPrices] = useState({
        semestral: door.price_semestral || 8000,
        anual: door.price_anual || 10000
    });

    // Sincronizar estado local si los props cambian (refresco instantáneo)
    useEffect(() => {
        setPrices({
            semestral: door.price_semestral || 8000,
            anual: door.price_anual || 10000
        });
    }, [door.price_semestral, door.price_anual]);

    const isCustom = door.price_semestral !== undefined;

    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            backgroundColor: isCustom ? 'rgba(52, 152, 219, 0.05)' : 'transparent',
            borderRadius: '8px'
        }}>
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold' }}>{door.name}</div>
                <div style={{ fontSize: '0.7em', color: isCustom ? '#3498db' : '#aaa' }}>
                    {isCustom ? 'Tarifa Especial' : 'Usa Tarifa Global'}
                </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
                <input
                    type="number"
                    style={{ ...inputStyleSmall, borderColor: isCustom ? '#3498db' : 'rgba(255,255,255,0.1)' }}
                    value={prices.semestral}
                    onChange={(e) => setPrices({ ...prices, semestral: e.target.value })}
                />
                <input
                    type="number"
                    style={{ ...inputStyleSmall, borderColor: isCustom ? '#3498db' : 'rgba(255,255,255,0.1)' }}
                    value={prices.anual}
                    onChange={(e) => setPrices({ ...prices, anual: e.target.value })}
                />
                <button
                    onClick={() => onUpdate(door.id, prices)}
                    style={{ background: 'none', border: 'none', color: '#3498db', cursor: 'pointer', fontSize: '1.2em' }}
                >
                    💾
                </button>
            </div>
        </div>
    );
};

const inputStyleSmall = {
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff',
    padding: '5px 8px',
    borderRadius: '4px',
    width: '75px',
    fontSize: '0.9em'
};

export default AdminPricingScreen;
