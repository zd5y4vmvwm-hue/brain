import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openLegacyBackup, readLegacyRaw, mergeLegacySeed} from '../memory/compat.mjs';
import {encryptBackup, mergeRecords, openBackup} from '../memory/memory-core.mjs';

const legacy = globalThis.BrainVault;
const pass = 'fictional-orchard-test-only';
const early = '2025-02-01T12:00:00.000Z';
const late = '2025-03-02T14:00:00.000Z';
const original = {
  title: 'Field notebook', body: 'Original entry', sources: [
    {label: 'Ledger'}, {label: 'Field archive', url: 'https://example.org/archive'}
  ]
};
const edited = {title: 'Corrected notebook', body: 'Updated entry', sources: [{label: 'Notebook'}]};
const first = legacy.entry(original, null, early);
const final = legacy.entry(edited, first, late);
const rawSeed = values => JSON.stringify({format:'brain-memory-seed',version:1,records:values});
async function encrypted(values) {
  const {k, salt} = await legacy.start(null, pass);
  return legacy.seal(values, k, salt);
}

test('real earlier writer exports and current reader preserves identity, dates, edits and sources', async () => {
  const raw = await encrypted([final]);
  const result = await openLegacyBackup(raw, pass);
  const expected = [{
    id:first.id,
    versions:[
      {at:early,title:original.title,body:original.body,source:'Ledger\n\nField archive\nhttps://example.org/archive'},
      {at:late,title:edited.title,body:edited.body,source:'Notebook'}
    ]
  }];
  assert.deepEqual(result, expected);
  assert.deepEqual((await mergeRecords(result, result)).records, expected);
  const portable = await encryptBackup(result, pass);
  assert.deepEqual((await openBackup(portable, pass)).records, expected);
  assert.deepEqual((await legacy.open(raw, pass)).items, [final]);
});

test('preserves a separate creation date when the earlier file lacks that first revision', async () => {
  const result = await openLegacyBackup(await encrypted([{...final,history:[]}]), pass);
  const [last] = result[0].versions;
  assert.equal(last.at, late);
  assert.ok(last.source.includes('Original vault creation date: '+early));
  assert.equal(result[0].versions.length, 1);
  assert.equal(mergeLegacySeed(result, rawSeed([edited])).skipped, 1);
});

test('rejects incorrect passphrases, tampering and unsupported formats', async () => {
  const raw = await encrypted([final]);
  await assert.rejects(openLegacyBackup(raw, 'different-test-passphrase'), /passphrase/);
  const changed = JSON.parse(raw);
  const bytes = Buffer.from(changed.ct, 'base64'); bytes[0] ^= 1; changed.ct = bytes.toString('base64');
  await assert.rejects(openLegacyBackup(JSON.stringify(changed), pass), /altered/);
  await assert.rejects(openLegacyBackup(JSON.stringify({...changed, version:2}), pass), /Unsupported/);
});

test('retains all twenty long references from an earlier vault or seed', async () => {
  const huge = {...original, sources:Array.from({length:20}, (_,i) => ({label:'Link '+i+' '+'y'.repeat(220),url:'https://example.org/'+ 'x'.repeat(2000)}))};
  const expected = huge.sources.map(s => s.label+'\n'+s.url).join('\n\n');
  const restored = await openLegacyBackup(await encrypted([legacy.entry(huge, null, early)]),pass);
  assert.equal(restored[0].versions[0].source, expected);
  assert.equal(mergeLegacySeed([],rawSeed([huge])).records[0].versions[0].source, expected);
});

test('merges original seeds without duplicating current or historical entries even with reordered references', async () => {
  const base = await openLegacyBackup(await encrypted([final]), pass);
  const frozen = structuredClone(base);
  const fresh = {...original,title:'New note',body:'Different content'};
  const input = rawSeed([edited,{...original,sources:[...original.sources].reverse()},fresh,fresh]);
  const result = mergeLegacySeed(base,input);
  assert.deepEqual([result.added,result.skipped,result.records.length],[1,3,2]);
  assert.deepEqual(base,frozen);
  assert.equal(result.records[1].versions[0].title,fresh.title);
  assert.equal(mergeLegacySeed(result.records,input).added,0);
  assert.throws(() => mergeLegacySeed(base,rawSeed([{...fresh,unsafe:true}])), /Invalid seed/);
});

test('legacy detection reads exactly the original key without writing or deleting on error', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  try {
    const calls=[];
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
      getItem(key) { calls.push(key); return 'ciphertext'; }
    }});
    assert.equal(readLegacyRaw(),'ciphertext');
    assert.deepEqual(calls,['brain.localMemory.v1']);
    Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('blocked')}});
    assert.throws(readLegacyRaw,/browser storage/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis,'localStorage',descriptor);
    else delete globalThis.localStorage;
  }
});
