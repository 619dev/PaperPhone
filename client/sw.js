/**
 * Service Worker — PaperPhone PWA
 * Cache-first for shell assets, network-first for API
 * + Web Push notification handler
 */
const CACHE = 'paperphone-v4';
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

// ── Web Push Handler ─────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;

  let payload;
  try { payload = e.data.json(); } catch { return; }

  const title = payload.title || 'PaperPhone';
  const options = {
    body: payload.body || '',
    icon: '/public/icons/icon-192.png',
    badge: '/public/icons/icon-192.png',
    tag: payload.type || 'default',
    renotify: true,
    data: payload.data || {},
    vibrate: [100, 50, 100],
    actions: [],
  };

  // Collapse multiple unread messages by tag
  if (payload.type === 'message') {
    options.tag = `msg-${payload.data?.from || 'unknown'}`;
  }

  // Incoming call — high-priority notification with actions
  if (payload.type === 'incoming_call') {
    options.tag = `call-${payload.data?.call_id || 'unknown'}`;
    options.requireInteraction = true;  // keep visible until user interacts
    options.vibrate = [300, 100, 300, 100, 300];  // longer vibration pattern
    options.actions = [
      { action: 'accept', title: '📞 Accept' },
      { action: 'decline', title: '❌ Decline' },
    ];
  }

  e.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification Click Handler ───────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  const data = e.notification.data || {};
  const action = e.action;

  // Decline action — just close the notification, do nothing else
  if (action === 'decline') {
    // Optionally notify the client to dismiss the call
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
        for (const client of windowClients) {
          if (client.url.includes(self.location.origin)) {
            client.postMessage({ type: 'incoming_call_declined', call_id: data.call_id });
          }
        }
      })
    );
    return;
  }

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // If a PaperPhone window is already open, focus it
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Notify the client about the incoming call click
          if (data.type === 'incoming_call') {
            client.postMessage({
              type: 'incoming_call_clicked',
              from: data.from,
              call_id: data.call_id,
              is_video: data.is_video,
            });
          }
          return client.focus();
        }
      }
      // Otherwise, open a new window with call data in URL hash
      if (data.type === 'incoming_call') {
        const params = new URLSearchParams({
          call_from: data.from || '',
          call_id: data.call_id || '',
          is_video: data.is_video ? '1' : '0',
        });
        return clients.openWindow('/#incoming_call?' + params.toString());
      }
      return clients.openWindow('/');
    })
  );
});
