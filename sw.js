// Brain service worker. Preserve network-first app updates and offline use.
const C='brain-v2-memory-1', ROOT=new URL(self.registration.scope);
const ASSETS=['./','./index.html','./manifest.json','./icon-180.png','./icon-192.png','./icon-512.png',
  './memory.html','./brain-vault.js','./memory.js','./memory.css'];
const paths=new Set(ASSETS.map(p=>new URL(p,ROOT).pathname));
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys()
  .then(ks=>Promise.all(ks.filter(k=>k.startsWith('brain-v2-')&&k!==C).map(k=>caches.delete(k))))
  .then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==ROOT.origin||!paths.has(u.pathname))return;
  const cacheKey=u.pathname===ROOT.pathname?new URL('./index.html',ROOT):new URL(u.pathname,ROOT);
  const doc=r.mode==='navigate'||u.pathname.endsWith('/index.html')||u.pathname.endsWith('/memory.html');
  e.respondWith((async()=>{
    const c=await caches.open(C);
    if(!doc){const saved=await c.match(cacheKey);if(saved)return saved}
    try{
      const res=await fetch(r);
      if(res.ok){await c.put(cacheKey,res.clone()).catch(()=>{});return res}
      return await c.match(cacheKey)||res;
    }catch(err){const saved=await c.match(cacheKey);if(saved)return saved;throw err}
  })());
});
