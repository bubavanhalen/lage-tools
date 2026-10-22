/**
 * Offline-Spracherkennung mit Whisper im Browser (Web Worker, siehe `whisper.worker.ts`).
 * Modell: `onnx-community/whisper-base`, quantisiert (q8): Encoder 23 MB + Decoder 54 MB + Tokenizer ≈ 80 MB.
 */
import { decodeTo16k } from "../audio";
import type { LoadProgress, SttEngine } from "./index";

export const WHISPER_MODEL = "onnx-community/whisper-base";
/** ungefähre Downloadgrösse in MB (für Anzeige vor dem Laden) */
export const WHISPER_MB = 80;
/** Dateien des Modells im Zwischenspeicher von transformers.js – daran erkennen wir «geladen» */
const MODEL_FILES = ["onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx", "tokenizer.json", "config.json"];
const HF_CACHE = "transformers-cache";

export type WorkerIn =
  | { type: "load"; id: number; model: string; allowRemote: boolean }
  | { type: "transcribe"; id: number; model: string; allowRemote: boolean; audio: Float32Array };
export type WorkerOut =
  | { type: "progress"; file: string; loaded: number; total: number; status: string }
  | { type: "ready"; id: number }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id: number; message: string };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (v: string) => void; reject: (e: Error) => void }>();
let progressCb: ((p: LoadProgress) => void) | null = null;
const files = new Map<string, { loaded: number; total: number }>();

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
      progressCb?.({ phase: "laden", loaded, total: Math.max(known, WHISPER_MB * 1e6), file: m.file });
      return;
    }
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.type === "error") w.reject(new Error(m.message));
    else w.resolve(m.type === "result" ? m.text : "");
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

/** Liegt das Modell schon im Browser-Zwischenspeicher? */
export async function whisperCached(): Promise<boolean> {
  try {
    if (!("caches" in self)) return false;
    const c = await caches.open(HF_CACHE);
    const keys = (await c.keys()).map((r) => r.url);
    return MODEL_FILES.every((f) => keys.some((k) => k.includes(WHISPER_MODEL) && k.endsWith(f)));
  } catch {
    return false;
  }
}

/** Modell aus dem Zwischenspeicher löschen (Speicher freigeben) */
export async function clearWhisper(): Promise<void> {
  worker?.terminate();
  worker = null;
  try {
    const c = await caches.open(HF_CACHE);
    for (const r of await c.keys()) if (r.url.includes(WHISPER_MODEL)) await c.delete(r);
  } catch { /* egal */ }
}

/** Belegter Platz des Modells im Zwischenspeicher (MB, grob) */
export async function whisperSizeMb(): Promise<number> {
  try {
    const c = await caches.open(HF_CACHE);
    let n = 0;
    for (const r of await c.keys()) {
      if (!r.url.includes(WHISPER_MODEL)) continue;
      const res = await c.match(r);
      n += +(res?.headers.get("content-length") ?? 0);
    }
    return n / 1e6;
  } catch {
    return 0;
  }
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

export const whisperEngine: SttEngine = {
  id: "whisper-offline",
  label: "Offline (Whisper)",
  ready: whisperCached,
  async load(onProgress) {
    progressCb = onProgress ?? null;
    files.clear();
    try {
      await call({ type: "load", model: WHISPER_MODEL, allowRemote: true });
      onProgress?.({ phase: "starten", loaded: 1, total: 1 });
    } finally {
      progressCb = null;
    }
  },
  async transcribe(blob) {
    const audio = await decodeTo16k(blob);
    if (audio.length < 16000 * 0.3) return "";
    const text = await call({ type: "transcribe", model: WHISPER_MODEL, allowRemote: navigator.onLine, audio }, [audio.buffer]);
    return cleanWhisper(text);
  },
};
