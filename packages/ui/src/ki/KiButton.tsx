/**
 * KI-Knopf mit sichtbarer Offenlegung: Klick → «Wird gesendet: …» (aufklappbar mit Rohinhalt) → Senden/Abbrechen →
 * Laufanzeige (Abbrechen) → Ergebnis an den Aufrufer bzw. Fehler in Klartext. Option «nicht mehr fragen» pro Zweck
 * und Übung – die Offenlegung bleibt dann als Zeile sichtbar.
 * Zustand der KI: aus = Knopf fehlt (oder ausgegraut mit Erklärung), kein Schlüssel = öffnet das Menü, offline = «nur online».
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { KI_PURPOSE_LABEL, type KiPurpose, type KiRequest } from "@lage/core";
import { KiError, kiBodyPreview, type KiResult } from "./client";
import { KiMark, useKi } from "./context";
import "./ki.css";

type St =
  | { s: "idle" }
  | { s: "bauen" }
  | { s: "vorschau"; req: KiRequest }
  | { s: "laeuft"; req: KiRequest; t0: number }
  | { s: "fehler"; msg: string; req?: KiRequest }
  | { s: "gesendet"; req: KiRequest; ms: number };

const RUN_TEXT: Record<KiPurpose, string> = {
  handschrift: "Claude liest das Foto",
  meldung: "Claude deutet die Meldung",
  hinweis: "Claude formuliert den Hinweis aus",
  lagerot: "Claude begründet die Möglichkeit",
  lagebericht: "Claude entwirft den Lagebericht",
};

export interface KiActionProps {
  purpose: KiPurpose;
  /** Knopftext, z. B. «KI deuten» */
  label: string;
  /** Anfrage bauen (erst beim Klick) */
  build: () => KiRequest | Promise<KiRequest>;
  /** Antwort verarbeiten; wirft → «Antwort unbrauchbar» */
  onResult: (r: KiResult, req: KiRequest) => void;
  /** KI aus: Knopf ausgegraut mit Erklärung zeigen (statt ausblenden) */
  showOff?: boolean;
  /** Knopf als Hauptknopf */
  primary?: boolean;
  /** dezent (kleiner Chip) */
  subtle?: boolean;
  /** zusätzlicher Inhalt neben dem Knopf (z. B. Erklärung) */
  aside?: ReactNode;
  /** nach erfolgreichem Senden die Zeile «Gesendet: …» zeigen (Standard: ja) */
  sentLine?: boolean;
  className?: string;
  /** Knopf gesperrt (z. B. kein Foto) */
  disabled?: boolean;
}

export function KiAction({ purpose, label, build, onResult, showOff, primary, subtle, aside, sentLine = true, className, disabled }: KiActionProps) {
  const ki = useKi();
  const [st, setSt] = useState<St>({ s: "idle" });
  const [raw, setRaw] = useState(false);
  const [skip, setSkip] = useState(false);
  const [now, setNow] = useState(Date.now());
  const ctl = useRef<AbortController | null>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  useEffect(() => {
    if (st.s !== "laeuft") return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [st.s]);
  useEffect(() => { if (st.s === "vorschau") sendRef.current?.focus({ preventScroll: true }); }, [st.s]);
  if (!ki) return null;
  const btnCls = (subtle ? "chipbtn ki-btn subtle" : "ki-btn") + (primary ? " primary" : "");

  if (ki.state === "aus") {
    if (!showOff) return null;
    return (
      <span className={"ki-act off " + (className ?? "")}>
        <button className={btnCls} disabled title="KI ist für diese Übung aus – im Menü «KI» einschalten"><KiMark />{label}</button>
        <span className="ki-offnote">KI ist aus. <button className="linkbtn" onClick={ki.openSettings}>Einschalten …</button></span>
      </span>
    );
  }

  const send = async (req: KiRequest) => {
    const c = new AbortController();
    ctl.current = c;
    setSt({ s: "laeuft", req, t0: Date.now() });
    setNow(Date.now());
    try {
      const r = await ki.send(req, c.signal);
      if (c.signal.aborted || ctl.current !== c) return;
      try { onResult(r, req); } catch (e) {
        setSt({ s: "fehler", msg: e instanceof KiError ? e.message : "Die Antwort war unbrauchbar – nochmals versuchen.", req });
        return;
      }
      setSt(sentLine ? { s: "gesendet", req, ms: r.ms } : { s: "idle" });
    } catch (e) {
      if (ctl.current !== c) return;
      if (c.signal.aborted && !(e instanceof KiError && e.code !== "abgebrochen")) { setSt({ s: "idle" }); return; }
      setSt({ s: "fehler", msg: e instanceof KiError ? e.message : "Unbekannter Fehler.", req });
    }
  };
  const start = async () => {
    if (ki.state === "schluessel") { ki.openSettings(); return; }
    if (ki.state === "offline") return;
    setRaw(false); setSkip(false);
    setSt({ s: "bauen" });
    let req: KiRequest;
    try { req = await build(); } catch (e) {
      setSt({ s: "fehler", msg: "Anfrage konnte nicht vorbereitet werden" + ((e as Error)?.message ? `: ${(e as Error).message}` : ".") });
      return;
    }
    if (ki.skips(purpose)) void send(req);
    else setSt({ s: "vorschau", req });
  };
  const cancel = () => { ctl.current?.abort(); setSt({ s: "idle" }); };
  const confirm = (req: KiRequest) => { if (skip) ki.setSkips(purpose, true); void send(req); };

  const busy = st.s === "bauen" || st.s === "laeuft";
  const offline = ki.state === "offline";
  const btn = (
    <button className={btnCls} onClick={start} disabled={disabled || busy || offline || st.s === "vorschau"}
      title={offline ? "KI geht nur online" : ki.state === "schluessel" ? "Zuerst Schlüssel eingeben (Menü «KI»)" : `${KI_PURPOSE_LABEL[purpose]} – du siehst vor dem Senden, was an Claude geht`}>
      <KiMark />{label}{offline ? <span className="ki-only"> · nur online</span> : ki.state === "schluessel" ? <span className="ki-only"> · Schlüssel fehlt</span> : null}
    </button>
  );

  return (
    <span className={"ki-act " + (className ?? "") + (st.s !== "idle" ? " active" : "")}>
      <span className="ki-actrow">{btn}{aside}</span>
      {st.s === "vorschau" && (
        <span className="ki-pre" role="group" aria-label="Wird gesendet">
          <span className="ki-pre-h">Wird an Claude (Anthropic, USA) gesendet:</span>
          <Disclosure req={st.req} />
          <button className="linkbtn ki-rawbtn" aria-expanded={raw} onClick={() => setRaw(!raw)}><span className="hp-chev" aria-hidden="true">▸</span> Genauer Inhalt</button>
          {raw && <pre className="ki-raw">{kiBodyPreview(st.req, ki.model)}</pre>}
          <label className="ki-check small"><input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> <span>Für «{KI_PURPOSE_LABEL[purpose]}» in dieser Übung nicht mehr fragen</span></label>
          <span className="ki-pre-btns">
            <button ref={sendRef} className="primary" onClick={() => confirm(st.req)}>Senden</button>
            <button onClick={cancel}>Abbrechen</button>
            <span className="ki-model-note">{ki.modelLabel}</span>
          </span>
        </span>
      )}
      {st.s === "laeuft" && (
        <span className="ki-run" role="status">
          <span className="ki-spin" aria-hidden="true" />
          <span>{RUN_TEXT[purpose]} … <span className="tnum">{Math.max(0, Math.round((now - st.t0) / 1000))} s</span></span>
          <button onClick={cancel}>Abbrechen</button>
        </span>
      )}
      {st.s === "fehler" && (
        <span className="ki-err" role="alert">
          <span>{st.msg}</span>
          <span className="ki-pre-btns">
            {st.req && <button onClick={() => void send(st.req!)} disabled={offline}>Nochmals</button>}
            <button onClick={() => setSt({ s: "idle" })}>Schliessen</button>
          </span>
        </span>
      )}
      {st.s === "gesendet" && <SentLine req={st.req} ms={st.ms} model={ki.modelLabel} onClose={() => setSt({ s: "idle" })} />}
    </span>
  );
}

/** Liste «was genau das Gerät verlässt» */
export function Disclosure({ req }: { req: KiRequest }) {
  const items = req.disclosure.items.length ? req.disclosure.items : [req.disclosure.summary];
  return <ul className="ki-disc">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

/** Offenlegung nach dem Senden (bleibt sichtbar, auch ohne Rückfrage) */
function SentLine({ req, ms, model, onClose }: { req: KiRequest; ms: number; model: string; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ki-sent">
      <button className="linkbtn ki-sentbtn" aria-expanded={open} onClick={() => setOpen(!open)} title="Was gesendet wurde">
        <span className="hp-chev" aria-hidden="true">▸</span> Gesendet: {req.disclosure.summary} · {model} · {(ms / 1000).toFixed(1).replace(".", ",")} s
      </button>
      <button className="ki-sentx" onClick={onClose} aria-label="Zeile ausblenden" title="ausblenden">×</button>
      {open && <Disclosure req={req} />}
    </span>
  );
}

/** KI-Text unter einer Karte: klar als Entwurf gekennzeichnet */
export function KiDraft({ text, meta, onDrop, children }: { text: string; meta?: string; onDrop?: () => void; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* nicht erlaubt */ }
  };
  return (
    <div className="ki-draft" role="note" aria-label="KI-Entwurf">
      <div className="ki-draft-h"><span className="ki-badge"><KiMark size={12} />KI-Entwurf, prüfen</span>{meta && <span className="ki-draft-m">{meta}</span>}</div>
      <div className="ki-draft-t">{text.split(/\n+/).map((l, i) => <KiLine key={i} line={l} />)}</div>
      <div className="ki-draft-b">
        {children}
        <button className="linkbtn" onClick={copy}>{copied ? "kopiert ✓" : "Kopieren"}</button>
        {onDrop && <button className="linkbtn" onClick={onDrop}>Verwerfen</button>}
      </div>
    </div>
  );
}

/** eine Zeile: «- Punkt» als Aufzählung, «Überschrift:» fett */
function KiLine({ line }: { line: string }) {
  const l = line.trim();
  if (!l) return null;
  const b = /^[-•*]\s+(.*)$/.exec(l);
  if (b) return <p className="ki-li">{b[1]}</p>;
  const h = /^(#{1,3}\s*)?([^:]{2,40}):\s*$/.exec(l) ?? /^#{1,3}\s+(.*)$/.exec(l);
  if (h) return <p className="ki-lh">{(h[2] ?? h[1] ?? "").replace(/^#+\s*/, "")}</p>;
  return <p>{l.replace(/\*\*(.+?)\*\*/g, "$1")}</p>;
}
