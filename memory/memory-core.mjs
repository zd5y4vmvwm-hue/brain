const FORMAT = 'grok-brain-memory';
const ENCRYPTED = 'grok-brain-memory-encrypted';
const ITERATIONS = 600000;
const MAX_BYTES = 16 * 1024 * 1024;
export const MAX_BACKUP_BYTES = Math.ceil(MAX_BYTES / 3) * 4 + 2048;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});
const aad = encoder.encode(ENCRYPTED + '/v1');

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function unbase64(text, max) {
  if (typeof text !== 'string' || !text.length || text.length > Math.ceil(max / 3) * 4) {
    throw new Error('Invalid encrypted backup.');
  }
  const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
  if (bytes.length > max) throw new Error('Invalid encrypted backup.');
  return bytes;
}

export function validateRecords(records) {
  if (!Array.isArray(records) || records.length > 10000) throw new Error('Invalid memory collection.');
  const ids = new Set();
  return records.map(record => {
    if (!record || !/^[A-Za-z0-9_-]{8,128}$/.test(record.id) || typeof record.id !== 'string' ||
        ids.has(record.id) || !Array.isArray(record.versions) || !record.versions.length || record.versions.length > 5000) {
      throw new Error('Invalid record or duplicate record ID.');
    }
    ids.add(record.id);
    const versions = record.versions.map(version => {
      if (!version || typeof version.title !== 'string' || !version.title.trim() || version.title.length > 512 ||
          typeof version.body !== 'string' || version.body.length > 200000 || typeof version.source !== 'string' ||
          version.source.length > 60000 || typeof version.at !== 'string' || !Number.isFinite(Date.parse(version.at))) {
        throw new Error('Invalid memory entry.');
      }
      return {at: new Date(version.at).toISOString(), title: version.title, body: version.body, source: version.source};
    });
    return {id: record.id, versions};
  });
}

export async function deriveMemoryKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || !passphrase.length) throw new Error('Enter a passphrase.');
  const input = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS}, input,
    {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}

export async function newKey(passphrase) {
  if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {key: await deriveMemoryKey(passphrase, salt), salt: base64(salt)};
}

export async function seal(records, {key, salt}) {
  const payload = encoder.encode(JSON.stringify({format: FORMAT, version: 1, records: validateRecords(records)}));
  if (payload.length + 16 > MAX_BYTES) throw new Error('Memory exceeds the 16 MiB vault limit.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad}, key, payload);
  return {format: ENCRYPTED, version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt,
    iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext))};
}

export async function encryptBackup(records, passphrase) {
  return seal(records, await newKey(passphrase));
}

function parameters(envelope) {
  if (envelope?.format !== ENCRYPTED || envelope.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256' ||
      envelope.iterations !== ITERATIONS) throw new Error('Unrecognized encrypted backup format.');
  const salt = unbase64(envelope.salt, 16);
  const iv = unbase64(envelope.iv, 12);
  const data = unbase64(envelope.ciphertext, MAX_BYTES);
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw new Error('Invalid encryption parameters.');
  return {salt, iv, data};
}

async function decode(key, {iv, data}) {
  let plain;
  try {
    plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv, additionalData: aad}, key, data);
  } catch {
    throw new Error('Incorrect passphrase or damaged encrypted file.');
  }
  const payload = JSON.parse(decoder.decode(plain));
  if (payload?.format !== FORMAT || payload.version !== 1) throw new Error('Unsupported memory version.');
  return validateRecords(payload.records);
}

export async function openBackup(envelope, passphrase) {
  const params = parameters(envelope);
  const key = await deriveMemoryKey(passphrase, params.salt);
  return {session: {key, salt: envelope.salt}, records: await decode(key, params)};
}

export function openWithKey(envelope, session) {
  if (envelope.salt !== session.salt) throw new Error('The vault key changed. Lock and unlock memory again.');
  return decode(session.key, parameters(envelope));
}

function prefix(a, b) {
  return a.length <= b.length && a.every((v, index) => JSON.stringify(v) === JSON.stringify(b[index]));
}

async function conflictPrefix(originalId) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(originalId));
  return 'fork-' + Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}

export async function mergeRecords(current, incoming) {
  const result = new Map(validateRecords(current).map(record => [record.id, record]));
  let added = 0, updated = 0, conflicts = 0;
  for (const record of validateRecords(incoming)) {
    const prior = result.get(record.id);
    if (!prior) { result.set(record.id, record); added++; continue; }
    if (prefix(record.versions, prior.versions)) continue;
    if (prefix(prior.versions, record.versions)) { result.set(record.id, record); updated++; continue; }
    // Recognize other retained branches by original ID and full revision
    // history. An occupied ID alone never proves that we kept this record.
    const base = await conflictPrefix(record.id);
    let slot = 0;
    for (;;) {
      const id = base + '-' + slot++, existing = result.get(id);
      if (!existing) { result.set(id, {...record, id}); conflicts++; break; }
      if (prefix(record.versions, existing.versions)) break;
      if (prefix(existing.versions, record.versions)) {
        result.set(id, {...record, id}); updated++; break;
      }
    }
  }
  return {records: [...result.values()], added, updated, conflicts};
}
