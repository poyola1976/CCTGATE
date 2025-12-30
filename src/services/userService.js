import { doc, getDoc, setDoc, getFirestore, collection, getDocs, updateDoc, deleteDoc, query, where, limit } from 'firebase/firestore';

const COLLECTION_USERS = 'users';

// Helper local para obtener instancia DB lazy (evita race condition al inicio)
const getDb = () => getFirestore();

export const UserService = {
    /**
     * Valida si un email está autorizado para registrarse.
     * Retorna true (autorizado) o lanza error.
     */
    validateWhitelist: async (emailRaw) => {
        const email = emailRaw.toLowerCase();
        const db = getDb();
        // VERIFICACIÓN DE WHITELIST (Nuevo usuario)
        // Eliminada lógica de "Primer Usuario = Admin" por problemas de permisos y seguridad.
        // El primer admin debe crearse manualmente en Firebase Console o usar un script de seed.

        // Verificar si está en alguna puerta
        const doorsRef = collection(db, 'doors');
        const q = query(doorsRef, where('allowedEmails', 'array-contains', email), limit(1));
        const doorSnap = await getDocs(q);

        if (doorSnap.empty) {
            console.warn(`Registro rechazado: ${email} no está en ninguna whitelist.`);
            throw new Error("UNAUTHORIZED_REGISTRATION");
        }
        return 'user';
    },

    /**
     * Obtiene el rol del usuario o lo crea si no existe.
     */
    getUserRole: async (user) => {
        if (!user) return null;

        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            const userData = userSnap.data();

            // SELF-HEALING: Si es un usuario normal y no tiene 'deviceAccess' (o está vacío),
            // significa que se creó incorrectamente (quizás por error de permisos). Intentamos reparar.
            if (userData.role === 'user' && (!userData.deviceAccess || Object.keys(userData.deviceAccess).length === 0)) {
                console.warn("Usuario incompleto detectado. Intentando reparar licencias...");
                UserService.regenerateLicenses(user.uid, user.email);
            }

            return userData.role;
        } else {
            // Usar validador centralizado (ya normaliza internamente, pero pasamos user.email)
            const defaultRole = await UserService.validateWhitelist(user.email);
            const normalizedEmail = user.email.toLowerCase();

            let initialData = {
                email: normalizedEmail,
                role: defaultRole,
                createdAt: new Date(),
                deviceAccess: {} // Inicializar mapa
            };

            if (defaultRole !== 'admin' && defaultRole !== 'validador') {
                try {
                    // 1. Obtener Configuración
                    const settings = await UserService.getSystemSettings();
                    const days = settings.defaultLicenseDays || 30;

                    if (days > 0) {
                        // 2. Buscar TODAS las puertas donde está este email
                        const db = getDb();
                        const doorsRef = collection(db, 'doors');
                        // QUERY CASE-INSENSITIVE (Usando email normalizado)
                        const q = query(doorsRef, where('allowedEmails', 'array-contains', normalizedEmail));
                        const doorsSnap = await getDocs(q);

                        // 3. Generar regla para CADA puerta encontrada
                        const now = new Date();
                        const expDate = new Date();
                        expDate.setDate(expDate.getDate() + parseInt(days));
                        expDate.setHours(23, 59, 59, 999);

                        doorsSnap.forEach(doc => {
                            const deviceId = doc.id;
                            initialData.deviceAccess[deviceId] = {
                                startDate: now,
                                expirationDate: expDate
                            };
                        });
                    }
                } catch (e) {
                    console.warn("Error generando licencias iniciales", e);
                }
            }

            await setDoc(userRef, initialData);
            return defaultRole;
        }
    },

    getUserProfile: async (uid) => {
        if (!uid) return null;
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        const userSnap = await getDoc(userRef);
        return userSnap.exists() ? userSnap.data() : null;
    },

    saveUserProfile: async (uid, data) => {
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        await setDoc(userRef, {
            ...data,
            updatedAt: new Date()
        }, { merge: true });
    },

    /**
     * Obtiene usuarios por lista de emails (para mostrar detalle en puertas).
     * Nota: Firestore 'in' limitation: max 30. Si es mayor, se debería hacer por lotes.
     * Para simplificar, asumimos < 30 por puerta normalmente, o iteramos.
     */
    getUsersByEmails: async (emails) => {
        if (!emails || !Array.isArray(emails) || emails.length === 0) return [];

        // Normalizar emails de entrada
        const normalizedEmails = emails.map(e => e.toLowerCase());
        const db = getDb();
        const usersRef = collection(db, COLLECTION_USERS);

        // Estrategia Robustez: Si son pocos, usamos 'in'. Si son muchos, hacemos fetch de todo (cacheado) o batches.
        // Dado el uso typical, usaremos batches de 10 para ser seguros (limitación 'in' es 30).
        const chunks = [];
        for (let i = 0; i < normalizedEmails.length; i += 10) {
            chunks.push(normalizedEmails.slice(i, i + 10));
        }

        let allUsers = [];
        for (const chunk of chunks) {
            const q = query(usersRef, where('email', 'in', chunk));
            const snap = await getDocs(q);
            allUsers = [...allUsers, ...snap.docs.map(d => ({ uid: d.id, ...d.data() }))];
        }

        return allUsers;
    },

    getAllUsers: async () => {
        const db = getDb();
        const usersRef = collection(db, COLLECTION_USERS);
        const q = query(usersRef);
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    },

    updateUserRole: async (uid, newRole) => {
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        await updateDoc(userRef, { role: newRole });
    },

    deleteUser: async (uid) => {
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        await deleteDoc(userRef);
    },

    updateUserExpiration: async (uid, startDate, endDate, deviceId = null) => {
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);

        if (deviceId) {
            await updateDoc(userRef, {
                [`deviceAccess.${deviceId}`]: {
                    startDate: startDate,
                    expirationDate: endDate,
                    updatedAt: new Date()
                }
            });
        } else {
            await updateDoc(userRef, {
                startDate: startDate,
                expirationDate: endDate
            });
        }
    },

    grantDefaultLicenseByEmail: async (email, deviceId) => {
        const db = getDb();
        const q = query(collection(db, COLLECTION_USERS), where('email', '==', email), limit(1));
        const snap = await getDocs(q);

        if (snap.empty) return;

        const userDoc = snap.docs[0];
        const uid = userDoc.id;

        const settings = await UserService.getSystemSettings();
        const days = settings.defaultLicenseDays || 30;

        const now = new Date();
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + parseInt(days));
        expDate.setHours(23, 59, 59, 999);

        await UserService.updateUserExpiration(uid, now, expDate, deviceId);
        console.log(`Licencia de ${days} dias otorgada a ${email} para device ${deviceId}`);
    },

    checkUserAccess: (user, deviceId) => {
        const now = new Date();

        // Admin y Validador tienen acceso perpetuo
        if (user.role === 'admin' || user.role === 'validador') {
            return { allowed: true, message: 'Acceso Permanente (Rol)' };
        }

        if (user.deviceAccess && user.deviceAccess[deviceId]) {
            const rule = user.deviceAccess[deviceId];
            const start = rule.startDate ? new Date(rule.startDate.seconds * 1000) : null;
            const end = rule.expirationDate ? new Date(rule.expirationDate.seconds * 1000) : null;

            if (start && now < start) return { allowed: false, message: `Acceso inicia el ${start.toLocaleDateString()}` };
            if (end && now > end) return { allowed: false, message: `Acceso venció el ${end.toLocaleDateString()}` };

            return { allowed: true, message: 'Acceso Específico Válido' };
        }

        const globalStart = user.startDate ? new Date(user.startDate.seconds * 1000) : null;
        const globalEnd = user.expirationDate ? new Date(user.expirationDate.seconds * 1000) : null;

        if (globalStart && now < globalStart) return { allowed: false, message: `Usuario inactivo hasta ${globalStart.toLocaleDateString()}` };
        if (globalEnd && now > globalEnd) return { allowed: false, message: `Usuario vencido desde ${globalEnd.toLocaleDateString()}` };

        return { allowed: true, message: 'Acceso Global Válido' };
    },

    getSystemSettings: async () => {
        const db = getDb();
        const docRef = doc(db, 'settings', 'global');
        const snap = await getDoc(docRef);
        if (snap.exists()) return snap.data();
        return { defaultLicenseDays: 30 };
    },

    updateSystemSettings: async (settings) => {
        const db = getDb();
        const docRef = doc(db, 'settings', 'global');
        await setDoc(docRef, settings, { merge: true });
    },

    /**
     * Helper para generar/regenerar licencias por defecto.
     * Útil para auto-reparación o inicialización.
     */
    regenerateLicenses: async (uid, emailRaw) => {
        const email = emailRaw.toLowerCase();
        try {
            // 1. Obtener Configuración
            const settings = await UserService.getSystemSettings();
            const days = settings.defaultLicenseDays || 30;

            if (days > 0) {
                // 2. Buscar TODAS las puertas donde está este email
                const db = getDb();
                const doorsRef = collection(db, 'doors');
                const q = query(doorsRef, where('allowedEmails', 'array-contains', email));
                const doorsSnap = await getDocs(q);

                // 3. Generar regla para CADA puerta encontrada
                const now = new Date();
                const expDate = new Date();
                expDate.setDate(expDate.getDate() + parseInt(days));
                expDate.setHours(23, 59, 59, 999);

                const updates = {};
                doorsSnap.forEach(doc => {
                    const deviceId = doc.id;
                    updates[`deviceAccess.${deviceId}`] = {
                        startDate: now,
                        expirationDate: expDate
                    };
                });

                if (Object.keys(updates).length > 0) {
                    const userRef = doc(db, COLLECTION_USERS, uid);
                    await updateDoc(userRef, updates);
                    console.log(`Licencias reparadas para ${email}`);
                }
            }
        } catch (e) {
            console.warn("Error regenerando licencias", e);
        }
    }
};
