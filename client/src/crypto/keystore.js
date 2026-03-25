/**
 * KeyStore — persists crypto keys in IndexedDB
 * Keys never touch localStorage or the wire.
 */

const DB_NAME = 'paperphone_keys';
const DB_VERSION = 1;
const STORE = 'keystore';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function setKey(name, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, name);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}

export async function getKey(name) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(name);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function deleteKey(name) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}
