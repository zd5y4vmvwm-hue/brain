import {deriveMemoryKey, validateRecords} from './memory-core.mjs';

const PREFIX = '#import=z1.';
const MAX_FRAGMENT = 32768;
const MAX_PLAIN = 16 * 1024 * 1024 - 16;
const encoder = new TextEncoder();
const aad = encoder.encode('grok-brain-memory-compact/z1');

function unavailable() {
  return new Error('This browser cannot open compressed imports. Use the encrypted backup file instead.');
}

function pack(bytes) {
  let text = '';
  for (let pos = 0; pos < bytes.length; pos += 8192) {
    text += String.fromCharCode(...bytes.subarray(pos,pos + 8192));
  }
  return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function unpack(text) {
  if (typeof text !== 'string' || text.length + PREFIX.length > MAX_FRAGMENT ||
      text.length < 59 || text.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new Error('Invalid compact encrypted import.');
  }
  const bytes = Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
  if (bytes.length < 44 || pack(bytes) !== text) throw new Error('Invalid compact encrypted import.');
  return bytes;
}

async function inflated(bytes) {
  if (typeof DecompressionStream !== 'function') throw unavailable();
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader(), chunks = [];
  let total = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PLAIN) {
        await reader.cancel();
        throw new Error('Expanded memory exceeds the 16 MiB vault limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk,offset); offset += chunk.length; }
  return output;
}

export async function makeCompactImport(records, passphrase) {
  if (typeof CompressionStream !== 'function') throw unavailable();
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const plain = encoder.encode(JSON.stringify({format:'grok-brain-memory',version:1,records:validateRecords(records)}));
  if (plain.length > MAX_PLAIN) throw new Error('Memory exceeds the 16 MiB vault limit.');
  const stream = new Blob([plain]).stream().pipeThrough(new CompressionStream('gzip'));
  const zipped = await new Response(stream).arrayBuffer();
  if (Math.ceil((zipped.byteLength + 44) * 4 / 3) + PREFIX.length > MAX_FRAGMENT) {
    throw new Error('This collection exceeds the compact link limit. Use an encrypted backup file.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveMemoryKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,zipped);
  const packed = new Uint8Array(28 + ciphertext.byteLength);
  packed.set(salt); packed.set(iv,16); packed.set(new Uint8Array(ciphertext),28);
  return PREFIX + pack(packed);
}

export async function openCompactImport(text, passphrase) {
  const packed = unpack(text);
  const key = await deriveMemoryKey(passphrase, packed.subarray(0,16));
  let compressed;
  try {
    compressed = await crypto.subtle.decrypt({name:'AES-GCM',iv:packed.subarray(16,28),additionalData:aad},key,packed.subarray(28));
  } catch { throw new Error('Incorrect passphrase or damaged encrypted link.'); }
  const plain = await inflated(compressed);
  const payload = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
  if (payload?.format !== 'grok-brain-memory' || payload.version !== 1) throw new Error('Unsupported memory version.');
  return validateRecords(payload.records);
}
