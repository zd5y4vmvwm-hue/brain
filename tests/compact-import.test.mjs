import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes} from 'node:crypto';
import {gunzipSync, gzipSync} from 'node:zlib';
import {makeCompactImport, openCompactImport} from '../memory/compact-import.mjs';
import {encryptBackup} from '../memory/memory-core.mjs';

const prefix='#import=z1.';
const password='Fictional-Compact-FieldJournal-978';
const context='grok-brain-memory-compact/z1';
const records=[{id:'fixture-only-small',versions:[
  {at:'2026-02-17T15:00:00.000Z',title:'Fictional field journal · 🌻',body:'Rivière, 梨 and ☀️. This is a synthetic field note.',source:'Fictional log 01'},
  {at:'2026-02-19T15:00:00.000Z',title:'Fictional field journal · 🌻',body:'Corrected fictional text. Café, العربية and ♫.',source:'Fictional log 01\nhttps://example.org/fiction'}
]}];

function unpack(fragment){
  assert.ok(fragment.startsWith(prefix));
  const value=fragment.slice(prefix.length);assert.match(value,/^[A-Za-z\d_-]+$/);
  const bytes=Buffer.from(value,'base64url');
  return {value,bytes,salt:bytes.subarray(0,16),iv:bytes.subarray(16,28),ct:bytes.subarray(28)};
}
function passwordKey(salt){return pbkdf2Sync(password,salt,600000,32,'sha256');}
function decipher({salt,iv,ct},aad=context){
  const algorithm=createDecipheriv('aes-256-gcm',passwordKey(salt),iv);
  algorithm.setAAD(Buffer.from(aad));algorithm.setAuthTag(ct.subarray(-16));
  return Buffer.concat([algorithm.update(ct.subarray(0,-16)),algorithm.final()]);
}
function independentPacket(payload,aad=context){
  const salt=randomBytes(16),iv=randomBytes(12),algorithm=createCipheriv('aes-256-gcm',passwordKey(salt),iv);
  algorithm.setAAD(Buffer.from(aad));
  return Buffer.concat([salt,iv,algorithm.update(payload),algorithm.final(),algorithm.getAuthTag()]).toString('base64url');
}

test('compact link round-trips UTF-8, original text, correction history and source references',async()=>{
  const a=unpack(await makeCompactImport(records,password));const b=unpack(await makeCompactImport(records,password));
  assert.deepEqual(await openCompactImport(a.value,password),records);
  assert.notDeepEqual(a.salt,b.salt);assert.notDeepEqual(a.iv,b.iv);assert.notDeepEqual(a.ct,b.ct);
  for(const value of [password,records[0].id,...records[0].versions.map(v=>v.title)])assert.ok(!a.bytes.includes(Buffer.from(value)));
});

test('independent OpenSSL AES-GCM and gzip decrypt the compact link and produce an accepted independently encrypted packet',async()=>{
  const packet=unpack(await makeCompactImport(records,password));
  const compressed=decipher(packet);assert.equal(compressed[0],0x1f);assert.equal(compressed[1],0x8b);
  const plain=gunzipSync(compressed);const text=plain.toString('utf8');
  assert.deepEqual(JSON.parse(text),{format:'grok-brain-memory',version:1,records});
  assert.ok(text.includes(records[0].id));assert.ok(text.includes('Rivière'));assert.ok(text.includes('العربية'));
  assert.deepEqual(await openCompactImport(independentPacket(gzipSync(plain)),password),records);
});

test('compact links reject wrong passphrases, modified tags and cross-protocol authentication',async()=>{
  const packet=unpack(await makeCompactImport(records,password));
  await assert.rejects(()=>openCompactImport(packet.value,'Fictional-Wrong-Compact-Passphrase'));
  const corrupted=Buffer.from(packet.bytes);corrupted[corrupted.length-1]^=1;
  await assert.rejects(()=>openCompactImport(corrupted.toString('base64url'),password));
  assert.throws(()=>decipher(packet,'grok-brain-memory-encrypted/v1'));
  const compressed=decipher(packet);
  await assert.rejects(()=>openCompactImport(independentPacket(compressed,'grok-brain-memory-encrypted/v1'),password));
  const v1=await encryptBackup(records,password);
  const disguised=Buffer.concat(['salt','iv','ciphertext'].map(k=>Buffer.from(v1[k],'base64'))).toString('base64url');
  await assert.rejects(()=>openCompactImport(disguised,password));
});

test('malformed, oversize and unauthenticated compact inputs are rejected',async()=>{
  for(const malformed of ['', 'A', 'AAA+', 'AAAA/', 'AA==', 'AAAAA', 'AA?AA', 'https://example.org/file', 'A'.repeat(32769)]){
    await assert.rejects(()=>openCompactImport(malformed,password));
  }
  await assert.rejects(()=>makeCompactImport(records,'short'));
  const hugeText=randomBytes(35000).toString('base64');
  const incompressible=[{...records[0],versions:[{...records[0].versions[0],body:hugeText}]}];
  await assert.rejects(()=>makeCompactImport(incompressible,password),/large|long|limit|size|backup|exceed|file/i);
});

test('authenticated compact input still requires gzip, UTF-8 and a recognized valid memory payload',async()=>{
  const invalid=[
    Buffer.from('Plain test data without gzip'),
    gzipSync(Buffer.from([0xff,0xfe,0xc0])),
    gzipSync(Buffer.from('{"format":"fictional-unsupported","version":1,"records":[]}')),
    gzipSync(Buffer.from('{"format":"grok-brain-memory","version":1,"records":[{}]}'))
  ];
  for(const compressed of invalid)await assert.rejects(()=>openCompactImport(independentPacket(compressed),password));
});

test('compact reader stops expansion above sixteen MiB, even for a small authenticated packet',async()=>{
  const expanded=gzipSync(Buffer.alloc(16*1024*1024+1,0x20));
  const packet=independentPacket(expanded);
  assert.ok(packet.length+prefix.length<32768);
  await assert.rejects(()=>openCompactImport(packet,password),/large|long|limit|size|16 MiB|exceed/i);
});
