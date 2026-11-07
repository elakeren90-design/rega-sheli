// קובץ גיבוי: כל הרגעים, כולל ההקלטות, בקובץ אחד.
import { listEntries, getAudio, saveEntry } from './store.js';

const APP = 'rega-sheli';
const COLORS = 7;

export class BackupError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function toBase64(buffer) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(new Blob([buffer], { type: 'application/octet-stream' }));
  });
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function buildBackupFile() {
  const entries = await listEntries();
  const parts = ['{"app":"' + APP + '","version":1,"exportedAt":' + JSON.stringify(new Date().toISOString()) + ',"count":' + entries.length + ',"entries":['];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let audio = null;
    if (e.hasAudio) {
      const a = await getAudio(e.id);
      if (a && a.buffer) audio = { type: a.type || e.audioType || 'audio/mp4', data: await toBase64(a.buffer) };
    }
    parts.push((i ? ',' : '') + JSON.stringify({
      id: e.id,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt || e.createdAt,
      text: e.text || '',
      color: e.color,
      audioDuration: e.audioDuration || 0,
      audio,
    }));
  }
  parts.push(']}');
  const name = `גיבוי רגע שלי ${stamp()}.json`;
  return { parts, name, count: entries.length };
}

export function asFile(backup, type = 'application/json') {
  return new File(backup.parts, backup.name, { type });
}

function clean(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.createdAt !== 'number') return null;
  const text = typeof raw.text === 'string' ? raw.text : '';
  let audio = null;
  if (raw.audio && typeof raw.audio.data === 'string' && raw.audio.data) {
    try {
      audio = { type: String(raw.audio.type || 'audio/mp4'), buffer: fromBase64(raw.audio.data) };
    } catch {
      audio = null;
    }
  }
  if (!text.trim() && !audio) return null;
  const entry = {
    id: raw.id.slice(0, 100),
    createdAt: raw.createdAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : raw.createdAt,
    text,
    color: Number.isInteger(raw.color) ? Math.abs(raw.color) % COLORS : Math.floor(Math.random() * COLORS),
    hasAudio: !!audio,
    audioType: audio ? audio.type : null,
    audioDuration: audio ? Math.max(0, Number(raw.audioDuration) || 0) : 0,
  };
  return { entry, audio };
}

function readText(file) {
  if (file.text) return file.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}

// מוסיף רגעים מהקובץ. לא מוחק כלום. אם רגע קיים בשתי הגרסאות, הגרסה החדשה יותר נשארת.
export async function importBackupFile(file) {
  let data;
  try {
    data = JSON.parse(await readText(file));
  } catch {
    throw new BackupError('bad');
  }
  if (!data || data.app !== APP || !Array.isArray(data.entries)) throw new BackupError('bad');

  const existing = new Map((await listEntries()).map((e) => [e.id, e]));
  let added = 0;
  let updated = 0;
  let same = 0;
  for (const raw of data.entries) {
    const item = clean(raw);
    if (!item) continue;
    const cur = existing.get(item.entry.id);
    if (cur && (cur.updatedAt || 0) >= (item.entry.updatedAt || 0)) {
      same++;
      continue;
    }
    await saveEntry(item.entry, item.audio);
    if (cur) updated++;
    else added++;
  }
  return { added, updated, same };
}
