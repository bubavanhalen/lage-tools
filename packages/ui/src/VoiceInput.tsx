/**
 * Sprechen statt tippen: Knopf gedrückt halten (oder antippen = Start/Stopp, Leertaste halten am Laptop).
 * Das Sprachmemo wird immer gespeichert. Erkennung offline (Whisper) oder – nur nach Einschalten – im Browser.
 * Ablauf: Transkript → `normalizeSpoken` (Funksprache → Kurzschreibweise) → `splitMeldungen`
 *   → eine Meldung: ins Meldungsfeld (Vorschau wie getippt) · mehrere: `BatchReview`.
 *
 * Einbau im Meldungsfeld: `const voice = useVoice({...})`, dann `<VoiceButton v={voice} />` und `<VoiceStatus v={voice} />`.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { normalizeSpoken, splitMeldungen, type Attachment, type Exercise } from "@lage/core";
import { MicError, Recorder, canRecord, fmtDuration, hasMicrophone, patchAttachment, saveMemo, type Recording } from "./audio";
import { WHISPER_MODELS, ensureModel, startLive, transcribeOffline, useBrowserNow, useModelState, useSpeechPrefs, type LiveSession } from "./stt";
import { SpeechSettings } from "./SpeechSettings";
import { BatchReview, type BatchItem } from "./BatchReview";
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
  /** ID des Anhangs, der gerade auf die nächste Meldung wartet (nicht in «Memos ohne Meldung» zeigen) */
  pendingId?: string;
  /** mehrere Meldungen eintragen (gleicher Weg wie Enter im Meldungsfeld) */
  onCommit: (texts: string[], a: Attachment) => void;
  /** Tag für BatchReview */
  day?: string;
  /** Meldungsfeld (Fokus, Höhe nach dem Einsetzen) */
  input?: RefObject<HTMLTextAreaElement | null>;
}

type State =
  | { s: "idle" }
  | { s: "start" }
  | { s: "rec"; mode: "halten" | "tippen"; cancelArmed: boolean }
  | { s: "erkennen"; att: Attachment; label: string }
  | { s: "ergebnis"; att: Attachment; raw: string; changes: Array<{ from: string; to: string }>; n: number }
  | { s: "gespeichert"; att: Attachment; why: "modell" | "offline" | "fehler" | "leer"; msg?: string }
  | { s: "fehler"; msg: string; denied?: boolean };

export interface Voice {
  o: VoiceOptions;
  st: State;
  available: boolean;
  level: number;
  secs: number;
  live: string;
  settings: boolean;
  setSettings: (b: boolean) => void;
  batch: { items: BatchItem[]; att: Attachment } | null;
  setBatch: (b: { items: BatchItem[]; att: Attachment } | null) => void;
  press: () => void;
  release: () => void;
  armCancel: (b: boolean) => void;
  cancel: () => void;
  dismiss: () => void;
  recognize: (a: Attachment) => void;
  /** schon erkannten Text nochmals übernehmen (ins Feld bzw. Übersicht) */
  take: (a: Attachment) => void;
  remove: (a: Attachment) => void;
  loadAndRecognize: (a: Attachment) => void;
}

const hhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const editable = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);

export function useVoice(o: VoiceOptions): Voice {
  const opts = useRef(o);
  opts.current = o;
  const prefs = useSpeechPrefs();
  const model = useModelState();
  const browserNow = useBrowserNow(prefs);
  // für Tasten-Ereignisse (einmal angemeldet) immer den aktuellen Stand
  const now = useRef({ ready: model.status === "bereit", browserNow });
  now.current = { ready: model.status === "bereit", browserNow };
  const [st, setSt] = useState<State>({ s: "idle" });
  const stRef = useRef(st);
  stRef.current = st;
  const [available, setAvailable] = useState(() => canRecord());
  const [level, setLevel] = useState(0);
  const [secs, setSecs] = useState(0);
  const [live, setLive] = useState("");
  const [settings, setSettings] = useState(false);
  const [batch, setBatch] = useState<{ items: BatchItem[]; att: Attachment } | null>(null);
  const rec = useRef<Recorder | null>(null);
  const liveRef = useRef<LiveSession | null>(null);
  const pressAt = useRef(0);
  const released = useRef(false);
  const tick = useRef<number | undefined>(undefined);

  useEffect(() => { if (canRecord()) hasMicrophone().then(setAvailable); }, []);
  // Ergebnis-Hinweis verschwindet, sobald die Meldung eingetragen (Feld leer) ist
  useEffect(() => { if (!o.text && stRef.current.s === "ergebnis") setSt({ s: "idle" }); }, [o.text]);

  /** Text verteilen: eine Meldung ins Feld, mehrere in die Übersicht */
  const route = (raw: string, att: Attachment) => {
    const n = normalizeSpoken(raw);
    const parts = splitMeldungen(n.text).map((t) => t.trim()).filter(Boolean);
    if (!parts.length) { setSt({ s: "gespeichert", att, why: "leer" }); return; }
    if (parts.length === 1) {
      const cur = opts.current.text.trim();
      opts.current.setText(cur ? `${cur} ${parts[0]}` : parts[0]!);
      opts.current.onAttach(att);
      setSt({ s: "ergebnis", att, raw, changes: n.changes.filter((c) => c.to !== c.from), n: 1 });
      // Feldhöhe nachführen (sonst nur beim Tippen) und Fokus zurück
      requestAnimationFrame(() => {
        const el = opts.current.input?.current;
        if (!el) return;
        el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight + 2, 96) + "px";
        el.focus();
      });
    } else {
      const t = hhmm(att.createdAt);
      setBatch({ items: parts.map((text, i) => ({ text, origin: `Memo ${t}, Teil ${i + 1}` })), att: { ...att, text: raw } });
      setSt({ s: "ergebnis", att, raw, changes: n.changes.filter((c) => c.to !== c.from), n: parts.length });
    }
  };

  const recognize = async (att: Attachment, blob?: Blob) => {
    const b = blob ?? (await getBlob(att.id));
    if (!b) { setSt({ s: "gespeichert", att, why: "fehler", msg: "Ton nicht auf diesem Gerät." }); return; }
    setSt({ s: "erkennen", att, label: now.current.ready ? "Erkenne offline …" : "Lade Spracherkennung …" });
    try {
      const r = await transcribeOffline(b);
      patchAttachment(opts.current.update, att.id, { text: r.text, engine: r.engine });
      const a2 = { ...att, text: r.text, engine: r.engine };
      if (!r.text) { setSt({ s: "gespeichert", att: a2, why: "leer" }); return; }
      route(r.text, a2);
    } catch (e) {
      setSt({ s: "gespeichert", att, why: navigator.onLine ? "fehler" : "offline", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const finish = async (r: Recording, liveText: string) => {
    if (r.duration < MIN_S && !liveText) { setSt({ s: "idle" }); opts.current.say("Zu kurz – Knopf gedrückt halten und sprechen (oder antippen = Start, nochmals = Stopp)."); return; }
    const att = await saveMemo(r, opts.current.update);
    if (liveText) {
      const a2 = { ...att, text: liveText, engine: "browser" };
      patchAttachment(opts.current.update, att.id, { text: liveText, engine: "browser" });
      route(liveText, a2);
      return;
    }
    if (now.current.ready) { recognize(att, r.blob); return; }
    setSt({ s: "gespeichert", att, why: navigator.onLine ? "modell" : "offline" });
  };

  const stopTimers = () => { window.clearInterval(tick.current); tick.current = undefined; setLevel(0); };

  const start = async () => {
    if (stRef.current.s === "start" || stRef.current.s === "rec") return;
    setSt({ s: "start" });
    setLive(""); setSecs(0);
    const r = new Recorder((l) => setLevel(l));
    rec.current = r;
    try {
      await r.start();
    } catch (e) {
      rec.current = null;
      if (e instanceof MicError && e.reason === "kein-mikrofon") setAvailable(false);
      setSt({ s: "fehler", msg: e instanceof Error ? e.message : String(e), denied: e instanceof MicError && e.reason === "verweigert" });
      return;
    }
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
    if (!r) return;
    rec.current = null;
    stopTimers();
    const lv = liveRef.current;
    liveRef.current = null;
    setSt({ s: "erkennen", att: { id: "", kind: "audio", mime: "", createdAt: new Date().toISOString() }, label: lv ? "Erkenne (Browser) …" : "Speichere Memo …" });
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
    if (s.s === "erkennen") return;
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

  // beim Verlassen: laufende Aufnahme beenden
  useEffect(() => () => { rec.current?.cancel(); liveRef.current?.abort(); window.clearInterval(tick.current); }, []);

  const remove = (a: Attachment) => {
    opts.current.update((x) => { x.attachments = (x.attachments ?? []).filter((y) => y.id !== a.id); return x; });
    deleteBlob(a.id);
    if ("att" in stRef.current && stRef.current.att.id === a.id) setSt({ s: "idle" });
  };
  const loadAndRecognize = (a: Attachment) => {
    setSt({ s: "erkennen", att: a, label: "Lade Spracherkennung …" });
    ensureModel().then(() => recognize(a), (e: unknown) => setSt({ s: "gespeichert", att: a, why: "fehler", msg: e instanceof Error ? e.message : String(e) }));
  };

  return {
    o, st, available, level, secs, live, settings, setSettings, batch, setBatch,
    press, release, armCancel, cancel, dismiss: () => setSt({ s: "idle" }),
    recognize: (a) => { void recognize(a); }, take: (a) => { if (a.text) route(a.text, a); else void recognize(a); }, remove, loadAndRecognize,
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
  const busy = v.st.s === "erkennen";
  const denied = v.st.s === "fehler" && v.st.denied;
  const title = recording
    ? (v.st.s === "rec" && v.st.mode === "tippen" ? "Nochmals tippen = fertig · Esc = abbrechen" : "Loslassen = fertig · wegziehen = abbrechen")
    : `Sprechen: gedrückt halten (oder antippen = Start/Stopp) · Leertaste halten · Erkennung ${browserNow ? "im Browser (online)" : "offline"}`;
  return (
    <span className="vc-wrap">
      <button type="button" className={"vc-btn" + (recording ? " rec" : "") + (busy ? " busy" : "") + (v.st.s === "rec" && v.st.cancelArmed ? " armed" : "")}
        style={{ ["--lvl" as string]: recording ? v.level.toFixed(2) : "0" }}
        aria-pressed={recording} aria-label={recording ? "Aufnahme beenden" : "Sprechen"} title={title}
        disabled={busy}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
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
          title={`${v.batch.items.length} Meldungen im Memo`}
          onCommit={(texts) => v.o.onCommit(texts, v.batch!.att)}
          onClose={() => { v.setBatch(null); v.dismiss(); v.o.input?.current?.focus(); }} />
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
  const style = r && window.innerWidth > 560
    ? { left: Math.max(12, Math.min(r.left - w / 2, window.innerWidth - w - 12)), top: Math.min(r.bottom + 8, window.innerHeight - 200), width: w }
    : undefined;
  return createPortal(<div ref={ref} className={"vc-pop" + (style ? "" : " sheet")} style={style}><SpeechSettings onClose={onClose} /></div>, document.body);
}

// ---------------------------------------------------------------- Status unter dem Meldungsfeld

function Bars({ level }: { level: number }) {
  const n = 14;
  return (
    <span className="vc-bars" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <i key={i} className={i / n < level ? "on" : ""} />)}
    </span>
  );
}

export function VoiceStatus({ v }: { v: Voice }) {
  const model = useModelState();
  const prefs = useSpeechPrefs();
  const { st } = v;
  const orphans = useOrphanMemos(v.o.ex, v.o.pendingId, "att" in st ? st.att.id : undefined);
  let body: ReactNode = null;
  if (st.s === "start") body = <div className="vc-status rec"><span className="vc-dot" /> Mikrofon wird gestartet …</div>;
  else if (st.s === "rec") {
    body = (
      <div className={"vc-status rec" + (st.cancelArmed ? " armed" : "")} role="status">
        <span className="vc-dot" />
        <span className="tnum vc-time">{fmtDuration(v.secs)}</span>
        <Bars level={v.level} />
        <span className="vc-hint">{st.cancelArmed ? "Loslassen = verwerfen" : st.mode === "tippen" ? "Nochmals tippen = fertig · Esc = abbrechen" : "Loslassen = fertig · wegziehen/Esc = abbrechen"}</span>
        {v.live && <span className="vc-live mono">{v.live}</span>}
        <button className="chipbtn" onClick={v.cancel}>Abbrechen</button>
      </div>
    );
  } else if (st.s === "erkennen") {
    const pct = model.status === "laedt" ? Math.round((model.loaded / Math.max(1, model.total)) * 100) : null;
    body = (
      <div className="vc-status" role="status">
        <span className="vc-spin" aria-hidden="true" /> {st.label}
        {pct !== null && <span className="tnum vc-pct">{pct} % von {Math.round(model.total / 1e6)} MB</span>}
      </div>
    );
  } else if (st.s === "ergebnis") {
    body = (
      <div className="vc-status ok" role="status">
        <span className="vc-ok">{st.n > 1 ? `${st.n} Meldungen erkannt – bitte prüfen` : "Erkannt – prüfen, dann Enter"}</span>
        {st.changes.length > 0 && (
          <span className="vc-changes" title="Funksprache übersetzt">
            {st.changes.slice(0, 6).map((c, i) => <span key={i} className="vc-ch"><s>{c.from}</s> → <b className="mono">{c.to || "–"}</b></span>)}
            {st.changes.length > 6 && <span className="vc-ch">+{st.changes.length - 6}</span>}
          </span>
        )}
        <details className="vc-raw"><summary>gesprochen</summary><span>«{st.raw}»{st.att.engine ? <small> · {engineLabel(st.att.engine)}</small> : null}</span></details>
        <MemoPlayer att={st.att} />
        {st.n > 1 && !v.batch && <button className="chipbtn" onClick={() => v.take({ ...st.att, text: st.raw })}>Nochmals prüfen</button>}
        <button className="vc-x" onClick={v.dismiss} aria-label="Hinweis schliessen">✕</button>
      </div>
    );
  } else if (st.s === "gespeichert") {
    const mb = WHISPER_MODELS[prefs.model].mb;
    body = (
      <div className="vc-status saved" role="status">
        <MemoPlayer att={st.att} />
        <span>
          <b>Memo gespeichert.</b>{" "}
          {st.why === "modell" && <>Erkennung offline ist noch nicht geladen.</>}
          {st.why === "offline" && <>Ohne Netz und ohne Modell – später «Erkennen».</>}
          {st.why === "leer" && <>Kein Text erkannt – deutlicher und näher am Mikrofon sprechen.</>}
          {st.why === "fehler" && <>Erkennung fehlgeschlagen{st.msg ? `: ${st.msg}` : ""}.</>}
        </span>
        {st.why === "modell" && navigator.onLine && <button className="chipbtn primary" onClick={() => v.loadAndRecognize(st.att)}>Laden ({mb} MB) und erkennen</button>}
        {st.why === "fehler" && <button className="chipbtn" onClick={() => v.recognize(st.att)}>Nochmals</button>}
        <button className="vc-x" onClick={v.dismiss} aria-label="Hinweis schliessen">✕</button>
      </div>
    );
  } else if (st.s === "fehler") {
    body = (
      <div className="vc-status err" role="alert">
        <span>{st.msg}</span>
        <button className="vc-x" onClick={v.dismiss} aria-label="Hinweis schliessen">✕</button>
      </div>
    );
  }
  return (
    <>
      {body}
      {orphans.length > 0 && st.s !== "rec" && st.s !== "start" && <OrphanTray list={orphans} v={v} ready={model.status === "bereit"} />}
    </>
  );
}

const engineLabel = (e: string) => (e === "browser" ? "Browser-Erkennung" : e.startsWith("whisper") ? `offline (${e.replace("whisper-", "Whisper ")})` : e);

/** Sprachmemos ohne Meldung (z. B. offline aufgenommen, noch nicht erkannt oder nicht eingetragen) */
function useOrphanMemos(ex: Exercise, pendingId?: string, currentId?: string): Attachment[] {
  return useMemo(() => {
    const used = new Set<string>();
    for (const e of ex.events ?? []) if (!e.deleted) for (const a of e.attachments ?? []) used.add(a);
    return (ex.attachments ?? []).filter((a) => a.kind === "audio" && !used.has(a.id) && a.id !== pendingId && a.id !== currentId && !a.cell)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [ex.events, ex.attachments, pendingId, currentId]);
}

function OrphanTray({ list, v, ready }: { list: Attachment[]; v: Voice; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const busy = v.st.s === "erkennen";
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
            ? <button className="chipbtn" disabled={busy} onClick={() => v.take(a)} title="Ins Meldungsfeld übernehmen (mehrere Meldungen: zur Prüfung)">Übernehmen</button>
            : ready || navigator.onLine
              ? <button className="chipbtn" disabled={busy} onClick={() => (ready ? v.recognize(a) : v.loadAndRecognize(a))}>Erkennen</button>
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

/** Kleiner Player für ein Sprachmemo (Abspielen/Pause, Fortschritt, Dauer) */
export function MemoPlayer({ att }: { att: Attachment }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [on, setOn] = useState(false);
  const [pos, setPos] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!att.id) return;
    let u: string | null = null, gone = false;
    getBlob(att.id).then((b) => { if (gone) return; if (b) { u = URL.createObjectURL(b); setUrl(u); } else setUrl(null); });
    return () => { gone = true; audio.current?.pause(); if (u) URL.revokeObjectURL(u); };
  }, [att.id]);
  if (!att.id || url === undefined) return <span className="vc-play ph" />;
  if (url === null) return <span className="vc-play none" title="Ton nicht auf diesem Gerät">♪ {fmtDuration(att.duration ?? 0)}</span>;
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
    <button type="button" className={"vc-play" + (on ? " on" : "")} onClick={(e) => { e.stopPropagation(); toggle(); }} aria-label={on ? "Memo anhalten" : "Memo abspielen"} title={on ? "Anhalten" : "Memo abspielen"}>
      <span aria-hidden="true">{on ? "❚❚" : "▶"}</span>
      <span className="vc-prog" aria-hidden="true"><i style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }} /></span>
      <span className="tnum">{fmtDuration(on || pos ? pos : dur)}</span>
    </button>
  );
}
