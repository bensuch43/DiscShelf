// Thin promise wrapper over IndexedDB. All data stays on the device.
import { CONFIG } from './config.js';

let dbPromise;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (event.oldVersion < 1) {
          // Stores for later releases are created now so v0.3 needs no migration.
          db.createObjectStore('items', { keyPath: 'id' }).createIndex('ean', 'ean');
          db.createObjectStore('wants', { keyPath: 'id' }).createIndex('ean', 'ean');
          db.createObjectStore('priceLog', { keyPath: 'id' }).createIndex('wantId', 'wantId');
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (event.oldVersion < 2) {
          // 0.5.0: user-defined collections (checklists of films).
          db.createObjectStore('collections', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Let a newer version of the app (in another tab) upgrade the database.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Database upgrade blocked. Close other tabs or windows running DiscShelf, then reload.'));
    });
  }
  return dbPromise;
}

const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const completed = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
});

export const DATA_STORES = ['items', 'wants', 'priceLog', 'collections', 'meta'];
const RECORD_STORES = ['items', 'wants', 'priceLog', 'collections'];

export async function getAll(store) {
  const db = await openDb();
  return asPromise(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDb();
  return asPromise(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return completed(tx);
}

export async function remove(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return completed(tx);
}

export async function getMeta(key) {
  const row = await get('meta', key);
  return row ? row.value : undefined;
}

export function setMeta(key, value) {
  return put('meta', { key, value });
}

/**
 * Wipe every store and load the given data in one transaction.
 * Device-only meta (API keys, lookup cache, usage counter) is never in a
 * backup, so it is kept rather than wiped.
 */
export async function replaceAll(data, keepMeta = () => false) {
  const kept = (await getAll('meta')).filter((m) => keepMeta(m.key));
  const db = await openDb();
  const tx = db.transaction(DATA_STORES, 'readwrite');
  for (const name of DATA_STORES) {
    const store = tx.objectStore(name);
    store.clear();
    for (const row of data[name] || []) store.put(row);
  }
  for (const row of kept) tx.objectStore('meta').put(row);
  return completed(tx);
}

/** Merge by id: the record with the later updatedAt wins. Meta keys are upserted. */
export async function mergeAll(data) {
  const existing = {};
  for (const name of RECORD_STORES) {
    existing[name] = new Map((await getAll(name)).map((r) => [r.id, r]));
  }
  const db = await openDb();
  const tx = db.transaction(DATA_STORES, 'readwrite');
  const counts = { added: 0, updated: 0, kept: 0 };
  for (const name of RECORD_STORES) {
    const store = tx.objectStore(name);
    for (const row of data[name] || []) {
      const current = existing[name].get(row.id);
      if (!current) { store.put(row); counts.added += 1; }
      else if ((row.updatedAt || '') > (current.updatedAt || '')) { store.put(row); counts.updated += 1; }
      else counts.kept += 1;
    }
  }
  for (const row of data.meta || []) tx.objectStore('meta').put(row);
  await completed(tx);
  return counts;
}
