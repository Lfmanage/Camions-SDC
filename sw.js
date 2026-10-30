/* Camions SDC — service worker (hors ligne). Changer VERSION à chaque mise à jour.
   Mise à jour automatique : la page est toujours redemandée au serveur, le nouveau service worker
   s'active tout de suite (skipWaiting + clients.claim) et l'appli se recharge seule. Rien à réinstaller. */
const VERSION = 'camions-sdc-v40';
const FICHIERS = [
  './',
  'index.html',
  'style.css?v=40',
  'plan.js?v=40',
  'sync.js?v=40',
  'app.js?v=40',
  'manifest.webmanifest?v=40',
  'icon-192.png?v=40',
  'icon-512.png?v=40',
  'icon-maskable-512.png?v=40',
  'apple-touch-icon.png?v=40',
  'favicon-32.png?v=40',
  'camion.jpg?v=40',
  'bois.jpg?v=40',
  'logo-clair.png?v=40',
  'logo-sombre.png?v=40',
  'foret-clair.jpg?v=40',
  'foret-sombre.jpg?v=40',
  'feuilles.png?v=40',
  'bois-colis.jpg?v=40'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== VERSION && k !== VERSION + '-ext').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages : réseau d'abord (mises à jour rapides), cache si hors ligne
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((r) => { const copie = r.clone(); caches.open(VERSION).then((c) => c.put('index.html', copie)); return r; })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Fichiers de l'appli : cache d'abord
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((rep) => {
      if (rep.ok) { const copie = rep.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); }
      return rep;
    })));
    return;
  }

  // Polices Google et bibliothèque Supabase : cache puis mise à jour
  if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.host)) {
    e.respondWith(caches.open(VERSION + '-ext').then((c) => c.match(req).then((r) => {
      const reseau = fetch(req).then((rep) => { if (rep.ok || rep.type === 'opaque') c.put(req, rep.clone()); return rep; }).catch(() => r);
      return r || reseau;
    })));
  }
  // Le reste (API Supabase) passe directement par le réseau
});
