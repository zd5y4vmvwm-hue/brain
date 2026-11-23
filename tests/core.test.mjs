import {transactionDatabase} from "./transaction-double.mjs";
import {test} from "node:test";
import assert from "node:assert/strict";
import {createDecipheriv, pbkdf2Sync} from "node:crypto";
import {newKey, seal, openBackup, encryptBackup, openWithKey, mergeRecords, validateRecords} from "../memory/memory-core.mjs";
import {readVault, commitVault} from "../memory/memory-store.mjs";

const password = "Maple-Purple-Window-9071";
const second = "Crimson-Cloudy-Lantern-4521";
function version(body="The periwinkle station opens at quarter past the hour.", offset=0) {
  return {at: new Date(Date.UTC(2026,1,1,12,offset)).toISOString(), title:"Paper compass field note", body, source:"Notebook Indigo, sheet 726"};
}
const original = {id:"fictional-station", versions:[version()]};
const corrected = {...original, versions:[...original.versions, version("The green station opens at half past the hour.", 1)]};
const divergent = {...original, versions:[...original.versions, version("The red station opens at noon.",2)]};
const other = {id:"fictional-orchard", versions:[version("Orchard marker 80", 1)]};

test("portable AES-GCM backup decrypts independently with Node OpenSSL, iteration count, tag and AAD",async()=>{
  const backup=await encryptBackup([corrected],password);
  assert.equal(backup.kdf,"PBKDF2-SHA256");
  assert.equal(backup.iterations,600000);
  const key=pbkdf2Sync(password,Buffer.from(backup.salt,"base64"),backup.iterations,32,"sha256");
  const ciphertext=Buffer.from(backup.ciphertext,"base64");
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(backup.iv,"base64"));
  decipher.setAAD(Buffer.from("grok-brain-memory-encrypted/v1"));
  decipher.setAuthTag(ciphertext.subarray(-16));
  const payload=JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0,-16)),decipher.final()]));
  assert.deepEqual(payload.records,[corrected]);
  for (const sensitive of [password, original.id, ...Object.values(version())]) assert.ok(!JSON.stringify(backup).includes(sensitive));
});
test("restoring portable backup retains all text, provenance, timestamps and correction history",async()=>{
  const envelope = await encryptBackup([corrected],password);
  const {records,session} = await openBackup(envelope,password);
  assert.deepEqual(records,[corrected]); 
  assert.equal(session.key.extractable,false);
  await assert.rejects(()=>crypto.subtle.exportKey("raw",session.key));
});
test("same record and key produce fresh ciphertext and IV per write",async()=>{
  const key=await newKey(password), first=await seal([original],key), next=await seal([original],key);
  assert.equal(first.salt,next.salt);
  assert.notEqual(first.iv,next.iv);
  assert.notEqual(first.ciphertext,next.ciphertext);
  assert.deepEqual(await openWithKey(next,key),[original]);
});
test("new backups produce fresh random salt; keys cannot be reused across salt changes",async()=>{
  const x=await newKey(password), y=await newKey(password);
  assert.notEqual(x.salt,y.salt);
  const envelope=await seal([original],x);
  assert.throws(()=>openWithKey(envelope,y),/vault key changed/);
});
test("wrong passphrase, tampering and unrecognized versions fail closed",async()=>{
  const envelope=await encryptBackup([original],password);
  await assert.rejects(()=>openBackup(envelope,second),/passphrase|damaged/);
  const changed = Buffer.from(envelope.ciphertext,"base64");
  changed[5] ^= 1;
  await assert.rejects(()=>openBackup({...envelope,ciphertext:changed.toString("base64")},password),/passphrase|damaged/);
  for(const field of [{version:2},{iterations:1},{kdf:"none"},{iv:"AA=="},{salt:"AA=="}]){
    await assert.rejects(()=>openBackup({...envelope,...field},password));
  }
});
test("empty, short and invalid captures cannot create a usable vault/envelope",async()=>{
  for (const bad of ["","short"]){await assert.rejects(()=>newKey(bad));}
  for (const bad of [null,{},[original,original],[{...original,id:"bad id"}], [{...original,versions:[]}], [{...original,versions:[{...version(),at:"bad"}]}], [{...original,versions:[{...version(),title:" "}]}]]){
    assert.throws(()=>validateRecords(bad));
  }
  assert.equal(validateRecords([]).length,0);
});
test("restore into an independent vault preserves unrelated records and repeats without duplication",async()=>{
  const envelope=await encryptBackup([original],password);
  const imported=(await openBackup(envelope,password)).records;
  const first=await mergeRecords([other],imported), repeat=await mergeRecords(first.records,imported);
  assert.deepEqual(first.records,[other,original]); assert.equal(first.added,1);
  assert.deepEqual(repeat,{records:first.records,added:0,updated:0,conflicts:0});
  const destination=await encryptBackup(first.records,second);
  assert.deepEqual((await openBackup(destination,second)).records,[other,original]);
  await assert.rejects(()=>openBackup(destination,password));
});
test("ancestor restore cannot roll back edits; descendant extends known revision chain",async()=>{
  const merged=await mergeRecords([original],[corrected]); assert.deepEqual(merged.records,[corrected]); assert.equal(merged.updated,1);
  const old=await mergeRecords([corrected],[original]); assert.deepEqual(old.records,[corrected]); assert.equal(old.updated,0);
});
test("two diverging histories survive merge without loss and without fork duplication on repeated import",async()=>{
  const merge=await mergeRecords([corrected],[divergent]);
  assert.equal(merge.records.length,2); assert.equal(merge.conflicts,1);
  assert.deepEqual(merge.records[0],corrected);
  assert.deepEqual(merge.records[1].versions,divergent.versions);
  assert.notEqual(merge.records[1].id,original.id);
  assert.deepEqual((await mergeRecords(merge.records,[divergent])).records,merge.records);
});
test("later changes extend a retained alternate branch, and an occupied fork ID cannot hide a divergent history",async()=>{
  const merged=await mergeRecords([corrected],[divergent]);
  const branch=merged.records[1];
  const newer={...divergent, versions:[...divergent.versions,version("Fictional third version",4)]};
  const appended=await mergeRecords(merged.records,[newer]);
  assert.equal(appended.records.length,2);
  assert.equal(appended.updated,1);
  assert.deepEqual(appended.records[1].versions,newer.versions);
  assert.equal(appended.records[1].id,branch.id);
  const occupied={id:branch.id,versions:[version("Unrelated pre-existing history",9)]};
  const preserved=await mergeRecords([corrected,occupied],[divergent]);
  assert.equal(preserved.records.length,3);
  assert.deepEqual(preserved.records[1],occupied);
  assert.deepEqual(preserved.records[2].versions,divergent.versions);
});
test("size, count and type validation rejects hostile or damaged archives before publishing a merged collection",async()=>{
  const big={...version(),body:"A".repeat(200001)};
  for(const data of [[{...original, versions:[big]}],[{...original,versions:Array(5001).fill(version())}],Array(10001).fill(original)]) {
    assert.throws(()=>validateRecords(data));
  }
  for(const data of [null,{},[],{format:"grok-brain-memory-encrypted",version:1,kdf:"PBKDF2-SHA256",iterations:600000,salt:"A".repeat(32)}]){
    await assert.rejects(()=>openBackup(data,password));
  }
});

test("transaction adapter saves only ciphertext, rejects stale/concurrent writers and keeps old contents after quota error",async()=>{
  const db=transactionDatabase(); globalThis.indexedDB=db;
  assert.equal(await readVault(),null);
  const key=await newKey(password);
  const initial=await seal([original],key);
  assert.equal(await commitVault(null,initial),true); assert.equal(await commitVault(null,initial),false);
  const a=await readVault(), b=await readVault();
  const next=await seal([corrected],key), otherChange=await seal([divergent],key);
  const [first,secondResult]=await Promise.all([commitVault(a.revision,next),commitVault(b.revision,otherChange)]);
  assert.deepEqual([first,secondResult].sort(),[false,true]);
  const current=await readVault();
  assert.deepEqual(await openWithKey(current.envelope,key),first ? [corrected] : [divergent]);
  db.abortNext();
  await assert.rejects(()=>commitVault(current.revision,initial),/storage quota/);
  assert.deepEqual(await readVault(),current);
  const persisted=db.snapshot();
  for (const sensitive of [password, original.id, ...Object.values(version())]) assert.ok(!persisted.includes(sensitive));
});
