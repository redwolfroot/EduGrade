// EduGrade Service Worker
const CACHE_NAME = 'edugrade-v23';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        ).then(() => clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    // Only handle GET requests; let everything else pass through
    if (event.request.method !== 'GET') return;

    // Never proxy cross-origin requests (CDN scripts/styles/fonts). A fetch()
    // made from inside the worker is governed by the CSP of the worker script
    // (connect-src 'self'), not by the page's CSP, so the CDN would get blocked
    // whenever a page is SW-controlled; a hard reload (which bypasses the SW)
    // then "fixes" it until the next normal reload. Returning without
    // respondWith() lets the browser fetch it natively under the page's CSP.
    if (new URL(event.request.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request).catch(async () => {
            const cached = await caches.match(event.request);
            return cached || Response.error();
        })
    );
});
