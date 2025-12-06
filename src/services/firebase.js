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
    orderBy
} from 'firebase/firestore';

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
try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (e) {
    console.warn("⚠️ Firebase no configurado correctamente. Edita src/services/firebase.js", e);
}

const COLLECTION_NAME = 'doors';

export const FirebaseService = {
    /**
     * Suscribirse a cambios en tiempo real (Sync)
     * @param {function} callback - Función que recibe el array de puertas actualizado
     * @returns {function} Unsubscribe function
     */
    subscribeToDoors: (callback) => {
        if (!db) return () => { };

        const q = query(collection(db, COLLECTION_NAME), orderBy('name'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const doors = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            callback(doors);
        }, (error) => {
            console.error("Error syncing doors:", error);
            // Fallback silencioso o notificación
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
    }
};
