import {MAX_BACKUP_BYTES, mergeRecords, newKey, openBackup, openWithKey, seal} from './memory-core.mjs';
import {readLegacyRaw, openLegacyBackup, mergeLegacySeed, LEGACY_BACKUP_FORMAT} from './compat.mjs';
import {readVault, commitVault} from './memory-store.mjs';

const $ = id => document.getElementById(id);
let session = null, records = [], selected = null, editBase = null, pendingCapture = null;
let closePicker = null;
let busy = false, generation = 0, channel = null, refreshNumber = 0;
const latest = record => record.versions[record.versions.length - 1];
const byId = id => records.find(record => record.id === id);
const element = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

async function action(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); } catch (error) { status(error.message || 'Unable to access encrypted memory.', true); }
  finally { busy = false; }
}

function linkSource(container, value) {
  container.replaceChildren();
  if (!value) { container.textContent = 'No source recorded.'; return; }
  for (const [i, line] of value.split('\n').entries()) {
    if (i) container.append(document.createTextNode('\n'));
    let url;
    try { url = new URL(line); } catch { /* Free-form source label. */ }
    if (url && ['https:', 'http:'].includes(url.protocol)) {
      const link = element('a', line); link.href = url.href; link.rel = 'noopener noreferrer'; link.target = '_blank'; container.append(link);
    } else { container.append(document.createTextNode(line)); }
  }
}

function showRecord(id) {
  const record = byId(id);
  selected = record?.id || null;
  const active = Boolean(record);
  $('detail').hidden = !active;
  if (!active) return;
  const value = latest(record);
  $('recordTitle').textContent = value.title; $('recordBody').textContent = value.body;
  linkSource($('recordSource'), value.source);
  const items = [...record.versions].reverse().map((version, i) => {
    const li = document.createElement('li');
    li.append(element('time', new Date(version.at).toLocaleString()), element('p', version.title),
      element('p', version.body), element('p', version.source));
    if (!i) li.prepend(element('strong', 'Current · '));
    return li;
  });
  $('history').replaceChildren(...items);
}

function draw() {
  const q = $('search').value.trim().toLocaleLowerCase();
  const matches = records.filter(record => {
    const {title, body, source} = latest(record);
    return [title, body, source].some(value => value.toLocaleLowerCase().includes(q));
  }).sort((a, b) => latest(b).at.localeCompare(latest(a).at));
  $('count').textContent = q ? matches.length + ' matching' : records.length + (records.length === 1 ? ' record' : ' records');
  const list = matches.map(record => {
    const li = document.createElement('li'), button = element('button', latest(record).title);
    button.type = 'button'; button.setAttribute('aria-current', String(record.id === selected));
    button.addEventListener('click', () => {
      if (!canLeaveDraft()) return;
      clearEditor(); showRecord(record.id); draw();
    });
    li.append(button); return li;
  });
  $('list').replaceChildren(...list);
  if ($('editor').hidden) showRecord(selected);
}

function clearEditor() {
  $('editor').reset(); $('editor').hidden = true; editBase = null;
}

function canLeaveDraft() {
  if ($('editor').hidden) return true;
  const fields = currentFields(), old = editBase?.value || {title:'',body:'',source:''};
  return Object.keys(fields).every(key => fields[key] === old[key]) || confirm('Discard the unsaved changes?');
}

function edit(record, capture) {
  if (!canLeaveDraft()) return;
  const version = record ? latest(record) : null;
  editBase = record ? {id: record.id, value: {...version}, length: record.versions.length} : null;
  $('editHeading').textContent = record ? 'Edit memory' : 'New memory';
  const value = version || capture || {};
  for (const key of ['title','body','source']) $(key).value = value[key] || '';
  $('detail').hidden = true; $('editor').hidden = false; $('title').focus();
}

function currentFields() {
  return {title: $('title').value.trim(), body: $('body').value, source: $('source').value};
}

async function lockedScreen() {
  const generationAtStart = generation;
  const existing = (await readVault()) || readLegacyRaw();
  if (generationAtStart !== generation || session) return;
  $('gate').hidden = false; $('desk').hidden = true; $('backup').hidden = Boolean(existing);
  $('download').hidden = true; $('lock').hidden = true; $('legacyTools').hidden = true;
  $('unlockBtn').textContent = existing ? 'Unlock memory' : 'Create memory';
  $('pw').autocomplete = existing ? 'current-password' : 'new-password';
  $('hint').textContent = existing ? '' : 'Choose at least 12 characters, or open an encrypted backup below. Keep your passphrase for recovery.';
  $('merge').textContent = 'Open encrypted backup';
  status(existing ? 'Memory is locked.' : 'No encrypted memory is stored on this device.');
}

function unlock(next, loaded) {
  generation++; session = next; records = loaded;
  $('pw').value = ''; $('backupPw').value = ''; $('file').value = '';
  $('gate').hidden = true; $('desk').hidden = false; $('backup').hidden = false; $('lock').hidden = false;
  $('download').hidden = false; $('legacyTools').hidden = false; $('legacyForm').hidden = !readLegacyRaw(); $('merge').textContent = 'Merge backup';
  draw(); status('Memory unlocked.');
  if (pendingCapture) { const capture = pendingCapture; pendingCapture = null; edit(null, capture); }
}

function lock(render = true) {
  closePicker?.(); closePicker = null;
  generation++; session = null; records = []; selected = null; pendingCapture = null;
  clearEditor(); $('unlockForm').reset(); $('restore').reset(); $('legacyForm').reset(); $('seedForm').reset(); $('search').value = '';
  for (const id of ['list','count','history','recordTitle','recordBody','recordSource']) $(id).replaceChildren();
  $('detail').hidden = true; $('desk').hidden = true; $('backup').hidden = true; $('lock').hidden = true;
  status('Memory is locked.');
  if (render) lockedScreen().catch(e => status(e.message, true));
}

async function refresh() {
  const ticket = ++refreshNumber, active = session;
  if (!active) return lockedScreen();
  const entry = await readVault();
  if (!entry) throw new Error('Vault is missing. Restore an encrypted backup to recover.');
  const next = await openWithKey(entry.envelope, active);
  if (session === active && ticket === refreshNumber) { records = next; draw(); }
}

async function mutate(operation) {
  const active = session;
  if (!active) throw new Error('Unlock memory first.');
  for (let i = 0; i < 5; i++) {
    const prior = await readVault();
    if (!prior) throw new Error('Local memory was removed.');
    const current = await openWithKey(prior.envelope, active);
    const result = await operation(current);
    const envelope = await seal(result.records, active);
    if (session !== active) throw new Error('Memory locked before saving.');
    if (await commitVault(prior.revision, envelope)) {
      refreshNumber++;
      if (session === active) records = result.records;
      channel?.postMessage('changed'); return result;
    }
  }
  throw new Error('Another window is saving. Your draft is still open. Try again.');
}

$('unlockForm').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const token = generation, passphrase = $('pw').value, prior = await readVault();
    if (prior) {
      const opened = await openBackup(prior.envelope, passphrase);
      if (token === generation) unlock(opened.session, opened.records);
    } else {
      const legacy = readLegacyRaw();
      const imported = legacy ? await openLegacyBackup(legacy, passphrase) : [];
      const next = await newKey(passphrase), envelope = await seal(imported, next);
      if (legacy !== readLegacyRaw()) throw new Error('Earlier memory changed. Retry unlock.');
      if (token !== generation) return;
      if (!await commitVault(null, envelope)) throw new Error('Another window created memory. Unlock it with its passphrase.');
      if (token === generation) { unlock(next, imported); if (legacy) status('Earlier device memory opened · ' + imported.length + ' records.'); }
      channel?.postMessage('changed');
    }
  });
});

$('pickGraph').addEventListener('click', () => action(async () => {
  if (!session || !canLeaveDraft()) return;
  clearEditor();
  const active = session;
  const {chooseGraphEntry} = await import('./graph-picker.mjs');
  if (session === active) closePicker = chooseGraphEntry(value => { if (session === active) edit(null, value); });
}));
$('lock').addEventListener('click', () => { if (canLeaveDraft()) lock(); });
$('new').addEventListener('click', () => edit(null));
$('edit').addEventListener('click', () => edit(byId(selected)));
$('cancel').addEventListener('click', () => { if (canLeaveDraft()) { clearEditor(); draw(); } });
$('search').addEventListener('input', draw);
$('editor').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const fields = currentFields(), id = editBase?.id || crypto.randomUUID(), base = editBase;
    if (!fields.title) throw new Error('Enter a title.');
    await mutate(async current => {
      const prior = current.find(record => record.id === id);
      if (base && (!prior || prior.versions.length !== base.length || JSON.stringify(latest(prior)) !== JSON.stringify(base.value))) {
        throw new Error('This record changed in another window. Copy your draft, then reopen the record to apply it to the latest version.');
      }
      if (prior && Object.keys(fields).every(key => latest(prior)[key] === fields[key])) return {records: current};
      const value = {at: new Date().toISOString(), ...fields};
      const record = {id, versions: [...(prior?.versions || []), value]};
      return {records: prior ? current.map(r => r.id === id ? record : r) : [...current, record]};
    });
    if (!session) return;
    clearEditor(); selected = id; draw(); status('Memory saved.');
  });
});

$('download').addEventListener('click', () => action(async () => {
  if (!session) return;
  const prior = await readVault();
  const url = URL.createObjectURL(new Blob([JSON.stringify(prior.envelope)], {type:'application/json'}));
  const link = document.createElement('a'); link.href = url;
  link.download = 'brain-memory-' + new Date().toISOString().slice(0,10) + '.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000); status('Encrypted backup prepared.');
}));

$('restore').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const token = generation, file = $('file').files[0];
    if (!file || file.size > MAX_BACKUP_BYTES) throw new Error('Choose a valid encrypted backup under 22 MiB.');
    const passphrase = $('backupPw').value;
    let envelope;
    try { envelope = JSON.parse(await file.text()); } catch { throw new Error('The backup is not valid JSON.'); }
    let opened;
    if (envelope.format === LEGACY_BACKUP_FORMAT) {
      const records = await openLegacyBackup(JSON.stringify(envelope), passphrase);
      opened = {records, session: await newKey(passphrase)};
    } else { opened = await openBackup(envelope, passphrase); }
    if (token !== generation) return;
    if (!session) {
      if (readLegacyRaw()) throw new Error('Unlock existing device memory, then merge this backup.');
      const clean = await seal(opened.records, opened.session);
      if (token !== generation) return;
      if (!await commitVault(null, clean)) throw new Error('Unlock existing memory, then merge this backup.');
      if (token !== generation) return;
      unlock(opened.session, opened.records); status('Restored ' + opened.records.length + ' records.'); channel?.postMessage('changed');
    } else {
      const result = await mutate(current => mergeRecords(current, opened.records));
      if (!session) return;
      draw(); status('Merged · ' + result.added + ' added · ' + result.updated + ' updated · ' + result.conflicts + ' conflicting copies retained.');
    }
    $('restore').reset();
  });
});

$('legacyForm').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const active = session, raw = readLegacyRaw();
    if (!active || !raw) throw new Error('No earlier device memory is available.');
    const incoming = await openLegacyBackup(raw, $('legacyPw').value);
    if (session !== active) return;
    const result = await mutate(current => mergeRecords(current, incoming));
    if (session === active) { $('legacyForm').reset(); draw(); status('Earlier memory merged · ' + result.added + ' added · ' + result.updated + ' updated · ' + result.conflicts + ' conflicting copies.'); }
  });
});
$('seedForm').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    const active = session, file = $('seedFile').files[0];
    if (!active || !file || file.size > 2000000) throw new Error('Choose a Brain seed JSON file under 2 MB.');
    const raw = await file.text();
    if (session !== active) return;
    const result = await mutate(current => mergeLegacySeed(current, raw));
    if (session === active) { $('seedForm').reset(); draw(); status('Imported ' + result.added + ' records · ' + result.skipped + ' duplicates.'); }
  });
});

if ('BroadcastChannel' in window) {
  channel = new BroadcastChannel('grok-brain-memory-v1');
  channel.onmessage = () => refresh().catch(e => status(e.message, true));
}
addEventListener('focus', () => refresh().catch(e => status(e.message, true)));
addEventListener('pagehide', () => lock(false));
addEventListener('pageshow', event => { if (event.persisted) lockedScreen().catch(e => status(e.message, true)); });
if (parent !== window) {
  $('return').addEventListener('click', event => {
    event.preventDefault(); if (canLeaveDraft()) { lock(false); parent.postMessage({type:'brain-memory-close'}, location.origin); }
  });
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'brain-memory-capture') return;
    const {title,body,source} = event.data;
    if (![title,body,source].every(value => typeof value === 'string')) return;
    const capture = {title:title.slice(0,512), body:body.slice(0,200000), source:source.slice(0,60000)};
    if (session) edit(null, capture); else pendingCapture = capture;
  });
  parent.postMessage({type:'brain-memory-ready'}, location.origin);
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    addEventListener('focus', () => reg.update().catch(() => {}));
  }).catch(() => {});
}
lockedScreen().catch(() => status('Encrypted browser storage is unavailable. Allow site storage and reload.', true));
