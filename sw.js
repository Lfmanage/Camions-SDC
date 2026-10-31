/* Camions SDC — service worker (hors ligne). Changer VERSION à chaque mise à jour.
   Mise à jour automatique : la page est toujours redemandée au serveur, le nouveau service worker
   s'active tout de suite (skipWaiting + clients.claim) et l'appli se recharge seule. Rien à réinstaller. */
const VERSION = 'camions-sdc-v49';
const FICHIERS = [
  './',
  'index.html',
  'barlow-regular.woff?v=49',
  'barlow-medium.woff?v=49',
  'barlow-semibold.woff?v=49',
  'barlow-bold.woff?v=49',
  'barlowcondensed-semibold.woff?v=49',
  'barlowcondensed-bold.woff?v=49',
  'style.css?v=49',
  'plan.js?v=49',
  'sync.js?v=49',
  'app.js?v=49',
  'manifest.webmanifest?v=49',
  'icon-192.png?v=49',
  'icon-512.png?v=49',
  'icon-maskable-512.png?v=49',
  'apple-touch-icon.png?v=49',
  'favicon-32.png?v=49',
  'camion.jpg?v=49',
  'bois.jpg?v=49',
  'logo-clair.png?v=49',
  'logo-sombre.png?v=49',
  'foret-clair.jpg?v=49',
  'foret-sombre.jpg?v=49',
  'feuilles.png?v=49',
  'bois-colis.jpg?v=49'
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
