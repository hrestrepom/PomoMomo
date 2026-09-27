/* ==========================================================================
   PomoMomo — Service Worker
   Estrategia: network-first para el código propio (para que las
   actualizaciones lleguen enseguida) con respaldo en caché sin conexión.
   Los recursos de Firebase no se cachean.
   ========================================================================== */

/* Debe cambiar en cada publicación: es lo que invalida la caché anterior
   y dispara el relevo del service worker. */
const VERSION = 'pomomomo-v2.9.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/charts.js',
  './js/config.js',
  './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL).catch(() => { /* algún recurso puede faltar */ }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // No interceptar Firebase ni Google (auth y datos necesitan la red real)
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firebaseapp.com') ||
      url.hostname.includes('gstatic.com') ||
      url.hostname.includes('google.com')) {
    return;
  }

  // Navegación: red primero, caché como respaldo
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Mismo origen: red primero, caché como respaldo.
  // cache:'no-cache' obliga a revalidar contra el servidor. Sin esto la
  // caché HTTP del navegador servía módulos viejos indefinidamente y los
  // arreglos no llegaban aunque el service worker ya estuviera al día.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
