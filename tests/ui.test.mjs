import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {setTimeout as delay} from 'node:timers/promises';
import {transactionDatabase} from './transaction-double.mjs';
const root = new URL('../memory/',import.meta.url);
const html = await fs.readFile(new URL('index.html',root),'utf8');
const importLinkScript=await fs.readFile(new URL('import-link.js',root),'utf8');
const moduleText=new Map(await Promise.all(['app.mjs','memory-core.mjs','memory-store.mjs','compat.mjs','../brain-vault.js','graph-picker.mjs'].map(async name=>[name,await fs.readFile(new URL(name,root),'utf8')])));
const password='Maple-Purple-Window-9071';
const title='Paper compass field note';
const source='Notebook Indigo, sheet 726';
const body='The periwinkle station opens at forty-five past the hour.';
const edit='The periwinkle station opens at quarter past the hour.';

class Element {
  constructor(tag,id='',hidden=false){Object.assign(this,{tag,id,hidden,style:{},dataset:{},parent:null,children:[],value:'',files:[],events:new Map(),attrs:{},text:'',classes:new Set()});}
  get classList(){return {toggle:(k,v)=>v?this.classes.add(k):this.classes.delete(k)};}
  set textContent(s){this.children=[];this.text=String(s??'');}
  get textContent(){return this.text+this.children.map(x=>x.textContent).join(' ');}
  replaceChildren(...nodes){this.text='';this.children=nodes;}
  append(...nodes){for(const node of nodes)node.parent=this;this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(name,fn){if (!this.events.has(name))this.events.set(name,[]);this.events.get(name).push(fn);}
  fire(name,arg={}){for(const fn of this.events.get(name)||[]) fn({preventDefault(){},...arg});}
  click(){this.fire('click');this.onClick?.();}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}
  querySelector(query){if(query==='[data-pick]')return this.children.find(x=>x.dataset.pick);throw Error('Unsupported fixture selector '+query);}
  focus(){}
  reset(){for(const node of this.fields||[]){node.value='';node.files=[];}}
}
function dom(){
  const nodes=new Map(Array.from(html.matchAll(/<(\w+)\b([^>]*?)\bid="([^"]+)"([^>]*)>/g),match=>[match[3],new Element(match[1],match[3],/\bhidden\b/.test(match[2]+match[4]))]));
  for(const [form,fields] of Object.entries({editor:['title','body','source'],unlockForm:['pw'],restore:['file','backupPw'],legacyForm:['legacyPw'],seedForm:['seedFile'],linkForm:['linkPw']})){
    nodes.get(form).fields=fields.map(id=>nodes.get(id));
  }
  const document={body:new Element('body'),getElementById:id=>{assert.ok(nodes.has(id),id);return nodes.get(id);},createTextNode:s=>{const t=new Element('text');t.textContent=s;return t;},createElement:tag=>new Element(tag)};
  return {document,$:document.getElementById};
}
function origin(){return {local:new Map(),db:transactionDatabase(),channels:[],downloads:[],requests:[],messages:[]};}
async function tab(shared,embedded=false,fragment=''){
  const {$,document}=dom(),listeners=new Element('window');
  class Channel {
    constructor(name){this.name=name;shared.channels.push(this);}
    postMessage(data){for (const channel of shared.channels) if(channel!==this&&channel.name===this.name)setImmediate(()=>channel.onmessage?.({data}));}
  }
  class LocalURL extends URL {static createObjectURL(blob){shared.downloads.push(blob);return 'blob:fixture';} static revokeObjectURL(){}}
  const location=new URL('https://test.invalid/brain/memory/'+fragment);
  const scrubbed=[];
  const history={state:null,replaceState(state,_title,address){this.state=state;location.href=new URL(address,location).href;scrubbed.push(location.href);}};
  const realm={document,location,history,navigator:{},addEventListener:(...args)=>listeners.addEventListener(...args),
    dispatchEvent:event=>listeners.fire(event.type,event),Event,CustomEvent,Blob,URL:LocalURL,
    MutationObserver:class {constructor(fn){this.fn=fn;}observe(element){element.watch=this.fn;}disconnect(){}},
    localStorage:{getItem:key=>shared.local.get(key)??null,setItem:(key,value)=>shared.local.set(key,value)},
    indexedDB:shared.db, crypto:globalThis.crypto,TextEncoder,TextDecoder,atob,btoa,BroadcastChannel:Channel,
    setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},confirm:()=>true,
    fetch:(...args)=>{shared.requests.push(args);throw new Error("Unexpected network request");}
  };
  realm.window=realm;
  realm.parent=embedded?{postMessage:(msg,where)=>shared.messages.push([msg,where])}:realm;
  const ctx=vm.createContext(realm);
  vm.runInContext(importLinkScript,ctx,{filename:'import-link.js'});
  const initialHash=location.hash;
  const modules=new Map();
  const resolve=(name,from)=>modules.get(new URL(name,from.identifier).href);
  async function importModule(name,from){
    const mod=resolve(name,from);
    if(mod.status==='unlinked')await mod.link(resolve);
    if(mod.status==='linked')await mod.evaluate();
    return mod;
  }
  for(const [name,text] of moduleText){
    const id=new URL(name,root).href;
    modules.set(id,new vm.SourceTextModule(text,{context:ctx,identifier:id,importModuleDynamically:importModule}));
  }
  const main=modules.get(new URL('app.mjs',root).href);
  await main.link(resolve);
  await main.evaluate();
  async function until(assertion){
    const deadline=Date.now()+4500;
    while(!assertion()){if(Date.now()>deadline)throw Error('UI did not reach expected condition: '+$('status').textContent);await delay(10);}
  }
  const t={$,until,initialHash,scrubbed,
    newHash(fragment){const oldURL=location.href;location.hash=fragment;listeners.fire('hashchange',{oldURL,newURL:location.href});},
    context:ctx,window:realm,listeners,shared,click:id=>$(id).click(),submit:id=>$(id).fire('submit'),
    async unlock(pw=password){$('pw').value=pw;t.submit('unlockForm'); await until(()=>!$('desk').hidden);},
    async save(values){for(const [key,value] of Object.entries(values))$(key).value=value;t.submit('editor');await until(()=>$('editor').hidden);},
    select(name){const btn=$('list').children.flatMap(li=>li.children).find(btn=>btn.textContent===name);assert.ok(btn,'Missing '+name);btn.click();},
    search(q){$('search').value=q;$('search').fire('input');return $('list').textContent;},
    async restore(backup,pw,message){$('file').files=[new Blob([backup])];$('backupPw').value=pw;t.submit('restore');await until(()=>$('status').textContent.includes(message));}
  };
  await until(()=>!$('gate').hidden||!$('linkPanel').hidden||$('status').classes.has('error'));return t;
}
test("production UI handlers capture, search, correct, lock, backup, restore and reconcile two tabs",async()=>{
  const context=origin(), a=await tab(context);
  assert.equal(a.$('unlockBtn').textContent,'Create memory'); await a.unlock();
  a.click('new');await a.save({title,body,source});
  for(const q of ['compass','periwinkle','Indigo'])assert.equal(a.search(q),title);
  assert.equal(a.search('missing fictional record'),'');a.search(''); a.select(title);
  assert.equal(a.$('recordBody').textContent,body);assert.equal(a.$('recordSource').textContent,source);
  a.click('edit');await a.save({body:edit});
  assert.ok(a.$('history').textContent.includes(body)); assert.ok(a.$('history').textContent.includes(edit));
  a.click('download');await a.until(()=>context.downloads.length===1);const exported=await context.downloads[0].text();
  for(const data of [title,body,edit,password,source]){assert.ok(!context.db.snapshot().includes(data));assert.ok(!exported.includes(data));}
  const b=await tab(context); await b.unlock();b.select(title);b.click('edit');b.$('body').value='Uncommitted stale revision';
  a.select(title);a.click('edit');await a.save({body:'A new concurrent version'});
  b.submit('editor');await b.until(()=>b.$('status').textContent.includes('another window'));
  assert.equal(b.$('body').value,'Uncommitted stale revision'); b.click('cancel'); b.select(title);assert.equal(b.$('recordBody').textContent,'A new concurrent version');
  a.click('lock');await a.until(()=>!a.$('gate').hidden);assert.equal(a.$('unlockBtn').textContent,'Unlock memory');
  assert.equal(a.$('history').textContent,'');assert.equal(a.$('recordBody').textContent,'');assert.equal(a.$('body').value,'');
  a.$('pw').value='wrong passphrase';a.submit('unlockForm');await a.until(()=>a.$('status').textContent.includes('Incorrect passphrase'));assert.ok(a.$('desk').hidden);await a.unlock();
  const target=origin(), c=await tab(target);await c.unlock('Another-Test-Passphrase-8012');c.click('new');await c.save({title:'Independent test record',body:'Independent local text',source:'Fixture'});
  await c.restore(exported,password,'1 added');assert.equal(c.$('count').textContent,'2 records');c.select(title);assert.equal(c.$('recordBody').textContent,edit);
  await c.restore(exported,password,'0 added');assert.equal(c.$('count').textContent,'2 records');
  const empty=origin(), d=await tab(empty);const foreign = 'fictional extra unencrypted metadata';
  const decorated = JSON.stringify({...JSON.parse(exported), externalNote:foreign});
  await d.restore(decorated,password,'Restored 1 records.');assert.ok(!empty.db.snapshot().includes(foreign));d.select(title);assert.equal(d.$('recordBody').textContent,edit);
  assert.deepEqual([...context.requests,...target.requests,...empty.requests],[]);
});
test("capture from the original graph accepts only the parent on the same origin and waits for explicit save",async()=>{
  const context=origin(), a=await tab(context,true);
  const message={type:'brain-memory-capture',title:'Captured node',body:'Fictional node body',source:'brain node #2'};
  const receive=(source,origin,data)=>a.listeners.fire('message',{source,origin,data});
  receive(a.window.parent,'https://wrong.invalid',message);
  receive({},a.window.location.origin,message);
  await a.unlock();assert.ok(a.$('editor').hidden);assert.equal(a.$('count').textContent,'0 records');
  receive(a.window.parent,a.window.location.origin,message);
  assert.ok(!a.$('editor').hidden);assert.equal(a.$('body').value,message.body);assert.equal(a.$('count').textContent,'0 records');
  await a.save({});a.select(message.title);assert.equal(a.$('recordSource').textContent,message.source);
  assert.ok(!context.db.snapshot().includes(message.body));
});

async function oldBackup(win,values,passphrase=password){
  const legacy=win.context.BrainVault;
  const {k,salt}=await legacy.start(null,passphrase);
  const sources=[{label:'Sheet 18',url:'https://example.org/sheet-18'}];
  const old=legacy.entry({title:'Old paper map',body:'Original archival reading',sources},null,'2026-01-02T01:00:00.000Z');
  const updated=legacy.entry({title:'Old paper map',body:'Corrected archival reading',sources},old,'2026-02-02T01:00:00.000Z');
  return {slot:legacy.SLOT,body:await legacy.seal(values||[updated],k,salt),record:updated};
}
test("legacy local vault unlock retains its original encrypted bytes, source, timestamps and both versions; later merge is idempotent",async()=>{
  const shared=origin(), initial=await tab(shared), old=await oldBackup(initial);
  shared.local.set(old.slot,old.body);const a=await tab(shared);
  assert.equal(a.$('unlockBtn').textContent,'Unlock memory');
  a.$('pw').value='Fictional-wrong-passphrase';a.submit('unlockForm');await a.until(()=>a.$('status').textContent.includes('Wrong passphrase'));
  assert.equal(shared.db.snapshot(),'[]');assert.equal(shared.local.get(old.slot),old.body);
  await a.unlock();a.select(old.record.title);
  assert.equal(a.$('recordBody').textContent,old.record.body);
  assert.ok(a.$('history').textContent.includes('Original archival reading'));assert.ok(a.$('recordSource').textContent.includes('https://example.org/sheet-18'));
  assert.equal(shared.local.get(old.slot),old.body);
  a.click('download');await a.until(()=>shared.downloads.length===1);
  const exported=JSON.parse(await shared.downloads[0].text());
  const {openBackup}=await import('../memory/memory-core.mjs'), opened=await openBackup(exported,password);
  assert.equal(opened.records[0].id,old.record.id);
  assert.deepEqual(opened.records[0].versions.map(v=>v.at),[old.record.created,old.record.updated]);
  a.$('legacyPw').value=password;a.submit('legacyForm');await a.until(()=>a.$('status').textContent.includes('0 added'));
  assert.equal(a.$('count').textContent,'1 record');
});
test("encrypted legacy backup restores on a fresh browser and merges without replacing occupied memory",async()=>{
  const empty=origin(), a=await tab(empty), old=await oldBackup(a);
  await a.restore(old.body,password,'Restored 1 records.');a.select(old.record.title);
  assert.ok(a.$('history').textContent.includes('Original archival reading'));
  const target=origin(),b=await tab(target);await b.unlock('Other-Purpose-Fictional-89293');
  b.click('new');await b.save({title:'Keep this local memory',body:'Another fixture'});
  await b.restore(old.body,password,'1 added');assert.equal(b.$('count').textContent,'2 records');
  await b.restore(old.body,password,'0 added');assert.equal(b.$('count').textContent,'2 records');
});
test("earlier seed JSON imports privately, including source URLs, with duplicate suppression across revisions and reordered sources",async()=>{
  const dest=origin(), a=await tab(dest);await a.unlock();
  const record={title:'Archived garden fixture',body:'Purple tulips in the fiction garden',sources:[{label:'Sheet Garden',url:'https://example.org/garden'},{label:'Fiction card 25'}]};
  const payload=records=>JSON.stringify({format:'brain-memory-seed',version:1,records});
  const importSeed=async(records,message)=>{a.$('seedFile').files=[new Blob([payload(records)])];a.submit('seedForm');await a.until(()=>a.$('status').textContent.includes(message));};
  await importSeed([record,record],'1 records · 1 duplicates');a.select(record.title);
  assert.ok(a.$('recordSource').textContent.includes('https://example.org/garden'));assert.ok(!dest.db.snapshot().includes(record.body));
  a.click('edit');await a.save({body:'An updated fictional garden'});
  await importSeed([{...record,sources:record.sources.toReversed()}],'0 records · 1 duplicates');
  assert.equal(a.$('count').textContent,'1 record');
  assert.deepEqual(dest.requests,[]);
});
test("the stable memory route can pick an unlocked graph node and requires a deliberate save",async()=>{
  const originData=origin(),a=await tab(originData);await a.unlock();a.click('pickGraph');
  const doc=a.context.document;
  await a.until(()=>doc.body.children.some(n=>n.className==='graph-picker'));
  const overlay=doc.body.children.find(n=>n.className==='graph-picker'),frame=overlay.children.find(n=>n.tag==='iframe');
  assert.equal(frame.src,'https://test.invalid/brain/?memory-picker');
  const graphPanel=new Element('div','panel');
  frame.contentDocument={getElementById:id=>id==='panel'?graphPanel:null,createElement:tag=>new Element(tag)};
  frame.contentWindow={};frame.fire('load');
  assert.equal(graphPanel.children.length,0);
  frame.contentWindow.GRAPH={nodes:[{id:'fictional/id',label:'Paper orchard',text:'Orchard fixture'}]};
  frame.contentWindow.BRAIN_STATE={sel:'fictional/id'};
  graphPanel.watch();graphPanel.watch();assert.equal(graphPanel.children.length,1);
  graphPanel.children[0].click();
  assert.ok(!doc.body.children.includes(overlay));assert.ok(!a.$('editor').hidden);assert.equal(a.$('title').value,'Paper orchard');assert.equal(a.$('count').textContent,'0 records');
  await a.save({});a.select('Paper orchard');assert.equal(a.$('recordSource').textContent,'Brain graph · fictional/id');assert.equal(a.$('recordBody').textContent,'Orchard fixture');
});

async function importFixture(){
  const {encryptBackup}=await import('../memory/memory-core.mjs');
  const entry={id:'fictional-link-id',versions:[{at:'2026-11-22T09:30:00.000Z',title:'Fictional linked entry',body:'Fictional private fragment text',source:'Notebook for fragment testing'}]};
  const secret='Fictional-Link-Passphrase-981';
  const envelope=await encryptBackup([entry],secret);
  const fragment='#import=v1.'+Buffer.from(JSON.stringify(envelope)).toString('base64url');
  return {entry,secret,envelope,fragment};
}
function submitLink(t,secret){t.$('linkPw').value=secret;t.submit('linkForm');}
test('private link strips its fragment before application startup, rejects a wrong passphrase without writing and imports on a fresh device',async()=>{
  const {entry,secret,fragment}=await importFixture(),state=origin(),a=await tab(state,false,fragment);
  assert.equal(a.initialHash,'');
  assert.deepEqual(a.scrubbed,['https://test.invalid/brain/memory/']);
  assert.equal(a.context.takeBrainImport(),null);
  assert.equal(state.db.snapshot(),'[]');assert.equal(state.local.size,0);
  await a.until(()=>!a.$('linkPanel').hidden);
  submitLink(a,'Wrong-Passphrase-Example');
  await a.until(()=>a.$('status').classes.has('error'));
  assert.equal(state.db.snapshot(),'[]');assert.equal(state.local.size,0);
  submitLink(a,secret);await a.until(()=>a.$('list').textContent===entry.versions[0].title);
  a.select(entry.versions[0].title);
  assert.equal(a.$('recordBody').textContent,entry.versions[0].body);
  assert.equal(a.$('recordSource').textContent,entry.versions[0].source);
  assert.ok(a.$('linkPanel').hidden);assert.equal(a.$('linkPw').value,'');
  assert.ok(!state.db.snapshot().includes(entry.versions[0].body));assert.ok(!state.db.snapshot().includes(secret));
  assert.deepEqual(state.requests,[]);
});
test('existing locked memory requires its own unlock before merging a link and repeated links retain one copy',async()=>{
  const {entry,secret,fragment}=await importFixture(),state=origin(),old=await tab(state);
  await old.unlock();old.click('new');await old.save({title:'Existing private fixture',body:'Do not overwrite this separate record'});
  old.click('lock');await old.until(()=>!old.$('gate').hidden);
  const a=await tab(state,false,fragment),initialStore=state.db.snapshot();
  submitLink(a,secret);await delay(350);
  assert.ok(a.$('desk').hidden);assert.equal(state.db.snapshot(),initialStore);
  await a.unlock(password);await a.until(()=>!a.$('linkPanel').hidden);
  submitLink(a,secret);await a.until(()=>a.$('count').textContent==='2 records');
  a.select('Existing private fixture');assert.equal(a.$('recordBody').textContent,'Do not overwrite this separate record');
  a.select(entry.versions[0].title);assert.equal(a.$('recordBody').textContent,entry.versions[0].body);
  a.newHash(fragment);await a.until(()=>!a.$('linkPanel').hidden);
  assert.equal(a.window.location.hash,'');
  submitLink(a,secret);await a.until(()=>a.$('linkPanel').hidden);
  assert.equal(a.$('count').textContent,'2 records');assert.deepEqual(state.requests,[]);
});
test('malformed and dismissed import fragments cause no network requests or vault writes',async()=>{
  const {fragment}=await importFixture(),state=origin(),a=await tab(state,false,'#import=v1.!');
  assert.equal(a.initialHash,'');assert.ok(!a.$('linkPanel').hidden);assert.ok(a.$('linkForm').hidden);assert.match(a.$('linkMessage').textContent,/invalid/i);
  assert.equal(state.db.snapshot(),'[]');assert.equal(state.local.size,0);
  a.newHash(fragment);await a.until(()=>!a.$('linkPanel').hidden);a.click('linkDismiss');
  assert.ok(a.$('linkPanel').hidden);assert.equal(a.context.takeBrainImport(),null);
  assert.equal(a.window.location.hash,'');assert.equal(state.db.snapshot(),'[]');assert.deepEqual(state.requests,[]);
});

test('private import parser rejects extra plaintext metadata, URL-looking payloads and oversized fragments without fetching or persisting',async()=>{
  const {envelope}=await importFixture(),state=origin();
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const attempted=[
    '#import=v1.'+encode({...envelope,privateNote:'Fictional forbidden plaintext metadata'}),
    '#import=v1.https://example.invalid/private-fixture',
    '#import=https://example.invalid/alternate',
    '#import=v1.'+encode('https://example.invalid/alternative'),
    '#import=v1.'+'A'.repeat(32768)
  ];
  for(const fragment of attempted){
    const a=await tab(state,false,'?local=1'+fragment);
    assert.equal(a.initialHash,'');assert.deepEqual(a.scrubbed,['https://test.invalid/brain/memory/?local=1']);
    assert.equal(a.context.takeBrainImport(),null);
    assert.match(a.$('linkMessage').textContent,/invalid/i);assert.ok(a.$('linkForm').hidden);
    assert.ok(!a.$('linkMessage').textContent.includes('forbidden plaintext'));
    submitLink(a,'Fictional-wrong-password');await delay(15);
    assert.equal(state.db.snapshot(),'[]');assert.equal(state.local.size,0);assert.deepEqual(state.requests,[]);
  }
});
