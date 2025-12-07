import { doc, getDoc, setDoc, getFirestore } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';

const db = getFirestore();
const COLLECTION_USERS = 'users';

export const UserService = {
    /**
     * Obtiene el rol del usuario o lo crea si no existe.
     * Estrategia "Bootstrap": Si la colección users está vacía, el primero es admin.
     */
    getUserRole: async (user) => {
        if (!user) return null;

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
        const userRef = doc(db, COLLECTION_USERS, uid);
        const userSnap = await getDoc(userRef);
        return userSnap.exists() ? userSnap.data() : null;
    },

    /**
     * Guarda datos adicionales del perfil en Firestore (Telefono, Nombre)
     */
    saveUserProfile: async (uid, data) => {
        const userRef = doc(db, COLLECTION_USERS, uid);
        // Usamos setDoc con merge: true para no borrar el rol si ya existe
        await setDoc(userRef, {
            ...data,
            updatedAt: new Date()
        }, { merge: true });
    }
};
