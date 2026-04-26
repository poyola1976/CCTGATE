// CCTGATE Service Worker v1.0
const CACHE_NAME = 'cctgate-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/icon-192.png',
    '/icon-512.png',
    '/manifest.json'
];

// Instalación: cachear archivos estáticos
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando CCTGATE Service Worker...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activación: limpiar caches antiguas
self.addEventListener('activate', (event) => {
    console.log('[SW] Service Worker activado.');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: Network-first strategy (siempre intenta la red, si falla usa caché)
self.addEventListener('fetch', (event) => {
    // No cachear peticiones a Firebase, Mercado Pago, o APIs externas
    if (
        event.request.url.includes('firebaseio.com') ||
        event.request.url.includes('googleapis.com') ||
        event.request.url.includes('mercadopago.com') ||
        event.request.url.includes('shelly.cloud') ||
        event.request.method !== 'GET'
    ) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clonar y guardar en caché
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // Si falla la red, buscar en caché
                return caches.match(event.request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Si no hay caché, mostrar página offline
                    if (event.request.mode === 'navigate') {
                        return caches.match('/index.html');
                    }
                });
            })
    );
});
