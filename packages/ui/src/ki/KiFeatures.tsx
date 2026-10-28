/**
 * KI an den Einsatzstellen: Handschrift auf Fotos, unklare Meldung deuten, Hinweis/Möglichkeit ausformulieren,
 * Lagebericht entwerfen. Alles als Vorschlag – nie automatisch eintragen.
 */
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildCoaExplainRequest, buildHandwritingRequest, buildHintExplainRequest, buildLageberichtRequest, buildMeldungRequest,
  parseExplainResponse, parseHandwritingResponse, parseLageberichtResponse, parseMeldung, parseMeldungResponse,
  type Draft, type Exercise, type Hint, type KiRequest, type KiZeile, type LageEvent, type RedCoa,
} from "@lage/core";
import { DraftPreview } from "../BatchReview";
import { pqDoubt } from "../batchRows";
import { journalCtx } from "../commit";
import { downloadText, safeFileName } from "../store";
import { dayLabel } from "../Timeline";
import type { Rect } from "../photo";
import { KiAction, KiDraft, KiStale, SentInfo } from "./KiButton";
import { KiMark, useKi } from "./context";
import { modelLabel } from "./settings";
import "./ki.css";

// ---------- 1. Handschrift auf dem Foto ----------

/** längste Kante für die KI (Anthropic verkleinert grössere Bilder ohnehin) */
const KI_IMG_MAX = 1568;

/** Foto (bzw. markierter Ausschnitt) als JPEG für die KI – verkleinert, ohne Metadaten */
export function photoForKi(canvas: HTMLCanvasElement, rect?: Rect | null): { base64: string; mime: string; bytes: number } {
  const r = rect && rect.w > 20 && rect.h > 20 ? rect : { x: 0, y: 0, w: canvas.width, h: canvas.height };
  const s = Math.min(1, KI_IMG_MAX / Math.max(r.w, r.h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(r.w * s)); c.height = Math.max(1, Math.round(r.h * s));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.85);
  const base64 = url.slice(url.indexOf(",") + 1);
  const pad = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return { base64, mime: "image/jpeg", bytes: Math.floor((base64.length * 3) / 4) - pad };
}

/**
 * «Mit KI erkennen» im Foto-Dialog: Ergebnis als Zeilen für die Prüfung (BatchReview). Die Offenlegung (`sent`)
 * geht mit – die Prüfung zeigt «Gesendet: …», auch wenn für diesen Zweck nicht mehr nachgefragt wird.
 */
export function KiPhotoButton({ ex, canvas, rect, onLines, showOff, primary, label = "Mit KI erkennen" }: {
  ex: Exercise; canvas: HTMLCanvasElement | null; rect?: Rect | null; onLines: (rows: KiZeile[], notes: string | undefined, sent: KiRequest["disclosure"]) => void; showOff?: boolean; primary?: boolean; label?: string;
}) {
  const ki = useKi();
  if (!ki) return null;
  return (
    <KiAction purpose="handschrift" label={label} showOff={showOff} subtle={!primary} primary={primary} disabled={!canvas} sentLine={false}
      build={() => buildHandwritingRequest(photoForKi(canvas!, rect), { ex, t: ki.t })}
      onResult={(r, req) => {
        const out = parseHandwritingResponse(r.toolInput, { ex, t: ki.t });
        if (!out.rows.length) throw new Error("leer");
        onLines(out.rows, out.notes, req.disclosure);
      }} />
  );
}

// ---------- 2. Unklare Meldung deuten ----------

/** Meldung unklar? (kein Melder, kein Ort, kein Zeichen erkannt, freie Sprache) – dann wird «KI deuten» angeboten */
export function meldungUnklar(draft: Draft | null, text: string, hasPos: boolean): boolean {
  if (!draft || text.trim().length < 10) return false;
  const words = text.trim().split(/\s+/).length;
  const prose = words >= 9 && /\b(sieht|gesehen|laufen|läuft|fahren|fährt|eventuell|vielleicht|bei der|beim|richtung|wahrscheinlich|glaube|irgendwo)\b/i.test(text);
  return !draft.melder || !hasPos || (draft.sym === "einheit" && draft.kind !== "eigen" && words >= 5) || prose;
}

interface MeldungVorschlag { kurz: string; begruendung?: string; unsicher?: string[]; model: string; for: string; sent: KiRequest["disclosure"]; ms: number }

/** dezenter Knopf «KI deuten» unter dem Meldungsfeld, Vorschlag mit Übernehmen/Verwerfen */
export function KiMeldungSuggest({ ex, text, day, unklar, onTake }: { ex: Exercise; text: string; day: string; unklar: boolean; onTake: (kurz: string) => void }) {
  const ki = useKi();
  const [v, setV] = useState<MeldungVorschlag | null>(null);
  const [why, setWhy] = useState(false);
  /** aktueller Text im Feld (die Antwort kommt später – gilt nur, wenn der Text noch derselbe ist) */
  const textRef = useRef(text);
  textRef.current = text;
  /** Text, der gesendet wurde */
  const sentFor = useRef("");
  // Vorschlag gilt nur für den Text, zu dem er erstellt wurde
  useEffect(() => { if (v && text.trim() !== v.for) setV(null); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useMemo(() => (v ? parseMeldung(v.kurz, journalCtx(ex, day)) : null), [v, ex, day]);
  if (!ki || ki.state === "aus") return null;
  if (v && v.for === text.trim()) return (
    <div className="ki-sugg" role="group" aria-label="Vorschlag der KI">
      <div className="ki-sugg-h"><span className="ki-badge"><KiMark size={12} />Vorschlag</span><span className="mono ki-sugg-t">{v.kurz}</span></div>
      {prev && <DraftPreview draft={prev} days={ex.days} posDoubt={pqDoubt(v.unsicher)} />}
      {v.unsicher && v.unsicher.length > 0 && <p className="ki-uns"><b>Unsicher:</b> {v.unsicher.join(" · ")}</p>}
      {v.begruendung && (
        <>
          <button className="linkbtn ki-rawbtn" aria-expanded={why} onClick={() => setWhy(!why)}><span className="hp-chev" aria-hidden="true">▸</span> Begründung</button>
          {why && <p className="ki-why">{v.begruendung}</p>}
        </>
      )}
      <div className="ki-sugg-b">
        <button className="primary" onClick={() => { onTake(v.kurz); setV(null); }} title="Vorschlag ins Meldungsfeld übernehmen – eingetragen wird erst mit «Eintragen»">Übernehmen</button>
        <button onClick={() => setV(null)}>Verwerfen</button>
        <span className="ki-help">{modelLabel(v.model)} · erst «Eintragen» trägt ein</span>
      </div>
      <SentInfo disclosure={v.sent} extra={`${modelLabel(v.model)} · ${(v.ms / 1000).toFixed(1).replace(".", ",")} s`} />
    </div>
  );
  if (!unklar) return null;
  return (
    <KiAction purpose="meldung" label="KI deuten" subtle className="ki-meld"
      aside={<span className="ki-help ki-meld-why">Meldung unklar?</span>}
      build={() => { sentFor.current = text.trim(); return buildMeldungRequest(sentFor.current, { ex, t: ki.t }); }}
      onResult={(r, req) => {
        // Text inzwischen geändert: Vorschlag passt nicht mehr
        if (textRef.current.trim() !== sentFor.current) throw new KiStale("Meldung inzwischen geändert – Vorschlag verworfen. Bei Bedarf nochmals «KI deuten».");
        const out = parseMeldungResponse(r.toolInput, { ctx: { ex, t: ki.t }, text: sentFor.current });
        if (!out.kurz.trim()) throw new Error("leer");
        setV({ ...out, model: r.model, for: sentFor.current, sent: req.disclosure, ms: r.ms });
        setWhy(false);
      }} />
  );
}

// ---------- 3. Hinweis / Möglichkeit Rot ausformulieren ----------

interface Formulierung { text: string; model: string; at: string; sent: KiRequest["disclosure"] }

const evsOf = (ex: Exercise, ids: string[]) => {
  const m = new Map((ex.events ?? []).map((e) => [e.id, e]));
  return ids.map((id) => m.get(id)).filter((e): e is LageEvent => !!e && !e.deleted);
};

/** «Ausformulieren» unter einem Hinweis */
export function KiHintExplain({ h }: { h: Hint }) {
  const ki = useKi();
  if (!ki || ki.state === "aus") return null;
  const key = `hint:${h.id}`;
  const f = ki.memo<Formulierung>(key);
  return (
    <div className="ki-explain">
      {f ? (
        <KiDraft text={f.text} meta={`${modelLabel(f.model)} · ${f.at}`} sent={f.sent} onDrop={() => ki.setMemo(key, undefined)} />
      ) : (
        <KiAction purpose="hinweis" sentLine={false} label="Ausformulieren" subtle
          build={() => buildHintExplainRequest(h, evsOf(ki.ex, h.events), { ex: ki.ex, t: ki.t })}
          onResult={(r, req) => ki.setMemo(key, { text: explainText(r.text), model: r.model, at: clock(), sent: req.disclosure })} />
      )}
    </div>
  );
}

/** «Begründen» unter einer möglichen Aktion Rot */
export function KiCoaExplain({ c }: { c: RedCoa }) {
  const ki = useKi();
  if (!ki || ki.state === "aus") return null;
  const key = `coa:${c.id}`;
  const f = ki.memo<Formulierung>(key);
  return (
    <div className="ki-explain">
      {f ? (
        <KiDraft text={f.text} meta={`${modelLabel(f.model)} · ${f.at}`} sent={f.sent} onDrop={() => ki.setMemo(key, undefined)} />
      ) : (
        <KiAction purpose="lagerot" sentLine={false} label="Ausformulieren" subtle
          build={() => buildCoaExplainRequest(c, evsOf(ki.ex, c.events), { ex: ki.ex, t: ki.t })}
          onResult={(r, req) => ki.setMemo(key, { text: explainText(r.text), model: r.model, at: clock(), sent: req.disclosure })} />
      )}
    </div>
  );
}

/** Einschätzung + «Was prüfen» (max. 3) als Text für den Entwurf */
function explainText(raw: string): string {
  const e = parseExplainResponse(raw);
  if (!e.einschaetzung && !e.pruefen.length) throw new Error("leer");
  return [e.einschaetzung, ...(e.pruefen.length ? ["Was prüfen:", ...e.pruefen.map((p) => `- ${p}`)] : [])].join("\n");
}

const clock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// ---------- 4. Lagebericht ----------

interface Bericht { text: string; model: string; at: string; t: string }

/** Knopf «Lagebericht entwerfen» (Lage Rot) mit Dialog */
export function KiLageberichtButton({ hints, coas }: { hints: Hint[]; coas: RedCoa[] }) {
  const ki = useKi();
  const [open, setOpen] = useState(false);
  if (!ki || ki.state === "aus") return null;
  const has = !!ki.memo<Bericht>("lagebericht");
  return (
    <>
      <button className="chipbtn ki-btn subtle ki-lbbtn" onClick={() => setOpen(true)} title="Entwurf für Rapport oder Übergabe – du siehst vor dem Senden, was an Claude geht">
        <KiMark />{has ? "Lagebericht (Entwurf)" : "Lagebericht entwerfen"}
      </button>
      {open && <LageberichtDialog hints={hints} coas={coas} onClose={() => setOpen(false)} />}
    </>
  );
}

const SINCE: Array<[number, string]> = [[30, "30 Min"], [60, "1 Std"], [120, "2 Std"], [240, "4 Std"], [720, "12 Std"]];
/** ISO lokal minus Minuten (ohne Zeitzonen-Umrechnung) */
function isoMinus(iso: string, min: number): string {
  const d = new Date(iso.slice(0, 16));
  d.setMinutes(d.getMinutes() - min);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function LageberichtDialog({ hints, coas, onClose }: { hints: Hint[]; coas: RedCoa[]; onClose: () => void }) {
  const ki = useKi()!;
  const b = ki.memo<Bericht>("lagebericht");
  const [text, setText] = useState(b?.text ?? "");
  const [copied, setCopied] = useState(false);
  const [since, setSince] = useState(60);
  useEffect(() => { setText(b?.text ?? ""); }, [b?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !ev.defaultPrevented) { ev.preventDefault(); onClose(); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  const lage = `${dayLabel(ki.t, ki.ex.days)} ${ki.t.slice(11, 16)}`;
  const save = (v: string) => { setText(v); if (b) ki.setMemo("lagebericht", { ...b, text: v }); };
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* nicht erlaubt */ } };
  const file = () => downloadText(`Lagebericht_${safeFileName(ki.ex.name)}_${(b?.t ?? ki.t).replace(/[:T]/g, "-")}.txt`,
    `Lagebericht – ${ki.ex.name}\nLagezeit ${b ? `${dayLabel(b.t, ki.ex.days)} ${b.t.slice(11, 16)}` : lage}\nKI-Entwurf (${modelLabel(b?.model ?? ki.model)}), geprüft durch: ________\n\n${text}\n`, "text/plain;charset=utf-8");
  return createPortal(
    <div className="ki-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ki-dlg ki-lb" role="dialog" aria-modal="true" aria-labelledby="ki-lb-h">
        <header className="ki-head">
          <KiMark size={18} />
          <h2 id="ki-lb-h">Lagebericht</h2>
          <span className="ki-sub tnum">Lage {lage}</span>
          <span className="ki-sp" />
          <button className="ki-x" onClick={onClose} aria-label="Schliessen" title="Schliessen (Esc)">×</button>
        </header>
        <div className="ki-body">
          <p className="ki-help">Entwurf für Rapport oder Übergabe, gegliedert in Lage Rot · Lage eigene · Absicht Rot · offene Punkte. Grundlage sind Journal, Hinweise und Lage Rot zur Lagezeit.</p>
          <KiAction purpose="lagebericht" label={b ? "Neu entwerfen" : "Entwurf erstellen"} primary={!b}
            aside={<label className="ki-since">Neue Meldungen seit
              <select value={since} onChange={(e) => setSince(+e.target.value)}>{SINCE.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>}
            build={() => buildLageberichtRequest({ ex: ki.ex, t: ki.t }, { hints, coas, since: isoMinus(ki.t, since) })}
            onResult={(r) => {
              const v = parseLageberichtResponse(r.text);
              if (!v.trim()) throw new Error("leer");
              ki.setMemo("lagebericht", { text: v, model: r.model, at: clock(), t: ki.t });
              setText(v);
            }} />
          {b ? (
            <div className="ki-lbdraft">
              <div className="ki-draft-h"><span className="ki-badge"><KiMark size={12} />KI-Entwurf, prüfen</span>
                <span className="ki-draft-m">Lage {dayLabel(b.t, ki.ex.days)} {b.t.slice(11, 16)} · {modelLabel(b.model)} · erstellt {b.at}{b.t !== ki.t ? " · Lagezeit seither geändert" : ""}</span></div>
              <textarea className="ki-lbtext" value={text} onChange={(e) => save(e.target.value)} aria-label="Lagebericht (bearbeitbar)" spellCheck={false} />
              <p className="ki-help">{text.trim().split(/\s+/).filter(Boolean).length} Wörter · bearbeitbar · Einschätzungen sind Hinweise, keine Fakten – der Zfhr entscheidet.</p>
            </div>
          ) : (
            <p className="ki-empty">Noch kein Entwurf.</p>
          )}
        </div>
        <footer className="ki-foot">
          {b && <button onClick={copy}>{copied ? "Kopiert ✓" : "Kopieren"}</button>}
          {b && <button onClick={file} title="Als Textdatei speichern">Als Datei</button>}
          <button className={b ? "primary" : ""} onClick={onClose}>Schliessen</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
