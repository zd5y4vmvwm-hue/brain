/* Browser UI. Only encrypted envelopes are written to local storage. */
(() => {
'use strict';
const V=globalThis.BrainVault, $=id=>document.getElementById(id);
const MAX_SEED=2_000_000, MAX_BACKUP=3_000_000;
let active=null, previous=null, editId=null, seed=null, restore=null, busy=false, generation=0;
const status=(msg,err=false)=>{$('state').textContent=msg;$('state').classList.toggle('error',err)};
const current=()=>localStorage.getItem(V.SLOT);
const message=e=>e instanceof SyntaxError?'Invalid JSON. Nothing changed.':(e.message||'Could not finish. Nothing changed.');
function reset(){$('edit').reset();editId=null;$('form-title').textContent='Capture';$('cancel').hidden=true}
function resetImport() {
  seed=restore=null;
  $('seed-file').value='';$('restore').reset();
  for (const kind of ['seed','restore']){$(kind+'-plan').textContent='';$(kind==='seed'?'seed-import':'restore-apply').hidden=true}
}
function formState(){
  const fresh=current()===null;
  $('confirm-wrap').hidden=!fresh;$('confirm-pass').required=fresh;
  $('unlock-button').textContent=fresh?'Create encrypted vault':'Unlock';
}
function close(msg='Vault locked.'){
  ++generation;active=null;previous=null;reset();resetImport();
  $('unlock').reset();$('query').value='';$('results').replaceChildren();
  $('vault').hidden=true;$('locked').hidden=false;
  try{formState()}catch{status('Browser storage is unavailable.',true);return}
  status(msg);
}
function withBusy(fn){return async ev=>{
  ev.preventDefault();
  if(busy)return;
  busy=true;const action=ev.submitter||ev.currentTarget, g=generation;
  if(action instanceof HTMLButtonElement)action.disabled=true;
  try{await fn(g)}catch(e){if(g===generation)status(message(e),true)}
  finally{busy=false;if(action instanceof HTMLButtonElement)action.disabled=false}
}}
function checked(g){if(g!==generation)throw new Error('Vault locked. Nothing changed.')}
async function commit(items,g) {
  const a=active, base=previous;
  if(!a)throw new Error('Vault is locked.');
  const raw=await V.seal(items,a.k,a.salt);
  const write=()=>{
    checked(g);
    if(current()!==base)throw new Error('Vault changed in another tab. Lock and unlock before retrying.');
    localStorage.setItem(V.SLOT,raw);
    previous=raw;
  };
  if(navigator.locks)await navigator.locks.request(V.SLOT,write);
  else throw new Error('This browser does not support safe vault writes. Use a current browser.');
  checked(g);
  active.items=items;
}
function html(tag,t){const el=document.createElement(tag);if(t!==undefined)el.textContent=t;return el}
function listSources(s){
  const ul=html('ul');
  for(const x of s){const li=html('li');if(x.url){const a=html('a',x.label);a.href=x.url;a.target='_blank';a.rel='noopener noreferrer';li.append(a)}else li.textContent=x.label;ul.append(li)}
  return ul;
}
function draw(){
  if(!active)return;
  const matches=V.search(active.items,$('query').value);
  const cap=100, root=$('results');root.replaceChildren(html('p',matches.length>cap?'Showing '+cap+' of '+matches.length+' results. Search to narrow them.':matches.length+' records'));
  for(const r of matches.slice(0,cap)){
    const card=html('article'), button=html('button','Edit');button.type='button';
    button.addEventListener('click',()=>{
      editId=r.id;$('title').value=r.title;$('body').value=r.body;
      $('sources').value=r.sources.map(s=>s.label+' | '+(s.url||'')).join('\n');
      $('form-title').textContent='Edit memory';$('cancel').hidden=false;$('title').focus();
    });
    card.append(html('h3',r.title),html('p',r.body),listSources(r.sources),button);
    if(r.history.length){
      const d=html('details');d.append(html('summary',r.history.length+' previous versions'));
      d.addEventListener('toggle',()=>{if(d.open&&d.children.length===1)for(const h of r.history.slice().reverse())d.append(html('h4',h.title),html('time',h.at),html('p',h.body),listSources(h.sources))});
      card.append(d);
    }
    root.append(card);
  }
}
async function readFile(id,max){
  const f=$(id).files?.[0];if(!f)throw new Error('Select a file first.');
  if(!f.size||f.size>max)throw new Error('File is empty or exceeds the size limit.');
  return f.text();
}
$('unlock').addEventListener('submit',withBusy(async g=>{
  const raw=current();let pass=$('pass').value;
  const confirmed=$('confirm-pass').value;
  $('unlock').reset();
  if(raw===null&&pass!==confirmed)throw new Error('Passphrases do not match.');
  const a=await V.start(raw,pass);pass='';
  checked(g);
  if(raw!==current())throw new Error('Vault changed in another tab. Retry.');
  active=a;previous=raw;
  if(raw===null){
    try{await commit([],g)}catch(e){active=null;previous=null;formState();throw e}
  }
  checked(g);$('locked').hidden=true;$('vault').hidden=false;
  draw();status('Vault unlocked.');$('title').focus();
}));
$('lock').addEventListener('click',()=>close());
$('cancel').addEventListener('click',reset);
$('query').addEventListener('input',draw);
$('edit').addEventListener('submit',withBusy(async g=>{
  if(!active)return;
  const prior=active.items.find(x=>x.id===editId);
  const sources=$('sources').value.split(/\r?\n/).filter(x=>x.trim()).map(line=>{
    const i=line.lastIndexOf(' | ');
    return i<0?{label:line.trim()}:{label:line.slice(0,i).trim(),url:line.slice(i+3).trim()};
  });
  const r=V.entry({title:$('title').value,body:$('body').value,sources},prior);
  if(r!==prior)await commit(prior?active.items.map(x=>x.id===r.id?r:x):[...active.items,r],g);
  reset();draw();status(r===prior?'No changes.':'Saved encrypted.');
}));
$('backup').addEventListener('click',withBusy(async g=>{
  if(!active||!previous)return;
  checked(g);if(current()!==previous)throw new Error('Vault changed in another tab. Lock and unlock before exporting.');
  const blob=new Blob([previous],{type:'application/json'});
  const url=URL.createObjectURL(blob), a=html('a');a.href=url;
  a.download='brain-memory-'+new Date().toISOString().slice(0,10)+'.encrypted.json';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  status('Encrypted backup download started. Keep its passphrase separately.');
}));
$('seed-file').addEventListener('change',()=>{seed=null;$('seed-import').hidden=true;$('seed-plan').textContent=''});
$('backup-file').addEventListener('change',()=>{restore=null;$('restore-apply').hidden=true;$('restore-plan').textContent=''});
$('seed-preview').addEventListener('click',withBusy(async g=>{
  seed=null;$('seed-import').hidden=true;$('seed-plan').textContent='';
  const file=$('seed-file').files?.[0];
  const input=V.parseSeed(await readFile('seed-file',MAX_SEED));checked(g);
  if(!active||$('seed-file').files?.[0]!==file)return;
  const plan=V.seedPlan(active.items,input);seed={input,file};
  $('seed-plan').textContent=plan.unique.length+' new, '+plan.skipped+' duplicate.';
  $('seed-import').hidden=!plan.unique.length;
}));
$('seed-import').addEventListener('click',withBusy(async g=>{
  if(!active||!seed||$('seed-file').files?.[0]!==seed.file)return;
  const {unique}=V.seedPlan(active.items,seed.input);
  if(unique.length)await commit([...active.items,...unique.map(x=>V.entry(x))],g);
  resetImport();draw();status(unique.length+' records imported and encrypted.');
}));
$('restore').addEventListener('submit',withBusy(async g=>{
  let pass=$('restore-pass').value;$('restore-pass').value='';
  restore=null;$('restore-apply').hidden=true;$('restore-plan').textContent='';
  const file=$('backup-file').files?.[0];
  const data=await V.open(await readFile('backup-file',MAX_BACKUP),pass);pass='';
  checked(g);if(!active||$('backup-file').files?.[0]!==file)return;
  const p=V.restorePlan(active.items,data.items);restore={items:data.items,file};
  $('restore-plan').textContent=p.unique.length+' new, '+p.skipped+' duplicate, '+p.conflicts+' conflicting records skipped.';
  $('restore-apply').hidden=!p.unique.length;
}));
$('restore-apply').addEventListener('click',withBusy(async g=>{
  if(!active||!restore||$('backup-file').files?.[0]!==restore.file)return;
  const p=V.restorePlan(active.items,restore.items);
  if(p.unique.length)await commit([...active.items,...p.unique],g);
  resetImport();draw();status(p.unique.length+' records restored and encrypted. Existing records were kept.');
}));
window.addEventListener('storage',e=>{if((e.key===V.SLOT||e.key===null)&&active)close('Vault changed in another tab. Unlock to see the latest records.')});
window.addEventListener('pagehide',()=>{if(active)close()});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').then(r=>r.update()).catch(()=>{});
if(!window.isSecureContext||!crypto.subtle||!navigator.locks){
  $('unlock-button').disabled=true;status('Use HTTPS in a current browser with Web Crypto and Web Locks.',true);
}else try{formState()}catch{$('unlock-button').disabled=true;status('Browser storage is unavailable.',true)}
})();
