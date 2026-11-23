/* Brain memory vault. No network; authenticated, passphrase-derived local encryption. */
(() => {
  'use strict';
  const FORMAT='brain-memory-backup', SEED='brain-memory-seed', SLOT='brain.localMemory.v1';
  const ITER=600000, MAX=2_000_000, MAX_RECORDS=1500, enc=new TextEncoder();
  const dec=new TextDecoder('utf-8',{fatal:true});
  const fail=message=>{throw new Error(message)};
  const text=(x,max,min=0)=>typeof x==='string'&&x.length>=min&&x.length<=max;
  const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
  function strict(x,allowed){return obj(x)&&Object.keys(x).every(k=>allowed.includes(k))}
  function b64(raw){let s='';for(let i=0;i<raw.length;i+=8192)s+=String.fromCharCode(...raw.subarray(i,i+8192));return btoa(s)}
  function un64(str,max){
    if(!text(str,max)||(str.length%4!==0||/[^A-Za-z0-9+/=]/.test(str)||!/^[^=]*={0,2}$/.test(str)))fail('Invalid encrypted data');
    return Uint8Array.from(atob(str),c=>c.charCodeAt(0));
  }
  function source(s){
    if(!strict(s,['label','url'])||!text(s.label,250,1)||!s.label.trim()||/[\r\n]/.test(s.label))fail('Every source needs a label (up to 250 characters)');
    const label=s.label.trim();
    if(s.url===undefined||s.url==='')return {label};
    if(!text(s.url,2048,1))fail('Invalid source link');
    const u=new URL(s.url);
    if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail('Use an HTTP(S) link without credentials');
    return {label,url:u.href};
  }
  function fields(x){
    if(!obj(x)||!text(x.title,250,1)||!x.title.trim()||!text(x.body,20000,1)||!x.body.trim())fail('Add a title and body within the size limits');
    const s=x.sources===undefined?[]:x.sources;
    if(!Array.isArray(s)||s.length>20)fail('Use at most 20 source references');
    const normalized=s.map(source);
    const sources=[...new Map(normalized.map(v=>[JSON.stringify(v),v])).values()];
    return {title:x.title.trim(),body:x.body.trim(),sources};
  }
  function stamp(v){if(!text(v,30,24)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)fail('Invalid time in backup');return v}
  function record(x){
    if(!strict(x,['id','created','updated','title','body','sources','history'])||!text(x.id,36,36)||!/^[-0-9a-f]{36}$/.test(x.id)||!Array.isArray(x.history)||x.history.length>1000)fail('Invalid record in backup');
    const created=stamp(x.created),updated=stamp(x.updated);
    const history=x.history.map(h=>{
      if(!strict(h,['at','title','body','sources']))fail('Invalid correction history');
      return {at:stamp(h.at),...fields(h)};
    });
    return {id:x.id,created,updated,...fields(x),history};
  }
  function records(xs){
    if(!Array.isArray(xs)||xs.length>MAX_RECORDS)fail('Too many records');
    const next=xs.map(record);
    if(new Set(next.map(x=>x.id)).size!==next.length)fail('Duplicate record IDs in backup');
    return next;
  }
  function parseSeed(raw){
    if(!text(raw,MAX,1))fail('Seed is empty or larger than 2 MB');
    const x=JSON.parse(raw);
    if(!strict(x,['format','version','records'])||x.format!==SEED||x.version!==1||!Array.isArray(x.records)||x.records.length>MAX_RECORDS)fail('Not a supported Brain memory seed');
    return x.records.map(r=>{if(!strict(r,['title','body','sources']))fail('Invalid seed record');return fields(r)});
  }
  const signature=x=>JSON.stringify([x.title,x.body,x.sources.map(s=>JSON.stringify(s)).sort()]);
  function seedPlan(current,input){
    const seen=new Set(current.flatMap(r=>[signature(r),...r.history.map(signature)]));const unique=[];
    for(const r of input){const id=signature(r);if(!seen.has(id)){seen.add(id);unique.push(r)}}
    return {unique,skipped:input.length-unique.length};
  }
  function restorePlan(current,input){
    const existing=new Map(current.map(r=>[r.id,JSON.stringify(record(r))]));
    const unique=[];let skipped=0,conflicts=0;
    for(const r of input){
      if(!existing.has(r.id))unique.push(r);
      else if(existing.get(r.id)===JSON.stringify(record(r)))skipped++;
      else conflicts++;
    }
    return {unique,skipped,conflicts};
  }
  function search(xs,query){
    const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return xs.filter(r=>{const hay=[r.title,r.body,...r.sources.flatMap(s=>[s.label,s.url||''])].join('\n').toLowerCase();return words.every(w=>hay.includes(w))})
      .sort((a,b)=>b.updated.localeCompare(a.updated));
  }
  const rng=n=>crypto.getRandomValues(new Uint8Array(n));
  async function key(pass,salt){
    if(typeof pass!=='string'||pass.length<12||pass.length>1024)fail('Use a passphrase at least 12 characters long');
    const material=await crypto.subtle.importKey('raw',enc.encode(pass),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITER,hash:'SHA-256'},material,
      {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  const aad=salt=>enc.encode(JSON.stringify([FORMAT,1,ITER,b64(salt)]));
  async function seal(xs,k,salt){
    xs=records(xs);
    const raw=enc.encode(JSON.stringify(xs));
    if(raw.length>MAX)fail('Vault too large. No changes saved.');
    const iv=rng(12),ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(salt)},k,raw));
    return JSON.stringify({format:FORMAT,version:1,kdf:'PBKDF2-SHA256',iterations:ITER,salt:b64(salt),iv:b64(iv),ct:b64(ct)});
  }
  function envelope(raw){
    if(!text(raw,3_000_000,1))fail('Invalid backup size');
    const x=JSON.parse(raw);
    if(!strict(x,['format','version','kdf','iterations','salt','iv','ct'])||x.format!==FORMAT||x.version!==1||x.kdf!=='PBKDF2-SHA256'||x.iterations!==ITER)fail('Unsupported backup');
    const salt=un64(x.salt,24),iv=un64(x.iv,16),ct=un64(x.ct,2_666_692);
    if(salt.length!==16||iv.length!==12||ct.length<16||ct.length>MAX+16)fail('Invalid encrypted data');
    return {salt,iv,ct};
  }
  async function reveal(e,k){
    let bytes;
    try{bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:e.iv,additionalData:aad(e.salt)},k,e.ct)}
    catch{fail('Wrong passphrase or altered encrypted data. Nothing changed.')}
    return records(JSON.parse(dec.decode(bytes)));
  }
  async function open(raw,pass){const e=envelope(raw),k=await key(pass,e.salt);return {items:await reveal(e,k),k,salt:e.salt}}
  async function start(raw,pass){
    if(raw!==null)return open(raw,pass);
    const salt=rng(16),k=await key(pass,salt);
    return {items:[],k,salt};
  }
  function entry(draft,prior,now=new Date().toISOString()){
    const f=fields(draft);
    if(!prior)return {id:crypto.randomUUID(),created:now,updated:now,...f,history:[]};
    if(signature(f)===signature(prior))return prior;
    return {...prior,...f,updated:now,history:[...prior.history,{at:prior.updated,...fields(prior)}]};
  }
  globalThis.BrainVault=Object.freeze({SLOT,parseSeed,seedPlan,restorePlan,search,start,open,seal,entry});
})();
