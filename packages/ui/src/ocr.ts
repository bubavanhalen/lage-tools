/**
 * Texterkennung (gedruckter Text) offline im Browser: tesseract.js mit deutscher Sprachdatei.
 * Alle Dateien liegen in der App unter `ocr/` (kein CDN). Sie werden erst beim Einschalten bzw. ersten Gebrauch geladen
 * (≈ 5 MB) und im Zwischenspeicher `lt-ocr-v1` abgelegt – den liest der Service Worker, danach geht es ohne Netz.
 * Die Erkennung läuft im Web Worker von tesseract.js (blockiert die Bedienung nicht).
 *
 * Handschrift erkennt tesseract kaum – dafür ist eine KI-Erkennung vorgesehen (Etappe 4c, siehe `HANDWRITING_KI`).
 */
import * as core from "@lage/core";
import { boxBlur, prepareForOcr, rotateGray, textAxis, type Gray, type OcrPrep, type PhotoQuality, type Rect } from "./photo";

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

/** Wörter, die fast sicher zu einer Meldung gehören (Zeit, Element, Planquadrat) – auch bei geringer Sicherheit behalten */
const KEY_WORD = /^[^\p{L}\d]*(?:[0-2Oo]?[0-9OoIl][0-5Oo][0-9OoIlSB]|[Hh][O0o\d]{1,2}\d|A[A-Z]\d{1,2}|NAI)[^\p{L}\d]*$/u;

/**
 * Unsichere Störwörter (Flecken, Ränder, Linienreste) einer Zeile weglassen; ganze Zeile weg, wenn unsicher.
 * @returns Text und mittlere Sicherheit, oder null
 */
export function filterLine(words: Array<{ text: string; confidence: number }>): { text: string; confidence: number } | null {
  const kept = words.filter((w, i) => w.text.trim() && (w.confidence >= WORD_MIN
    // Richtung nach «Rtg» («Rtg S» – einzelner Buchstabe, oft unsicher gelesen)
    || (w.confidence >= 10 && /^(?:N|NO|NW|O|S|SO|SW|W)$/.test(w.text) && /^R[t1lI]g$/i.test(words[i - 1]?.text ?? "")) || (w.confidence >= 15 && /^[\p{L}\d]{2,}$/u.test(w.text)) || KEY_WORD.test(w.text)
    // zusammengeklebte Kurzmeldung («2FzAG13RIgN») – unsicher, wird danach aufgetrennt
    || (w.confidence >= 3 && /^[\p{L}\d]{6,}$/u.test(w.text) && /\d/.test(w.text) && /\p{L}/u.test(w.text))));
  const text = kept.map((w) => w.text).join(" ").trim();
  if (!/[\p{L}\d]{2}/u.test(text)) return null;
  const confidence = kept.reduce((a, w) => a + w.confidence * w.text.length, 0) / Math.max(1, kept.reduce((a, w) => a + w.text.length, 0));
  return confidence < LINE_MIN && !KEY_WORD.test(kept[0]?.text ?? "") ? null : { text, confidence };
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

/** Erkennung sofort beenden (Abbrechen): Worker beenden, beim nächsten Mal neu starten (Dateien sind im Speicher) */
export function cancelOcr(): void {
  window.clearTimeout(idle);
  const p = workerP;
  workerP = null;
  progressCb = null;
  p?.then((w) => w.terminate()).catch(() => { /* egal */ });
}

/** Abbruch durch den Benutzer */
export class OcrAbort extends Error {
  constructor() { super("Texterkennung abgebrochen"); this.name = "AbortError"; }
}
/** Versprechen, das beim Abbrechen sofort mit `OcrAbort` endet */
export function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((res, rej) => {
    if (signal.aborted) { rej(new OcrAbort()); return; }
    const on = () => rej(new OcrAbort());
    signal.addEventListener("abort", on, { once: true });
    p.then((v) => { signal.removeEventListener("abort", on); res(v); }, (e) => { signal.removeEventListener("abort", on); rej(e); });
  });
}

/** Text auf dem (aufbereiteten) Bild erkennen; `signal` bricht sofort ab (Worker wird beendet) */
export async function recognize(img: HTMLCanvasElement | Blob, onProgress?: (p: OcrProgress) => void, signal?: AbortSignal): Promise<OcrResult> {
  const t0 = performance.now();
  progressCb = onProgress ?? null;
  const stop = () => cancelOcr();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const w = await abortable(getWorker(), signal);
    const r = await abortable(w.recognize(img, {}, { text: true, blocks: true }), signal);
    // Prüfhilfe (nur Tests): aufbereitetes Bild ablesen
    const dbg = window as unknown as { __ltOcrDebug?: string | boolean };
    if (dbg.__ltOcrDebug && img instanceof HTMLCanvasElement) {
      dbg.__ltOcrDebug = img.toDataURL("image/png");
      (window as unknown as { __ltOcrWords?: string }).__ltOcrWords = (r.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => l.words.map((w) => `${w.text}(${Math.round(w.confidence)})`).join(" ")))).join("\n");
    }
    return { ...linesFromBlocks(r.data), ms: performance.now() - t0 };
  } finally {
    signal?.removeEventListener("abort", stop);
    progressCb = null;
    if (workerP) scheduleIdle();
  }
}

export interface OrientedResult extends OcrResult {
  /** Drehung in Vierteln im Uhrzeigersinn, mit der erkannt wurde (0 = wie fotografiert) */
  rotation: number;
  quality: PhotoQuality;
}

/**
 * Erkennen mit automatischer Ausrichtung: Laufen die Zeilen senkrecht (Foto quer), wird das Papier um 90° gedreht
 * (beide Richtungen probiert); ist die Sicherheit tief und das Bild gut, wird auch 180° probiert. Bestes Ergebnis zählt.
 * `rec` erkennt ein aufbereitetes Graustufenbild (Browser: tesseract-Worker; Tests: Ersatz).
 */
export async function recognizeOriented(prep: OcrPrep, rec: (g: Gray, attempt: number) => Promise<OcrResult>, signal?: AbortSignal): Promise<OrientedResult> {
  const axis = textAxis(prep.g);
  const vertical = axis < 0.4;
  const order = vertical ? [3, 1] : [0];
  const t0 = performance.now();
  let best: OrientedResult | null = null;
  const score = (r: OcrResult) => (r.text.replace(/\s/g, "").length < 6 ? 0 : r.confidence);
  const tryRot = async (q: number, attempt: number, soft = false) => {
    if (signal?.aborted) throw new OcrAbort();
    const paper = q ? rotateGray(prep.paper, q) : prep.paper;
    const g = soft ? prepareForOcr(boxBlur(paper, 1)) : q ? prepareForOcr(paper) : prep.g;
    const r = await rec(g, attempt);
    if (!best || score(r) > score(best)) best = { ...r, rotation: q, quality: prep.quality };
  };
  await tryRot(order[0]!, 0);
  if (score(best!) < LOW_CONFIDENCE) {
    if (vertical) await tryRot(order[1]!, 1);
    else if (prep.quality.verdict === "gut") await tryRot(2, 1);
    // verrauscht/unscharf: noch einmal leicht geglättet (Rauschen weg, Schrift bleibt)
    else await tryRot(0, 1, true);
  }
  return { ...best!, ms: performance.now() - t0 };
}

interface TWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface TData { confidence: number; blocks?: Array<{ bbox?: TWord["bbox"]; paragraphs: Array<{ lines: Array<{ words: TWord[]; bbox: TWord["bbox"] }> }> }> | null }

/** Einheiten am Zeilenende gehören zur Meldung («Höhe ca 100 m») */
const UNIT_RE = /^(?:m|km|cm|mm|min|h|s|kg|t|l|°)$/i;

/**
 * Visum-Spalte weglassen: kurzes Kürzel (1–4 Zeichen) am Zeilenende, weit vom Text abgesetzt (Lücke > 3 Zeilenhöhen) –
 * z. B. «… Rtg O                ab». Einheiten nur, wenn sie ebenso weit weg stehen.
 */
export function dropVisum(words: TWord[]): TWord[] {
  let ws = words;
  // Tabellenstrich/Störzeichen ganz rechts («ab |») zuerst weg
  while (ws.length && !/[\p{L}\d]/u.test(ws[ws.length - 1]!.text)) ws = ws.slice(0, -1);
  // Formularfeld «Absender     H05» ist kein Visum: erst ab drei Wörtern (Zeit, Melder, Text …)
  if (ws.length < 3) return ws;
  const last = ws[ws.length - 1]!;
  const prev = ws[ws.length - 2]!;
  const hs = ws.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const lh = Math.max(8, hs[Math.floor(hs.length / 2)]!);
  const gap = last.bbox.x0 - prev.bbox.x1;
  // Kürzel aus Buchstaben (nicht «H05», «AK7», Zahl)
  if (/^[^\d\s]{1,4}$/u.test(last.text.trim()) && gap > 3 * lh) return ws.slice(0, -1);
  return ws;
}

/**
 * Zeilen aus dem Ergebnis von tesseract: Visum weg, unsichere Störwörter weg, Zeile allein mit einem Kürzel ganz rechts
 * (Visum, das tesseract als eigene Zeile liest) weg. Sicherheit gewichtet mit der Textlänge.
 */
export function linesFromBlocks(data: TData): { text: string; confidence: number; lines: OcrLine[] } {
  const lines: OcrLine[] = [];
  const all = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const right = Math.max(1, ...all.map((l) => l.bbox.x1));
  for (const l of all) {
    const words = dropVisum(l.words.filter((w) => w.text.trim()));
    if (words.length === 1 && /^\p{L}{1,3}$/u.test(words[0]!.text.trim()) && words[0]!.bbox.x0 > right * 0.7) continue;
    const f = filterLine(words);
    if (f) lines.push({ ...f, bbox: l.bbox });
  }
  // mittlere Sicherheit, gewichtet mit der Textlänge (kurze Störzeilen zählen wenig)
  const n = lines.reduce((a, l) => a + l.text.length, 0);
  const kept = n ? lines.reduce((a, l) => a + l.confidence * l.text.length, 0) / n : 0;
  // viel weggelassen (Handschrift, Fleck) → gesamthafte Sicherheit von tesseract zählt mit
  const confidence = Math.min(kept, Math.max(data.confidence, kept - 15));
  return { text: lines.map((l) => l.text).join("\n"), confidence, lines };
}

// ---------------------------------------------------------------- Text → Meldungen

type Fn = (t: string, o?: core.CleanOcrOptions) => string;
const kern = core as unknown as { cleanOcr?: Fn; splitMeldungen: (t: string) => string[] };

/** OCR-Fehler glätten: Kern (`cleanOcr`) und Grundregeln (Trennstriche, Leerzeichen, Störzeichen) */
export function cleanOcrText(t: string, opts?: core.CleanOcrOptions): string {
  let s = t.replace(/\r/g, "").replace(/[|¦]\s*$/gm, "").replace(/^[\s|¦_—–-]+$/gm, "")
    // Störzeichen am Zeilenanfang («[0755», «| H04»)
    .replace(/^[^\p{L}\d(«"]+/gmu, "");
  s = s.replace(/[ \t]+\|[ \t]+/g, " | ");
  s = kern.cleanOcr ? kern.cleanOcr(s, opts) : s.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2");
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
  [/^A[A-Z]\d{1,2}(?:[A-D](?![a-z]))?/, (m) => (/[A-D]$/.test(m) && /\d[A-D]$/.test(m) ? m.slice(0, -1) + " " + m.slice(-1) : m)],
  [/^\d{1,4}/, (m) => m],
  [new RegExp(`^(?:${DIRS.join("|")})`), (m) => m],
];
function segment(tok: string): string | null {
  type St = { parts: string[]; cost: number; skips: number } | null;
  const best: St[] = new Array(tok.length + 1).fill(null);
  best[0] = { parts: [], cost: 0, skips: 0 };
  const put = (j: number, st: NonNullable<St>) => { if (!best[j] || st.cost < best[j]!.cost) best[j] = st; };
  for (let i = 0; i < tok.length; i++) {
    const b = best[i];
    if (!b) continue;
    for (const [re, f] of VOCAB) {
      const m = re.exec(tok.slice(i));
      if (m) put(i + m[0].length, { parts: [...b.parts, f(m[0])], cost: b.cost + 1, skips: b.skips });
    }
    // höchstens ein Störzeichen überspringen (z. B. doppelt gelesenes «Z»)
    if (b.skips < 1 && /\p{L}/u.test(tok[i]!)) put(i + 1, { parts: b.parts, cost: b.cost + 3, skips: b.skips + 1 });
  }
  const r = best[tok.length];
  return r && r.parts.length >= 3 ? r.parts.join(" ") : null;
}

/**
 * Lesefehler in einer Zeile korrigieren: Elemente («HO4» → H04, «HOS» → H05), Richtung («RIg» → Rtg),
 * Planquadrate («AES» → AE5, «AKLO» → AK10 – nur wenn es das Feld im Raster gibt), zusammengeklebte Kurzmeldungen.
 */
export function fixOcrTokens(line: string, isCell?: (c: string) => boolean): string {
  return line.split(/(\s+)/).map((t) => {
    if (/^\s*$/.test(t)) return t;
    // einzelnes Störzeichen (Tabellenstrich, Fleck) zwischen Zeit und Melder: weg
    if (/^[\\|)(\][{}!'‚„`´^~]$/.test(t)) return "";
    const m = /^([^\p{L}\d]*)(.*?)([^\p{L}\d]*)$/u.exec(t)!;
    let [, pre, core, post] = m as unknown as [string, string, string, string];
    // Störzeichen vor Melder/Planquadrat («!'H05», «)H01»)
    if (/^[\\|)(\][{}!'‚„`´]+$/.test(pre) && /^(?:[Hh][O0o\d]|A[A-Z]\d)/.test(core)) pre = "";
    let c = core;
    if (/^[Hh][OoDQ0-9IlL|SsZzB]{2,3}$/.test(c)) c = "H" + toDigits(c.slice(1).replace(/[Oo]{2}/, "O")).slice(0, 2);
    else if (/^[0-2Oo][0-9OoIlSB][0-5Oo][0-9OoIlSB]$/.test(c) && /\d/.test(c)) c = toDigits(c);
    else if (/^R[Iıil1t][gq]$/.test(c)) c = "Rtg";
    else if (/^R[Iıil1tT][gqGQ](N|NO|O|SO|S|SW|W|NW)$/.test(c)) c = "Rtg " + c.slice(3);
    else if (/^R[Iıil1tT][GQ]$/.test(c)) c = "Rtg";
    else if (/^[2z]iv$/.test(c)) c = "ziv";
    // «3RtgS», «3RtgSW» (Leerschläge verschluckt)
    else if (/^\d{1,2}R[tTIl1ı][gq](?:N|NO|O|SO|S|SW|W|NW)?$/.test(c)) c = c.replace(/^(\d{1,2})R..(\w*)$/, (_m, n: string, d: string) => `${n} Rtg${d ? " " + d : ""}`);
    // «Pwziv», «Fzgn»
    else if (/^(?:Pw|Lw|Fz|Spz|Kpz|Pers)(?:ziv|gn)$/i.test(c)) c = c.replace(/(ziv|gn)$/i, " $1");
    else if (/^[9g][nm]$/.test(c)) c = "gn";
    else if (/^A[A-Z]\d{1,2}[A-D]$/.test(c) && isCell?.(c.slice(0, -1))) c = c.slice(0, -1) + " " + c.slice(-1);
    else if (/^\d\.(?:gn|ziv|Fz|Pers)$/i.test(c)) c = c.replace(".", " ");
    else if (/^A[A-Z][0-9OoDQIlL|SsZzGBTg]{1,2}$/.test(c) && /[^0-9]/.test(c.slice(2)) && isCell) {
      const cell = c.slice(0, 2) + toDigits(c.slice(2));
      if (isCell(cell)) c = cell;
    } else if (c.length >= 6 && /^[\p{L}\d]+$/u.test(c) && /\d/.test(c) && /\p{L}/u.test(c)) {
      const seg = segment(c);
      if (seg) c = seg;
    }
    return pre + c + post;
  }).join("");
}

const LABELS: Array<[RegExp, "zeit" | "melder" | "text" | "datum" | "sonst"]> = [
  [/^(?:zeit|uhrzeit|zeitpunkt|dtg)\b\s*[:.]?\s*/i, "zeit"],
  [/^(?:absender|melder|von|abs\.?|meldender)\b\s*[:.]?\s*/i, "melder"],
  [/^(?:meldung|inhalt|text|beobachtung|sachverhalt)\b\s*[:.]?\s*/i, "text"],
  [/^(?:datum|tag)\b\s*[:.]?\s*/i, "datum"],
  [/^(?:empfänger|empfaenger|an|unterschrift|visum|visa|quittung|nr\.?|übermittelt|uebermittelt)\b\s*[:.]?\s*/i, "sonst"],
];

/**
 * Meldezettel (Formular mit Feldern «Zeit», «Absender», «Meldung» …) → eine Meldung wie getippt,
 * z. B. «T2 0645 H05 3 Fz in Kolonne AP10 Rtg W». null, wenn es kein solches Formular ist.
 */
export function formToMeldung(text: string, days?: string[]): string | null {
  const got: Record<string, string> = {};
  let cur: string | null = null;
  for (const raw of text.split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const hit = LABELS.find(([re]) => re.test(l));
    if (hit) { cur = hit[1]; got[cur] = (got[cur] ? got[cur] + " " : "") + l.replace(hit[0], "").trim(); continue; }
    // Folgezeile gehört zum Meldungstext
    if (cur === "text") got.text += " " + l;
  }
  const n = ["zeit", "melder", "text"].filter((k) => got[k] !== undefined).length;
  if (n < 2 || !got.text?.trim()) return null;
  let day = "";
  const dm = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(got.datum ?? "");
  if (dm && days?.length) {
    const y = dm[3]!.length === 2 ? "20" + dm[3] : dm[3]!;
    const iso = `${y}-${dm[2]!.padStart(2, "0")}-${dm[1]!.padStart(2, "0")}`;
    const i = days.indexOf(iso);
    if (i >= 0) day = `T${i + 1}`;
  }
  const time = /\b([0-2]?\d)[:.]?([0-5]\d)\b/.exec(got.zeit ?? "");
  const melder = (got.melder ?? "").split(/\s+/)[0] ?? "";
  return [day, time ? time[1]!.padStart(2, "0") + time[2] : "", melder, got.text.trim()].filter(Boolean).join(" ");
}

const TIME_START = /^\s*(?:\d+[.)]\s*)?(?:T\d\s+)?[0-2]?\d[:.]?[0-5]\d\b/;
const HEADER = /^\s*(?:datum|zeit|meldung|lagejournal|journal|melder|nr\.?|seite\s*\d|blatt)\b/i;

/**
 * Erkannten Text in einzelne Meldungen trennen: `splitMeldungen` aus dem Kern; trennt der (noch) nicht,
 * hier nach Zeilen mit Zeitangabe am Anfang (Folgezeilen hängen an der vorherigen).
 */
export function ocrToMeldungen(text: string, isCell?: (c: string) => boolean, days?: string[], nai?: string[]): string[] {
  const clean = cleanOcrText(text, { isCell, nai }).split("\n").map((l) => stripTail(fixCircle(fixOcrTokens(l, isCell)))).join("\n");
  const form = formToMeldung(clean, days);
  if (form) return [form];
  const k = kern.splitMeldungen(clean).map((x) => x.trim()).filter(Boolean);
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  if (k.length > 1 || lines.length <= 1) {
    // Kopfzeilen vor der ersten Meldung mit Zeit weglassen (Titel, Übungsname, Spaltenköpfe)
    const first = k.findIndex((x) => TIME_START.test(x));
    return (first > 0 ? k.slice(first) : k).map(tidy).filter(Boolean);
  }
  const out: string[] = [];
  const first = lines.findIndex((l) => TIME_START.test(l));
  for (const l of first > 0 ? lines.slice(first) : lines) {
    if (HEADER.test(l) && !TIME_START.test(l)) continue;
    if (TIME_START.test(l) || !out.length) out.push(l);
    else out[out.length - 1] += " " + l;
  }
  return out.map(tidy).filter(Boolean);
}

/** Kreis-Zeichen nach (erst jetzt korrigiertem) Planquadrat bzw. «Rtg»: «AK7 ©» → AK7 C, «Rtg ©» → Rtg O */
const fixCircle = (l: string) => l.replace(/\b(A[A-Z]\d{1,2}) ?[©€¢](?=$|[\s,.;])/g, "$1 C").replace(/\b(Rtg) ?[©®@](?=$|[\s,.;])/g, "$1 O");

/** Tabellenstriche zu Leerzeichen; Visum-Kürzel/Störzeichen am Ende («… Rtg N mb», «\\s») weg */
const tidy = (s: string) => stripTail(s.replace(/\s*[|¦]\s*/g, " ").replace(/\s{2,}/g, " ").trim());
/** kurze Wörter am Zeilenende, die zur Meldung gehören (Einheiten, «zieht ab», «fährt vor») */
const TAIL_KEEP = /\s(?:\d+\s?(?:m|km|cm|mm|h|s|t|l|kg)|ab|an|in|um|zu|da|ob|vor|aus|ca|km|min)$/i;
function stripTail(s: string): string {
  let t = s.trim();
  for (let k = 0; k < 3; k++) {
    // Störzeichen mit Klammer/Strich am Ende («… bezogen EN]», «… W |l»)
    t = t.replace(/\s+\S{0,3}[\][{}|\\]\S{0,2}$/u, "").trim();
    if (TAIL_KEEP.test(t)) break;
    t = t.replace(/\s+(?:[\\/|}{\]\[()~_.,;:'"‚„“”-]*[a-zäöü]{0,2}[\\/|}{\]\[~_.,;:'"‚„“”-]*)$/u, "").trim();
  }
  return t;
}

/** Zeilen mit Bildlage → Herkunft für die Anzeige («Zeile 3») */
export function originOf(stamp: string, i: number, n: number): string {
  return n > 1 ? `${stamp}, Meldung ${i + 1}` : stamp;
}

export type { Rect };
