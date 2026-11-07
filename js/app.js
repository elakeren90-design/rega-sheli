// רגע שלי · הלוגיקה של המסכים
import * as store from './store.js';
import { Recorder, setAudioSession } from './recorder.js';
import { buildBackupFile, asFile, importBackupFile } from './backup.js';
import { questionFor, dayNumber } from './questions.js';

const PALETTE = ['#E5A93F', '#D9735A', '#E596A3', '#9A6E9E', '#6A98C0', '#4C978F', '#97B079'];
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const ROT = -Math.PI / 2;

const $ = (id) => document.getElementById(id);
const el = {
  home: $('home'), today: $('today'), collection: $('collection'), dots: $('dots'), caption: $('collectionCaption'),
  btnWrite: $('btnWrite'), btnWriteIcon: $('btnWriteIcon'), writeHint: $('writeHint'),
  btnRecord: $('btnRecord'), btnRecordIcon: $('btnRecordIcon'), prompt: $('prompt'), journalLink: $('journalLink'),
  journal: $('journal'), journalBack: $('journalBack'), journalCount: $('journalCount'), journalList: $('journalList'),
  journalEmpty: $('journalEmpty'), emptyWrite: $('emptyWrite'), backupBtn: $('backupBtn'),
  writer: $('writer'), writerClose: $('writerClose'), writerTitle: $('writerTitle'), writerMeta: $('writerMeta'),
  writerAudio: $('writerAudio'), writerText: $('writerText'), draftStatus: $('draftStatus'), writerSave: $('writerSave'),
  recorder: $('recorder'), recCancel: $('recCancel'), recBody: $('recBody'), recOrb: $('recOrb'), recTime: $('recTime'),
  recStatus: $('recStatus'), recBlocked: $('recBlocked'), recBlockedTitle: $('recBlockedTitle'), recBlockedText: $('recBlockedText'),
  recToWrite: $('recToWrite'), recRetry: $('recRetry'), recFoot: $('recFoot'), recStop: $('recStop'),
  backup: $('backupModal'), lastBackup: $('lastBackup'), exportBtn: $('exportBtn'), exportSaveBtn: $('exportSaveBtn'),
  importBtn: $('importBtn'), importInput: $('importInput'), backupStatus: $('backupStatus'), backupClose: $('backupClose'),
  confirm: $('confirmModal'), confirmTitle: $('confirmTitle'), confirmText: $('confirmText'),
  confirmOk: $('confirmOk'), confirmCancel: $('confirmCancel'),
  toast: $('toast'),
};

const html = document.documentElement;
const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

const fmtDate = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDateYear = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtShort = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });

let entries = [];
let view = 'home';
let writing = null;
let currentDay = dayNumber();

/* ───────── עזרים ───────── */

function fmtDur(sec, floor = false) {
  const s = Math.max(0, floor ? Math.floor(sec) : Math.round(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function countLabel(n) {
  if (n === 1) return 'רגע אחד';
  if (n === 2) return 'שני רגעים';
  return `${n} רגעים`;
}

function colorOf(e) {
  return PALETTE[(Number(e && e.color) || 0) % PALETTE.length];
}

function nextColor() {
  const last = entries[0];
  let c = Math.floor(Math.random() * PALETTE.length);
  if (last && c === last.color) c = (c + 1 + Math.floor(Math.random() * (PALETTE.length - 1))) % PALETTE.length;
  return c;
}

function entryById(id) {
  return entries.find((x) => x.id === id) || (writing && writing.entry && writing.entry.id === id ? writing.entry : null);
}

function syncViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  html.style.setProperty('--vvh', vv.height + 'px');
  html.style.setProperty('--vvtop', vv.offsetTop + 'px');
  html.classList.toggle('kb-open', window.innerHeight - vv.height > 140);
}

let toastTimer = 0;
function showToast(msg, ms = 2200) {
  el.toast.textContent = msg;
  el.toast.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('is-on'), ms);
}

/* ───────── מסך הבית ───────── */

function renderToday() {
  const now = new Date();
  el.today.textContent = fmtDate.format(now);
  el.prompt.textContent = questionFor(now);
  currentDay = dayNumber(now);
}

function updateWriteHint() {
  const d = store.getDraft('new');
  el.writeHint.textContent = d && d.trim() ? 'יש טיוטה שמחכה לך' : 'מספיק משפט אחד';
}

// האוסף: הרגע הראשון במרכז, כל רגע חדש מצטרף בחוץ, כמו פרח שגדל.
// גדל עד בערך 60 רגעים, ואחר כך מתמלא ונהיה צפוף יותר.
function layout(n) {
  const MAX = 200;
  const NC = 13;
  const RATIO = 1.3;
  if (n <= 0) return { size: 84, c: 0, d: 0 };
  if (n === 1) return { size: 84, c: 0, d: 20 };
  const need = NC * Math.sqrt(n - 0.5) + (NC * RATIO) / 2 + 6;
  if (need * 2 <= MAX) return { size: Math.max(84, Math.ceil(need * 2)), c: NC, d: NC * RATIO };
  const c = (MAX / 2 - 6) / (Math.sqrt(n - 0.5) + RATIO / 2);
  return { size: MAX, c, d: Math.max(2.6, c * RATIO) };
}

function positions(n, c) {
  if (n === 1) return [{ x: 0, y: 0 }];
  const pts = [];
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const r = c * Math.sqrt(i + 0.5);
    const a = i * GOLDEN + ROT;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    pts.push({ x, y });
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const dx = (minX + maxX) / 2;
  const dy = (minY + maxY) / 2;
  return pts.map((p) => ({ x: p.x - dx, y: p.y - dy }));
}

function renderCollection(newId) {
  const list = entries.slice().reverse();
  const n = list.length;
  const { size, c, d } = layout(n);
  el.dots.style.setProperty('--s', size + 'px');
  el.collection.classList.toggle('has-dots', n > 0);

  const old = new Map();
  el.dots.querySelectorAll('.dot').forEach((dot) => old.set(dot.dataset.id, dot));
  const created = [];
  const pos = n ? positions(n, c) : [];
  list.forEach((e, i) => {
    let dot = old.get(e.id);
    if (dot) {
      old.delete(e.id);
    } else {
      dot = document.createElement('span');
      dot.className = 'dot';
      dot.dataset.id = e.id;
      dot.appendChild(document.createElement('i'));
      dot.style.transition = 'none';
      dot.firstChild.style.transition = 'none';
      if (e.id === newId) dot.classList.add('is-waiting');
      el.dots.appendChild(dot);
      created.push(dot);
    }
    dot.style.setProperty('--x', pos[i].x.toFixed(2) + 'px');
    dot.style.setProperty('--y', pos[i].y.toFixed(2) + 'px');
    dot.style.setProperty('--d', d.toFixed(2) + 'px');
    dot.style.setProperty('--c', colorOf(e));
  });
  old.forEach((dot) => dot.remove());
  if (created.length) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      created.forEach((dot) => { dot.style.transition = ''; dot.firstChild.style.transition = ''; });
    }));
  }
  el.caption.textContent = n ? countLabel(n) : 'הרגע הראשון שלך יופיע כאן';
  el.collection.setAttribute('aria-label', n ? `הרגעים שלי, ${countLabel(n)}` : 'הרגעים שלי');
}

// הרגע הקטן: ״נשמר 💛״ ונקודה צבעונית שעפה לאוסף
function celebrate(entry, fromEl) {
  showToast('נשמר 💛');
  renderCollection(entry.id);
  const dot = el.dots.querySelector(`.dot[data-id="${window.CSS && CSS.escape ? CSS.escape(entry.id) : entry.id}"]`);
  if (!dot) return;
  const color = colorOf(entry);
  if (reduceMotion.matches || !fromEl || typeof dot.animate !== 'function') {
    reveal(dot, color);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const f = fromEl.getBoundingClientRect();
    const field = el.dots.getBoundingClientRect();
    const x = parseFloat(dot.style.getPropertyValue('--x')) || 0;
    const y = parseFloat(dot.style.getPropertyValue('--y')) || 0;
    const d = parseFloat(dot.style.getPropertyValue('--d')) || 14;
    const from = { x: f.left + f.width / 2, y: f.top + f.height / 2 };
    const to = { x: field.left + field.width / 2 + x, y: field.top + field.height / 2 + y };
    const ctrl = { x: (from.x + to.x) / 2 + (to.x <= from.x ? 70 : -70), y: Math.min(from.y, to.y) - 60 };
    const fly = document.createElement('span');
    fly.className = 'fly-dot';
    fly.style.background = color;
    document.body.appendChild(fly);
    const endScale = Math.max(0.2, d / 20);
    const frames = [];
    const steps = 18;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      const px = u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x;
      const py = u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y;
      const s = t < 0.18 ? 0.35 + (t / 0.18) * 0.85 : 1.2 + (endScale - 1.2) * ((t - 0.18) / 0.82);
      frames.push({ transform: `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) scale(${s.toFixed(3)})`, offset: t });
    }
    const anim = fly.animate(frames, { duration: 950, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' });
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      fly.remove();
      reveal(dot, color);
    };
    anim.onfinish = finish;
    anim.oncancel = finish;
    setTimeout(finish, 1600);
  }));
}

function reveal(dot, color) {
  dot.classList.remove('is-waiting');
  const core = dot.firstElementChild;
  if (!core || typeof core.animate !== 'function' || reduceMotion.matches) return;
  core.animate([
    { transform: 'scale(0.2)' },
    { transform: 'scale(1.5)', offset: 0.55 },
    { transform: 'scale(1)' },
  ], { duration: 480, easing: 'ease-out' });
  const burst = document.createElement('span');
  burst.className = 'burst';
  burst.style.setProperty('--c', color);
  dot.appendChild(burst);
  setTimeout(() => burst.remove(), 800);
  el.dots.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 560, delay: 80, easing: 'ease-out' });
}

/* ───────── כתיבה ───────── */

let draftTimer = 0;
let saving = false;

function setDraftStatus(text) {
  el.draftStatus.textContent = text;
}

function openWriter(entry = null) {
  stopPlayback();
  const isEdit = !!entry;
  const key = isEdit ? entry.id : 'new';
  const draft = store.getDraft(key);
  writing = { mode: isEdit ? 'edit' : 'new', entry, key, original: isEdit ? (entry.text || '') : '' };
  el.writerText.value = draft != null ? draft : writing.original;

  if (isEdit) {
    el.writerTitle.textContent = entry.hasAudio && !entry.text ? 'טקסט להקלטה' : 'עריכת רגע';
    el.writerMeta.textContent = fmtTime.format(new Date(entry.createdAt));
    el.writerText.placeholder = entry.hasAudio ? 'כמה מילים על ההקלטה…' : questionFor();
    setDraftStatus(draft != null && draft !== writing.original ? 'שוחזרה טיוטה שלא נשמרה' : '');
  } else {
    el.writerTitle.textContent = 'רגע חדש';
    el.writerMeta.textContent = fmtTime.format(new Date());
    el.writerText.placeholder = questionFor();
    setDraftStatus(draft && draft.trim() ? 'ממשיכים מהטיוטה' : 'הטיוטה נשמרת תוך כדי');
  }

  el.writerAudio.replaceChildren();
  if (isEdit && entry.hasAudio) {
    el.writerAudio.appendChild(makePlayer(entry));
    el.writerAudio.hidden = false;
    preload(entry);
  } else {
    el.writerAudio.hidden = true;
  }

  el.writer.hidden = false;
  html.classList.add('sheet-open');
  // חייב לקרות מיד בלחיצה, כדי שהמקלדת תיפתח באייפון
  el.writerText.focus({ preventScroll: true });
  const len = el.writerText.value.length;
  try { el.writerText.setSelectionRange(len, len); } catch { /* */ }
  el.writerText.scrollTop = el.writerText.scrollHeight;
  updateSaveState();
}

function updateSaveState() {
  if (!writing) return;
  el.writerSave.disabled = writing.mode === 'new' && !el.writerText.value.trim();
}

function saveDraftNow() {
  if (!writing) return;
  const v = el.writerText.value;
  if (writing.mode === 'new') {
    if (v.trim()) {
      store.setDraft('new', v);
      setDraftStatus('הטיוטה נשמרה ✓');
    } else {
      store.clearDraft('new');
      setDraftStatus('הטיוטה נשמרת תוך כדי');
    }
  } else if (v !== writing.original) {
    store.setDraft(writing.key, v);
  } else {
    store.clearDraft(writing.key);
  }
}

async function saveWriter() {
  if (!writing || saving) return;
  clearTimeout(draftTimer);
  const text = el.writerText.value.trim();
  saving = true;
  try {
    if (writing.mode === 'new') {
      if (!text) return;
      const entry = store.newEntry({ text, color: nextColor() });
      await store.saveEntry(entry);
      store.clearDraft('new');
      entries.unshift(entry);
      closeWriter();
      updateWriteHint();
      if (view === 'journal') {
        renderJournal();
        renderCollection();
        showToast('נשמר 💛');
      } else {
        celebrate(entry, el.btnWriteIcon);
      }
      store.requestPersist();
      return;
    }

    const e = writing.entry;
    if (!text && !e.hasAudio) {
      el.writerText.blur();
      const ok = await confirmDialog({ title: 'הרגע ריק. למחוק אותו?', ok: 'למחוק', cancel: 'ביטול', danger: true });
      if (ok) {
        const key = writing.key;
        closeWriter();
        store.clearDraft(key);
        await removeEntry(e.id);
        showToast('נמחק');
      }
      return;
    }
    const changed = text !== (e.text || '');
    if (changed) {
      const updated = { ...e, text, updatedAt: Date.now() };
      await store.saveEntry(updated);
      entries = entries.map((x) => (x.id === e.id ? updated : x));
    }
    store.clearDraft(writing.key);
    closeWriter();
    if (view === 'journal') renderJournal();
    if (changed) showToast('נשמר 💛');
  } catch (err) {
    console.error(err);
    saveDraftNow();
    showToast('לא הצלחנו לשמור. הטקסט נשאר בטיוטה.', 3400);
  } finally {
    saving = false;
  }
}

async function requestCloseWriter() {
  if (!writing) return;
  clearTimeout(draftTimer);
  saveDraftNow();
  if (writing.mode === 'edit' && el.writerText.value.trim() !== (writing.original || '').trim()) {
    el.writerText.blur();
    const res = await confirmDialog({ title: 'לשמור את השינויים?', ok: 'לשמור', cancel: 'לא לשמור' });
    if (res === true) {
      saveWriter();
    } else if (res === false && writing) {
      store.clearDraft(writing.key);
      closeWriter();
    }
    return;
  }
  closeWriter();
  updateWriteHint();
}

function closeWriter() {
  el.writerText.blur();
  el.writer.hidden = true;
  html.classList.remove('sheet-open');
  stopPlayback();
  writing = null;
}

/* ───────── הקלטה ───────── */

const BLOCKED = {
  denied: {
    title: 'המיקרופון חסום',
    text: 'כדי להקליט צריך לאשר גישה למיקרופון. אפשר לאשר אותה בהגדרות האייפון, תחת ספארי ← מיקרופון. בינתיים אפשר לכתוב.',
    retry: true,
  },
  notfound: { title: 'לא נמצא מיקרופון', text: 'נראה שאין מיקרופון זמין כרגע. בינתיים אפשר לכתוב.', retry: true },
  busy: { title: 'המיקרופון תפוס', text: 'ייתכן ששיחה או אפליקציה אחרת משתמשות בו. אפשר לנסות שוב בעוד רגע, או לכתוב.', retry: true },
  unsupported: { title: 'אין כאן אפשרות להקליט', text: 'הדפדפן הזה לא תומך בהקלטה. כתיבה עובדת כרגיל.', retry: false },
  insecure: { title: 'אין כאן אפשרות להקליט', text: 'הקלטה עובדת רק כשהאפליקציה נפתחת מכתובת מאובטחת. כתיבה עובדת כרגיל.', retry: false },
  error: { title: 'ההקלטה לא התחילה', text: 'משהו השתבש. אפשר לנסות שוב, או לכתוב.', retry: true },
};

const recorder = new Recorder({
  onTick: (s) => { el.recTime.textContent = fmtDur(s, true); },
  onLevel: (lvl) => { el.recOrb.style.setProperty('--lvl', (0.6 + lvl * 0.45).toFixed(3)); },
  onInterrupted: () => { stopAndSave(); },
});

function setRecState(state, code) {
  el.recorder.dataset.state = state;
  const blocked = state === 'blocked';
  el.recBody.hidden = blocked;
  el.recFoot.hidden = blocked;
  el.recBlocked.hidden = !blocked;
  el.recOrb.classList.toggle('is-idle', state === 'starting' || state === 'saving');
  el.recOrb.classList.toggle('is-pulse', state === 'recording' && !recorder.metering);
  el.recStop.disabled = state !== 'recording';
  if (state === 'starting') {
    el.recTime.textContent = '0:00';
    el.recStatus.textContent = 'מחכים לאישור למיקרופון…';
    el.recOrb.style.removeProperty('--lvl');
  } else if (state === 'recording') {
    el.recStatus.textContent = 'מקליטים…';
  } else if (state === 'saving') {
    el.recStatus.textContent = 'שומרים…';
  } else if (blocked) {
    const m = BLOCKED[code] || BLOCKED.error;
    el.recBlockedTitle.textContent = m.title;
    el.recBlockedText.textContent = m.text;
    el.recRetry.hidden = !m.retry;
  }
}

function openRecorder() {
  if (recorder.state !== 'idle') return;
  stopPlayback();
  el.recorder.hidden = false;
  html.classList.add('sheet-open');
  beginRecording();
}

async function beginRecording() {
  recorder.prime();
  setRecState('starting');
  try {
    await recorder.start();
    if (el.recorder.hidden) {
      recorder.cancel();
      return;
    }
    setRecState('recording');
  } catch (err) {
    if (err && err.code === 'cancelled') return;
    console.warn(err);
    setRecState('blocked', err && err.code);
  }
}

async function stopAndSave() {
  if (recorder.state !== 'recording') return;
  if (!el.confirm.hidden) settleConfirm(null);
  setRecState('saving');
  let res;
  try {
    res = await recorder.stop();
  } catch (err) {
    console.error(err);
    closeRecorder();
    showToast('לא הצלחנו לשמור את ההקלטה', 3200);
    return;
  }
  if (!res || !res.size || res.duration < 0.5) {
    closeRecorder();
    showToast('ההקלטה הייתה קצרה מדי');
    return;
  }
  const entry = store.newEntry({ text: '', color: nextColor(), audio: { type: res.type, duration: res.duration } });
  try {
    await store.saveEntry(entry, { type: res.type, buffer: res.buffer });
  } catch (err) {
    console.error(err);
    closeRecorder();
    showToast('לא הצלחנו לשמור את ההקלטה', 3200);
    return;
  }
  entries.unshift(entry);
  closeRecorder();
  if (view === 'journal') {
    renderJournal();
    renderCollection();
    showToast('נשמר 💛');
  } else {
    celebrate(entry, el.btnRecordIcon);
  }
  store.requestPersist();
}

async function cancelRecording() {
  if (recorder.state === 'recording' && recorder.elapsed() > 4) {
    const ok = await confirmDialog({ title: 'לוותר על ההקלטה?', text: 'ההקלטה לא תישמר.', ok: 'לוותר', cancel: 'להמשיך להקליט', danger: true });
    if (!ok) return;
  }
  recorder.cancel();
  closeRecorder();
}

function closeRecorder() {
  el.recorder.hidden = true;
  html.classList.remove('sheet-open');
}

/* ───────── היומן ───────── */

let journalPushed = false;

function openJournal() {
  if (view === 'journal') return;
  view = 'journal';
  el.home.hidden = true;
  el.journal.hidden = false;
  renderJournal();
  window.scrollTo(0, 0);
  try {
    history.pushState({ v: 'journal' }, '', '#journal');
    journalPushed = true;
  } catch {
    journalPushed = false;
  }
}

function closeJournal(fromPop = false) {
  if (view !== 'journal') return;
  view = 'home';
  stopPlayback();
  releaseUrls();
  el.journal.hidden = true;
  el.home.hidden = false;
  window.scrollTo(0, 0);
  renderCollection();
  if (!fromPop && journalPushed) {
    journalPushed = false;
    history.back();
  } else {
    journalPushed = false;
  }
}

function dayLabel(d, k, todayN) {
  if (k === todayN) return 'היום';
  if (k === todayN - 1) return 'אתמול';
  return (d.getFullYear() === new Date().getFullYear() ? fmtDate : fmtDateYear).format(d);
}

function actionBtn(label, action, danger = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.dataset.action = action;
  if (danger) b.className = 'is-danger';
  return b;
}

function renderEntry(e) {
  const art = document.createElement('article');
  art.className = 'entry';
  art.dataset.id = e.id;
  art.style.setProperty('--c', colorOf(e));
  const when = new Date(e.createdAt);
  const time = document.createElement('time');
  time.className = 'entry__time';
  time.dateTime = when.toISOString();
  time.textContent = fmtTime.format(when);
  art.appendChild(time);
  if (e.text) {
    const p = document.createElement('p');
    p.className = 'entry__text';
    p.dir = 'auto';
    p.textContent = e.text;
    art.appendChild(p);
  }
  if (e.hasAudio) art.appendChild(makePlayer(e));
  const actions = document.createElement('div');
  actions.className = 'entry__actions';
  actions.append(actionBtn(e.hasAudio && !e.text ? 'להוסיף טקסט' : 'לערוך', 'edit'), actionBtn('למחוק', 'delete', true));
  art.appendChild(actions);
  return art;
}

function renderJournal() {
  const list = el.journalList;
  list.replaceChildren();
  el.journalCount.textContent = entries.length ? `· ${entries.length}` : '';
  el.journalEmpty.hidden = entries.length > 0;
  const todayN = dayNumber();
  let key = null;
  let section = null;
  for (const e of entries) {
    const d = new Date(e.createdAt);
    const k = dayNumber(d);
    if (k !== key) {
      key = k;
      section = document.createElement('section');
      section.className = 'day';
      const h = document.createElement('h3');
      h.className = 'day__title';
      h.textContent = dayLabel(d, k, todayN);
      section.appendChild(h);
      list.appendChild(section);
    }
    section.appendChild(renderEntry(e));
  }
  observePlayers();
}

async function deleteFlow(e) {
  const ok = await confirmDialog({ title: 'למחוק את הרגע הזה?', text: 'אי אפשר יהיה לשחזר אותו.', ok: 'למחוק', cancel: 'ביטול', danger: true });
  if (!ok) return;
  if (await removeEntry(e.id)) showToast('נמחק');
}

async function removeEntry(id) {
  if (playingId === id) stopPlayback();
  try {
    await store.deleteEntry(id);
  } catch (err) {
    console.error(err);
    showToast('לא הצלחנו למחוק', 3000);
    return false;
  }
  store.clearDraft(id);
  entries = entries.filter((x) => x.id !== id);
  dropUrl(id);
  if (view === 'journal') renderJournal();
  renderCollection();
  return true;
}

/* ───────── השמעה ───────── */

const audio = new Audio();
audio.preload = 'auto';
let playingId = null;
const urls = new Map();
const loading = new Map();
let io = null;

const PLAY_SVG = '<svg class="i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/></svg>';
const PAUSE_SVG = '<svg class="i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';

function makePlayer(e) {
  const p = document.createElement('div');
  p.className = 'player';
  p.dataset.id = e.id;
  p.innerHTML = `<button class="player__btn" type="button" aria-label="השמעה">${PLAY_SVG}${PAUSE_SVG}</button>`
    + '<div class="player__track"><div class="player__bar"><div class="player__fill"></div></div></div>'
    + '<span class="player__time"></span>';
  syncPlayer(p);
  return p;
}

function ensureUrl(id, typeHint) {
  if (urls.has(id)) return Promise.resolve(urls.get(id));
  if (loading.has(id)) return loading.get(id);
  const job = store.getAudio(id).then((a) => {
    loading.delete(id);
    if (!a || !a.buffer) throw new Error('missing-audio');
    const url = URL.createObjectURL(new Blob([a.buffer], { type: a.type || typeHint || 'audio/mp4' }));
    urls.set(id, url);
    return url;
  }, (err) => {
    loading.delete(id);
    throw err;
  });
  loading.set(id, job);
  return job;
}

function preload(e) {
  if (e && e.hasAudio) ensureUrl(e.id, e.audioType).catch(() => {});
}

function observePlayers() {
  if (io) io.disconnect();
  const players = el.journalList.querySelectorAll('.player');
  if (!('IntersectionObserver' in window)) {
    players.forEach((p) => preload(entryById(p.dataset.id)));
    return;
  }
  io = new IntersectionObserver((items) => {
    items.forEach((it) => {
      if (!it.isIntersecting) return;
      preload(entryById(it.target.dataset.id));
      io.unobserve(it.target);
    });
  }, { rootMargin: '700px 0px' });
  players.forEach((p) => io.observe(p));
}

function releaseUrls() {
  if (io) {
    io.disconnect();
    io = null;
  }
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
}

function dropUrl(id) {
  const u = urls.get(id);
  if (u) {
    URL.revokeObjectURL(u);
    urls.delete(id);
  }
}

function durationOf(e) {
  const d = audio.duration;
  if (e && playingId === e.id && Number.isFinite(d) && d > 0) return d;
  return (e && e.audioDuration) || 0;
}

function syncPlayer(p) {
  const id = p.dataset.id;
  const e = entryById(id);
  const active = id === playingId && !audio.ended;
  const playing = active && !audio.paused;
  p.classList.toggle('is-playing', playing);
  p.querySelector('.player__btn').setAttribute('aria-label', playing ? 'עצירה' : 'השמעה');
  const total = durationOf(e);
  const t = active ? audio.currentTime : 0;
  p.querySelector('.player__fill').style.width = active && total ? Math.min(100, (t / total) * 100) + '%' : '0%';
  p.querySelector('.player__time').textContent = active && t > 0 ? fmtDur(t, true) : fmtDur(total);
}

function syncPlayers(id) {
  document.querySelectorAll('.player').forEach((p) => {
    if (!id || p.dataset.id === id) syncPlayer(p);
  });
}

function playerError(id) {
  document.querySelectorAll('.player').forEach((p) => { if (p.dataset.id === id) p.classList.add('is-error'); });
  showToast('לא הצלחנו להשמיע את ההקלטה', 3000);
}

function togglePlay(id) {
  const e = entryById(id);
  if (!e) return;
  if (playingId === id && !audio.paused && !audio.ended) {
    audio.pause();
    return;
  }
  setAudioSession('playback');
  const url = urls.get(id);
  if (url) {
    startAudio(id, url);
    return;
  }
  ensureUrl(id, e.audioType).then((u) => startAudio(id, u)).catch(() => playerError(id));
}

function startAudio(id, url) {
  const prev = playingId;
  if (playingId !== id || audio.src !== url) {
    audio.src = url;
    playingId = id;
  } else if (audio.ended) {
    try { audio.currentTime = 0; } catch { /* */ }
  }
  if (prev && prev !== id) syncPlayers(prev);
  const p = audio.play();
  if (p && typeof p.catch === 'function') {
    p.catch((err) => {
      if (err && err.name === 'NotAllowedError') syncPlayers(id);
      else if (err && err.name !== 'AbortError') playerError(id);
    });
  }
}

function stopPlayback() {
  if (!playingId) return;
  const id = playingId;
  playingId = null;
  try { audio.pause(); } catch { /* */ }
  audio.removeAttribute('src');
  try { audio.load(); } catch { /* */ }
  syncPlayers(id);
}

['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange'].forEach((name) => {
  audio.addEventListener(name, () => { if (playingId) syncPlayers(playingId); });
});
audio.addEventListener('error', () => {
  if (playingId && audio.getAttribute('src')) playerError(playingId);
});

/* ───────── גיבוי ───────── */

let prepared = null;

function renderLastBackup() {
  const t = Number(store.getMeta('lastBackup'));
  el.lastBackup.textContent = t ? `גיבוי אחרון: ${fmtShort.format(new Date(t))}` : 'עוד לא נשמר גיבוי.';
}

function openBackup() {
  prepared = null;
  el.exportBtn.hidden = false;
  el.exportBtn.disabled = entries.length === 0;
  el.exportSaveBtn.hidden = true;
  el.importBtn.disabled = false;
  el.backupStatus.textContent = entries.length ? '' : 'עוד אין רגעים לגבות.';
  renderLastBackup();
  el.backup.hidden = false;
}

function closeBackup() {
  el.backup.hidden = true;
  prepared = null;
}

async function prepareBackup() {
  el.exportBtn.disabled = true;
  el.backupStatus.textContent = 'מכינים את הקובץ…';
  try {
    prepared = await buildBackupFile();
    el.exportBtn.hidden = true;
    el.exportSaveBtn.hidden = false;
    el.backupStatus.textContent = `הקובץ מוכן, ${countLabel(prepared.count)}.`;
  } catch (err) {
    console.error(err);
    el.exportBtn.disabled = false;
    el.backupStatus.textContent = 'לא הצלחנו להכין את הקובץ.';
  }
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function backupDone() {
  store.setMeta('lastBackup', Date.now());
  renderLastBackup();
  el.backupStatus.textContent = 'הגיבוי נשמר 💛';
}

// באייפון נפתח חלון השיתוף: לשמור בקבצים, לשלוח בוואטסאפ או במייל
function deliverBackup() {
  if (!prepared) return;
  let file = asFile(prepared, 'application/json');
  let canShare = false;
  try { canShare = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch { /* */ }
  if (!canShare) {
    try {
      const alt = asFile(prepared, 'text/plain');
      if (navigator.canShare && navigator.canShare({ files: [alt] })) {
        file = alt;
        canShare = true;
      }
    } catch { /* */ }
  }
  if (canShare && navigator.share) {
    navigator.share({ files: [file] }).then(backupDone).catch((err) => {
      if (err && err.name === 'AbortError') return;
      downloadFile(asFile(prepared));
      backupDone();
    });
    return;
  }
  downloadFile(asFile(prepared));
  backupDone();
}

function importMessage(r) {
  const parts = [];
  if (r.added === 1) parts.push('נוסף רגע אחד');
  else if (r.added > 1) parts.push(`נוספו ${countLabel(r.added)}`);
  if (r.updated === 1) parts.push('רגע אחד עודכן');
  else if (r.updated > 1) parts.push(`עודכנו ${countLabel(r.updated)}`);
  return parts.length ? parts.join(', ') + ' 💛' : 'כל הרגעים מהקובץ כבר היו כאן.';
}

async function runImport() {
  const file = el.importInput.files && el.importInput.files[0];
  if (!file) return;
  el.importBtn.disabled = true;
  el.backupStatus.textContent = 'משחזרים…';
  try {
    const r = await importBackupFile(file);
    entries = await store.listEntries();
    renderCollection();
    if (view === 'journal') renderJournal();
    el.backupStatus.textContent = importMessage(r);
    el.exportBtn.disabled = entries.length === 0;
  } catch (err) {
    console.error(err);
    el.backupStatus.textContent = err && err.code === 'bad' ? 'הקובץ הזה לא נראה כמו גיבוי של רגע שלי.' : 'לא הצלחנו לשחזר מהקובץ.';
  } finally {
    el.importBtn.disabled = false;
    el.importInput.value = '';
  }
}

/* ───────── חלון אישור ───────── */

let confirmResolve = null;

function confirmDialog({ title, text = '', ok = 'אישור', cancel = 'ביטול', danger = false }) {
  if (confirmResolve) settleConfirm(null);
  el.confirmTitle.textContent = title;
  el.confirmText.textContent = text;
  el.confirmOk.textContent = ok;
  el.confirmCancel.textContent = cancel;
  el.confirmOk.className = 'btn ' + (danger ? 'btn--danger' : 'btn--primary');
  el.confirm.hidden = false;
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function settleConfirm(value) {
  if (!confirmResolve) return;
  const resolve = confirmResolve;
  confirmResolve = null;
  el.confirm.hidden = true;
  resolve(value);
}

/* ───────── חיבורים ───────── */

function bind() {
  el.btnWrite.addEventListener('click', () => openWriter());
  el.btnRecord.addEventListener('click', () => openRecorder());
  el.collection.addEventListener('click', () => openJournal());
  el.journalLink.addEventListener('click', (ev) => { ev.preventDefault(); openJournal(); });
  el.journalBack.addEventListener('click', () => closeJournal());
  el.emptyWrite.addEventListener('click', () => { closeJournal(); openWriter(); });
  el.backupBtn.addEventListener('click', openBackup);

  el.writerText.addEventListener('input', () => {
    updateSaveState();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 300);
  });
  el.writerText.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      saveWriter();
    }
  });
  el.writerSave.addEventListener('click', saveWriter);
  el.writerClose.addEventListener('click', requestCloseWriter);

  el.recStop.addEventListener('click', stopAndSave);
  el.recCancel.addEventListener('click', cancelRecording);
  el.recToWrite.addEventListener('click', () => { recorder.cancel(); closeRecorder(); openWriter(); });
  el.recRetry.addEventListener('click', () => beginRecording());

  el.journalList.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const art = btn.closest('.entry');
    const e = art && entries.find((x) => x.id === art.dataset.id);
    if (!e) return;
    if (btn.dataset.action === 'edit') openWriter(e);
    else if (btn.dataset.action === 'delete') deleteFlow(e);
  });

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.player__btn');
    if (btn) {
      togglePlay(btn.closest('.player').dataset.id);
      return;
    }
    const track = ev.target.closest('.player__track');
    if (!track) return;
    const id = track.closest('.player').dataset.id;
    if (id !== playingId) {
      togglePlay(id);
      return;
    }
    const r = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (r.right - ev.clientX) / r.width));
    const total = durationOf(entryById(id));
    if (total) {
      try { audio.currentTime = frac * total; } catch { /* */ }
    }
  });

  el.exportBtn.addEventListener('click', prepareBackup);
  el.exportSaveBtn.addEventListener('click', deliverBackup);
  el.importBtn.addEventListener('click', () => el.importInput.click());
  el.importInput.addEventListener('change', runImport);
  el.backupClose.addEventListener('click', closeBackup);
  el.backup.addEventListener('click', (ev) => { if (ev.target === el.backup) closeBackup(); });

  el.confirmOk.addEventListener('click', () => settleConfirm(true));
  el.confirmCancel.addEventListener('click', () => settleConfirm(false));
  el.confirm.addEventListener('click', (ev) => { if (ev.target === el.confirm) settleConfirm(null); });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!el.confirm.hidden) settleConfirm(null);
    else if (!el.backup.hidden) closeBackup();
    else if (!el.writer.hidden) requestCloseWriter();
    else if (!el.recorder.hidden) cancelRecording();
    else if (view === 'journal') closeJournal();
  });

  window.addEventListener('popstate', () => { if (view === 'journal') closeJournal(true); });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (writing) {
        clearTimeout(draftTimer);
        saveDraftNow();
      }
      // אם האפליקציה נסגרת באמצע הקלטה, שומרים את מה שהוקלט
      if (recorder.state === 'recording') stopAndSave();
    } else if (dayNumber() !== currentDay) {
      renderToday();
      if (view === 'journal') renderJournal();
    }
  });
  window.addEventListener('pagehide', () => { if (writing) saveDraftNow(); });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }
  window.addEventListener('resize', syncViewport);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('service worker', err));
}

async function init() {
  if (location.hash) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch { /* */ }
  }
  syncViewport();
  bind();
  renderToday();
  updateWriteHint();
  try {
    entries = await store.listEntries();
  } catch (err) {
    console.error(err);
    showToast('אין אפשרות לשמור במכשיר הזה', 4000);
  }
  renderCollection();
  html.dataset.ready = '1';
  registerServiceWorker();
}

init();
