/**
 * Service Worker — PaperPhone PWA
 * Cache-first for shell assets, network-first for API
 */
const CACHE = 'paperphone-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/style.css',
  '/src/app.js',
  '/src/api.js',
  '/src/socket.js',
  '/src/pages/login.js',
  '/src/pages/chats.js',
  '/src/pages/chat.js',
  '/src/pages/contacts.js',
  '/src/pages/discover.js',
  '/src/pages/profile.js',
  '/src/crypto/ratchet.js',
  '/src/crypto/keystore.js',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first for API and WebSocket
  if (url.pathname.startsWith('/api/') || url.protocol === 'ws:' || url.protocol === 'wss:') {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'Offline' }), {
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        const r = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, r));
        return res;
      });
    }).catch(() => caches.match('/index.html'))
  );
});
