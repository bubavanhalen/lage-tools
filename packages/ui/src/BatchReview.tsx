/**
 * Mehrere Meldungen auf einmal prüfen und übernehmen (nach Foto eines Meldezettels/einer Journalseite oder einem
 * langen Sprachmemo). Je Zeile: Text bearbeiten, Vorschau wie im Meldungsfeld, übernehmen oder verwerfen.
 * Eingetragen wird über den gleichen Weg wie Enter im Meldungsfeld (`onCommit` → `commitTexts` in commit.ts).
 *
 * Gleiche Regeln wie das Meldungsfeld (`entryState`, Nachbesserung K2): jede Zeile ist grün «bereit», gelb «bitte
 * prüfen» (erstes «Übernehmen»/Enter fragt, zweites trägt ein) oder rot «geht nicht» (gesperrt, mit Grund und Ausweg,
 * z. B. «15:35 liegt in der Zukunft – meintest du 07:35?» mit Knopf «07:35 einsetzen»). Vorab angehakt und von
 * «Alle übernehmen» erfasst werden nur grüne Zeilen; gelbe nur einzeln.
 *
 * Tastatur: ↑/↓ = Zeile wechseln · Enter = Zeile übernehmen · Esc = schliessen (mit offenen Vorschlägen: Rückfrage,
 * nochmals Esc = verwerfen).
 */
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseMeldung, symbolDef, type Attachment, type Draft, type EntryState, type Exercise, type Kind } from "@lage/core";
import { iconSvg } from "@lage/map";
import { dayLabel } from "./Timeline";
import { defaultDay, journalCtx } from "./commit";
import { getBlob } from "./store";
import { initialRows, pqDoubt, type BatchItem, type BatchRow } from "./batchRows";
import { dayTitle, genericWhat, replaceToken } from "./entry/labels";
import { stateOf } from "./entry/stateOptions";
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
  const note = draft.kindHint === "notiz";
  const what = draft.desc ?? genericWhat(draft.sym, draft.side, draft.unit || draft.melder) ?? symbolDef(draft.sym).name;
  const sym = useMemo(() => ({ __html: iconSvg(draft.sym, draft.aff, 16, { sidc: draft.sidc, status: draft.status }).svg }), [draft.sym, draft.aff, draft.sidc, draft.status]);
  const kind = draft.side === "blau" ? "eigen" : draft.aff === "N" ? "neutral" : draft.kind;
  return (
    <div className="preview br-preview">
      <span className={"chip" + (draft.timeFromText ? "" : " soft")} title={`${dayTitle(draft.t, days)} · ${draft.timeFromText ? "Zeit aus der Meldung" : "keine Zeit genannt – jetzt"}`}>{dayLabel(draft.t, days)} {draft.t.slice(11, 16)}</span>
      {draft.melder ? <span className="chip" title="Trupp, der meldet"><b>{draft.melder}</b> meldet</span>
        : !note && <span className="chip warnsoft" title="Wer meldet? z. B. «H04» an den Anfang">Wer meldet? fehlt</span>}
      {note ? <span className="chip">Notiz – ohne Zeichen</span> : <>
        <span className={"chip br-kind k-" + kind}>{kind === "neutral" ? "Neutral" : KIND_LABEL[draft.kind]}</span>
        {draft.kind !== "eigen" && draft.unit && draft.unit !== draft.melder && <span className="chip"><b>{draft.unit}</b></span>}
        <span className="chip"><span className="symmini" dangerouslySetInnerHTML={sym} />{what}{!draft.desc && draft.count && draft.count > 1 ? ` ×${draft.count}` : ""}</span>
      </>}
      {(draft.dir !== undefined || draft.dirLabel) && <span className="chip" title="Bewegungsrichtung">{draft.dirLabel ?? `Rtg ${compass(draft.dir!)}`}</span>}
      {note || ortProblem ? null : draft.pos ? (posDoubt
        ? <span className="chip warnsoft posdoubt" title={`${posDoubt} – Ort nur vermutet`}>📍 {draft.where?.label} · vermutet, prüfen</span>
        : <span className="chip where">📍 {draft.where?.label}</span>)
        : <span className="chip warn">{draft.placeQuery ? `Ort «${draft.placeQuery}» nicht gefunden` : "Ort fehlt"}</span>}
    </div>
  );
}

const coarse = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

type RowLevel = EntryState["level"];
/** Ausweg ohne Bedienelemente des Meldungsfelds (keine Trupp-Knöpfe, keine Karte im Dialog) */
const batchHint = (h: string) => h.replace(/^Trupp oben antippen oder an den Anfang schreiben\.$/, "Trupp an den Anfang schreiben, z. B. H04.")
  .replace(/ oder Ort auf Karte setzen/g, "");
const LEVEL_TEXT: Record<RowLevel, string> = { bereit: "Bereit", pruefen: "Bitte prüfen", "geht-nicht": "Geht nicht" };

/** Zustand einer Zeile: `entryState` wie im Feld; KI-Zeilen mit unsicheren Teilen sind mindestens gelb */
function rowState(dr: Draft | null, doubt: string[] | undefined, ex: Exercise, online: boolean): EntryState | null {
  if (!dr) return null;
  const st = stateOf(dr, ex, { online });
  if (!doubt?.length || st.level === "geht-nicht") return st;
  const r = { code: "ort" as const, text: `Unsicher gelesen: ${doubt.join(" · ")}`, hint: "Text mit dem Foto vergleichen und korrigieren.", ask: "So übernehmen? Nochmals «Übernehmen»." };
  return { level: "pruefen", reasons: [r, ...st.reasons] };
}

export function BatchReview({ items, attachment, ex, onCommit, onClose, day, notice, title }: BatchReviewProps) {
  const online = typeof navigator === "undefined" || navigator.onLine;
  // nur grüne Zeilen sind vorab angehakt (gelbe einzeln bestätigen, rote erst nach Korrektur)
  const [rows, setRows] = useState<BatchRow[]>(() => {
    const c0 = journalCtx(ex, day ?? defaultDay(ex));
    return initialRows(items, (t) => {
      if (!t.trim()) return false;
      const dr = parseMeldung(t.replace(/\s*\n\s*/g, " "), c0);
      return stateOf(dr, ex, { online }).level !== "bereit";
    });
  });
  const [cur, setCur] = useState(0);
  const [raw, setRaw] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1100 && !!attachment);
  const [url, setUrl] = useState<string | null>(null);
  /** Rückfrage «n Vorschläge verwerfen?» beim Schliessen */
  const [ask, setAsk] = useState(false);
  /** gelbe Zeile: Text, zu dem das erste «Übernehmen» gefragt hat (je Zeilenschlüssel) */
  const [armed, setArmed] = useState<Record<number, string>>({});
  const askRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const d = day ?? defaultDay(ex);
  const ctx = useMemo(() => journalCtx(ex, d), [ex, d]);
  const drafts = useMemo(() => rows.map((r) => (r.text.trim() ? parseMeldung(r.text.replace(/\s*\n\s*/g, " "), ctx) : null)), [rows, ctx]);
  const states = useMemo(() => drafts.map((dr, i) => rowState(dr, rows[i]!.doubt, ex, online)), [drafts, rows, ex, online]);

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
  const levelOf = (i: number): RowLevel | null => states[i]?.level ?? null;
  /** «Alle übernehmen»: nur angehakte grüne Zeilen */
  const chosen = open.filter((r) => r.on && r.text.trim() && levelOf(rows.indexOf(r)) === "bereit");
  const toCheck = open.filter((r) => r.text.trim() && levelOf(rows.indexOf(r)) !== "bereit").length;
  const nextOpen = (from: number, list = rows) => {
    for (let k = 1; k <= list.length; k++) { const j = (from + k) % list.length; if (list[j]!.state === "offen") return j; }
    return -1;
  };

  const setText = (i: number, text: string) => setRows(rows.map((x, j) => (j === i ? { ...x, text } : x)));
  const take = (i: number) => {
    const r = rows[i];
    const lvl = levelOf(i);
    if (!r || r.state !== "offen" || !r.text.trim() || !lvl) return;
    // nie still falsch: «geht nicht» trägt nie ein
    if (lvl === "geht-nicht") { focusRow(i); return; }
    // gelb: erstes Übernehmen fragt, zweites (ohne Textänderung) trägt ein
    if (lvl === "pruefen" && armed[r.key] !== r.text) { setArmed({ ...armed, [r.key]: r.text }); return; }
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
    const keys = new Set(chosen.map((r) => r.key));
    const next = rows.map((x) => (keys.has(x.key) ? { ...x, state: "eingetragen" as const } : x));
    setRows(next);
    // gelbe/rote Zeilen bleiben offen zum Prüfen; sonst fertig
    if (!next.some((x) => x.state === "offen" && x.text.trim())) onClose();
    else { const n = next.findIndex((x) => x.state === "offen"); if (n >= 0) { setCur(n); window.setTimeout(() => focusRow(n), 0); } }
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
  const allGreen = chosen.length === open.length;

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
              const st = states[i];
              const lvl = st?.level ?? null;
              const r0 = st?.reasons[0];
              const asked = lvl === "pruefen" && armed[r.key] === r.text;
              const green = lvl === "bereit";
              const offer = st?.reasons.find((x) => x.code === "zukunft" && x.suggest && x.token);
              const wasOffer = st?.reasons.find((x) => x.code === "was" && x.token) && dr?.unknownWord?.suggestLabel ? dr.unknownWord : undefined;
              return (
                <li key={r.key} className={`br-row k-${k}` + (i === cur ? " cur" : "") + (r.on && green ? "" : " off") + (lvl ? ` lvl-${lvl}` : "")} onFocus={() => setCur(i)} data-zustand={lvl ?? undefined}>
                  <label className="br-check" title={green ? "bei «Alle übernehmen» mitnehmen" : "einzeln prüfen und übernehmen"}>
                    <input type="checkbox" checked={r.on && green} disabled={!green}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                      aria-label={green ? `Zeile ${i + 1} bei «Alle übernehmen» mitnehmen` : `Zeile ${i + 1}: einzeln prüfen und übernehmen`} />
                  </label>
                  <div className="br-main">
                    {r.origin && <span className="br-origin">{r.origin}</span>}
                    <textarea className="br-text" data-i={i} rows={1} value={r.text} spellCheck={false} aria-label={`Meldung ${i + 1}`}
                      autoCorrect="off" autoCapitalize="off" enterKeyHint="send"
                      aria-invalid={lvl === "geht-nicht" || undefined}
                      ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight + 2, 120) + "px"; } }}
                      onChange={(e) => setText(i, e.target.value.replace(/\n/g, " "))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); take(i); }
                        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          const step = e.key === "ArrowDown" ? 1 : -1;
                          for (let j = i + step; j >= 0 && j < rows.length; j += step) {
                            if (rows[j]!.state === "offen") { e.preventDefault(); setCur(j); focusRow(j); break; }
                          }
                        }
                      }} />
                    {st && lvl && (
                      <div className={`br-st s-${lvl}${asked ? " asked" : ""}`} role={lvl === "bereit" ? undefined : "note"}>
                        {lvl === "bereit" ? <p className="br-st-h"><span aria-hidden="true">✓ </span>Bereit</p>
                          : asked ? <p className="br-st-h"><span aria-hidden="true">⚠ </span>{r0?.ask ?? "Trotzdem übernehmen? Nochmals «Übernehmen»."}</p>
                          : <>
                            <p className="br-st-h"><span aria-hidden="true">{lvl === "pruefen" ? "⚠ " : "⛔ "}</span>{LEVEL_TEXT[lvl]}: {r0?.text}{st.reasons.length > 1 && <span className="br-more"> +{st.reasons.length - 1}</span>}</p>
                            {r0?.hint && <p className="br-st-t">{batchHint(r0.hint)}</p>}
                          </>}
                        {(offer || wasOffer) && (
                          <span className="br-st-acts">
                            {offer && <button type="button" className="chipbtn" onClick={() => setText(i, replaceToken(r.text, offer.token!, offer.suggest!))}>{offer.suggest!.slice(0, 2)}:{offer.suggest!.slice(2)} einsetzen</button>}
                            {wasOffer && <button type="button" className="chipbtn" onClick={() => setText(i, replaceToken(r.text, wasOffer.token, wasOffer.suggestLabel!))}>«{wasOffer.suggestLabel}» einsetzen</button>}
                          </span>
                        )}
                      </div>
                    )}
                    {dr ? <DraftPreview draft={dr} days={ex.days} posDoubt={pqDoubt(r.doubt)} /> : <span className="help">leer – verwerfen oder Text ergänzen</span>}
                    {dr?.normalized && dr.normalized !== dr.text && <span className="help br-read">gelesen als: <span className="mono">{dr.normalized}</span></span>}
                  </div>
                  <div className="br-acts">
                    <button className="br-take" onClick={() => take(i)} disabled={!r.text.trim() || lvl === "geht-nicht"}
                      title={lvl === "geht-nicht" ? "Geht nicht – zuerst korrigieren (siehe Grund)" : lvl === "pruefen" ? "Bitte prüfen – zweimal «Übernehmen» trägt ein" : "Diese Meldung eintragen (Enter)"}>
                      ✓<span> {asked ? "Trotzdem übernehmen" : "Übernehmen"}</span>
                    </button>
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
            <span className="help br-keys">
              {toCheck > 0 ? <><b>{toCheck}</b> {toCheck === 1 ? "Zeile" : "Zeilen"} einzeln prüfen bzw. korrigieren · </> : null}
              <b>↑/↓</b> Zeile · <b>Enter</b> Zeile übernehmen · <b>Esc</b> schliessen
            </span>
            <button onClick={requestClose}>{open.length ? "Schliessen" : "Fertig"}</button>
            <button className="primary" disabled={!chosen.length} onClick={takeAll}>{allGreen ? "Alle übernehmen" : "Alle grünen übernehmen"} ({chosen.length})</button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
