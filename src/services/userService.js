import { doc, getDoc, setDoc, getFirestore, collection, getDocs, updateDoc, deleteDoc, query } from 'firebase/firestore';

const COLLECTION_USERS = 'users';

// Helper local para obtener instancia DB lazy (evita race condition al inicio)
const getDb = () => getFirestore();

export const UserService = {
    /**
     * Obtiene el rol del usuario o lo crea si no existe.
     * Estrategia "Bootstrap": Si la colección users está vacía, el primero es admin.
     */
    getUserRole: async (user) => {
        if (!user) return null;

        const db = getDb();
        const userRef = doc(db, COLLECTION_USERS, user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
            return userSnap.data().role;
        } else {
            const defaultRole = 'user';

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
