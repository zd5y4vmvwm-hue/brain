const DATABASE = 'grok-brain-memory-v1';
const STORE = 'vault';
let connection;

function open() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => { connection = null; reject(request.error); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    });
  }
  return connection;
}

export async function readVault() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get('current');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// Encryption happens outside this short transaction. Compare-and-swap prevents
// another tab's complete encrypted snapshot from being silently overwritten.
export async function commitVault(previous, envelope) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get('current');
    let changed = false;
    request.onsuccess = () => {
      const current = request.result?.revision || null;
      if (current !== previous) return;
      store.put({revision: crypto.randomUUID(), envelope}, 'current');
      changed = true;
    };
    tx.oncomplete = () => resolve(changed);
    tx.onabort = () => reject(tx.error || new Error('Memory storage is unavailable.'));
    tx.onerror = () => reject(tx.error);
  });
}
