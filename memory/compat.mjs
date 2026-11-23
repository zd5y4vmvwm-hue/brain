import '../brain-vault.js';
import {validateRecords} from './memory-core.mjs';

const legacy = globalThis.BrainVault;
export const LEGACY_BACKUP_FORMAT = 'brain-memory-backup';
export const LEGACY_SEED_FORMAT = 'brain-memory-seed';

export function readLegacyRaw() {
  try {
    return globalThis.localStorage.getItem(legacy.SLOT);
  } catch {
    throw new Error('Unable to read the earlier memory vault. Check access to this site’s browser storage.');
  }
}

function sourceText(sources) {
  return sources.map(({label, url}) => url ? label + '\n' + url : label).join('\n\n');
}

function revision(at, fields) {
  return {at, title: fields.title, body: fields.body, source: sourceText(fields.sources)};
}

export async function openLegacyBackup(raw, passphrase) {
  const {items} = await legacy.open(raw, passphrase);
  const converted = items.map(item => {
    const versions = item.history.map(snapshot => revision(snapshot.at, snapshot));
    versions.push(revision(item.updated, item));
    // Original writes make the first revision's timestamp the creation date.
    // Some valid older exports contain a separate date without a first snapshot.
    if (versions[0].at !== item.created) {
      const metadata = 'Original vault creation date: ' + item.created;
      versions[0].source = [versions[0].source, metadata].filter(Boolean).join('\n\n');
    }
    return {id: item.id, versions};
  });
  return validateRecords(converted);
}

function signature({title, body, source}) {
  // Legacy source order did not distinguish otherwise identical seed entries.
  const sourceGroups = source ? source.split('\n\n').sort() : [];
  return JSON.stringify([title, body, sourceGroups]);
}

function retainedSignatures(version) {
  const result = [signature(version)];
  const marker = /(?:^|\n\n)Original vault creation date: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (marker.test(version.source)) {
    result.push(signature({...version, source: version.source.replace(marker, '')}));
  }
  return result;
}

export function mergeLegacySeed(current, raw) {
  const input = legacy.parseSeed(raw);
  const records = validateRecords(current);
  const seen = new Set(records.flatMap(record => record.versions.flatMap(retainedSignatures)));
  const at = new Date().toISOString();
  let added = 0;
  for (const fields of input) {
    const version = revision(at, fields);
    const key = signature(version);
    if (seen.has(key)) continue;
    records.push({id: crypto.randomUUID(), versions: [version]});
    seen.add(key);
    added++;
  }
  return {records: validateRecords(records), added, updated: 0, conflicts: 0, skipped: input.length - added};
}
