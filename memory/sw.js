const CACHE = 'grok-brain-memory-shell-v1-20261123c';
const BASE = self.registration.scope;
const SHELL = new URL('./', BASE).href;
const ASSETS = ['./','./index.html','./style.css','./app.mjs','./import-link.js','./compact-import.mjs','./memory-core.mjs','./memory-store.mjs','./graph-picker.mjs','./compat.mjs','../brain-vault.js'].map(path => new URL(path, BASE).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('grok-brain-memory-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.search = ''; url.hash = '';
  if (!ASSETS.includes(url.href)) return;
  const key = req.mode === 'navigate' ? SHELL : url.href;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(req, {cache:'no-cache'});
      if (response.ok && response.type === 'basic') await cache.put(key, response.clone());
      return response;
    } catch {
      const cached = await cache.match(key);
      return cached || Response.error();
    }
  })());
});
