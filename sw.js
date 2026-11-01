/* Camions SDC — service worker (hors ligne). Changer VERSION à chaque mise à jour.
   Mise à jour automatique : la page est toujours redemandée au serveur, le nouveau service worker
   s'active tout de suite (skipWaiting + clients.claim) et l'appli se recharge seule. Rien à réinstaller. */
const VERSION = 'camions-sdc-v78';
const FICHIERS = [
  './',
  'index.html',
  'barlow-regular.woff?v=78',
  'barlow-medium.woff?v=78',
  'barlow-semibold.woff?v=78',
  'barlow-bold.woff?v=78',
  'barlowcondensed-semibold.woff?v=78',
  'barlowcondensed-bold.woff?v=78',
  'style.css?v=78',
  'plan.js?v=78',
  'qr.js?v=78',
  'vue3d.js?v=78',
  'sync.js?v=78',
  'app.js?v=78',
  'manifest.webmanifest?v=78',
  'icon-192.png?v=78',
  'icon-512.png?v=78',
  'icon-maskable-512.png?v=78',
  'apple-touch-icon.png?v=78',
  'favicon-32.png?v=78',
  'logo-clair.png?v=78',
  'logo-sombre.png?v=78',
  'mini-1.jpg?v=78',
  'mini-2.jpg?v=78',
  'mini-3.jpg?v=78',
  'mini-4.jpg?v=78',
  'mini-5.jpg?v=78',
  'mini-6.jpg?v=78',
  'mini-7.jpg?v=78',
  'mini-8.jpg?v=78',
  'mini-9.jpg?v=78',
  'ambiance.js?v=78',
  'feuilles.png?v=78'
];

self.addEventListener('install', (e) => {
  // chaque fichier séparément : un seul fichier manquant ne doit jamais bloquer la mise à jour
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(FICHIERS.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== VERSION && k !== VERSION + '-ext' && k.indexOf('csdc-fonds') !== 0).map((k) => caches.delete(k))))
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

  // Fonds d'écran en haute qualité : chargés une seule fois, gardés même après les mises à jour
  if (url.origin === location.origin && /\/fond-\d+\.jpg$/.test(url.pathname)) {
    e.respondWith(caches.open('csdc-fonds-int').then((c) => c.match(req, { ignoreSearch: true }).then((r) => r || fetch(req).then((rep) => {
      if (rep.ok) c.put(req, rep.clone());
      return rep;
    }))));
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
