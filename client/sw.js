/**
 * Service Worker — PaperPhone PWA
 * Cache-first for shell assets, network-first for API
 * + Web Push notification handler
 */
const CACHE = 'paperphone-v5';
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

// ── Pending call data (stored in SW scope for client retrieval) ───────────
let _pendingCallData = null;

// ── Notification Click Handler ───────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  const data = e.notification.data || {};
  const action = e.action;

  // Decline action — notify all clients to dismiss the call
  if (action === 'decline') {
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

  // Accept action or body click — show ringing UI
  // Store the call data so newly opened windows can retrieve it
  if (data.type === 'incoming_call') {
    _pendingCallData = {
      from: data.from,
      call_id: data.call_id,
      is_video: data.is_video,
      ts: Date.now(),
    };
  }

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // If a PaperPhone window is already open, post message and focus it
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
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
      // No existing window — open a new one with call data in query params
      if (data.type === 'incoming_call') {
        const params = new URLSearchParams({
          pp_call_from: data.from || '',
          pp_call_id: data.call_id || '',
          pp_is_video: data.is_video ? '1' : '0',
        });
        return clients.openWindow('/?' + params.toString());
      }
      return clients.openWindow('/');
    })
  );
});

// ── Handle messages from client pages ────────────────────────────────────
self.addEventListener('message', e => {
  // Client requests pending call data (e.g. after fresh page load)
  if (e.data && e.data.type === 'get_pending_call') {
    if (_pendingCallData && (Date.now() - _pendingCallData.ts) < 60000) {
      e.source.postMessage({
        type: 'incoming_call_clicked',
        ..._pendingCallData,
      });
      _pendingCallData = null; // consumed
    }
  }
});
