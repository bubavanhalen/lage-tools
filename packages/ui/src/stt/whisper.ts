/**
 * Offline-Spracherkennung mit Whisper im Browser (Web Worker, siehe `whisper.worker.ts`).
 * Modelle (quantisiert q8, vom Hugging Face Hub, danach im Browser-Zwischenspeicher):
 * - «small» (Standard): Encoder 92 MB + Decoder 157 MB ≈ 250 MB – versteht Funksprache deutlich besser
 *   (Test mit Sprachausgabe: «Hotel null vier, zwo Fahrzeuge, Alpha Golf eins drei» → «Hotel 04 2 Fahrzeuge, Alpha Golf 1 3»).
 * - «base»: Encoder 23 MB + Decoder 54 MB ≈ 80 MB – schneller, aber viele Fehler («Hote 04-2 Fahrzeuge … Golf 123»).
 */
import { decodeTo16k } from "../audio";
import type { LoadProgress, SttEngine } from "./index";

export type WhisperSize = "small" | "base";
export const WHISPER_MODELS: Record<WhisperSize, { id: string; mb: number; name: string }> = {
  small: { id: "onnx-community/whisper-small", mb: 250, name: "Genau" },
  base: { id: "onnx-community/whisper-base", mb: 80, name: "Klein" },
};
/** Dateien des Modells im Zwischenspeicher von transformers.js – daran erkennen wir «geladen» */
const MODEL_FILES = ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx", "tokenizer.json", "config.json"];
const HF_CACHE = "transformers-cache";

export type WorkerIn =
  | { type: "load"; id: number; model: string; allowRemote: boolean }
  | { type: "transcribe"; id: number; model: string; allowRemote: boolean; audio: Float32Array };
export type WorkerOut =
  | { type: "progress"; file: string; loaded: number; total: number; status: string }
  | { type: "ready"; id: number; wasm?: string[] }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id: number; message: string };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();
let progressCb: ((p: LoadProgress) => void) | null = null;
const files = new Map<string, { loaded: number; total: number }>();
let expectMb = 80;

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
    if (m.type === "error") w.reject(new Error(m.message));
    else w.resolve(m.type === "result" ? m.text : m.type === "ready" ? JSON.stringify(m.wasm ?? []) : "");
  };
  worker.onerror = (ev) => {
    const err = new Error(ev.message || "Spracherkennung abgestürzt");
    waiting.forEach((w) => w.reject(err));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
function call(msg: WithoutId<WorkerIn>, transfer?: Transferable[]): Promise<string> {
  const id = ++seq;
  return new Promise<string>((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id } as WorkerIn, transfer ?? []);
  });
}

/** Zwischenspeicher für die ONNX-Laufzeit (gleich wie im Service Worker, `sw.template.js`) */
const RUNTIME_CACHE = "lt-stt-v1";
/** Laufzeit (WASM) sicher für offline ablegen – falls der Service Worker beim Laden noch nicht aktiv war */
async function keepRuntime(urls: string[]): Promise<void> {
  try {
    const c = await caches.open(RUNTIME_CACHE);
    for (const u of urls) if (new URL(u).origin === location.origin && !(await c.match(u, { ignoreSearch: true }))) await c.add(u);
  } catch { /* z. B. Entwicklungsserver – egal */ }
}

/** Liegt das Modell schon im Browser-Zwischenspeicher? */
export async function whisperCached(size: WhisperSize): Promise<boolean> {
  const id = WHISPER_MODELS[size].id;
  try {
    if (!("caches" in self)) return false;
    const c = await caches.open(HF_CACHE);
    const keys = (await c.keys()).map((r) => r.url);
    return MODEL_FILES.every((f) => keys.some((k) => k.includes(`/${id}/`) && k.endsWith(f)));
  } catch {
    return false;
  }
}

/** Modell aus dem Zwischenspeicher löschen (Speicher freigeben) */
export async function clearWhisper(size: WhisperSize): Promise<void> {
  const id = WHISPER_MODELS[size].id;
  worker?.terminate();
  worker = null;
  try {
    const c = await caches.open(HF_CACHE);
    for (const r of await c.keys()) if (r.url.includes(`/${id}/`)) await c.delete(r);
  } catch { /* egal */ }
}

/**
 * Typische Whisper-Erfindungen bei Stille/Rauschen entfernen (Untertitel-Abspann u. ä. aus den Trainingsdaten).
 */
export function cleanWhisper(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*(musik|applaus|lachen|stille)[^)]*\)|\*[^*]*\*/gi, " ")
    .replace(/untertitel(ung)?\b[^.!?]*(zdf|amara|swr|ard|funk|community)[^.!?]*[.!?]?/gi, " ")
    .replace(/(vielen dank|danke)\s+(fürs|für's|für das|für ihre)\s+(zuschauen|zuhören|aufmerksamkeit)[.!]?/gi, " ")
    .replace(/\bcopyright\b[^.!?]*[.!?]?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const whisperEngine = (size: WhisperSize): SttEngine => ({
  id: `whisper-${size}`,
  label: `Offline (Whisper ${size})`,
  ready: () => whisperCached(size),
  async load(onProgress) {
    progressCb = onProgress ?? null;
    files.clear();
    expectMb = WHISPER_MODELS[size].mb;
    try {
      const wasm = JSON.parse(await call({ type: "load", model: WHISPER_MODELS[size].id, allowRemote: true }) || "[]") as string[];
      await keepRuntime(wasm);
      onProgress?.({ phase: "starten", loaded: 1, total: 1 });
    } finally {
      progressCb = null;
    }
  },
  async transcribe(blob) {
    const audio = await decodeTo16k(blob);
    if (audio.length < 16000 * 0.3) return "";
    const text = await call({ type: "transcribe", model: WHISPER_MODELS[size].id, allowRemote: navigator.onLine, audio }, [audio.buffer]);
    return cleanWhisper(text);
  },
});
