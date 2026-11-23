// This parser-blocking script runs before the app renders. The fragment is local
// to this page and removed before any vault, navigation or restore operation.
(() => {
  const prefix = '#import=v1.';
  let pending = null;
  function read() {
    const hash = location.hash;
    if (!hash || !hash.startsWith('#import=')) return;
    try {
      history.replaceState(history.state, '', location.pathname + location.search);
      if (!hash.startsWith(prefix) || hash.length > 32768) throw new Error();
      const encoded = hash.slice(prefix.length);
      if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) throw new Error();
      const ascii = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(ascii, char => char.charCodeAt(0));
      const e = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
      const allowed = ['format','version','kdf','iterations','salt','iv','ciphertext'];
      const base64 = value => typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
      if (!e || Object.keys(e).length !== allowed.length || !allowed.every(k => Object.hasOwn(e,k)) ||
          e.format !== 'grok-brain-memory-encrypted' || e.version !== 1 || e.kdf !== 'PBKDF2-SHA256' ||
          e.iterations !== 600000 || !base64(e.salt) || !base64(e.iv) || !base64(e.ciphertext) ||
          atob(e.salt).length !== 16 || atob(e.iv).length !== 12 || atob(e.ciphertext).length < 16) throw new Error();
      pending = {envelope:e};
    } catch {
      pending = {error:'This encrypted import link is invalid or too large. Open the original link again or choose its backup file.'};
    }
    window.dispatchEvent(new Event('brain-import-received'));
  }
  window.takeBrainImport = () => { const result = pending; pending = null; return result; };
  read();
  window.addEventListener('hashchange', read);
})();
