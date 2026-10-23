/**
 * Offline-Spracherkennung mit Whisper im Browser (Web Worker, siehe `whisper.worker.ts`).
 * Modelle vom Hugging Face Hub, danach im Browser-Zwischenspeicher. Grössen und Zeiten gemessen (Etappe 4b, Messtabelle im Bericht):
 * - «small» (Standard, «Genau»): versteht Funksprache deutlich besser
 *   (Test mit Sprachausgabe: «Hotel null vier, zwo Fahrzeuge, Alpha Golf eins drei» → «Hotel 04, 2 Fahrzeuge, Alpha Golf 1/3»).
 *   Ohne Grafikkarte (WASM): Encoder q8 92 MB + Decoder q8 157 MB ≈ 250 MB – q4 wäre 26 MB kleiner, rechnet in WASM aber ~30 % langsamer.
 *   Mit WebGPU: Encoder q4 66 MB auf der Grafikkarte (q8 läuft dort nicht) + Decoder q8 in WASM ≈ 225 MB.
 *   Unter 150 MB geht «small» nicht: der Decoder allein hat 157 MB (q4 wegen der Wort-Tabelle sogar 233 MB).
 * - «base» («Klein»): ≈ 77 MB – etwa 3× schneller, aber viele Fehler («Hote 04-2-fahrzeuge … Golf 1-3», «07200002»).
 * Deutsche Spezialmodelle in ONNX (distil-large-v3-de, large-v3-turbo-de, small-cv11-de) sind alle > 200 MB bzw. ohne WASM-taugliche Quantisierung.
 */
import { decodeTo16k } from "../audio";
import type { LoadProgress, SttEngine, TranscribeOptions } from "./index";

export type WhisperSize = "small" | "base";
export interface WhisperDtype { encoder_model: string; decoder_model_merged: string }
interface Variant { dtype: WhisperDtype; mb: number }
export const WHISPER_MODELS: Record<WhisperSize, { id: string; name: string; mb: number; wasm: Variant; gpu: Variant }> = {
  small: {
    id: "onnx-community/whisper-small", name: "Genau", mb: 250,
    wasm: { dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, mb: 250 },
    gpu: { dtype: { encoder_model: "q4", decoder_model_merged: "q8" }, mb: 225 },
  },
  base: {
    id: "onnx-community/whisper-base", name: "Klein", mb: 77,
    wasm: { dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, mb: 77 },
    gpu: { dtype: { encoder_model: "q4", decoder_model_merged: "q8" }, mb: 73 },
  },
};

/** WebGPU im Browser vorhanden? (einmal geprüft; bis dahin «nein») */
let gpuFlag: boolean | null = null;
let gpuCheck: Promise<boolean> | null = null;
export function detectGpu(): Promise<boolean> {
  if (gpuFlag !== null) return Promise.resolve(gpuFlag);
  return (gpuCheck ??= (async () => {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      const a = gpu ? await Promise.race([gpu.requestAdapter(), new Promise((r) => setTimeout(() => r(null), 1500))]) : null;
      gpuFlag = !!a;
    } catch {
      gpuFlag = false;
    }
    return gpuFlag;
  })());
}
/** Grösse des Modells für dieses Gerät (vor dem Download anzeigen) */
export const modelMb = (size: WhisperSize) => (gpuFlag ? WHISPER_MODELS[size].gpu.mb : WHISPER_MODELS[size].wasm.mb);
if (typeof navigator !== "undefined") void detectGpu();

/** Dateiname-Endung je Quantisierung (wie transformers.js) */
const SUFFIX: Record<string, string> = { q8: "_quantized", int8: "_int8", uint8: "_uint8", q4: "_q4", bnb4: "_bnb4", fp16: "_fp16", fp32: "", q4f16: "_q4f16" };
/** Dateien einer Variante – daran erkennen wir im Zwischenspeicher «geladen» */
const variantFiles = (d: WhisperDtype) => [`onnx/encoder_model${SUFFIX[d.encoder_model] ?? ""}.onnx`, `onnx/decoder_model_merged${SUFFIX[d.decoder_model_merged] ?? ""}.onnx`, "tokenizer.json", "config.json"];
const HF_CACHE = "transformers-cache";
/** Worker nach so langer Pause beenden (gibt einige 100 MB Arbeitsspeicher frei); beim nächsten Memo neu aus dem Zwischenspeicher */
export const IDLE_MS = 3 * 60_000;

type ModelMsg = { model: string; dtype: WhisperDtype; allowRemote: boolean; gpu: boolean };
export type WorkerIn =
  | ({ type: "load"; id: number } & ModelMsg)
  | ({ type: "transcribe"; id: number; audio: Float32Array } & ModelMsg);
export type WorkerOut =
  | { type: "progress"; file: string; loaded: number; total: number; status: string }
  | { type: "ready"; id: number; wasm?: string[]; device?: string; threads?: number; ms?: number }
  | { type: "result"; id: number; text: string; ms?: number }
  | { type: "error"; id: number; message: string };

let worker: Worker | null = null;
/** Modell im laufenden Worker geladen (sonst muss es beim nächsten Memo erst starten) */
let warmKey = "";
let seq = 0;
const waiting = new Map<number, { resolve: (v: WorkerOut) => void; reject: (e: Error) => void }>();
let progressCb: ((p: LoadProgress) => void) | null = null;
const files = new Map<string, { loaded: number; total: number }>();
let expectMb = 80;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** Laufzeit-Angaben des letzten Starts (für Einstellungen/Bericht) */
export const whisperInfo: { device?: string; threads?: number; isolated?: boolean; startMs?: number } = {};

function stopWorker() {
  worker?.terminate();
  worker = null;
  warmKey = "";
  clearTimeout(idleTimer);
}

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!waiting.size) stopWorker(); }, IDLE_MS);
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module", name: "whisper" });
  worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
    const m = ev.data;
    if (m.type === "progress") {
      if (m.file && (m.total || m.status === "initiate")) {
        const f = files.get(m.file) ?? { loaded: 0, total: 0 };
        if (m.total) { f.total = m.total; f.loaded = m.loaded; }
        if (m.status === "done" && f.total) f.loaded = f.total;
        files.set(m.file, f);
      }
      const loaded = [...files.values()].reduce((s, f) => s + f.loaded, 0);
      const known = [...files.values()].reduce((s, f) => s + f.total, 0);
      // vor dem Start der grossen Dateien ist die Summe noch klein: mindestens die erwartete Grösse annehmen
      progressCb?.({ phase: "laden", loaded, total: Math.max(known, expectMb * 1e6), file: m.file });
      return;
    }
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    armIdle();
    if (m.type === "error") w.reject(new Error(m.message));
    else w.resolve(m);
  };
  worker.onerror = (ev) => {
    const err = new Error(ev.message || "Spracherkennung abgestürzt");
    waiting.forEach((w) => w.reject(err));
    waiting.clear();
    stopWorker();
  };
  return worker;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
function call(msg: WithoutId<WorkerIn>, transfer?: Transferable[], signal?: AbortSignal): Promise<WorkerOut> {
  const id = ++seq;
  clearTimeout(idleTimer);
  return new Promise<WorkerOut>((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id } as WorkerIn, transfer ?? []);
    // Abbrechen: Rechnung im Worker lässt sich nicht anhalten → Worker beenden (nächstes Memo startet ihn neu)
    signal?.addEventListener("abort", () => {
      if (!waiting.has(id)) return;
      const all = [...waiting.values()];
      waiting.clear();
      stopWorker();
      all.forEach((w) => w.reject(abortError()));
    }, { once: true });
  });
}

export const abortError = () => { const e = new Error("abgebrochen"); e.name = "AbortError"; return e; };

/** Zwischenspeicher für die ONNX-Laufzeit (gleich wie im Service Worker, `sw.template.js`) */
const RUNTIME_CACHE = "lt-stt-v1";
/** Laufzeit (WASM) sicher für offline ablegen – falls der Service Worker beim Laden noch nicht aktiv war */
async function keepRuntime(urls: string[]): Promise<void> {
  try {
    const c = await caches.open(RUNTIME_CACHE);
    for (const u of urls) if (new URL(u).origin === location.origin && !(await c.match(u, { ignoreSearch: true }))) await c.add(u);
  } catch { /* z. B. Entwicklungsserver – egal */ }
}

async function cachedUrls(): Promise<string[]> {
  try {
    if (!("caches" in self)) return [];
    const c = await caches.open(HF_CACHE);
    return (await c.keys()).map((r) => r.url);
  } catch {
    return [];
  }
}
const hasVariant = (keys: string[], id: string, v: Variant) => variantFiles(v.dtype).every((f) => keys.some((k) => k.includes(`/${id}/`) && k.endsWith(f)));

/**
 * Welche Variante benutzen? Schon geladene vor passender (kein zweiter Download), sonst passend zum Gerät:
 * WebGPU → Encoder q4 auf der Grafikkarte, sonst q8 in WASM.
 */
async function pickVariant(size: WhisperSize): Promise<{ v: Variant; gpu: boolean }> {
  const m = WHISPER_MODELS[size];
  const gpu = await detectGpu();
  const keys = await cachedUrls();
  const want = gpu ? m.gpu : m.wasm, other = gpu ? m.wasm : m.gpu;
  if (hasVariant(keys, m.id, want)) return { v: want, gpu };
  if (hasVariant(keys, m.id, other)) return { v: other, gpu };
  return { v: want, gpu };
}

/** Liegt das Modell (eine der Varianten) schon im Browser-Zwischenspeicher? */
export async function whisperCached(size: WhisperSize): Promise<boolean> {
  const m = WHISPER_MODELS[size];
  const keys = await cachedUrls();
  return hasVariant(keys, m.id, m.wasm) || hasVariant(keys, m.id, m.gpu);
}

/** Modell aus dem Zwischenspeicher löschen (Speicher freigeben) */
export async function clearWhisper(size: WhisperSize): Promise<void> {
  const id = WHISPER_MODELS[size].id;
  stopWorker();
  try {
    const c = await caches.open(HF_CACHE);
    for (const r of await c.keys()) if (r.url.includes(`/${id}/`)) await c.delete(r);
  } catch { /* egal */ }
}

/**
 * Typische Whisper-Erfindungen bei Stille/Rauschen entfernen (Untertitel-Abspann u. ä. aus den Trainingsdaten).
 */
export function cleanWhisper(text: string): string {
  return collapseRepeats(text
    .replace(/\[[^\]]*\]|\([^)]*(musik|applaus|lachen|stille)[^)]*\)|\*[^*]*\*/gi, " ")
    .replace(/untertitel(ung)?\b[^!?\n]*(zdf|amara|swr|\bard\b|\bfunk\b|community)\S*(\s*,?\s*\d{4})?[.!?]?/gi, " ")
    .replace(/(vielen dank|danke)\s+(fürs|für's|für das|für ihre)\s+(zuschauen|zuhören|aufmerksamkeit)[.!]?/gi, " ")
    .replace(/\bcopyright\b[^.!?]*[.!?]?/gi, " ")
    .replace(/\s+/g, " ")
    .trim());
}

/**
 * Wiederholungsschleifen von Whisper entfernen: derselbe Abschnitt (≥ 4 Wörter) mehrmals direkt hintereinander
 * → einmal behalten. Auch ein angefangener letzter Durchgang wird entfernt.
 */
export function collapseRepeats(text: string): string {
  let w = text.split(" ").filter(Boolean);
  const norm = (x: string) => x.toLowerCase().replace(/[.,!?;:]+$/, "");
  for (let n = Math.min(40, Math.floor(w.length / 2)); n >= 4; n--) {
    for (let i = 0; i + 2 * n <= w.length; i++) {
      let k = 1;
      while (i + (k + 1) * n <= w.length && w.slice(i + k * n, i + (k + 1) * n).every((x, j) => norm(x) === norm(w[i + j]!))) k++;
      if (k < 2) continue;
      // angefangene weitere Wiederholung am Ende
      let rest = i + k * n;
      let m = 0;
      while (rest + m < w.length && m < n && norm(w[rest + m]!) === norm(w[i + m]!)) m++;
      if (rest + m === w.length) rest += m;
      w = [...w.slice(0, i + n), ...w.slice(rest)];
    }
  }
  return w.join(" ");
}

export const whisperEngine = (size: WhisperSize): SttEngine => {
  const start = async (allowRemote: boolean, signal?: AbortSignal) => {
    const { v, gpu } = await pickVariant(size);
    const msg: ModelMsg = { model: WHISPER_MODELS[size].id, dtype: v.dtype, allowRemote, gpu };
    const r = await call({ type: "load", ...msg }, undefined, signal);
    if (r.type === "ready") {
      Object.assign(whisperInfo, { device: r.device, threads: r.threads, isolated: !!(self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated, startMs: r.ms });
      await keepRuntime(r.wasm ?? []);
    }
    warmKey = size;
    return msg;
  };
  let current: ModelMsg | null = null;
  return {
    abort() {
      const all = [...waiting.values()];
      waiting.clear();
      stopWorker();
      all.forEach((w) => w.reject(abortError()));
    },
    id: `whisper-${size}`,
    label: `Offline (Whisper ${size})`,
    ready: () => whisperCached(size),
    warm: () => warmKey === size && !!worker,
    async load(onProgress) {
      progressCb = onProgress ?? null;
      files.clear();
      expectMb = modelMb(size);
      try {
        current = await start(true);
        onProgress?.({ phase: "starten", loaded: 1, total: 1 });
      } finally {
        progressCb = null;
      }
    },
    async transcribe(blob, o: TranscribeOptions = {}) {
      const audio = await decodeTo16k(blob);
      if (audio.length < 16000 * 0.3) return { text: "", ms: 0 };
      if (o.signal?.aborted) throw abortError();
      // Modell im Worker (wieder) starten – aus dem Zwischenspeicher, kein Download
      if (warmKey !== size || !worker || !current) { o.onPhase?.("starten"); current = await start(navigator.onLine, o.signal); }
      o.onPhase?.("erkennen", audio.length / 16000);
      const r = await call({ type: "transcribe", audio, ...current, allowRemote: navigator.onLine }, [audio.buffer], o.signal);
      return { text: r.type === "result" ? cleanWhisper(r.text) : "", ms: r.type === "result" ? r.ms ?? 0 : 0 };
    },
  };
};
