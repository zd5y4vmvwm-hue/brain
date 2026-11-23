// Brain nightly graph build c1014ef97a
const CACHE = 'brain-v2-c1014ef97a-memory1';
const BASE = self.registration.scope;
const ASSETS = ['./','./index.html','./manifest.json','./icon-180.png','./icon-192.png','./icon-512.png','./memory/connect.js','./memory.html','./brain-vault.js'].map(path => new URL(path, BASE).href);
const INDEX = new URL('./index.html', BASE).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('brain-v2-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(BASE)) return;
  const url = new URL(req.url);
  url.search = ''; url.hash = '';
  if (!ASSETS.includes(url.href)) return;
  const graph = url.href === BASE || url.href === INDEX;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(req, {cache:graph ? 'no-cache' : 'default'});
      if (response.ok) await cache.put(graph ? INDEX : url.href, response.clone()).catch(() => {});
      else return (await cache.match(graph ? INDEX : url.href)) || response;
      return response;
    } catch {
      return (await cache.match(graph ? INDEX : url.href)) || Response.error();
    }
  })());
});
