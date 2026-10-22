/**
 * Texterkennung (gedruckter Text) offline im Browser: tesseract.js mit deutscher Sprachdatei.
 * Alle Dateien liegen in der App unter `ocr/` (kein CDN). Sie werden erst beim Einschalten bzw. ersten Gebrauch geladen
 * (≈ 5 MB) und im Zwischenspeicher `lt-ocr-v1` abgelegt – den liest der Service Worker, danach geht es ohne Netz.
 * Die Erkennung läuft im Web Worker von tesseract.js (blockiert die Bedienung nicht).
 *
 * Handschrift erkennt tesseract kaum – dafür ist eine KI-Erkennung vorgesehen (Etappe 4c, siehe `HANDWRITING_KI`).
 */
import * as core from "@lage/core";
import type { Rect } from "./photo";

/** Ordner der Erkennungsdateien (scripts/assemble-site.mjs kopiert sie aus npm) */
export const OCR_DIR = "ocr/";
/** Zwischenspeicher (gleicher Name im Service Worker) */
export const OCR_CACHE = "lt-ocr-v1";
/** ab dieser mittleren Sicherheit (0–100) gilt die Erkennung als schlecht → Hinweis «Handschrift?» */
export const LOW_CONFIDENCE = 62;
/** Wörter unter dieser Sicherheit gelten als Störung (Flecken, Linienreste) */
const WORD_MIN = 45;
/** Zeilen unter dieser mittleren Sicherheit werden weggelassen */
const LINE_MIN = 40;
/** Etappe 4c: Handschrift mit KI erkennen (nur nach ausdrücklichem Einschalten). Bis dahin deaktiviert. */
export const HANDWRITING_KI = false;

export interface OcrLine { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
export interface OcrResult { text: string; confidence: number; lines: OcrLine[]; ms: number }
export interface OcrProgress { phase: "laden" | "erkennen"; /** 0..1 */ p: number; label: string }

const abs = (f: string) => new URL(OCR_DIR + f, document.baseURI).href;

/** Kern-Variante wie tesseract.js selbst (SIMD / Relaxed-SIMD, nur LSTM) */
async function coreFile(): Promise<string> {
  const { simd, relaxedSimd } = await import("wasm-feature-detect");
  if (await relaxedSimd()) return "tesseract-core-relaxedsimd-lstm.wasm.js";
  if (await simd()) return "tesseract-core-simd-lstm.wasm.js";
  return "tesseract-core-lstm.wasm.js";
}
const LANG_FILE = "deu.traineddata.gz";
const WORKER_FILE = "worker.min.js";

async function neededFiles(): Promise<string[]> {
  return [WORKER_FILE, await coreFile(), LANG_FILE];
}

/** Grösse der Dateien (für die Anzeige vor dem Laden; geschätzt) */
export const OCR_MB = 5;

export type OcrState = "fehlt" | "bereit" | "unbekannt";

/** Sind alle Dateien auf dem Gerät? */
export async function ocrState(): Promise<OcrState> {
  try {
    if (!("caches" in window)) return "unbekannt";
    const c = await caches.open(OCR_CACHE);
    for (const f of await neededFiles()) if (!(await c.match(abs(f)))) return "fehlt";
    return "bereit";
  } catch {
    return "unbekannt";
  }
}

/** Dateien laden und ablegen (mit Fortschritt in Bytes). Online nötig, sonst Fehler. */
export async function downloadOcr(onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const files = await neededFiles();
  const c = "caches" in window ? await caches.open(OCR_CACHE) : null;
  const todo: string[] = [];
  for (const f of files) if (!c || !(await c.match(abs(f)))) todo.push(f);
  if (!todo.length) { onProgress?.(1, 1); return; }
  const heads = await Promise.all(todo.map(async (f) => {
    try { const r = await fetch(abs(f), { method: "HEAD", signal }); return +(r.headers.get("content-length") ?? 0); } catch { return 0; }
  }));
  const total = heads.reduce((a, b) => a + b, 0) || OCR_MB * 1048576;
  let done = 0;
  for (const f of todo) {
    const r = await fetch(abs(f), { signal, cache: "reload" });
    if (!r.ok || !r.body) throw new Error(`Texterkennung: ${f} nicht geladen (${r.status})`);
    const reader = r.body.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      parts.push(value);
      done += value.length;
      onProgress?.(Math.min(done, total), total);
    }
    const blob = new Blob(parts as BlobPart[], { type: r.headers.get("content-type") ?? "application/octet-stream" });
    if (c) await c.put(abs(f), new Response(blob, { headers: { "content-type": blob.type, "content-length": String(blob.size) } }));
  }
  onProgress?.(total, total);
}

type TWorker = import("tesseract.js").Worker;
let workerP: Promise<TWorker> | null = null;
let idle: number | undefined;
let progressCb: ((p: OcrProgress) => void) | null = null;

const STATUS: Record<string, string> = {
  "loading tesseract core": "Erkennung wird gestartet",
  "initializing tesseract": "Erkennung wird gestartet",
  "loading language traineddata": "Sprachdatei Deutsch",
  "initializing api": "Erkennung wird gestartet",
  "recognizing text": "Text wird erkannt",
};

async function getWorker(): Promise<TWorker> {
  window.clearTimeout(idle);
  if (!workerP) {
    workerP = (async () => {
      const mod = await import("tesseract.js");
      // CommonJS-Paket: Funktionen je nach Bündelung unter «default»
      const T = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
      const w = await T.createWorker("deu", T.OEM.LSTM_ONLY, {
        workerPath: abs(WORKER_FILE),
        corePath: abs(await coreFile()),
        langPath: new URL(OCR_DIR, document.baseURI).href.replace(/\/$/, ""),
        workerBlobURL: false,
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          const label = STATUS[m.status] ?? m.status;
          progressCb?.({ phase: m.status === "recognizing text" ? "erkennen" : "laden", p: m.progress ?? 0, label });
        },
        errorHandler: () => { /* Fehler kommen über das Promise */ },
      });
      await w.setParameters({
        // ein Textblock, Zeilen von links nach rechts (Meldezettel, Journal-Tabelle)
        tessedit_pageseg_mode: T.PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return w;
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

/** Worker nach einer Weile ohne Gebrauch beenden (Speicher frei) */
function scheduleIdle() {
  window.clearTimeout(idle);
  idle = window.setTimeout(async () => {
    const p = workerP;
    workerP = null;
    try { (await p)?.terminate(); } catch { /* egal */ }
  }, 120000);
}

/** Erkennung starten und warten, bis sie bereit ist (lädt die Dateien, falls nötig) */
export async function warmOcr(onProgress?: (p: OcrProgress) => void): Promise<void> {
  progressCb = onProgress ?? null;
  try { await getWorker(); } finally { progressCb = null; scheduleIdle(); }
}

/** Text auf dem (aufbereiteten) Bild erkennen */
export async function recognize(img: HTMLCanvasElement | Blob, onProgress?: (p: OcrProgress) => void): Promise<OcrResult> {
  const t0 = performance.now();
  progressCb = onProgress ?? null;
  try {
    const w = await getWorker();
    const r = await w.recognize(img, {}, { text: true, blocks: true });
    // Prüfhilfe (nur Tests): aufbereitetes Bild ablesen
    const dbg = window as unknown as { __ltOcrDebug?: string | boolean };
    if (dbg.__ltOcrDebug && img instanceof HTMLCanvasElement) dbg.__ltOcrDebug = img.toDataURL("image/png");
    const lines: OcrLine[] = [];
    for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
      // unsichere Störwörter (Flecken, Ränder, Linienreste) weglassen
      const words = l.words.filter((w) => w.text.trim() && (w.confidence >= WORD_MIN || (w.confidence >= 15 && /^[\p{L}\d]{2,}$/u.test(w.text))));
      const text = words.map((w) => w.text).join(" ").trim();
      if (!/[\p{L}\d]{2}/u.test(text)) continue;
      const conf = words.reduce((a, w) => a + w.confidence * w.text.length, 0) / Math.max(1, words.reduce((a, w) => a + w.text.length, 0));
      if (conf < LINE_MIN) continue;
      lines.push({ text, confidence: conf, bbox: l.bbox });
    }
    // mittlere Sicherheit, gewichtet mit der Textlänge (kurze Störzeilen zählen wenig)
    const n = lines.reduce((a, l) => a + l.text.length, 0);
    const kept = n ? lines.reduce((a, l) => a + l.confidence * l.text.length, 0) / n : 0;
    // viel weggelassen (Handschrift, Fleck) → gesamthafte Sicherheit von tesseract zählt mit
    const confidence = Math.min(kept, Math.max(r.data.confidence, kept - 15));
    return { text: lines.map((l) => l.text).join("\n"), confidence, lines, ms: performance.now() - t0 };
  } finally {
    progressCb = null;
    scheduleIdle();
  }
}

// ---------------------------------------------------------------- Text → Meldungen

type Fn = (t: string) => string;
const kern = core as unknown as { cleanOcr?: Fn; splitMeldungen: (t: string) => string[] };

/** OCR-Fehler glätten: Kern (`cleanOcr`) und Grundregeln (Trennstriche, Leerzeichen, Störzeichen) */
export function cleanOcrText(t: string): string {
  let s = t.replace(/\r/g, "").replace(/[|¦]\s*$/gm, "").replace(/^[\s|¦_—–-]+$/gm, "")
    // Störzeichen am Zeilenanfang («[0755», «| H04»)
    .replace(/^[^\p{L}\d(«"]+/gmu, "");
  s = s.replace(/[ \t]+\|[ \t]+/g, " | ");
  s = kern.cleanOcr ? kern.cleanOcr(s) : s.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2");
  return s.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "").trim();
}

// ---------------------------------------------------------------- typische Lesefehler in Kurzmeldungen

const DIGIT: Record<string, string> = { O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", L: "1", "|": "1", i: "1", "!": "1", Z: "2", z: "2", S: "5", s: "5", G: "6", B: "8", g: "9", q: "9", T: "7" };
const toDigits = (s: string) => s.replace(/[OoDQIlL|i!ZzSsGBgqT]/g, (c) => DIGIT[c]!);
const DIRS = ["NO", "NW", "SO", "SW", "N", "O", "S", "W"];
/** Wortschatz zum Auftrennen zusammengeklebter Wörter («2FZAG13RIGN» → «2 Fz AG13 Rtg N») */
const VOCAB: Array<[RegExp, (m: string) => string]> = [
  [/^R[TI1lı]G/i, () => "Rtg"],
  [/^(?:KPZ|SPZ|PZ|FZ|LW|PW|PERS|INF|DET|GR|ZUG|HZ|GN|ZIV|NAI|STAO|BEO)/i, (m) => ({ KPZ: "Kpz", SPZ: "Spz", PZ: "Pz", FZ: "Fz", LW: "Lw", PW: "Pw", PERS: "Pers", INF: "Inf", DET: "Det", GR: "Gr", ZUG: "Zug", HZ: "Hz", GN: "gn", ZIV: "ziv", NAI: "NAI", STAO: "Stao", BEO: "Beo" } as Record<string, string>)[m.toUpperCase()]!],
  [/^H\d{2}/, (m) => m],
  [/^A[A-Z]\d{1,2}/, (m) => m],
  [/^\d{1,4}/, (m) => m],
  [new RegExp(`^(?:${DIRS.join("|")})`), (m) => m],
];
function segment(tok: string): string | null {
  const best: Array<string[] | null> = new Array(tok.length + 1).fill(null);
  best[0] = [];
  for (let i = 0; i < tok.length; i++) {
    if (!best[i]) continue;
    for (const [re, f] of VOCAB) {
      const m = re.exec(tok.slice(i));
      if (!m) continue;
      const j = i + m[0].length;
      const cand = [...best[i]!, f(m[0])];
      if (!best[j] || cand.length < best[j]!.length) best[j] = cand;
    }
  }
  const r = best[tok.length];
  return r && r.length >= 3 ? r.join(" ") : null;
}

/**
 * Lesefehler in einer Zeile korrigieren: Elemente («HO4» → H04, «HOS» → H05), Richtung («RIg» → Rtg),
 * Planquadrate («AES» → AE5, «AKLO» → AK10 – nur wenn es das Feld im Raster gibt), zusammengeklebte Kurzmeldungen.
 */
export function fixOcrTokens(line: string, isCell?: (c: string) => boolean): string {
  return line.split(/(\s+)/).map((t) => {
    if (/^\s*$/.test(t)) return t;
    const m = /^([^\p{L}\d]*)(.*?)([^\p{L}\d]*)$/u.exec(t)!;
    const [, pre, core, post] = m as unknown as [string, string, string, string];
    let c = core;
    if (/^[Hh][OoDQ0-9IlL|SsZzB]{2}$/.test(c)) c = "H" + toDigits(c.slice(1));
    else if (/^R[Iıil1t][gq]$/.test(c)) c = "Rtg";
    else if (/^\d\.(?:gn|ziv|Fz|Pers)$/i.test(c)) c = c.replace(".", " ");
    else if (/^A[A-Z][0-9OoDQIlL|SsZzGBTg]{1,2}$/.test(c) && /[^0-9]/.test(c.slice(2)) && isCell) {
      const cell = c.slice(0, 2) + toDigits(c.slice(2));
      if (isCell(cell)) c = cell;
    } else if (c.length >= 6 && /^[\p{Lu}\d]+$/u.test(c) && /\d/.test(c)) {
      const seg = segment(c);
      if (seg) c = seg;
    }
    return pre + c + post;
  }).join("");
}

const TIME_START = /^\s*(?:\d+[.)]\s*)?(?:T\d\s+)?[0-2]?\d[:.]?[0-5]\d\b/;
const HEADER = /^\s*(?:datum|zeit|meldung|lagejournal|journal|melder|nr\.?|seite\s*\d|blatt)\b/i;

/**
 * Erkannten Text in einzelne Meldungen trennen: `splitMeldungen` aus dem Kern; trennt der (noch) nicht,
 * hier nach Zeilen mit Zeitangabe am Anfang (Folgezeilen hängen an der vorherigen).
 */
export function ocrToMeldungen(text: string, isCell?: (c: string) => boolean): string[] {
  const clean = cleanOcrText(text).split("\n").map((l) => fixOcrTokens(l, isCell)).join("\n");
  const k = kern.splitMeldungen(clean).map((x) => x.trim()).filter(Boolean);
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  if (k.length > 1 || lines.length <= 1) return k.map(tidy).filter(Boolean);
  const out: string[] = [];
  for (const l of lines) {
    if (HEADER.test(l) && !TIME_START.test(l)) continue;
    if (TIME_START.test(l) || !out.length) out.push(l);
    else out[out.length - 1] += " " + l;
  }
  return out.map(tidy).filter(Boolean);
}

/** Tabellenstriche zu Leerzeichen; Visum-Kürzel/Störzeichen am Ende («… Rtg N mb», «\\s») weg */
const tidy = (s: string) => {
  let t = s.replace(/\s*[|¦]\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  for (let k = 0; k < 3; k++) if (!/\s(?:ab|an|in|um|zu|da|ob|vor|aus)$/i.test(t)) t = t.replace(/\s+(?:[\\/|}{\]\[()~_.,;:'"‚„“”-]*[a-zäöü]{0,2}[\\/|}{\]\[~_.,;:'"‚„“”-]*)$/u, "").trim();
  return t;
};

/** Zeilen mit Bildlage → Herkunft für die Anzeige («Zeile 3») */
export function originOf(stamp: string, i: number, n: number): string {
  return n > 1 ? `${stamp}, Meldung ${i + 1}` : stamp;
}

export type { Rect };
