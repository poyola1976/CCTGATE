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
    setDoc,
    updateDoc,
    onSnapshot,
    query,
    orderBy,
    where,
    limit,
    getDocs,
    serverTimestamp,
    connectFirestoreEmulator
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
    EmailAuthProvider,
    connectAuthEmulator
} from 'firebase/auth';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';

// --- CONFIGURACIÓN DE FIREBASE (¡REEMPLAZA ESTO!) ---
const firebaseConfig = {
    // Pega aquí tus credenciales de Firebase Console -> Project Settings -> General -> Your apps
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
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
let functions;
const googleProvider = new GoogleAuthProvider();

try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    functions = getFunctions(app);

    // --- CONEXIÓN A EMULADORES (Modo Local) ---
    if (typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        // console.log("🛠️ CONECTANDO A EMULADORES LOCALES...");
        // connectFirestoreEmulator(db, '127.0.0.1', 8180);
        // connectAuthEmulator(auth, 'http://127.0.0.1:9199');
        // connectFunctionsEmulator(functions, '127.0.0.1', 5101);
    }
} catch (e) {
    console.error("🔥 CRITICAL FIREBASE ERROR:", e);
    // Alerting in console isn't enough for the user, but we will catch 'auth' being null later.
    // Explicitly check for missing API Key to give a helpful hint
    if (!firebaseConfig.apiKey) {
        console.error("❌ FALTA API KEY: Verifica tu archivo .env y asegúrate de reiniciar el servidor (VITE_FIREBASE_API_KEY).");
    }
}

const COLLECTION_NAME = 'doors';
const LOGS_COLLECTION = 'access_logs';

export const FirebaseService = {
    auth,
    db,
    functions,
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
     * CÁMARAS CCTV
     */
    subscribeToCameras: (callback) => {
        if (!db) return () => { };
        // Todos descargan todas las cámaras (la seguridad estará en no mostrarlas si no están asignadas)
        // O mejor: si es admin ve todo, si es usuario no necesita ver la lista completa, 
        // solo leerá la cámara asociada a su puerta.
        // Por simplicidad: Sync de todas las cámaras (suelen ser pocas).
        const q = query(collection(db, 'cameras'), orderBy('name'));
        return onSnapshot(q, (snapshot) => {
            const cameras = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            callback(cameras);
        });
    },

    addCamera: async (cameraData) => {
        if (!db) throw new Error("Firebase no configurado");
        return await addDoc(collection(db, 'cameras'), cameraData);
    },

    updateCamera: async (cameraId, data) => {
        if (!db) throw new Error("Firebase no configurado");
        return await updateDoc(doc(db, 'cameras', cameraId), data);
    },

    deleteCamera: async (cameraId) => {
        if (!db) throw new Error("Firebase no configurado");
        return await deleteDoc(doc(db, 'cameras', cameraId));
    },

    verifyTuyaCamera: async (credentials) => {
        if (!functions) throw new Error("Functions no configurado (Firebase V9)");
        const verifyFn = httpsCallable(functions, 'verifyTuyaCredentials');
        return await verifyFn(credentials); // { data: { success: true, ... } }
    },

    getTuyaHlsUrl: async (credentials) => {
        if (!functions) throw new Error("Functions no configurado");
        const getUrlFn = httpsCallable(functions, 'getTuyaHlsUrl');
        return await getUrlFn(credentials); // { data: { success: true, url: ... } }
    },

    /**
     * LOGS DE ACCESO
     */
    getGlobalPricing: async () => {
        const docRef = doc(db, 'config', 'pricing');
        const snap = await getDocs(query(collection(db, 'config')));
        const res = await getDocs(collection(db, 'config'));
        const pricingDoc = res.docs.find(d => d.id === 'pricing');
        return pricingDoc ? pricingDoc.data() : { semestral: 8000, anual: 10000 };
    },

    subscribeToGlobalPricing: (callback) => {
        if (!db) return () => { };
        return onSnapshot(doc(db, 'config', 'pricing'), (snap) => {
            if (snap.exists()) callback(snap.data());
        });
    },

    updateGlobalPricing: async (pricingData) => {
        if (!db) throw new Error("Firebase no configurado");
        return await setDoc(doc(db, 'config', 'pricing'), pricingData, { merge: true });
    },
    addAccessLog: async (logData) => {
        if (!db) return;
        // Usamos serverTimestamp() de Firestore para garantizar tipo Timestamp correcto
        return await addDoc(collection(db, LOGS_COLLECTION), {
            ...logData,
            timestamp: serverTimestamp()
        });
    },

    /**
     * MERCADO PAGO: Crea preferencia de pago
     */
    createPaymentPreference: async (paymentData) => {
        if (!functions) throw new Error("Functions no configurado");
        const createPrefFn = httpsCallable(functions, 'createPaymentPreference');
        return await createPrefFn(paymentData);
    },

    getLogsForDoor: async (doorId, limitCount = 20) => {
        if (!db) return [];
        try {
            // Añadimos orderBy para obtener siempre los 20 más recientes. 
            // ⚠️ REQUIERE ÍNDICE Compuesto (doorId ASC, timestamp DESC) en la consola de Firebase.
            const q = query(
                collection(db, LOGS_COLLECTION),
                where('doorId', '==', doorId),
                orderBy('timestamp', 'desc'),
                limit(limitCount)
            );
            const querySnapshot = await getDocs(q);
            const logs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Ordenar en cliente: más reciente primero — maneja Firestore Timestamp y Date
            const getSeconds = (ts) => {
                if (!ts) return 0;
                if (ts instanceof Date) return ts.getTime() / 1000;
                return ts.seconds || 0;
            };
            return logs.sort((a, b) => getSeconds(b.timestamp) - getSeconds(a.timestamp));

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

    /** Leer perfil de usuario completo */
    getUserData: async (uid) => {
        if (!db) return null;
        const userRef = doc(db, 'users', uid);
        const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', uid)));
        if (snap.empty) {
            // Reintento por ID directo de documento
            const snap2 = await getDocs(query(collection(db, 'users'), where('__name__', '==', uid)));
            return snap2.empty ? null : snap2.docs[0].data();
        }
        return snap.docs[0].data();
    },

    forceCheckDevice: async (doorId) => {
        if (!functions) throw new Error("Functions no configurado");
        const checkFn = httpsCallable(functions, 'forceCheckDevice');
        return await checkFn({ doorId });
    },

    createPaymentPreference: async (data) => {
        if (!functions) throw new Error("Functions no configurado");
        const createPref = httpsCallable(functions, 'createPaymentPreference');
        return await createPref(data);
    },

    logout: async () => {
        if (!auth) throw new Error("Auth no configurado");
        return await signOut(auth);
    }
};
