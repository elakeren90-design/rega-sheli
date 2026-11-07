// הקלטה: מיקרופון, טיימר, מד עוצמה. מותאם לאייפון (mp4/AAC) ולדפדפנים אחרים.

export class RecorderError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

// אייפון מקליט mp4. כרום יכול גם mp4 – עדיף, כי זה מתנגן בכל מקום.
const TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/aac',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

export function pickType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  for (const t of TYPES) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* */ }
  }
  return '';
}

export function setAudioSession(type) {
  try {
    if (navigator.audioSession && 'type' in navigator.audioSession) navigator.audioSession.type = type;
  } catch { /* */ }
}

function toArrayBuffer(blob) {
  if (blob.arrayBuffer) return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

export class Recorder {
  constructor({ onTick, onLevel, onInterrupted } = {}) {
    this.onTick = onTick;
    this.onLevel = onLevel;
    this.onInterrupted = onInterrupted;
    this.state = 'idle';
    this.chunks = [];
  }

  // נקרא מיד בלחיצה, כדי שהאייפון יאפשר את מד העוצמה
  prime() {
    this._cancelled = false;
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      }
    } catch {
      this.ctx = null;
    }
  }

  async start() {
    if (!window.isSecureContext) throw new RecorderError('insecure');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new RecorderError('unsupported');
    }
    this.state = 'starting';
    setAudioSession('play-and-record');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      this.state = 'idle';
      this._release();
      const n = err && err.name;
      if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') throw new RecorderError('denied', err);
      if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') throw new RecorderError('notfound', err);
      if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') throw new RecorderError('busy', err);
      throw new RecorderError('error', err);
    }

    if (this._cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      this.state = 'idle';
      this._release();
      throw new RecorderError('cancelled');
    }

    this.stream = stream;
    this.chunks = [];
    this.type = pickType();

    let rec;
    try {
      rec = this.type ? new MediaRecorder(stream, { mimeType: this.type }) : new MediaRecorder(stream);
    } catch {
      try {
        rec = new MediaRecorder(stream);
        this.type = '';
      } catch (err2) {
        this.state = 'idle';
        this._release();
        throw new RecorderError('unsupported', err2);
      }
    }

    this.rec = rec;
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
    rec.onerror = () => { if (this.state === 'recording' && this.onInterrupted) this.onInterrupted(); };
    // בלי חלוקה לקטעים: קובץ אחד שלם בסוף – הכי בטוח לניגון באייפון
    rec.start();

    this.startedAt = performance.now();
    this.state = 'recording';
    this._timer = setInterval(() => { if (this.onTick) this.onTick(this.elapsed()); }, 200);
    if (this.onTick) this.onTick(0);

    stream.getAudioTracks().forEach((t) => {
      t.addEventListener('ended', () => {
        if (this.state === 'recording' && this.onInterrupted) this.onInterrupted();
      });
    });

    this._startMeter();
    this._keepAwake();
  }

  elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  get metering() {
    return !!this._analyser;
  }

  stop() {
    if (this.state !== 'recording' || !this.rec) return Promise.resolve(null);
    this.state = 'stopping';
    const duration = this.elapsed();
    const rec = this.rec;

    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = async () => {
        if (finished) return;
        finished = true;
        const type = rec.mimeType || this.type || (this.chunks[0] && this.chunks[0].type) || 'audio/mp4';
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        this._release();
        this.state = 'idle';
        try {
          const buffer = await toArrayBuffer(blob);
          resolve({ buffer, type, size: blob.size, duration });
        } catch (e) {
          reject(e);
        }
      };
      rec.onstop = () => { finish(); };
      try {
        rec.stop();
      } catch {
        finish();
      }
      // אם האירוע לא הגיע מסיבה כלשהי
      setTimeout(finish, 4000);
    });
  }

  cancel() {
    this._cancelled = true;
    if (this.rec) {
      this.rec.ondataavailable = null;
      this.rec.onstop = null;
      try { if (this.rec.state !== 'inactive') this.rec.stop(); } catch { /* */ }
    }
    this.chunks = [];
    this._release();
    this.state = 'idle';
  }

  _startMeter() {
    try {
      if (!this.ctx || !this.stream) return;
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      const src = this.ctx.createMediaStreamSource(this.stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      this._src = src;
      this._analyser = an;
      const data = new Uint8Array(an.fftSize);
      let level = 0;
      const loop = () => {
        if (this.state !== 'recording' || !this._analyser) return;
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        level = level * 0.7 + Math.min(1, rms * 5) * 0.3;
        if (this.onLevel) this.onLevel(level);
        this._raf = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      this._analyser = null;
    }
  }

  async _keepAwake() {
    try {
      if ('wakeLock' in navigator) this._lock = await navigator.wakeLock.request('screen');
    } catch { /* */ }
  }

  _release() {
    clearInterval(this._timer);
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    try { if (this._src) this._src.disconnect(); } catch { /* */ }
    this._src = null;
    this._analyser = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      try { this.ctx.close(); } catch { /* */ }
      this.ctx = null;
    }
    if (this._lock) {
      this._lock.release().catch(() => {});
      this._lock = null;
    }
    setAudioSession('auto');
    this.rec = null;
    this.startedAt = 0;
  }
}
