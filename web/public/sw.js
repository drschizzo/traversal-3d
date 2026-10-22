// Service worker : le jeu (contre le bot, à deux sur un écran) fonctionne hors ligne après une première visite.
//   - la page : le réseau d'abord (toujours la dernière version), la copie gardée sinon
//   - les fichiers construits (assets/…, nommés d'après leur contenu) : la copie gardée, sans redemander
//   - le reste (icônes, manifeste, polices) : la copie gardée tout de suite, mise à jour en arrière-plan
//   - les salons en ligne (/room) : jamais gardés
// Changer CACHE efface les copies des versions précédentes.
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = 'traversal-v1';
const FONTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

sw.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(new Request(sw.registration.scope, { cache: 'reload' }))).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => sw.clients.claim()));
});

const keep = async (req, res) => {
  if (res.ok || res.type === 'opaque') (await caches.open(CACHE)).put(req, res.clone());
  return res;
};

async function networkFirst(req) {
  try { return await keep(req, await fetch(req)); }
  catch { return (await caches.match(req)) || (await caches.match(sw.registration.scope)) || Response.error(); }
}
async function cacheFirst(req) {
  return (await caches.match(req)) || keep(req, await fetch(req));
}
async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const fresh = fetch(req).then(res => keep(req, res)).catch(() => cached);
  return cached || fresh;
}

sw.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin && url.pathname.startsWith('/room')) return;
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req));
  if (sameOrigin && url.pathname.includes('/assets/')) return e.respondWith(cacheFirst(req));
  if (sameOrigin || FONTS.includes(url.origin)) return e.respondWith(staleWhileRevalidate(req));
});
