import { useState, useEffect } from 'react';
import { UserService } from '../services/userService';
import { FirebaseService } from '../services/firebase';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function AdminUsersScreen({ devices, onBack }) {
    const doors = devices || [];
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDoorId, setSelectedDoorId] = useState('');
    const [emailToAdd, setEmailToAdd] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [filterDoorId, setFilterDoorId] = useState('all');
    const [editingUser, setEditingUser] = useState(null); // { uid, doorId, email, currentExp }
    const [newDateValue, setNewDateValue] = useState('');

    // Cargar usuarios al montar
    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        setLoading(true);
        try {
            const allUsers = await UserService.getAllUsers();
            setUsers(allUsers);
        } catch (err) {
            console.error("Error loading users:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleAuthorize = async (e) => {
        e.preventDefault();
        if (!emailToAdd || !selectedDoorId) return;

        setIsProcessing(true);
        try {
            const normalizedEmail = emailToAdd.toLowerCase().trim();
            const selectedDoor = doors.find(d => d.id === selectedDoorId);
            const graceDays = selectedDoor?.grantDays ?? 0;

            // Buscar usuario por email
            const allUsers = await UserService.getAllUsers();
            const targetUser = allUsers.find(u => u.email?.toLowerCase() === normalizedEmail);

            if (!targetUser) {
                alert("❌ Este email no está registrado en el sistema. El usuario debe iniciar sesión al menos una vez.");
                return;
            }

            const now = new Date();
            const expDate = new Date();
            expDate.setDate(expDate.getDate() + graceDays);
            expDate.setHours(23, 59, 59, 999);

            // 1. Actualizar deviceAccess del usuario
            await UserService.updateUserExpiration(targetUser.uid, now, expDate, selectedDoorId);

            // 2. CRTICO: asegurar que el email está en allowedEmails de la puerta
            //    Sin esto, el usuario nunca verá esa puerta en su pantalla principal
            const currentEmails = selectedDoor?.allowedEmails || [];
            if (!currentEmails.map(e => e.toLowerCase()).includes(normalizedEmail)) {
                await FirebaseService.updateDoor(selectedDoorId, {
                    allowedEmails: [...currentEmails, normalizedEmail]
                });
            }

            setEmailToAdd('');
            alert(`✅ Usuario autorizado con ${graceDays} días de gracia.`);
            await loadUsers();
        } catch (error) {
            console.error("Error authorizing:", error);
            alert("❌ Error: " + error.message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleOpenEditDate = (uid, doorId, email, expiration) => {
        const currentExp = expiration?.seconds ? new Date(expiration.seconds * 1000) : new Date();
        // Formatear para input type="date"
        const formatted = currentExp.toISOString().split('T')[0];
        setNewDateValue(formatted);
        setEditingUser({ uid, doorId, email, currentExp });
    };

    const handleConfirmDateChange = async () => {
        if (!editingUser || !newDateValue) return;

        const selectedDate = new Date(newDateValue + 'T23:59:59');
        const formattedDate = selectedDate.toLocaleDateString();

        if (!window.confirm(`¿Estás seguro de cambiar la fecha de vencimiento de ${editingUser.email} a ${formattedDate}?`)) return;

        try {
            const user = users.find(u => u.uid === editingUser.uid);
            const startDate = user?.deviceAccess?.[editingUser.doorId]?.startDate || new Date();
            await UserService.updateUserExpiration(editingUser.uid, startDate, selectedDate, editingUser.doorId);
            alert(`✅ Fecha actualizada a ${formattedDate}`);
            setEditingUser(null);
            setNewDateValue('');
            await loadUsers();
        } catch (error) {
            alert("Error: " + error.message);
        }
    };

    const handleRevokeAccess = async (uid, doorId) => {
        if (!window.confirm("¿Estás seguro de revocar este acceso? Se pondrá la fecha de expiración en el pasado.")) return;
        try {
            const pastDate = new Date('2020-01-01');
            await UserService.updateUserExpiration(uid, pastDate, pastDate, doorId);
            alert("✅ Acceso revocado.");
            await loadUsers();
        } catch (error) {
            alert("Error: " + error.message);
        }
    };

    const handleRemoveUserFromDoor = async (uid, doorId, email) => {
        const door = doors.find(d => d.id === doorId);
        const doorName = door?.name || 'esta puerta';
        if (!window.confirm(`¿Eliminar a ${email} de "${doorName}"?\n\nEsto quitará su acceso y lo removerá de la lista completamente.`)) return;
        try {
            // 1. Quitar email de allowedEmails de la puerta
            if (door) {
                const updatedEmails = (door.allowedEmails || []).filter(e => e.toLowerCase() !== email.toLowerCase());
                await FirebaseService.updateDoor(doorId, { allowedEmails: updatedEmails });
            }
            // 2. Quitar entrada deviceAccess del usuario para esta puerta
            const { getFirestore, doc, updateDoc, deleteField } = await import('firebase/firestore');
            const db = getFirestore();
            const userRef = doc(db, 'users', uid);
            await updateDoc(userRef, { [`deviceAccess.${doorId}`]: deleteField() });

            alert(`✅ ${email} eliminado de "${doorName}".`);
            await loadUsers();
        } catch (error) {
            console.error("Error eliminando usuario:", error);
            alert("Error: " + error.message);
        }
    };

    const handleChangeRole = async (uid, email, currentRole) => {
        const newRole = currentRole === 'validador' ? 'user' : 'validador';
        const roleLabel = newRole === 'validador' ? 'VALIDADOR' : 'USUARIO NORMAL';
        if (!window.confirm(`Cambiar el rol de ${email} a ${roleLabel}?\n\nRecuerda asignar el validador a la puerta correspondiente desde Configuracion.`)) return;
        try {
            const { getFirestore, doc, updateDoc } = await import('firebase/firestore');
            const db = getFirestore();
            await updateDoc(doc(db, 'users', uid), { role: newRole });
            alert(`Rol de ${email} actualizado a ${roleLabel}`);
            await loadUsers();
        } catch (error) {
            alert('Error: ' + error.message);
        }
    };

    if (loading) return <div style={{ padding: '20px', color: '#fff', textAlign: 'center' }}>Cargando usuarios...</div>;

    // Construir lista de accesos activos
    const authList = [];
    users.forEach(u => {
        if (u.deviceAccess) {
            Object.keys(u.deviceAccess).forEach(dId => {
                const door = doors.find(d => d.id === dId);
                if (door) {
                    authList.push({
                        uid: u.uid,
                        email: u.email || 'Sin email',
                        doorId: dId,
                        doorName: door.name,
                        expiration: u.deviceAccess[dId].expirationDate,
                        role: u.role || 'user'
                    });
                }
            });
        }
    });

    // Aplicar filtro por puerta
    const filteredList = filterDoorId === 'all'
        ? authList
        : authList.filter(a => a.doorId === filterDoorId);

    // Preparar datos para exportación
    const buildExportData = () => {
        return filteredList.map(auth => {
            const expDate = auth.expiration?.seconds ? new Date(auth.expiration.seconds * 1000) : null;
            const isExpired = expDate && expDate < new Date();
            const daysLeft = expDate ? Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24)) : null;
            return {
                Email: auth.email,
                Puerta: auth.doorName,
                Vencimiento: expDate ? expDate.toLocaleDateString() : 'N/A',
                Estado: !expDate ? 'Sin fecha' : (isExpired ? 'Vencido' : 'Activo'),
                'Días Restantes': daysLeft ?? 'N/A'
            };
        });
    };

    const exportToExcel = () => {
        const data = buildExportData();
        if (data.length === 0) return alert('No hay datos para exportar.');
        const ws = XLSX.utils.json_to_sheet(data);
        // Ajustar ancho de columnas
        ws['!cols'] = [
            { wch: 35 }, // Email
            { wch: 20 }, // Puerta
            { wch: 15 }, // Vencimiento
            { wch: 12 }, // Estado
            { wch: 15 }, // Días Restantes
        ];
        const wb = XLSX.utils.book_new();
        const sheetName = filterDoorId === 'all' ? 'Todos' : (doors.find(d => d.id === filterDoorId)?.name || 'Usuarios');
        XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
        const doorLabel = filterDoorId === 'all' ? 'Todos' : (doors.find(d => d.id === filterDoorId)?.name || 'Puerta').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').replace(/ /g, '_');
        XLSX.writeFile(wb, `CCTGATE_Usuarios_${doorLabel}_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const exportToPDF = () => {
        const data = buildExportData();
        if (data.length === 0) return alert('No hay datos para exportar.');
        const doc = new jsPDF();
        const filterName = filterDoorId === 'all' ? 'Todas las puertas' : (doors.find(d => d.id === filterDoorId)?.name || '');

        // Header
        doc.setFontSize(16);
        doc.setTextColor(46, 204, 113);
        doc.text('CCTGATE - Reporte de Usuarios', 14, 20);
        doc.setFontSize(10);
        doc.setTextColor(150);
        doc.text(`Filtro: ${filterName}  |  Fecha: ${new Date().toLocaleDateString()}  |  Total: ${data.length}`, 14, 28);

        // Table
        autoTable(doc, {
            startY: 35,
            head: [['Email', 'Puerta', 'Vencimiento', 'Estado', 'Días']],
            body: data.map(d => [d.Email, d.Puerta, d.Vencimiento, d.Estado, d['Días Restantes']]),
            theme: 'grid',
            headStyles: { fillColor: [46, 204, 113], textColor: 255, fontStyle: 'bold' },
            styles: { fontSize: 8, cellPadding: 3 },
            alternateRowStyles: { fillColor: [245, 245, 245] },
            didParseCell: (data) => {
                if (data.column.index === 3 && data.section === 'body') {
                    if (data.cell.raw === 'Vencido') {
                        data.cell.styles.textColor = [231, 76, 60];
                        data.cell.styles.fontStyle = 'bold';
                    } else if (data.cell.raw === 'Activo') {
                        data.cell.styles.textColor = [46, 204, 113];
                    }
                }
            }
        });

        const doorLabel = filterDoorId === 'all' ? 'Todos' : (doors.find(d => d.id === filterDoorId)?.name || 'Puerta').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').replace(/ /g, '_');
        doc.save(`CCTGATE_Usuarios_${doorLabel}_${new Date().toISOString().split('T')[0]}.pdf`);
    };

    return (
        <div style={{ padding: '15px', maxWidth: '100%', margin: '0 auto', color: '#fff', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ color: '#2ecc71', margin: 0, fontSize: '1.2em' }}>👥 Gestión de Accesos</h2>
                <button
                    onClick={onBack}
                    style={{
                        background: 'rgba(255,255,255,0.1)',
                        border: 'none',
                        color: '#fff',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '0.85em'
                    }}
                >
                    ← Volver
                </button>
            </div>

            {/* FORMULARIO DE AUTORIZACIÓN */}
            <form onSubmit={handleAuthorize} style={{
                background: 'rgba(255,255,255,0.05)',
                padding: '15px',
                borderRadius: '12px',
                marginBottom: '20px',
                border: '1px solid rgba(255,255,255,0.1)'
            }}>
                <h3 style={{ fontSize: '0.9em', marginBottom: '12px', color: '#999' }}>Autorizar Nuevo Usuario</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input
                        type="email"
                        placeholder="Email del usuario"
                        value={emailToAdd}
                        onChange={(e) => setEmailToAdd(e.target.value)}
                        style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid #444',
                            color: '#fff',
                            padding: '10px',
                            borderRadius: '6px',
                            boxSizing: 'border-box',
                            width: '100%'
                        }}
                    />
                    <select
                        value={selectedDoorId}
                        onChange={(e) => setSelectedDoorId(e.target.value)}
                        style={{
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid #444',
                            color: '#fff',
                            padding: '10px',
                            borderRadius: '6px',
                            width: '100%'
                        }}
                    >
                        <option value="">Selecciona Puerta</option>
                        {doors.map(d => (
                            <option key={d.id} value={d.id}>{d.name} ({d.grantDays ?? 0} días gracia)</option>
                        ))}
                    </select>
                    <button
                        type="submit"
                        disabled={isProcessing || !emailToAdd || !selectedDoorId}
                        style={{
                            background: '#2ecc71',
                            color: '#fff',
                            border: 'none',
                            padding: '10px',
                            borderRadius: '6px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            opacity: isProcessing ? 0.5 : 1
                        }}
                    >
                        {isProcessing ? 'Procesando...' : 'Autorizar'}
                    </button>
                </div>
            </form>

            {/* FILTRO POR PUERTA + EXPORTAR + LISTA */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                    <h3 style={{ fontSize: '0.9em', color: '#999', margin: 0 }}>Usuarios ({filteredList.length})</h3>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                            value={filterDoorId}
                            onChange={(e) => setFilterDoorId(e.target.value)}
                            style={{
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid #444',
                                color: '#fff',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                fontSize: '0.8em'
                            }}
                        >
                            <option value="all">🏠 Todas las puertas</option>
                            {doors.map(d => (
                                <option key={d.id} value={d.id}>🚪 {d.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={exportToExcel}
                            style={{
                                background: '#217346',
                                border: 'none',
                                color: '#fff',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.75em',
                                fontWeight: 'bold'
                            }}
                        >
                            📄 Excel
                        </button>
                        <button
                            onClick={exportToPDF}
                            style={{
                                background: '#c0392b',
                                border: 'none',
                                color: '#fff',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.75em',
                                fontWeight: 'bold'
                            }}
                        >
                            📕 PDF
                        </button>
                    </div>
                </div>
                {filteredList.length === 0 ? (
                    <p style={{ color: '#666', textAlign: 'center', padding: '20px' }}>
                        {filterDoorId === 'all' ? 'No hay usuarios autorizados.' : 'No hay usuarios para esta puerta.'}
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {filteredList.map((auth, i) => {
                            const expDate = auth.expiration?.seconds ? new Date(auth.expiration.seconds * 1000) : null;
                            const isExpired = expDate && expDate < new Date();
                            const daysLeft = expDate ? Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24)) : null;

                            return (
                                <div key={i} style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    padding: '12px',
                                    borderRadius: '10px',
                                    border: `1px solid ${isExpired ? 'rgba(231,76,60,0.3)' : 'rgba(255,255,255,0.1)'}`
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                <div style={{ fontSize: '0.85em', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis' }}>{auth.email}</div>
                                                <button
                                                    onClick={() => handleChangeRole(auth.uid, auth.email, auth.role)}
                                                    title="Clic para cambiar rol"
                                                    style={{
                                                        background: auth.role === 'validador' ? 'rgba(243,156,18,0.2)' : 'rgba(255,255,255,0.08)',
                                                        border: '1px solid ' + (auth.role === 'validador' ? '#f39c12' : 'rgba(255,255,255,0.2)'),
                                                        color: auth.role === 'validador' ? '#f39c12' : '#777',
                                                        padding: '1px 7px',
                                                        borderRadius: '10px',
                                                        cursor: 'pointer',
                                                        fontSize: '0.65em',
                                                        fontWeight: 'bold',
                                                        flexShrink: 0
                                                    }}
                                                >
                                                    {auth.role === 'validador' ? 'Validador' : 'Usuario'}
                                                </button>
                                            </div>
                                            <div style={{ fontSize: '0.75em', color: '#888', marginTop: '2px' }}>{auth.doorName}</div>
                                            <div style={{ fontSize: '0.7em', marginTop: '4px', color: isExpired ? '#e74c3c' : '#2ecc71' }}>
                                                {expDate ? (isExpired ? `Vencio ${expDate.toLocaleDateString()}` : `${daysLeft} dias restantes`) : 'N/A'}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            <button
                                                onClick={() => handleOpenEditDate(auth.uid, auth.doorId, auth.email, auth.expiration)}
                                                style={{ background: '#3498db', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75em' }}
                                            >
                                                ✏️ Editar
                                            </button>
                                            <button
                                                onClick={() => handleRevokeAccess(auth.uid, auth.doorId)}
                                                style={{ background: '#e67e22', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75em' }}
                                            >
                                                Revocar
                                            </button>
                                            <button
                                                onClick={() => handleRemoveUserFromDoor(auth.uid, auth.doorId, auth.email)}
                                                style={{ background: '#c0392b', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75em', fontWeight: 'bold' }}
                                                title="Elimina al usuario de esta puerta completamente"
                                            >
                                                🗑️ Eliminar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* MODAL DE EDICIÓN DE FECHA */}
            {editingUser && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                    padding: '20px',
                    boxSizing: 'border-box'
                }}>
                    <div style={{
                        background: '#1e1e2e',
                        borderRadius: '16px',
                        padding: '25px',
                        maxWidth: '400px',
                        width: '100%',
                        border: '1px solid rgba(255,255,255,0.1)',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
                    }}>
                        <h3 style={{ color: '#fff', marginBottom: '15px', textAlign: 'center' }}>📅 Editar Fecha de Vencimiento</h3>
                        <p style={{ color: '#aaa', fontSize: '0.85em', textAlign: 'center', marginBottom: '20px' }}>
                            {editingUser.email}
                        </p>
                        <div style={{ marginBottom: '15px' }}>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '6px' }}>Fecha actual:</label>
                            <div style={{ color: '#f39c12', fontSize: '0.9em', fontWeight: 'bold' }}>
                                {editingUser.currentExp.toLocaleDateString()}
                            </div>
                        </div>
                        <div style={{ marginBottom: '25px' }}>
                            <label style={{ display: 'block', fontSize: '0.8em', color: '#888', marginBottom: '6px' }}>Nueva fecha de vencimiento:</label>
                            <input
                                type="date"
                                value={newDateValue}
                                onChange={(e) => setNewDateValue(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '12px',
                                    background: 'rgba(0,0,0,0.4)',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    borderRadius: '8px',
                                    color: '#fff',
                                    fontSize: '1em',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={handleConfirmDateChange}
                                style={{
                                    flex: 1,
                                    background: '#2ecc71',
                                    border: 'none',
                                    color: '#fff',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    fontSize: '0.9em'
                                }}
                            >
                                ✅ Confirmar
                            </button>
                            <button
                                onClick={() => { setEditingUser(null); setNewDateValue(''); }}
                                style={{
                                    flex: 1,
                                    background: 'rgba(255,255,255,0.1)',
                                    border: 'none',
                                    color: '#fff',
                                    padding: '12px',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: '0.9em'
                                }}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}
