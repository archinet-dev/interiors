// db/idb.js — a tiny promise wrapper over IndexedDB (no library, per the stack constraint).
//
// Persists ONE session record (the edit history + pointer) so a refresh doesn't wipe the user's
// work. IndexedDB structured-clones Blobs natively, so image Blobs are stored/restored directly.

const DB_NAME = "space-makeover";
const STORE = "session";
const VERSION = 1;
const KEY = "current"; // single record holding { history, historyIndex }

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      // Drop the cached handle if the connection dies or another tab triggers a
      // versionchange — otherwise withStore() would keep using a dead handle and
      // persistence would silently break until a full reload. Nulling dbPromise
      // makes the next openDB() call reopen a fresh connection.
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null; // don't cache a rejected promise — allow a later retry
      reject(req.error);
    };
  });
  return dbPromise;
}

// Run fn(store) inside a transaction and resolve with the wrapped request's result.
async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Persist the session ({ history, historyIndex }). Blobs survive structured clone.
export function saveSession(session) {
  return withStore("readwrite", (store) => store.put(session, KEY));
}

export function loadSession() {
  return withStore("readonly", (store) => store.get(KEY));
}

export function clearSession() {
  return withStore("readwrite", (store) => store.delete(KEY));
}
