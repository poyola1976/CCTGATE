import { doc, getDoc, setDoc, getFirestore } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';

// Requerimos acceso a DB, lo tomamos del mismo contexto (o idealmente pasarlo como dependencia)
// Para simplificar, asumimos que firebase.js ya inicializó la app, pero aquí necesitamos la instancia.
// Vamos a importar 'db' desde firebase.js NO se puede si no lo exportamos.
// Mejor opción: Replicar la inicialización o (mejor) exportar 'db' desde firebase.js.
// VOY A MODIFICAR firebase.js para exportar 'db' primero, es más limpio. 
// PERO para no interrumpir el flujo, usaré getFirestore() que devuelve la instancia default si ya se inicializó.

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
            // Usuario nuevo, determinar rol inicial
            // Por seguridad, default es 'user'.
            // Solo para facilidad de setup, podríamos hacer una lógica de "si soy el primero, soy admin".
            // Para v3.0, lo haremos manual: Default 'user'.
            // El usuario tendrá que ir a Firebase Console a cambiar su rol a 'admin' manualmente 
            // o implementamos la lógica de "primer usuario".

            // Vamos a ser estrictos: Default user.
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
