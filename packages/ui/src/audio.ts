/**
 * Sprachmemo aufnehmen (Mikrofon → MediaRecorder), Pegel messen und für die Spracherkennung aufbereiten.
 * Alles lokal im Browser; das Memo wird immer als Anhang gespeichert (Inhalt in IndexedDB «blobs»).
 */
import { newEventId, type Attachment, type Exercise } from "@lage/core";
import { putBlob } from "./store";

/** Kann dieses Gerät überhaupt aufnehmen? (sicherer Kontext, getUserMedia, MediaRecorder) */
export function canRecord(): boolean {
  try {
    return typeof window !== "undefined" && window.isSecureContext !== false && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  } catch {
    return false;
  }
}

/** Gibt es ein Mikrofon? (ohne Berechtigung: nur ob ein Eingang existiert; unbekannt = ja) */
export async function hasMicrophone(): Promise<boolean> {
  if (!canRecord()) return false;
  try {
    if (!navigator.mediaDevices.enumerateDevices) return true;
    const list = await navigator.mediaDevices.enumerateDevices();
    // manche Browser listen vor der Freigabe nichts auf – dann nicht ausblenden
    return list.length === 0 || list.some((d) => d.kind === "audioinput");
  } catch {
    return true;
  }
}

export type MicPermission = "granted" | "denied" | "prompt" | "unknown";
export async function micPermission(): Promise<MicPermission> {
  try {
    const s = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return s.state as MicPermission;
  } catch {
    return "unknown";
  }
}

/** Anleitung, wenn das Mikrofon verweigert wurde (je nach Gerät) */
export function micHelp(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return "Mikrofon gesperrt. iPhone/iPad: Einstellungen › Safari › Mikrofon › «Erlauben» (oder in der Adresszeile «aA» › Website-Einstellungen). Danach Seite neu laden.";
  }
  if (/Android/.test(ua)) return "Mikrofon gesperrt. Auf das Schloss links neben der Adresse tippen › Berechtigungen › Mikrofon › «Zulassen». Danach nochmals sprechen.";
  return "Mikrofon gesperrt. Auf das Schloss bzw. Symbol links neben der Adresse klicken › Mikrofon › «Zulassen», dann Seite neu laden.";
}

/** Aufnahmeformat: webm/opus (Chrome, Firefox, Edge) bzw. mp4/aac (Safari, iOS) */
export function pickMime(): string {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"];
  try {
    for (const m of c) if (MediaRecorder.isTypeSupported?.(m)) return m;
  } catch { /* egal */ }
  return "";
}

export interface Recording {
  blob: Blob;
  mime: string;
  /** Dauer in s */
  duration: number;
}

/** Fehler beim Start der Aufnahme – `reason` für die Anzeige */
export class MicError extends Error {
  constructor(public reason: "verweigert" | "kein-mikrofon" | "belegt" | "abgebrochen" | "unbekannt", msg: string) { super(msg); }
}

/**
 * Laufende Aufnahme. `onLevel` erhält ca. 30× pro Sekunde den Pegel 0…1 (für die Anzeige).
 */
export class Recorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private raf = 0;
  private t0 = 0;
  private done: Promise<Recording> | null = null;
  private cancelled = false;
  mime = "";

  constructor(private onLevel?: (level: number) => void) {}

  async start(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) {
      const n = (e as DOMException)?.name;
      if (n === "NotAllowedError" || n === "SecurityError") throw new MicError("verweigert", micHelp());
      if (n === "NotFoundError" || n === "OverconstrainedError") throw new MicError("kein-mikrofon", "Kein Mikrofon gefunden.");
      if (n === "NotReadableError" || n === "AbortError") throw new MicError("belegt", "Mikrofon wird von einer anderen App benutzt.");
      throw new MicError("unbekannt", "Mikrofon nicht verfügbar.");
    }
    this.stream = stream;
    // während des Starts abgebrochen (Esc, Freigabe-Dialog): Mikrofon sofort wieder frei geben
    if (this.cancelled) { this.release(); throw new MicError("abgebrochen", "Aufnahme abgebrochen."); }
    const mime = pickMime();
    try {
      this.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    } catch {
      try { this.rec = new MediaRecorder(stream); } catch { this.release(); throw new MicError("unbekannt", "Aufnahme in diesem Browser nicht möglich."); }
    }
    this.mime = this.rec.mimeType || mime || "audio/webm";
    this.chunks = [];
    this.rec.ondataavailable = (ev) => { if (ev.data.size) this.chunks.push(ev.data); };
    this.done = new Promise<Recording>((resolve) => {
      this.rec!.onstop = () => {
        const duration = (performance.now() - this.t0) / 1000;
        resolve({ blob: new Blob(this.chunks, { type: this.mime.split(";")[0] }), mime: this.mime.split(";")[0]!, duration });
      };
    });
    try {
      this.rec.start(250);
    } catch {
      this.release();
      throw new MicError("unbekannt", "Aufnahme konnte nicht starten.");
    }
    this.t0 = performance.now();
    this.meter();
  }

  /** Sekunden seit Start */
  elapsed(): number { return this.t0 ? (performance.now() - this.t0) / 1000 : 0; }

  private meter() {
    if (!this.onLevel || !this.stream) return;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const src = this.ctx.createMediaStreamSource(this.stream);
      const an = this.ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!;
        // RMS → grob logarithmisch auf 0…1 (Sprechen ≈ 0.4–0.9)
        const db = 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-6);
        this.onLevel?.(Math.max(0, Math.min(1, (db + 60) / 50)));
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* Pegel ist nur Anzeige */ }
  }

  private release() {
    cancelAnimationFrame(this.raf);
    this.ctx?.close().catch(() => { /* egal */ });
    this.ctx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** Aufnahme beenden und Memo zurückgeben */
  async stop(): Promise<Recording> {
    if (!this.rec || !this.done) throw new Error("keine Aufnahme");
    if (this.rec.state !== "inactive") this.rec.stop();
    const r = await this.done;
    this.release();
    return r;
  }

  /** Aufnahme verwerfen */
  cancel() {
    this.cancelled = true;
    try { if (this.rec && this.rec.state !== "inactive") this.rec.stop(); } catch { /* egal */ }
    this.release();
  }

  get isCancelled() { return this.cancelled; }
}

/**
 * Memo für Whisper aufbereiten: dekodieren, auf 16 kHz Mono umrechnen.
 * (Im Hauptfenster, weil Web Worker kein AudioContext haben.)
 */
export async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const data = await blob.arrayBuffer();
  const OAC = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  // decodeAudioData liefert die Abtastrate des Kontexts (16 kHz) – Umrechnung macht der Browser
  const ctx = new OAC(1, 16000, 16000);
  const buf = await new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && typeof p.then === "function") p.then(resolve, reject);
  });
  if (buf.sampleRate === 16000 && buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  return toMono16k(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)), buf.sampleRate);
}

/** Kanäle mitteln und linear auf 16 kHz umrechnen (Rückfall, falls der Browser nicht umrechnet) */
export function toMono16k(channels: Float32Array[], rate: number): Float32Array {
  const n = channels[0]?.length ?? 0;
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i]! += ch[i]! / channels.length;
  if (rate === 16000) return mono;
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(n / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    out[i] = (mono[i0] ?? 0) * (1 - f) + (mono[i0 + 1] ?? mono[i0] ?? 0) * f;
  }
  return out;
}

/** Metadaten zu einem neuen Sprachmemo */
export function memoAttachment(r: Recording): Attachment {
  return { id: `a${newEventId()}`, kind: "audio", mime: r.mime, createdAt: new Date().toISOString(), size: r.blob.size, duration: Math.round(r.duration * 10) / 10 };
}

/**
 * Memo speichern: Inhalt auf dem Gerät (IndexedDB), Metadaten in der Übung.
 * `stored: false` = Ton konnte nicht abgelegt werden (Speicher voll, privates Fenster) – die Metadaten
 * (und später das Transkript) bleiben trotzdem; der Ton bleibt im Arbeitsspeicher dieses Fensters (`putBlob`),
 * die Erkennung läuft damit und «Datei sichern» nimmt ihn mit.
 */
export async function saveMemo(r: Recording, update: (f: (x: Exercise) => Exercise) => void): Promise<{ att: Attachment; stored: boolean; error?: string }> {
  const att = memoAttachment(r);
  let stored = true;
  let error: string | undefined;
  try {
    await putBlob(att.id, r.blob);
  } catch (e) {
    stored = false;
    const n = (e as DOMException)?.name;
    error = n === "QuotaExceededError" || /quota/i.test(String((e as Error)?.message)) ? "Gerätespeicher voll" : "Gerätespeicher nicht verfügbar";
  }
  update((x) => { x.attachments = [...(x.attachments ?? []), att]; return x; });
  return { att, stored, error };
}

/** Transkript/Erkennung am Memo nachtragen */
export function patchAttachment(update: (f: (x: Exercise) => Exercise) => void, id: string, p: Partial<Attachment>) {
  update((x) => { x.attachments = (x.attachments ?? []).map((a) => (a.id === id ? { ...a, ...p } : a)); return x; });
}

/** «0:07», «1:23» */
export function fmtDuration(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
