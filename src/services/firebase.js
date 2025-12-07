/**
 * Servicio de Persistencia en la Nube (Firebase v9 Modular)
 * 
 * IMPORTANTE: Para que la sincronización funcione, debes reemplazar el objeto
 * 'firebaseConfig' con las credenciales de tu proyecto en Firebase Console.
 */

import { initializeApp } from 'firebase/app';
import {
    getFirestore,
    collection,
    addDoc,
    deleteDoc,
    doc,
    updateDoc,
    onSnapshot,
    query,
    orderBy,
    where,
    limit,
    getDocs
} from 'firebase/firestore';
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    updateProfile,
    sendEmailVerification,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider
} from 'firebase/auth';

// --- CONFIGURACIÓN DE FIREBASE (¡REEMPLAZA ESTO!) ---
const firebaseConfig = {
    // Pega aquí tus credenciales de Firebase Console -> Project Settings -> General -> Your apps
    apiKey: "AIzaSyDeGitBPAMzwr1V0rXnWS-fC9dUpIRVJUw",
    authDomain: "api-gate-af1a9.firebaseapp.com",
    projectId: "api-gate-af1a9",
    storageBucket: "api-gate-af1a9.firebasestorage.app",
    messagingSenderId: "925610303358",
    appId: "1:925610303358:web:98eb93eb8941c672e49d2f"
};
// ----------------------------------------------------

// Inicialización segura (Singleton)
let db;
let auth;
const googleProvider = new GoogleAuthProvider();

try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
} catch (e) {
    console.warn("⚠️ Firebase no configurado correctamente. Edita src/services/firebase.js", e);
}

const COLLECTION_NAME = 'doors';
const LOGS_COLLECTION = 'access_logs';

export const FirebaseService = {
    /**
     * Suscribirse a cambios en tiempo real (Sync)
     * @param {function} callback - Función que recibe el array de puertas actualizado
     * @param {string} role - 'admin' o 'user'
     * @param {string} userEmail - Email del usuario actual
     * @returns {function} Unsubscribe function
     */
    subscribeToDoors: (callback, role = 'user', userEmail = null) => {
        if (!db) return () => { };

        let q;

        if (role === 'admin') {
            // Admin ve todo
            q = query(collection(db, COLLECTION_NAME), orderBy('name'));
        } else if (userEmail) {
            // Usuario solo ve donde su email está en 'allowedEmails'
            // NOTA: Requiere índice compuesto en Firestore si combinamos con orderBy.
            // Para simplificar y evitar bloqueo por índice, quitamos orderBy en la query filtrada
            // y ordenamos en cliente si es necesario, O creamos el índice en consola.
            // Usaremos 'array-contains'
            q = query(
                collection(db, COLLECTION_NAME),
                where('allowedEmails', 'array-contains', userEmail)
            );
        } else {
            // Usuario sin email o error? No mostrar nada
            callback([]);
            return () => { };
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const doors = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            // Ordenamiento manual si no es admin (por si acaso el orderBy falla sin índice)
            if (role !== 'admin') {
                doors.sort((a, b) => a.name.localeCompare(b.name));
            }
            callback(doors);
        }, (error) => {
            console.error("Error syncing doors:", error);
            // Fallback silencioso o notificación
            if (error.code === 'failed-precondition') {
                console.warn("Posible falta de índice compuesto. Revisa la consola de Firebase.");
            }
        });

        return unsubscribe;
    },

    /**
     * Agregar una nueva puerta a la nube
     */
    addDoor: async (doorData) => {
        if (!db) throw new Error("Firebase no configurado");
        // Aseguramos que no guardamos el ID local si existe, Firestore crea uno nuevo
        const { id, ...dataToSave } = doorData;
        return await addDoc(collection(db, COLLECTION_NAME), dataToSave);
    },

    /**
     * Eliminar una puerta de la nube
     */
    deleteDoor: async (doorId) => {
        if (!db) throw new Error("Firebase no configurado");
        return await deleteDoc(doc(db, COLLECTION_NAME, doorId));
    },

    /**
     * Actualizar una puerta existente
     */
    updateDoor: async (doorId, data) => {
        if (!db) throw new Error("Firebase no configurado");
        const doorRef = doc(db, COLLECTION_NAME, doorId);
        return await updateDoc(doorRef, data);
    },

    /**
     * LOGS DE ACCESO
     */
    addAccessLog: async (logData) => {
        if (!db) return;
        // Agregamos timestamp de servidor
        return await addDoc(collection(db, LOGS_COLLECTION), {
            ...logData,
            timestamp: new Date()
        });
    },

    getLogsForDoor: async (doorId, limitCount = 20) => {
        if (!db) return [];
        try {
            // NOTA: Quitamos orderBy('timestamp') para evitar requerir un índice compuesto manual en Firestore.
            // Ordenamos en el cliente (arrays pequeños).
            const q = query(
                collection(db, LOGS_COLLECTION),
                where('doorId', '==', doorId),
                limit(limitCount)
            );
            const querySnapshot = await getDocs(q);
            const logs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Ordenar en cliente: más reciente primero es MAYOR timestamp
            return logs.sort((a, b) => {
                const tA = a.timestamp?.seconds || 0;
                const tB = b.timestamp?.seconds || 0;
                // si es Date object (timestamp local antes de sync)
                if (a.timestamp instanceof Date) return b.timestamp - a.timestamp;
                return tB - tA;
            });

        } catch (e) {
            console.error("Error fetching logs:", e);
            return [];
        }
    },

    // --- AUTH ---
    auth: auth, // Exponemos objeto auth para onAuthStateChanged

    loginWithGoogle: async () => {
        if (!auth) throw new Error("Auth no configurado");
        return await signInWithPopup(auth, googleProvider);
    },

    registerWithEmail: async (email, password) => {
        if (!auth) throw new Error("Auth no configurado");
        return await createUserWithEmailAndPassword(auth, email, password);
    },

    loginWithEmail: async (email, password) => {
        if (!auth) throw new Error("Auth no configurado");
        return await signInWithEmailAndPassword(auth, email, password);
    },

    resetPassword: async (email) => {
        if (!auth) throw new Error("Auth no configurado");
        return await sendPasswordResetEmail(auth, email);
    },

    updateUserProfile: async (user, profileData) => {
        if (!auth) throw new Error("Auth no configurado");
        return await updateProfile(user, profileData);
    },

    sendUserVerification: async (user) => {
        if (!auth) throw new Error("Auth no configurado");
        return await sendEmailVerification(user);
    },

    reauthenticate: async (user, password) => {
        if (!auth) throw new Error("Auth no configurado");
        const credential = EmailAuthProvider.credential(user.email, password);
        return await reauthenticateWithCredential(user, credential);
    },

    updateUserPassword: async (user, newPassword) => {
        if (!auth) throw new Error("Auth no configurado");
        return await updatePassword(user, newPassword);
    },

    logout: async () => {
        if (!auth) throw new Error("Auth no configurado");
        return await signOut(auth);
    }
};
