/**
 * Mehrere Meldungen auf einmal prüfen und übernehmen (nach Foto eines Meldezettels/einer Journalseite oder einem
 * langen Sprachmemo). Je Zeile: Text bearbeiten, Vorschau wie im Meldungsfeld, übernehmen oder verwerfen.
 * Eingetragen wird über den gleichen Weg wie Enter im Meldungsfeld (`onCommit` → `commitTexts` in commit.ts).
 *
 * Tastatur: ↑/↓ = Zeile wechseln · Enter = Zeile übernehmen · Esc = schliessen (mit offenen Vorschlägen: Rückfrage,
 * nochmals Esc = verwerfen).
 */
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseMeldung, symbolDef, type Attachment, type Draft, type Exercise, type Kind } from "@lage/core";
import { iconSvg } from "@lage/map";
import { dayLabel } from "./Timeline";
import { defaultDay, journalCtx } from "./commit";
import { getBlob } from "./store";
import { initialRows, pqDoubt, type BatchItem, type BatchRow } from "./batchRows";
import { BlockNote, ProblemChips } from "./DraftProblems";
import "./batch.css";

export type { BatchItem } from "./batchRows";
export interface BatchReviewProps {
  items: BatchItem[];
  /** Anhang, der an jede übernommene Meldung gehängt wird */
  attachment?: Attachment;
  /** Übungskontext für parseMeldung-Vorschau */
  ex: Exercise;
  onCommit(texts: string[], attachmentId?: string): void; // trägt über den bestehenden Eintrage-Weg ein (gleiche Logik wie Enter im Meldungsfeld, inkl. Zeichen/Strasse/Form)
  onClose(): void;
  /** optional: Tag für Meldungen ohne Tagesangabe (Standard wie im Meldungsfeld) */
  day?: string;
  /** optional: Hinweis über der Liste (z. B. «Handschrift? …») */
  notice?: ReactNode;
  /** optional: Titel (Standard «n Meldungen erkannt») */
  title?: string;
}

const KIND_LABEL: Record<Kind, string> = { eigen: "Eigene", feind: "Feind", unklar: "Unklar" };
const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;



/** Vorschau einer Meldung wie im Meldungsfeld (Zeit, Melder, Art, Zeichen, Ort) – nur Anzeige */
export function DraftPreview({ draft, days, posDoubt }: { draft: Draft; days: string[]; /** Ort nur vermutet (z. B. PQ nicht in der Meldung) */ posDoubt?: string }) {
  const problems = draft.problems ?? [];
  const ortProblem = problems.some((p) => p.kind === "ort");
  const sym = useMemo(() => ({ __html: iconSvg(draft.sym, draft.aff, 16, { sidc: draft.sidc, status: draft.status }).svg }), [draft.sym, draft.aff, draft.sidc, draft.status]);
  const kind = draft.side === "blau" ? "eigen" : draft.aff === "N" ? "neutral" : draft.kind;
  return (
    <div className="preview br-preview">
      <span className={"chip" + (draft.timeFromText ? "" : " soft")} title={draft.timeFromText ? "Zeit aus der Meldung" : "keine Zeit genannt – jetzt"}>{dayLabel(draft.t, days)} {draft.t.slice(11, 16)}</span>
      {draft.melder ? <span className="chip" title="eigenes Element, das meldet">Melder <b>{draft.melder}</b></span>
        : <span className="chip warnsoft" title="Wer meldet? z. B. «H04» an den Anfang">Melder fehlt</span>}
      <span className={"chip br-kind k-" + kind}>{kind === "neutral" ? "Neutral" : KIND_LABEL[draft.kind]}</span>
      {draft.kind !== "eigen" && draft.unit && draft.unit !== draft.melder && <span className="chip"><b>{draft.unit}</b></span>}
      <span className="chip"><span className="symmini" dangerouslySetInnerHTML={sym} />{draft.desc ?? symbolDef(draft.sym).name}{!draft.desc && draft.count && draft.count > 1 ? ` ×${draft.count}` : ""}</span>
      {(draft.dir !== undefined || draft.dirLabel) && <span className="chip" title="Bewegungsrichtung">{draft.dirLabel ?? `Rtg ${compass(draft.dir!)}`}</span>}
      <ProblemChips problems={problems} />
      {ortProblem ? null : draft.pos ? (posDoubt
        ? <span className="chip warnsoft posdoubt" title={`${posDoubt} – Ort nur vermutet`}>📍 {draft.where?.label} · vermutet, prüfen</span>
        : <span className="chip where">📍 {draft.where?.label}</span>)
        : <span className="chip warn">kein Ort{draft.placeQuery ? ` («${draft.placeQuery}»)` : ""}</span>}
    </div>
  );
}

const coarse = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

export function BatchReview({ items, attachment, ex, onCommit, onClose, day, notice, title }: BatchReviewProps) {
  // Zeilen mit Problem (unbekannter Ort, ungültige Zeit) sind nicht vorab angehakt
  const [rows, setRows] = useState<BatchRow[]>(() => {
    const c0 = journalCtx(ex, day ?? defaultDay(ex));
    return initialRows(items, (t) => !!t.trim() && !!parseMeldung(t.replace(/\s*\n\s*/g, " "), c0).problems?.length);
  });
  const [cur, setCur] = useState(0);
  const [raw, setRaw] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1100 && !!attachment);
  const [url, setUrl] = useState<string | null>(null);
  /** Rückfrage «n Vorschläge verwerfen?» beim Schliessen */
  const [ask, setAsk] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const d = day ?? defaultDay(ex);
  const ctx = useMemo(() => journalCtx(ex, d), [ex, d]);
  const drafts = useMemo(() => rows.map((r) => (r.text.trim() ? parseMeldung(r.text.replace(/\s*\n\s*/g, " "), ctx) : null)), [rows, ctx]);

  // Bild bzw. Memo zum Einblenden
  useEffect(() => {
    if (!attachment) return;
    let u: string | null = null, gone = false;
    getBlob(attachment.id).then((b) => { if (b && !gone) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { gone = true; if (u) URL.revokeObjectURL(u); };
  }, [attachment?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusRow = (i: number) => {
    const ta = listRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-i="${i}"]`);
    ta?.focus();
    ta?.closest("li")?.scrollIntoView({ block: "nearest" });
  };
  useEffect(() => { if (!coarse() && window.innerWidth >= 860) window.setTimeout(() => focusRow(0), 30); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = rows.filter((r) => r.state === "offen");
  /** Zeile i hat ein Problem im Entwurf: nicht eintragen, nur nach Korrektur */
  const blocked = (i: number) => !!drafts[i]?.problems?.length;
  const chosen = open.filter((r) => r.on && r.text.trim() && !blocked(rows.indexOf(r)));
  const nextOpen = (from: number, list = rows) => {
    for (let k = 1; k <= list.length; k++) { const j = (from + k) % list.length; if (list[j]!.state === "offen") return j; }
    return -1;
  };

  const take = (i: number) => {
    const r = rows[i];
    if (!r || r.state !== "offen" || !r.text.trim() || blocked(i)) return;
    onCommit([r.text.trim()], attachment?.id);
    const next = rows.map((x, j) => (j === i ? { ...x, state: "eingetragen" as const } : x));
    setRows(next);
    const n = nextOpen(i, next);
    if (n >= 0) { setCur(n); window.setTimeout(() => focusRow(n), 0); }
  };
  const drop = (i: number) => {
    const next = rows.map((x, j) => (j === i ? { ...x, state: "verworfen" as const } : x));
    setRows(next);
    const n = nextOpen(i, next);
    if (n >= 0) { setCur(n); window.setTimeout(() => focusRow(n), 0); }
  };
  const restore = (i: number) => setRows(rows.map((x, j) => (j === i ? { ...x, state: "offen" as const } : x)));
  const takeAll = () => {
    if (!chosen.length) return;
    onCommit(chosen.map((r) => r.text.trim()), attachment?.id);
    onClose();
  };

  /** offene Vorschläge mit Text (würden beim Schliessen verworfen) */
  const pending = open.filter((r) => r.text.trim()).length;
  /** Schliessen: mit offenen Vorschlägen erst nachfragen */
  const requestClose = () => { if (pending > 0 && !ask) { setAsk(true); return; } onClose(); };
  useEffect(() => { if (ask) askRef.current?.focus(); }, [ask]);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.defaultPrevented) return;
      ev.preventDefault();
      // nochmals Esc während der Rückfrage = verwerfen
      if (ask || pending === 0) onClose(); else setAsk(true);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, ask, pending]);

  const done = rows.filter((r) => r.state === "eingetragen").length;
  const head = title ?? (items.length === 1 ? "1 Meldung erkannt" : `${items.length} Meldungen erkannt`);
  const isAudio = attachment?.kind === "audio";

  return createPortal(
    <div className="br-back" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className={"br" + (raw ? " withraw" : "")} role="dialog" aria-modal="true" aria-label="Meldungen prüfen und übernehmen">
        <header className="br-head">
          <b className="br-title">{head}</b>
          {done > 0 && <span className="br-done tnum">{done} eingetragen</span>}
          <span className="br-sp" />
          {attachment && (
            <button className="chipbtn" aria-pressed={raw} onClick={() => setRaw(!raw)} title={isAudio ? "Memo und Transkript daneben zeigen" : "Foto und erkannten Rohtext daneben zeigen"}>
              {raw ? "Ausblenden" : isAudio ? "Memo / Rohtext" : "Bild / Rohtext"}
            </button>
          )}
          <button className="br-x" onClick={requestClose} aria-label="Schliessen" title="Schliessen (Esc)">×</button>
        </header>
        {notice && <div className="br-notice">{notice}</div>}
        <div className="br-body">
          {raw && attachment && (
            <aside className="br-raw" aria-label={isAudio ? "Sprachmemo" : "Foto"}>
              {url && (isAudio ? <audio controls src={url} /> : <img src={url} alt="Foto des Meldezettels" />)}
              {attachment.text && <pre className="br-rawtext">{attachment.text}</pre>}
            </aside>
          )}
          <ol className="br-list" ref={listRef}>
            {rows.map((r, i) => {
              const dr = drafts[i];
              if (r.state !== "offen") return (
                <li key={r.key} className={"br-row closed " + r.state}>
                  <span className="br-state">{r.state === "eingetragen" ? "✓ eingetragen" : "verworfen"}</span>
                  <span className="br-closedtext mono">{r.text}</span>
                  {r.state === "verworfen" && <button className="chipbtn" onClick={() => restore(i)}>zurückholen</button>}
                </li>
              );
              const k = dr ? (dr.side === "blau" ? "eigen" : dr.aff === "N" ? "neutral" : dr.kind) : "leer";
              return (
                <li key={r.key} className={`br-row k-${k}` + (i === cur ? " cur" : "") + (r.on ? "" : " off")} onFocus={() => setCur(i)}>
                  <label className="br-check" title="übernehmen">
                    <input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} aria-label={`Zeile ${i + 1} übernehmen`} />
                  </label>
                  <div className="br-main">
                    {r.origin && <span className="br-origin">{r.origin}</span>}
                    {r.doubt && <span className="br-doubt" role="note"><b>bitte prüfen:</b> {r.doubt.join(" · ")}</span>}
                    <textarea className="br-text" data-i={i} rows={1} value={r.text} spellCheck={false} aria-label={`Meldung ${i + 1}`}
                      ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight + 2, 120) + "px"; } }}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value.replace(/\n/g, " ") } : x)))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); take(i); }
                        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          const step = e.key === "ArrowDown" ? 1 : -1;
                          for (let j = i + step; j >= 0 && j < rows.length; j += step) {
                            if (rows[j]!.state === "offen") { e.preventDefault(); setCur(j); focusRow(j); break; }
                          }
                        }
                      }} />
                    {dr ? <DraftPreview draft={dr} days={ex.days} posDoubt={pqDoubt(r.doubt)} /> : <span className="help">leer – verwerfen oder Text ergänzen</span>}
                    {dr?.normalized && dr.normalized !== dr.text && <span className="help br-read">gelesen als: <span className="mono">{dr.normalized}</span></span>}
                    {dr && <BlockNote problems={dr.problems ?? []} verb="Übernehmen" />}
                  </div>
                  <div className="br-acts">
                    <button className="br-take" onClick={() => take(i)} disabled={!r.text.trim() || blocked(i)} title={blocked(i) ? "Zuerst korrigieren (Problem in der Meldung)" : "Diese Meldung eintragen (Enter)"}>✓<span> Übernehmen</span></button>
                    <button className="br-drop" onClick={() => drop(i)} title="Verwerfen" aria-label={`Zeile ${i + 1} verwerfen`}>✕</button>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        {ask ? (
          <footer className="br-foot br-ask" role="alertdialog" aria-label="Vorschläge verwerfen?">
            <b className="br-askq">{pending === 1 ? "1 Vorschlag" : `${pending} Vorschläge`} nicht übernommen – verwerfen?</b>
            <span className="help br-keys"><b>Esc</b> nochmals = verwerfen</span>
            <button ref={askRef} onClick={() => setAsk(false)}>Zurück</button>
            <button className="danger" onClick={onClose}>Verwerfen</button>
          </footer>
        ) : (
          <footer className="br-foot">
            <span className="help br-keys"><b>↑/↓</b> Zeile · <b>Enter</b> Zeile übernehmen · <b>Esc</b> schliessen</span>
            <button onClick={requestClose}>{open.length ? "Schliessen" : "Fertig"}</button>
            <button className="primary" disabled={!chosen.length} onClick={takeAll}>{chosen.length === open.length ? "Alle übernehmen" : "Gewählte übernehmen"} ({chosen.length})</button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
