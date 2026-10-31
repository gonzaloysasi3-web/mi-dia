const CACHE = 'midia-v18';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'sync.js', 'dates.js', 'quick.js', 'firebase-config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' evita que la copia nueva se rellene con archivos viejos de la caché del navegador.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Misma origen: sirve la copia guardada al instante y la actualiza en segundo plano.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })
  );
});

// Al tocar un aviso, abre la app (o la trae al frente).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(e.notification.data?.url || './?v=hoy');
  }));
});

// Avisos enviados por el servidor (GitHub Actions + Firebase Cloud Messaging) con la app cerrada.
self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch {}
  const n = p.notification || p.data || {};
  e.waitUntil(self.registration.showNotification(n.title || 'Séneca', {
    body: n.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: n.tag || undefined,
    data: { url: n.url || './?v=hoy' },
  }));
});
