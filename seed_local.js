import admin from 'firebase-admin';

// CONFIGURACIÓN PARA EMULADORES LOCALES
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8180';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9199';

admin.initializeApp({
    projectId: 'api-gate-af1a9'
});

const db = admin.firestore();
const auth = admin.auth();

async function seed() {
    console.log('🌱 Sembrando datos locales...');

    try {
        // 1. Crear Usuario Admin
        const userEmail = 'jose@cobe.cl';
        const userPassword = 'password123';
        const uid = 'admin001';

        try {
            await auth.createUser({
                uid: uid,
                email: userEmail,
                password: userPassword,
                displayName: 'Jose Admin'
            });
            console.log(`✅ Usuario creado localmente: ${userEmail} (Contraseña: ${userPassword})`);
        } catch (e) {
            console.log('ℹ️ El usuario ya existe o hubo un aviso menor.');
        }

        // 2. Perfil de Usuario en Firestore
        await db.collection('users').doc(uid).set({
            email: userEmail,
            role: 'admin',
            uid: uid
        });

        // 3. Sembrar Puertas (Configuración Real)
        const doors = [
            {
                name: 'Entrada 39',
                deviceId: '5443B2384784',
                authKey: 'MzVlNmQxdWlk29D528F2A3F7CCF08F4EF2658CE6EB3D5963BA9EED02B7873D7DA23D8112F8FA8AC4DDFBA88CC209C72C',
                serverUrl: 'https://shelly-76-eu.shelly.cloud',
                allowedEmails: ['jose@cobe.cl'],
                status: { online: true }
            },
            {
                name: 'Porton',
                deviceId: '34987A46A974',
                authKey: 'YTM4OGI1dWlkC00FC25166299D63851080E4631CE49195F4D3507D9A6B29583163359EFEBA30D046EEAA136696C7A701050F',
                serverUrl: 'https://shelly-76-eu.shelly.cloud',
                allowedEmails: ['jose@cobe.cl'],
                status: { online: true }
            },
            {
                name: 'Caldera Goleta 206',
                deviceId: 'E8DB84A045C8',
                authKey: 'ZThkYjg0dWlk8A428751B838634BBD6231F3AA940B042C79919E5FF00BD43058CA19329C1F8308D046EA10D501AF5702FF03',
                serverUrl: 'https://shelly-76-eu.shelly.cloud',
                allowedEmails: ['jose@cobe.cl'],
                status: { online: true }
            },
            {
                name: 'Shelly mini 1 gen 4',
                deviceId: '84fce6305a20',
                authKey: 'ODRlYmYwaWRmOTR2C1D2A08BA6C19F60058F3D1C8C06C782FB22E461A5288B11B2AAEEB3D3F192E693BCC11379D4088022E5',
                serverUrl: 'https://shelly-133-eu.shelly.cloud',
                allowedEmails: ['jose@cobe.cl'],
                status: { online: true }
            }
        ];

        for (const door of doors) {
            const snap = await db.collection('doors').where('deviceId', '==', door.deviceId).get();
            if (snap.empty) {
                await db.collection('doors').add(door);
                console.log(`✅ Puerta sembrada: ${door.name}`);
            }
        }

        // 4. Configuración de Precios
        await db.collection('config').doc('pricing').set({
            semestral: 8000,
            anual: 10000
        });

        console.log('✨ SIEMBRA LOCAL COMPLETADA ✨');
        console.log('Usuario: jose@cobe.cl');
        console.log('Clave: password123');

    } catch (err) {
        console.error('❌ Error fatal en siembra:', err);
    }
}

seed();
