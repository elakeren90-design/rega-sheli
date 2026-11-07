// שמירה במכשיר: רשומות והקלטות ב־IndexedDB, טיוטות ב־localStorage.

const DB_NAME = 'rega-sheli';
const DB_VERSION = 1;
const LS = 'rega-sheli:';

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('no-indexeddb'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('audio')) {
        db.createObjectStore('audio', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listEntries() {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  const all = await result(tx.objectStore('entries').getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getEntry(id) {
  const db = await openDB();
  const tx = db.transaction('entries', 'readonly');
  return result(tx.objectStore('entries').get(id));
}

// audio: { type, buffer } – ההקלטה נשמרת כ־ArrayBuffer (הכי יציב בספארי)
export async function saveEntry(entry, audio) {
  const db = await openDB();
  const tx = db.transaction(['entries', 'audio'], 'readwrite');
  tx.objectStore('entries').put(entry);
  if (audio && audio.buffer) {
    tx.objectStore('audio').put({ id: entry.id, type: audio.type || '', buffer: audio.buffer });
  } else if (!entry.hasAudio) {
    tx.objectStore('audio').delete(entry.id);
  }
  await done(tx);
  return entry;
}

export async function getAudio(id) {
  const db = await openDB();
  const tx = db.transaction('audio', 'readonly');
  return result(tx.objectStore('audio').get(id));
}

export async function deleteEntry(id) {
  const db = await openDB();
  const tx = db.transaction(['entries', 'audio'], 'readwrite');
  tx.objectStore('entries').delete(id);
  tx.objectStore('audio').delete(id);
  await done(tx);
}

export function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function newEntry({ text = '', color = 0, audio = null } = {}) {
  const now = Date.now();
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    text,
    color,
    hasAudio: !!audio,
    audioType: audio ? audio.type : null,
    audioDuration: audio ? audio.duration : 0,
  };
}

// טיוטות
export function getDraft(key) {
  try {
    const raw = localStorage.getItem(LS + 'draft:' + key);
    if (raw == null) return null;
    const o = JSON.parse(raw);
    return typeof o.text === 'string' ? o.text : null;
  } catch {
    return null;
  }
}

export function setDraft(key, text) {
  try {
    localStorage.setItem(LS + 'draft:' + key, JSON.stringify({ text, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key) {
  try { localStorage.removeItem(LS + 'draft:' + key); } catch { /* */ }
}

export function getMeta(key) {
  try { return localStorage.getItem(LS + key); } catch { return null; }
}

export function setMeta(key, value) {
  try { localStorage.setItem(LS + key, String(value)); } catch { /* */ }
}

// לבקש מהדפדפן לא למחוק את הנתונים כשחסר מקום
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      if (!already) await navigator.storage.persist();
    }
  } catch { /* */ }
}
