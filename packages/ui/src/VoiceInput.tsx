/**
 * Sprechen statt tippen: Knopf gedrückt halten (oder antippen = Start/Stopp, Leertaste halten am Laptop).
 * Das Sprachmemo wird immer gespeichert. Erkennung offline (Whisper) oder – nur nach Einschalten – im Browser.
 *
 * Zfhr im LVZ unter Zeitdruck – deshalb:
 * - **nie blockieren:** Memos kommen in eine Warteschlange, der Knopf bleibt während der Erkennung frei.
 *   Je Memo: «wartet» / «erkenne … ca. 12 s» (Restzeit aus der gemessenen Rechenzeit dieses Geräts) / fertig;
 *   jedes Memo einzeln abbrechbar (bleibt gespeichert, «später erkennen»).
 * - **nichts vermischen:** Steht schon Text im Meldungsfeld, wird das Erkannte nicht angehängt, sondern als
 *   Vorschlag unter dem Feld gezeigt (Eintragen / In Übersicht / Verwerfen). Das Memo hängt immer an der
 *   Meldung, die aus ihm entsteht – wird der eingesetzte Text gelöscht oder ersetzt, löst es sich wieder.
 *
 * Ablauf: Transkript → `fixHearing` → `normalizeSpoken` (Funksprache → Kurzschreibweise) → `splitMeldungen`
 *   → eine Meldung: ins Meldungsfeld (Vorschau wie getippt) · mehrere: `BatchReview`.
 *
 * Einbau im Meldungsfeld: `const voice = useVoice({...})`, dann `<VoiceButton v={voice} />` und `<VoiceStatus v={voice} />`.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { normalizeSpoken, parseMeldung, splitMeldungen, type Attachment, type Exercise } from "@lage/core";
import { MicError, Recorder, canRecord, fmtDuration, hasMicrophone, patchAttachment, saveMemo, type Recording } from "./audio";
import {
  downloadLabel, modelMb, engineWarm, ensureModel, estimateSecs, modelLoading, modelReady, recordRate, startLive, transcribeOffline,
  useBrowserNow, useModelState, useSpeechPrefs, type LiveSession,
} from "./stt";
import { SpeechSettings } from "./SpeechSettings";
import { fixHearing } from "./stt/hearing";
import { BatchReview, DraftPreview, type BatchItem } from "./BatchReview";
import { defaultDay, journalCtx } from "./commit";
import { stateOf } from "./entry/stateOptions";
import { deleteBlob, getBlob } from "./store";
import "./voice.css";

/** längstes Memo (danach automatisch Stopp) */
const MAX_S = 180;
/** kürzer gedrückt = «antippen» (Start/Stopp), länger = «gedrückt halten» */
const TAP_MS = 400;
/** kürzere Aufnahmen gelten als Versehen (ohne Ton) */
const MIN_S = 0.6;

export interface VoiceOptions {
  ex: Exercise;
  update: (f: (x: Exercise) => Exercise) => void;
  say: (t: string) => void;
  /** aktueller Text im Meldungsfeld */
  text: string;
  setText: (t: string) => void;
  /** Memo an die nächste eingetragene Meldung hängen (wie ein Foto) */
  onAttach: (a: Attachment) => void;
  /** Memo wieder lösen (eingesetzter Text gelöscht/ersetzt) – nur wenn es noch das wartende ist */
  onDetach?: (id: string) => void;
  /** ID des Anhangs, der gerade auf die nächste Meldung wartet (nicht in «Memos ohne Meldung» zeigen) */
  pendingId?: string;
  /** Meldungen eintragen (gleicher Weg wie Enter im Meldungsfeld) */
  onCommit: (texts: string[], a: Attachment) => void;
  /** Tag für BatchReview */
  day?: string;
  /** Meldungsfeld (Fokus, Höhe nach dem Einsetzen) */
  input?: RefObject<HTMLTextAreaElement | null>;
}

/** Aufnahme (nur eine gleichzeitig) */
type RecState =
  | { s: "idle" }
  | { s: "start" }
  | { s: "rec"; mode: "halten" | "tippen"; cancelArmed: boolean }
  | { s: "speichern" }
  | { s: "fehler"; msg: string; denied?: boolean };

type Change = { from: string; to: string };
/** Erkennung je Memo (Warteschlange) */
export type JobStatus = "wartet" | "laden" | "starten" | "erkennt" | "vorschlag" | "leer" | "fehler" | "ohne-modell";
export interface Job {
  att: Attachment;
  /** Ton im Arbeitsspeicher (sonst aus dem Gerätespeicher) */
  blob?: Blob;
  status: JobStatus;
  /** Memo-Länge in s */
  sec: number;
  /** Erkennung läuft seit (ms) und geschätzte Dauer (s) */
  t0?: number;
  est?: number;
  msg?: string;
  /** z. B. «Ton nicht gespeichert – Gerätespeicher voll» */
  warn?: string;
  /** Feld war nicht frei: Vorschlag statt Einsetzen */
  sug?: { raw: string; parts: string[]; changes: Change[] };
}
/** zuletzt ins Feld eingesetztes Erkanntes (Hinweis unter dem Feld) */
interface Result { att: Attachment; raw: string; changes: Change[]; n: number; inserted: string }

export interface Voice {
  o: VoiceOptions;
  st: RecState;
  jobs: Job[];
  result: Result | null;
  available: boolean;
  level: number;
  secs: number;
  live: string;
  settings: boolean;
  setSettings: (b: boolean) => void;
  batch: { items: BatchItem[]; att: Attachment } | null;
  closeBatch: () => void;
  press: () => void;
  release: () => void;
  armCancel: (b: boolean) => void;
  cancel: () => void;
  dismiss: () => void;
  dismissResult: () => void;
  /** Memo (nochmals) erkennen lassen – kommt in die Warteschlange; `load` = fehlendes Modell laden (Grösse wurde angezeigt) */
  recognize: (a: Attachment, load?: boolean) => void;
  /** Erkennung eines Memos abbrechen (Memo bleibt gespeichert) bzw. Zeile schliessen */
  cancelJob: (id: string) => void;
  /** alle Memos ohne Modell: Modell laden, dann erkennen */
  loadAndRecognize: () => void;
  /** Vorschlag: ins (leere) Feld · direkt eintragen · in die Übersicht · verwerfen */
  sugToField: (id: string) => void;
  sugCommit: (id: string) => void;
  sugReview: (id: string) => void;
  /** schon erkannten Text nochmals übernehmen (ins Feld bzw. Übersicht) */
  take: (a: Attachment) => void;
  remove: (a: Attachment) => void;
}

const hhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const editable = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";
/** Anteil der Wörter des eingesetzten Texts, die noch im Feld stehen */
function overlap(now: string, inserted: string): number {
  const w = inserted.toLowerCase().split(/\s+/).filter((x) => x.length >= 2);
  if (!w.length) return 1;
  const have = new Set(now.toLowerCase().split(/\s+/));
  return w.filter((x) => have.has(x)).length / w.length;
}

/** Funksprache → Kurzmeldungen */
function translate(raw: string): { parts: string[]; changes: Change[] } {
  // erst typische Hörfehler («Hote 04», «Alpha Tilo»), dann Funksprache → Kurzschreibweise
  const n = normalizeSpoken(fixHearing(raw));
  return { parts: splitMeldungen(n.text).map((t) => t.trim()).filter(Boolean), changes: n.changes.filter((c) => c.to !== c.from) };
}

export function useVoice(o: VoiceOptions): Voice {
  const opts = useRef(o);
  opts.current = o;
  const prefs = useSpeechPrefs();
  useModelState();
  const browserNow = useBrowserNow(prefs);
  // für Tasten-Ereignisse (einmal angemeldet) immer den aktuellen Stand
  const now = useRef({ browserNow });
  now.current = { browserNow };
  const [st, setSt] = useState<RecState>({ s: "idle" });
  const stRef = useRef(st);
  stRef.current = st;
  const [jobs, setJobsState] = useState<Job[]>([]);
  const jobsRef = useRef<Job[]>([]);
  const setJobs = (f: (j: Job[]) => Job[]) => { jobsRef.current = f(jobsRef.current); setJobsState(jobsRef.current); };
  const patchJob = (id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.att.id === id ? { ...j, ...p } : j)));
  const dropJob = (id: string) => setJobs((js) => js.filter((j) => j.att.id !== id));
  const [result, setResult] = useState<Result | null>(null);
  const [available, setAvailable] = useState(() => canRecord());
  const [level, setLevel] = useState(0);
  const [secs, setSecs] = useState(0);
  const [live, setLive] = useState("");
  const [settings, setSettings] = useState(false);
  const [batch, setBatchState] = useState<{ items: BatchItem[]; att: Attachment } | null>(null);
  const batchRef = useRef(batch);
  const setBatch = (b: { items: BatchItem[]; att: Attachment } | null) => { batchRef.current = b; setBatchState(b); };
  const rec = useRef<Recorder | null>(null);
  const liveRef = useRef<LiveSession | null>(null);
  const running = useRef<{ id: string; ctl: AbortController } | null>(null);
  const pressAt = useRef(0);
  const released = useRef(false);
  const tick = useRef<number | undefined>(undefined);

  useEffect(() => { if (canRecord()) hasMicrophone().then(setAvailable); }, []);

  // eingesetzter Text gelöscht oder ersetzt → Memo löst sich von der Meldung (nie an getippten Text hängen)
  useEffect(() => {
    const r = result;
    if (!r) return;
    if (!o.text.trim() || overlap(o.text, r.inserted) < 0.34) {
      if (o.pendingId === r.att.id) o.onDetach?.(r.att.id);
      setResult(null);
    }
  }, [o.text]); // eslint-disable-line react-hooks/exhaustive-deps

  // nach dem Einsetzen: Feldhöhe nachführen (sonst nur beim Tippen) und Fokus zurück ins Feld
  const fit = useRef(false);
  useEffect(() => {
    const el = o.input?.current;
    if (!fit.current || !el) return;
    fit.current = false;
    el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight + 2, 96) + "px";
    // Handy/Tablet: Tastatur nicht aufklappen (Eintragen per Knopf)
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [o.text]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Feld frei für Erkanntes? (leer, kein anderer Anhang wartet, keine Übersicht offen, keine Aufnahme läuft) */
  const fieldFree = () => !opts.current.text.trim() && !opts.current.pendingId && !batchRef.current;
  const idleRec = () => stRef.current.s === "idle" || stRef.current.s === "fehler";

  const insert = (att: Attachment, raw: string, text: string, changes: Change[]) => {
    opts.current.setText(text);
    opts.current.onAttach(att);
    setResult({ att, raw, changes, n: 1, inserted: text });
    fit.current = true;
  };
  const openBatch = (att: Attachment, raw: string, parts: string[]) => {
    const t = hhmm(att.createdAt);
    setBatch({ items: parts.map((text, i) => ({ text, origin: `Memo ${t}, Teil ${i + 1}` })), att: { ...att, text: raw } });
  };

  /** Erkanntes verteilen: freies Feld → einsetzen bzw. Übersicht; sonst Vorschlag (nichts vermischen) */
  const deliver = (att: Attachment, raw: string) => {
    const { parts, changes } = translate(raw);
    if (!parts.length) { upsert({ att, status: "leer", sec: att.duration ?? 0 }); return; }
    if (fieldFree() && parts.length === 1) { dropJob(att.id); insert(att, raw, parts[0]!, changes); return; }
    if (fieldFree() && idleRec()) {
      dropJob(att.id);
      openBatch(att, raw, parts);
      setResult({ att, raw, changes, n: parts.length, inserted: "" });
      return;
    }
    upsert({ att, status: "vorschlag", sec: att.duration ?? 0, sug: { raw, parts, changes } });
  };
  const upsert = (j: Job) => setJobs((js) => (js.some((x) => x.att.id === j.att.id) ? js.map((x) => (x.att.id === j.att.id ? { ...x, ...j, blob: x.blob } : x)) : [...js, j]));

  /** Warteschlange abarbeiten: immer nur ein Memo gleichzeitig (Whisper braucht das ganze Gerät) */
  const pump = async () => {
    if (running.current) return;
    const j = jobsRef.current.find((x) => x.status === "wartet");
    if (!j) return;
    const id = j.att.id;
    const ctl = new AbortController();
    running.current = { id, ctl };
    try {
      if (!modelReady()) {
        if (!navigator.onLine) { patchJob(id, { status: "ohne-modell" }); return; }
        patchJob(id, { status: "laden" });
        await ensureModel();
        if (ctl.signal.aborted) return;
      }
      const b = j.blob ?? (await getBlob(id).catch(() => undefined));
      if (!b) { patchJob(id, { status: "fehler", msg: "Ton nicht auf diesem Gerät." }); return; }
      patchJob(id, { status: engineWarm() ? "erkennt" : "starten", t0: Date.now(), est: estimateSecs(j.sec) });
      const r = await transcribeOffline(b, {
        signal: ctl.signal,
        onPhase: (p, sec) => patchJob(id, p === "starten" ? { status: "starten" } : { status: "erkennt", t0: Date.now(), est: estimateSecs(sec ?? j.sec) }),
      });
      recordRate(j.sec, r.ms);
      patchAttachment(opts.current.update, id, { text: r.text, engine: r.engine });
      const a2 = { ...j.att, text: r.text, engine: r.engine };
      if (!r.text) { patchJob(id, { status: "leer", att: a2 }); return; }
      deliver(a2, r.text);
    } catch (e) {
      if (isAbort(e) || ctl.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (!modelReady()) patchJob(id, { status: "ohne-modell", msg: navigator.onLine ? msg : undefined });
      else patchJob(id, { status: "fehler", msg });
    } finally {
      if (running.current?.id === id) running.current = null;
      void pump();
    }
  };

  /** Memo in die Warteschlange */
  const enqueue = (att: Attachment, blob?: Blob, warn?: string, load = false) => {
    // ohne Modell nie still laden: erst nach Klick auf «Laden (Grösse, Dauer)»
    const status: JobStatus = modelReady() || modelLoading() || (load && navigator.onLine) ? "wartet" : "ohne-modell";
    upsert({ att, blob, warn, status, sec: att.duration ?? 0 });
    void pump();
  };

  const cancelJob = (id: string) => {
    const r = running.current;
    const j = jobsRef.current.find((x) => x.att.id === id);
    if (r?.id === id) { r.ctl.abort(); running.current = null; }
    dropJob(id);
    if (j && (j.status === "wartet" || j.status === "erkennt" || j.status === "starten" || j.status === "laden")) {
      opts.current.say("Erkennung abgebrochen – Memo bleibt gespeichert (später «Erkennen» unter «Memos ohne Meldung»).");
    }
    void pump();
  };

  const finish = async (r: Recording, liveText: string) => {
    if (r.duration < MIN_S && !liveText) { setSt({ s: "idle" }); opts.current.say("Zu kurz – Knopf gedrückt halten und sprechen (oder antippen = Start, nochmals = Stopp)."); return; }
    const { att, stored, error } = await saveMemo(r, opts.current.update);
    setSt({ s: "idle" });
    const warn = stored ? undefined : `Ton nicht gespeichert (${error ?? "Gerätespeicher"}) – liegt nur in diesem Fenster: «Datei sichern», sonst geht er beim Schliessen verloren.`;
    if (!stored) opts.current.say(warn!);
    if (liveText) {
      const a2 = { ...att, text: liveText, engine: "browser" };
      patchAttachment(opts.current.update, att.id, { text: liveText, engine: "browser" });
      deliver(a2, liveText);
      return;
    }
    enqueue(att, r.blob, warn);
  };

  const stopTimers = () => { window.clearInterval(tick.current); tick.current = undefined; setLevel(0); };

  const start = async () => {
    if (stRef.current.s === "start" || stRef.current.s === "rec" || stRef.current.s === "speichern") return;
    setSt({ s: "start" });
    setLive(""); setSecs(0);
    const r = new Recorder((l) => setLevel(l));
    rec.current = r;
    try {
      await r.start();
    } catch (e) {
      if (rec.current === r) rec.current = null;
      if (e instanceof MicError && e.reason === "abgebrochen") return; // Esc während des Starts
      if (e instanceof MicError && e.reason === "kein-mikrofon") setAvailable(false);
      setSt({ s: "fehler", msg: e instanceof Error ? e.message : String(e), denied: e instanceof MicError && e.reason === "verweigert" });
      return;
    }
    // inzwischen abgebrochen (Esc, Verlassen): Mikrofon sofort frei geben
    if (rec.current !== r) { r.cancel(); return; }
    if (now.current.browserNow) liveRef.current = startLive(setLive, (m) => opts.current.say(m));
    // schon losgelassen, während das Mikrofon startete (Freigabe-Dialog) → wie «antippen»
    const mode = released.current ? "tippen" : "halten";
    setSt({ s: "rec", mode, cancelArmed: false });
    tick.current = window.setInterval(() => {
      const s = r.elapsed();
      setSecs(s);
      if (s >= MAX_S) stop();
    }, 200);
  };

  const stop = async () => {
    const r = rec.current;
    if (!r || stRef.current.s !== "rec") return;
    rec.current = null;
    stopTimers();
    const lv = liveRef.current;
    liveRef.current = null;
    setSt({ s: "speichern" });
    const [recording, liveText] = await Promise.all([r.stop(), lv ? lv.stop() : Promise.resolve("")]);
    await finish(recording, liveText);
  };

  const cancel = () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    stopTimers();
    r.cancel();
    liveRef.current?.abort();
    liveRef.current = null;
    setSt({ s: "idle" });
    opts.current.say("Aufnahme abgebrochen.");
  };

  const press = () => {
    const s = stRef.current;
    if (s.s === "rec") { if (s.mode === "tippen") stop(); return; }
    if (s.s === "start" || s.s === "speichern") return;
    pressAt.current = Date.now();
    released.current = false;
    start();
  };
  const release = () => {
    released.current = true;
    const s = stRef.current;
    if (s.s !== "rec" || s.mode !== "halten") return;
    if (s.cancelArmed) { cancel(); return; }
    if (Date.now() - pressAt.current < TAP_MS) setSt({ ...s, mode: "tippen" });
    else stop();
  };
  const armCancel = (b: boolean) => { const s = stRef.current; if (s.s === "rec" && s.mode === "halten" && s.cancelArmed !== b) setSt({ ...s, cancelArmed: b }); };

  // Leertaste halten (ausserhalb von Eingabefeldern), Esc = abbrechen
  useEffect(() => {
    if (!available) return;
    let spaceDown = false;
    const down = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && (stRef.current.s === "rec" || stRef.current.s === "start")) { ev.preventDefault(); ev.stopPropagation(); cancel(); return; }
      if (ev.key !== " " || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const el = document.activeElement;
      if (editable(ev.target as Element) || editable(el) || (el && (el.tagName === "BUTTON" || el.tagName === "A")) || document.querySelector(".br-back, .av-back, [aria-modal='true']")) return;
      ev.preventDefault();
      if (ev.repeat || spaceDown) return;
      spaceDown = true;
      press();
    };
    const up = (ev: KeyboardEvent) => { if (ev.key === " " && spaceDown) { spaceDown = false; ev.preventDefault(); release(); } };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => { window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); };
  }, [available]); // eslint-disable-line react-hooks/exhaustive-deps

  // beim Verlassen: laufende Aufnahme und Erkennung beenden
  useEffect(() => () => { rec.current?.cancel(); rec.current = null; liveRef.current?.abort(); window.clearInterval(tick.current); running.current?.ctl.abort(); }, []);

  const remove = (a: Attachment) => {
    if (running.current?.id === a.id) { running.current.ctl.abort(); running.current = null; }
    dropJob(a.id);
    opts.current.update((x) => { x.attachments = (x.attachments ?? []).filter((y) => y.id !== a.id); return x; });
    deleteBlob(a.id).catch(() => { /* egal */ });
    if (result?.att.id === a.id) setResult(null);
  };
  const job = (id: string) => jobsRef.current.find((x) => x.att.id === id);
  const sugToField = (id: string) => {
    const j = job(id);
    if (!j?.sug || !fieldFree()) return;
    dropJob(id);
    if (j.sug.parts.length === 1) insert(j.att, j.sug.raw, j.sug.parts[0]!, j.sug.changes);
    else openBatch(j.att, j.sug.raw, j.sug.parts);
  };
  const sugCommit = (id: string) => {
    const j = job(id);
    if (!j?.sug) return;
    // gleiche Regeln wie das Meldungsfeld: direkt nur, wenn jede Meldung grün «bereit» ist – sonst zuerst die Übersicht
    const ex = opts.current.ex, c = journalCtx(ex, opts.current.day ?? defaultDay(ex));
    const green = j.sug.parts.every((t) => stateOf(parseMeldung(t, c), ex, { online: navigator.onLine }).level === "bereit");
    if (!green) { if (!batchRef.current) { dropJob(id); openBatch(j.att, j.sug.raw, j.sug.parts); } return; }
    dropJob(id);
    opts.current.onCommit(j.sug.parts, { ...j.att, text: j.sug.raw });
  };
  const sugReview = (id: string) => {
    const j = job(id);
    if (!j?.sug || batchRef.current) return;
    dropJob(id);
    openBatch(j.att, j.sug.raw, j.sug.parts);
  };
  const take = (a: Attachment) => {
    if (!a.text) { enqueue(a); return; }
    deliver(a, a.text);
  };

  return {
    o, st, jobs, result, available, level, secs, live, settings, setSettings, batch,
    closeBatch: () => { setBatch(null); setResult((r) => (r && r.n > 1 ? null : r)); opts.current.input?.current?.focus(); void pump(); },
    press, release, armCancel, cancel,
    dismiss: () => setSt({ s: "idle" }),
    dismissResult: () => setResult(null),
    recognize: (a, load) => enqueue(a, undefined, undefined, load),
    cancelJob,
    loadAndRecognize: () => { setJobs((js) => js.map((j) => (j.status === "ohne-modell" ? { ...j, status: "wartet", msg: undefined } : j))); void pump(); },
    sugToField, sugCommit, sugReview, take, remove,
  };
}

// ---------------------------------------------------------------- Symbole

const MIC = (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <rect x="7" y="2.2" width="6" height="10" rx="3" fill="currentColor" />
    <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.8M7 17.8h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const MIC_OFF = (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <rect x="7" y="2.2" width="6" height="10" rx="3" fill="currentColor" opacity=".45" />
    <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.8M3 3l14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const GEAR = (
  <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
    <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 2.5v2.2M10 15.3v2.2M2.5 10h2.2M15.3 10h2.2M4.7 4.7l1.6 1.6M13.7 13.7l1.6 1.6M4.7 15.3l1.6-1.6M13.7 6.3l1.6-1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

// ---------------------------------------------------------------- Knopf

export function VoiceButton({ v }: { v: Voice }) {
  const prefs = useSpeechPrefs();
  const browserNow = useBrowserNow(prefs);
  const start = useRef<{ x: number; y: number } | null>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  if (!v.available) return null;
  const recording = v.st.s === "rec" || v.st.s === "start";
  const denied = v.st.s === "fehler" && v.st.denied;
  const busy = v.jobs.some((j) => j.status === "erkennt" || j.status === "starten" || j.status === "laden");
  const title = recording
    ? (v.st.s === "rec" && v.st.mode === "tippen" ? "Nochmals tippen = fertig · Esc = abbrechen" : "Loslassen = fertig · wegziehen = abbrechen")
    : `Sprechen: gedrückt halten (oder antippen = Start/Stopp) · Leertaste halten · Erkennung ${browserNow ? "im Browser (online)" : "offline"}${busy ? " · weitere Memos warten in der Reihe" : ""}`;
  return (
    <span className="vc-wrap">
      <button type="button" className={"vc-btn" + (recording ? " rec" : "") + (v.st.s === "rec" && v.st.cancelArmed ? " armed" : "")}
        style={{ ["--lvl" as string]: recording ? v.level.toFixed(2) : "0" }}
        aria-pressed={recording} aria-label={recording ? "Aufnahme beenden" : "Sprechen"} title={title}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* egal */ }
          start.current = { x: e.clientX, y: e.clientY };
          v.press();
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y;
          v.armCancel(Math.hypot(dx, dy) > 90);
        }}
        onPointerUp={() => { start.current = null; v.release(); }}
        onPointerCancel={() => { start.current = null; v.release(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!e.repeat) { v.press(); v.release(); } }
        }}>
        <span className="vc-ring" aria-hidden="true" />
        {denied ? MIC_OFF : MIC}
        <span className="vc-label">{recording ? (v.st.s === "rec" && v.st.mode === "tippen" ? "Stopp" : "Spricht …") : "Sprechen"}</span>
      </button>
      <button type="button" ref={gearRef} className="vc-gear" aria-label="Einstellungen Spracherkennung" title="Spracherkennung: offline oder Browser" aria-expanded={v.settings}
        onClick={() => v.setSettings(!v.settings)}>{GEAR}</button>
      {v.settings && <SettingsPop anchor={gearRef.current} onClose={() => v.setSettings(false)} />}
      {v.batch && (
        <BatchReview items={v.batch.items} attachment={v.batch.att} ex={v.o.ex} day={v.o.day}
          title={`${v.batch.items.length} ${v.batch.items.length === 1 ? "Meldung" : "Meldungen"} im Memo`}
          onCommit={(texts) => v.o.onCommit(texts, v.batch!.att)}
          onClose={v.closeBatch} />
      )}
    </span>
  );
}

function SettingsPop({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [anchor, onClose]);
  const r = anchor?.getBoundingClientRect();
  const w = Math.min(380, window.innerWidth - 24);
  const H = window.innerHeight;
  const left = r ? Math.max(12, Math.min(r.left - w / 2, window.innerWidth - w - 12)) : 0;
  // unter dem Knopf, sonst darüber; zu wenig Platz (Handy): unten als Blatt
  const style: CSSProperties | undefined = !r || window.innerWidth <= 560 ? undefined
    : H - r.bottom >= 420 ? { left, width: w, top: r.bottom + 8, maxHeight: H - r.bottom - 20 }
      : r.top >= 320 ? { left, width: w, bottom: H - r.top + 8, maxHeight: r.top - 20 }
        : undefined;
  return createPortal(<div ref={ref} className={"vc-pop" + (style ? "" : " sheet")} style={style}><SpeechSettings onClose={onClose} /></div>, document.body);
}

// ---------------------------------------------------------------- Status unter dem Meldungsfeld

/** sekündlich neu zeichnen (Restzeit) */
function useTick(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => { if (!on) return; const i = window.setInterval(() => setN((n) => n + 1), 1000); return () => window.clearInterval(i); }, [on]);
}
const secsLabel = (s: number) => (s >= 90 ? `${Math.round(s / 60)}\u00a0min` : `${Math.max(1, Math.round(s))}\u00a0s`);

function Bars({ level }: { level: number }) {
  const n = 14;
  return (
    <span className="vc-bars" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <i key={i} className={i / n < level ? "on" : ""} />)}
    </span>
  );
}

export function VoiceStatus({ v }: { v: Voice }) {
  const { st } = v;
  const orphans = useOrphanMemos(v.o.ex, v.o.pendingId, v.jobs);
  const recording = st.s === "rec" || st.s === "start";
  return (
    <>
      {st.s === "start" && <div className="vc-status rec"><span className="vc-dot" /> Mikrofon wird gestartet … <button className="chipbtn" onClick={v.cancel}>Abbrechen</button></div>}
      {st.s === "rec" && (
        <div className={"vc-status rec" + (st.cancelArmed ? " armed" : "")} role="status">
          <span className="vc-dot" />
          <span className="tnum vc-time">{fmtDuration(v.secs)}</span>
          <Bars level={v.level} />
          <span className="vc-hint">{st.cancelArmed ? "Loslassen = verwerfen" : st.mode === "tippen" ? "Nochmals tippen = fertig · Esc = abbrechen" : "Loslassen = fertig · wegziehen/Esc = abbrechen"}</span>
          {v.live && <span className="vc-live mono">{v.live}</span>}
          <button className="chipbtn" onClick={v.cancel}>Abbrechen</button>
        </div>
      )}
      {st.s === "speichern" && <div className="vc-status" role="status"><span className="vc-spin" aria-hidden="true" /> Speichere Memo …</div>}
      {st.s === "fehler" && (
        <div className="vc-status err" role="alert">
          <span>{st.msg}</span>
          <button className="vc-x" onClick={v.dismiss} aria-label="Hinweis schliessen">✕</button>
        </div>
      )}
      {v.result && <ResultLine v={v} r={v.result} />}
      {v.jobs.length > 0 && (
        <div className="vc-queue" aria-label="Sprachmemos in Erkennung">
          {v.jobs.map((j) => <JobLine key={j.att.id} v={v} j={j} />)}
        </div>
      )}
      {orphans.length > 0 && !recording && <OrphanTray list={orphans} v={v} />}
    </>
  );
}

function ResultLine({ v, r }: { v: Voice; r: Result }) {
  return (
    <div className="vc-status ok" role="status">
      <span className="vc-ok">{r.n > 1 ? `${r.n} Meldungen erkannt – bitte prüfen` : "Erkannt – prüfen, dann Enter"}</span>
      {r.changes.length > 0 && (
        <span className="vc-changes" title="Funksprache übersetzt">
          {r.changes.slice(0, 6).map((c, i) => <span key={i} className="vc-ch"><s>{c.from}</s> → <b className="mono">{c.to || "–"}</b></span>)}
          {r.changes.length > 6 && <span className="vc-ch">+{r.changes.length - 6}</span>}
        </span>
      )}
      <details className="vc-raw"><summary>gesprochen</summary><span>«{r.raw}»{r.att.engine ? <small> · {engineLabel(r.att.engine)}</small> : null}</span></details>
      <MemoPlayer att={r.att} />
      {r.n > 1 && !v.batch && <button className="chipbtn" onClick={() => v.take({ ...r.att, text: r.raw })}>Nochmals prüfen</button>}
      <button className="vc-x" onClick={v.dismissResult} aria-label="Hinweis schliessen">✕</button>
    </div>
  );
}

/** Eine Zeile je Memo in der Warteschlange */
function JobLine({ v, j }: { v: Voice; j: Job }) {
  const model = useModelState();
  const prefs = useSpeechPrefs();
  const live = j.status === "erkennt" || j.status === "wartet" || j.status === "starten";
  useTick(live);
  const id = j.att.id;
  const stop = <button className="chipbtn" onClick={() => v.cancelJob(id)} title="Erkennung abbrechen – Memo bleibt gespeichert, später erkennen">Abbrechen</button>;
  const close = <button className="vc-x" onClick={() => v.cancelJob(id)} aria-label="Zeile schliessen (Memo bleibt gespeichert)" title="Schliessen – Memo bleibt unter «Memos ohne Meldung»">✕</button>;
  const head = <><MemoPlayer att={j.att} />{j.warn && <span className="vc-warn">{j.warn}</span>}</>;
  if (j.status === "wartet" || j.status === "erkennt" || j.status === "starten" || j.status === "laden") {
    let label: string;
    let extra: string | null = null;
    if (j.status === "laden") {
      const pct = model.status === "laedt" ? Math.round((model.loaded / Math.max(1, model.total)) * 100) : 0;
      label = "Lade Spracherkennung …";
      extra = `${pct} % von ${Math.round(model.total / 1e6)} MB`;
    } else if (j.status === "starten") {
      label = "Starte Spracherkennung …";
    } else if (j.status === "erkennt") {
      const left = (j.est ?? 0) - (Date.now() - (j.t0 ?? Date.now())) / 1000;
      label = left > 1.5 ? `erkenne … ca. ${secsLabel(left)}` : "erkenne … gleich fertig";
    } else {
      // Wartezeit: was vorher läuft plus dieses Memo
      let wait = 0;
      for (const x of v.jobs) {
        if (x.att.id === id) break;
        if (x.status === "erkennt") wait += Math.max(0, (x.est ?? 0) - (Date.now() - (x.t0 ?? Date.now())) / 1000);
        else if (x.status === "wartet" || x.status === "starten") wait += estimateSecs(x.sec);
      }
      label = "wartet";
      extra = `fertig in ca. ${secsLabel(wait + estimateSecs(j.sec))}`;
    }
    return (
      <div className={"vc-status vc-job" + (j.status === "wartet" ? " wait" : "")} role="status">
        {j.status === "wartet" ? <span className="vc-wait" aria-hidden="true" /> : <span className="vc-spin" aria-hidden="true" />}
        <MemoPlayer att={j.att} />
        <span className="vc-job-t">{label}{extra && <small>{extra}</small>}{j.warn && <small className="vc-warn">{j.warn}</small>}</span>
        {stop}
      </div>
    );
  }
  if (j.status === "vorschlag" && j.sug) return <SuggestionLine v={v} j={j} />;
  if (j.status === "ohne-modell") {
    const mb = modelMb(prefs.model);
    const online = navigator.onLine;
    return (
      <div className="vc-status saved" role="status">
        {head}
        <span>{!j.warn && <><b>Memo gespeichert.</b> </>}{online ? "Erkennung offline ist noch nicht geladen." : "Ohne Netz und ohne Modell – später «Erkennen»."}{j.msg ? ` (${j.msg})` : ""}</span>
        {online && <button className="chipbtn primary" onClick={v.loadAndRecognize}>Laden ({downloadLabel(mb)}) und erkennen</button>}
        {close}
      </div>
    );
  }
  return (
    <div className={"vc-status " + (j.status === "fehler" ? "err" : "saved")} role="status">
      {head}
      <span>
        {!j.warn && <><b>Memo gespeichert.</b>{" "}</>}
        {j.status === "leer" ? "Kein Text erkannt – deutlicher und näher am Mikrofon sprechen." : `Erkennung fehlgeschlagen${j.msg ? `: ${j.msg}` : ""}.`}
      </span>
      {j.status === "fehler" && <button className="chipbtn" onClick={() => v.recognize(j.att)}>Nochmals</button>}
      {close}
    </div>
  );
}

/** Erkanntes, das nicht ins Feld durfte (dort steht schon Text) – nichts vermischen */
function SuggestionLine({ v, j }: { v: Voice; j: Job }) {
  const sug = j.sug!;
  const free = !v.o.text.trim() && !v.o.pendingId;
  const day = v.o.day ?? defaultDay(v.o.ex);
  const draft = useMemo(() => (sug.parts.length === 1 ? parseMeldung(sug.parts[0]!, journalCtx(v.o.ex, day)) : null), [sug.parts, v.o.ex, day]);
  const id = j.att.id;
  return (
    <div className="vc-status vc-sug" role="status">
      <MemoPlayer att={j.att} />
      <span className="vc-sug-t">
        <b>Erkannt{sug.parts.length > 1 ? ` (${sug.parts.length} Meldungen)` : ""}:</b>{" "}
        <span className="mono">{sug.parts[0]}</span>{sug.parts.length > 1 && <span className="vc-pct"> +{sug.parts.length - 1}</span>}
      </span>
      {draft && <DraftPreview draft={draft} days={v.o.ex.days} />}
      <span className="vc-sug-b">
        {sug.parts.length === 1 && (free
          ? <button className="chipbtn primary" onClick={() => v.sugToField(id)} title="Ins Meldungsfeld übernehmen (prüfen, dann Enter)">Übernehmen</button>
          : <button className="chipbtn primary" onClick={() => v.sugCommit(id)} title="Als eigene Meldung eintragen – der getippte Text im Feld bleibt">Eintragen</button>)}
        <button className={"chipbtn" + (sug.parts.length > 1 ? " primary" : "")} disabled={!!v.batch} onClick={() => v.sugReview(id)} title="Zuerst in der Übersicht prüfen und bearbeiten">In Übersicht</button>
        <button className="chipbtn" onClick={() => v.cancelJob(id)} title="Verwerfen – Memo bleibt unter «Memos ohne Meldung»">Verwerfen</button>
      </span>
    </div>
  );
}

const engineLabel = (e: string) => (e === "browser" ? "Browser-Erkennung" : e.startsWith("whisper") ? `offline (${e.replace("whisper-", "Whisper ")})` : e);

/** Sprachmemos ohne Meldung (z. B. offline aufgenommen, noch nicht erkannt, verworfen oder abgebrochen) */
function useOrphanMemos(ex: Exercise, pendingId: string | undefined, jobs: Job[]): Attachment[] {
  return useMemo(() => {
    const used = new Set<string>(jobs.map((j) => j.att.id));
    if (pendingId) used.add(pendingId);
    for (const e of ex.events ?? []) if (!e.deleted) for (const a of e.attachments ?? []) used.add(a);
    return (ex.attachments ?? []).filter((a) => a.kind === "audio" && !used.has(a.id) && !a.cell)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [ex.events, ex.attachments, pendingId, jobs]);
}

function OrphanTray({ list, v }: { list: Attachment[]; v: Voice }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const model = useModelState();
  const prefs = useSpeechPrefs();
  const ready = model.status === "bereit";
  const mb = modelMb(prefs.model);
  const shown = open ? list.slice(0, 8) : [];
  return (
    <div className="vc-tray">
      <button className="linkbtn vc-tray-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        {MIC} {list.length} {list.length === 1 ? "Memo" : "Memos"} ohne Meldung {open ? "▴" : "▾"}
      </button>
      {shown.map((a) => (
        <div key={a.id} className="vc-memo">
          <MemoPlayer att={a} />
          <span className="vc-memo-t" title={a.text ?? "noch nicht erkannt"}>{a.text ? `«${a.text}»` : <i>nicht erkannt</i>}</span>
          {a.text
            ? <button className="chipbtn" onClick={() => v.take(a)} title="Ins Meldungsfeld übernehmen (Feld belegt: als Vorschlag; mehrere Meldungen: zur Prüfung)">Übernehmen</button>
            : ready || model.status === "laedt"
              ? <button className="chipbtn" onClick={() => v.recognize(a)}>Erkennen</button>
              : navigator.onLine
                ? <button className="chipbtn" onClick={() => v.recognize(a, true)} title={`Lädt zuerst die Spracherkennung (${downloadLabel(mb)}), danach offline`}>Erkennen (lädt {mb} MB)</button>
                : <span className="help">offline – Modell fehlt</span>}
          {ask === a.id
            ? <><button className="chipbtn danger" onClick={() => { setAsk(null); v.remove(a); }}>Löschen</button><button className="chipbtn" onClick={() => setAsk(null)}>Nein</button></>
            : <button className="vc-x" onClick={() => setAsk(a.id)} aria-label="Memo löschen" title="Memo löschen">✕</button>}
        </div>
      ))}
      {open && list.length > 8 && <span className="help">… und {list.length - 8} ältere</span>}
    </div>
  );
}

// ---------------------------------------------------------------- Player

let playing: HTMLAudioElement | null = null;

/** Sprachmemos einer Meldung (Journalzeile, Banner): je ein kleiner Player, Transkript im Tooltip */
export function RowMemos({ list }: { list: Attachment[] }) {
  const memos = list.filter((a) => a.kind === "audio");
  if (!memos.length) return null;
  return <>{memos.map((a) => <MemoPlayer key={a.id} att={a} compact />)}</>;
}

/** Kleiner Player für ein Sprachmemo (Abspielen/Pause, Fortschritt, Dauer) */
export function MemoPlayer({ att, compact }: { att: Attachment; compact?: boolean }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [on, setOn] = useState(false);
  const [pos, setPos] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!att.id) return;
    let u: string | null = null, gone = false;
    getBlob(att.id).then((b) => { if (gone) return; if (b) { u = URL.createObjectURL(b); setUrl(u); } else setUrl(null); }, () => { if (!gone) setUrl(null); });
    return () => { gone = true; audio.current?.pause(); if (u) URL.revokeObjectURL(u); };
  }, [att.id]);
  if (!att.id || url === undefined) return <span className="vc-play ph" />;
  const said = att.text ? ` – gesprochen: «${att.text}»` : "";
  if (url === null) return <span className={"vc-play none" + (compact ? " sm" : "")} title={`Ton nicht auf diesem Gerät${said}`}>♪ {fmtDuration(att.duration ?? 0)}</span>;
  const dur = att.duration ?? 0;
  const toggle = () => {
    let a = audio.current;
    if (!a) {
      a = new Audio(url);
      audio.current = a;
      a.ontimeupdate = () => setPos(a!.currentTime);
      a.onended = () => { setOn(false); setPos(0); };
      a.onpause = () => setOn(false);
      a.onplay = () => setOn(true);
    }
    if (a.paused) { if (playing && playing !== a) playing.pause(); playing = a; a.play().catch(() => setOn(false)); } else a.pause();
  };
  return (
    <button type="button" className={"vc-play" + (on ? " on" : "") + (compact ? " sm" : "")} onClick={(e) => { e.stopPropagation(); toggle(); }} onKeyDown={(e) => e.stopPropagation()}
      aria-label={on ? "Memo anhalten" : "Memo abspielen"} title={(on ? "Anhalten" : "Memo abspielen") + said}>
      <span aria-hidden="true">{on ? "❚❚" : "▶"}</span>
      <span className="vc-prog" aria-hidden="true"><i style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }} /></span>
      <span className="tnum">{fmtDuration(on || pos ? pos : dur)}</span>
    </button>
  );
}
