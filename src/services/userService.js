import { doc, getDoc, setDoc, getFirestore, collection, getDocs, updateDoc, deleteDoc, query, where, limit } from 'firebase/firestore';

const COLLECTION_USERS = 'users';

// Helper local para obtener instancia DB lazy (evita race condition al inicio)
const getDb = () => getFirestore();

export const UserService = {
    /**
     * Obtiene el rol del usuario o lo crea si no existe.
     * Estrategia "Bootstrap": Si la colección users está vacía, el primero es admin.
     */
    /**
     * Valida si un email está autorizado para registrarse.
     * Retorna true (autorizado) o lanza error.
     */
    validateWhitelist: async (email) => {
        const db = getDb();
        // VERIFICACIÓN DE WHITELIST (Nuevo usuario)
        const usersSnap = await getDocs(query(collection(db, COLLECTION_USERS), limit(1)));
        const isFirstUser = usersSnap.empty;

        if (isFirstUser) return 'admin'; // Primer usuario es admin

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

    getUserRole: async (user) => {
        if (!user) return null;

        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            return userSnap.data().role;
        } else {
            // Usar validador centralizado
            const defaultRole = await UserService.validateWhitelist(user.email);

            await setDoc(userRef, {
                email: user.email,
                role: defaultRole,
                createdAt: new Date()
            });

            return defaultRole;
        }
    },

    /**
     * Obtiene el perfil completo del usuario desde Firestore
     */
    getUserProfile: async (uid) => {
        if (!uid) return null;
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        const userSnap = await getDoc(userRef);
        return userSnap.exists() ? userSnap.data() : null;
    },

    /**
     * Guarda datos adicionales del perfil en Firestore (Telefono, Nombre)
     */
    saveUserProfile: async (uid, data) => {
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        // Usamos setDoc con merge: true para no borrar el rol si ya existe
        await setDoc(userRef, {
            ...data,
            updatedAt: new Date()
        }, { merge: true });
    },

    /**
     * Obtiene todos los usuarios (Solo Admin)
     */
    getAllUsers: async () => {
        const db = getDb();
        const usersRef = collection(db, COLLECTION_USERS);
        // Intentamos ordenar por email, si falla por falta de índice, lo haremos en cliente
        const q = query(usersRef);
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    },

    /**
     * Actualiza el rol de un usuario (Solo Admin)
     */
    updateUserRole: async (uid, newRole) => {
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        await updateDoc(userRef, { role: newRole });
    },

    /**
     * Elimina los datos del usuario de Firestore (Solo Admin)
     */
    deleteUser: async (uid) => {
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        await deleteDoc(userRef);
    },

    /**
     * Establece el rango de vigencia del usuario
     */
    updateUserExpiration: async (uid, startDate, endDate) => {
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        await updateDoc(userRef, {
            startDate: startDate,
            expirationDate: endDate
        });
    },

    /**
     * Establece la vigencia para un dispositivo específico (Legacy support but method kept for safety)
     */
    updateUserDeviceAccess: async (uid, deviceId, startDate, endDate) => {
        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, uid);
        await updateDoc(userRef, {
            [`accessRules.${deviceId}`]: {
                startDate: startDate,
                expirationDate: endDate,
                updatedAt: new Date()
            }
        });
    }
};
