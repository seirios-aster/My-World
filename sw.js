/* Tambayan service worker: keeps the app installable and lets it open its shell on a bad connection.
   The page is always checked with the server first (not the browser's own copy), so a new version reaches everyone as soon as it is deployed. Other sites (Supabase, CDNs) are never touched. */
const CACHE = 'tambayan-shell-2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/models/')) return;
  e.respondWith(fetch(r, { cache: 'no-cache' }).then(res => {   // no-cache: always ask the server whether the file changed (GitHub Pages lets browsers keep a page for 10 minutes, which hid new versions)
    if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(r, c)); }
    return res;
  }).catch(() => caches.match(r).then(m => m || caches.match('./'))));
});
