import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const origin='https://brain.example';
const graph=origin+'/brain/', memory=graph+'memory/';

class CacheDouble {
  constructor(online){this.values=new Map();this.online=online;}
  async addAll(assets){for(const url of assets){const res=await this.online({url});this.values.set(url,res.clone());}}
  async put(url,value){this.values.set(url,value);}
  async match(url){return this.values.get(url)?.clone();}
}
async function host(){
  const stores=new Map(), network=new Map(), requests=[];
  let offline=false;
  const api={
    cache:stores,network,requests,
    setOffline(value){offline=value;},
    async fetch(req,options){
      requests.push([req.url,options]);
      if(offline)throw Error('offline');
      const base=req.url.split(/[?#]/)[0];
      const value=network.get(base)??base;
      const response=new Response(value,{status:200});
      Object.defineProperty(response,'type',{value:'basic'});return response;
    },
    async worker(scope,path){
      let claimed=false, skipped=false;const listeners=new Map();
      const self={registration:{scope},skipWaiting(){skipped=true},clients:{claim(){claimed=true}},addEventListener:(event,fn)=>listeners.set(event,fn)};
      const caches={keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name),
        async open(name){if(!stores.has(name))stores.set(name,new CacheDouble(api.fetch));return stores.get(name);}};
      vm.runInNewContext(await fs.readFile(new URL(path,root),'utf8'),{self,caches,fetch:api.fetch,Response,URL});
      function trigger(name,extras){let task;listeners.get(name)({waitUntil:v=>{task=v;},respondWith:v=>{task=v;},...extras});return task;}
      return {install:async()=>{await trigger('install');assert.ok(skipped);},activate:async()=>{await trigger('activate');assert.ok(claimed);},
        request:(url,method='GET',mode='cors')=>trigger('fetch',{request:{url,method,mode}})};
    }
  };
  return api;
}
test('both workers precache their own assets and leave other scopes and caches alone',async()=>{
  const h=await host();h.cache.set('unrelated-app',{});h.cache.set('brain-v2-previous',{});h.cache.set('grok-brain-memory-shell-old',{});
  const a=await h.worker(graph,'sw.js'), b=await h.worker(memory,'memory/sw.js');
  await b.install();await a.install();await a.activate();
  assert.ok(h.cache.has('grok-brain-memory-shell-old'));assert.ok(!h.cache.has('brain-v2-previous'));
  await b.activate();assert.ok(!h.cache.has('grok-brain-memory-shell-old'));assert.ok(h.cache.has('unrelated-app'));
  assert.equal(a.request(memory, 'GET','navigate'),undefined);
  assert.equal(b.request(graph, 'GET','navigate'),undefined);
  assert.equal(b.request(memory+'missing'),undefined);
  assert.equal(b.request(memory+'index.html','POST'),undefined);
  assert.equal(b.request('https://outside.example/brain/memory/'),undefined);
  assert.ok(h.requests.some(([x])=>x===memory+'app.mjs'));assert.ok(h.requests.some(([x])=>x===graph+'memory/connect.js'));
});
test('offline navigations resolve to distinct graph and memory shells, including supported query parameters',async()=>{
  const h=await host();h.network.set(graph,'original graph');h.network.set(graph+'index.html','original graph');
  h.network.set(memory,'encrypted memory UI');h.network.set(memory+'index.html','encrypted memory UI');h.network.set(memory+'app.mjs','current memory code');
  const a=await h.worker(graph,'sw.js'), b=await h.worker(memory,'memory/sw.js');
  await a.install();await b.install();h.setOffline(true);
  assert.equal(await (await a.request(graph+'?open=howto','GET','navigate')).text(),'original graph');
  assert.equal(await (await b.request(memory,'GET','navigate')).text(),'encrypted memory UI');
  assert.equal(await (await b.request(memory+'app.mjs')).text(),'current memory code');
});
test('next online load refreshes both the graph build and memory code for subsequent offline use',async()=>{
  const h=await host();const a=await h.worker(graph,'sw.js'), b=await h.worker(memory,'memory/sw.js');await b.install();await a.install();
  h.network.set(graph,'new nightly ciphertext');h.network.set(memory+'app.mjs','updated memory code');
  assert.equal(await (await a.request(graph,'GET','navigate')).text(),'new nightly ciphertext');
  assert.equal(await (await b.request(memory+'app.mjs')).text(),'updated memory code');
  assert.equal(h.requests.at(-1)[1].cache,'no-cache');
  h.setOffline(true);
  assert.equal(await (await a.request(graph+'index.html','GET','navigate')).text(),'new nightly ciphertext');
  assert.equal(await (await b.request(memory+'app.mjs')).text(),'updated memory code');
});
