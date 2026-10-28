/**
 * Journal-Liste (Spez. MVP 1, Kap. 2.1, 3.4): neueste zuerst, Stundenköpfe «T2 07:00», je Zeile Zeit · Form + Art
 * (◆ Feind, ● Eigene, ■ Unklar, ▲ Neutral) · Text, darunter «von H05 · AP11 · von 2 Trupps gesehen · korrigiert
 * 07:34 · neu». Klick/Enter = wählen; gewählte Zeile zeigt «Korrigieren» und «Löschen» (Text, 44 px); ↑/↓ wechseln,
 * Entf löscht. «korrigiert 07:34» öffnet die früheren Fassungen. Die Zeile in Korrektur ist dunkel gerahmt.
 * Leerzustände Kap. 4.5. Struktur: `.jlist` mit `li` je Meldung (Stundenköpfe stehen ausserhalb, nicht als `li`).
 * Vertrag `JournalListProps`; Ergänzungen (optional) unten.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { journalStatus, placeLabel, type EventQuality, type Exercise, type LageEvent } from "@lage/core";
import { iconSvg } from "@lage/map";
import { AttachmentChips } from "../Attachments";
import { attachmentsOf } from "../attachmentStore";
import { RowMemos } from "../VoiceInput";
import { KiMark } from "../ki/context";
import { dayLabel } from "../Timeline";
import { RueckblickStreifen } from "../time/RueckblickBanner";
import type { JournalListProps, ZeitApi } from "../shell/contracts";
import "./journal.css";

export interface JournalListExtra {
  /** Meldung, die gerade im Meldungsfeld korrigiert wird (dunkler Rahmen) */
  correcting?: string | null;
  /** Lagezeit für den Streifen «Liste bis 05:30» (nur Rückblick) */
  zeit?: Pick<ZeitApi, "zeit">;
  /** Leerzustand «suche»: Suchtext für «Nichts gefunden für «H07».» */
  query?: string;
  /** Leerzustand «zeige-letzte»: Minuten */
  showLast?: number | null;
  /** Leerzustand «rueckblick»: Lagezeit (ISO lokal) */
  stand?: string | null;
  onClearSearch?(): void;
  onShowAll?(): void;
  /** Leerzustand «erststart»: Knöpfe «Übung vorbereiten», «Beispiel ansehen (fiktiv)» */
  onPrepare?(): void;
  onDemo?(): void;
}

type Shape = "feind" | "eigen" | "unklar" | "neutral";
const SHAPE: Record<Shape, [string, string]> = { feind: ["◆", "Feind"], eigen: ["●", "Eigene"], unklar: ["■", "Unklar"], neutral: ["▲", "Neutral"] };
const shapeOf = (e: Pick<LageEvent, "side" | "aff">): Shape => (e.side === "blau" ? "eigen" : e.aff === "N" ? "neutral" : e.aff === "U" ? "unklar" : "feind");
const NEU_MS = 10 * 60000;

/** Anzeigetext ohne vorangestellten Melder («H01 4 Pers …» → «4 Pers …»), der Melder steht separat */
export function displayText(e: Pick<LageEvent, "melder" | "text">): string {
  const m = e.melder;
  if (!m) return e.text;
  const re = new RegExp("^" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*") + "\\s*(?:meldet\\s*)?[:,]?\\s*", "i");
  const t = e.text.replace(re, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : e.text;
}

function SymbolMini({ e }: { e: LageEvent }) {
  // gleiches Objekt behalten: React setzt innerHTML sonst bei jeder Darstellung neu
  const html = useMemo(() => ({ __html: iconSvg(e.sym, e.aff, 14, { sidc: e.sidc, status: e.status }).svg }), [e.sym, e.aff, e.sidc, e.status]);
  return <span className="jl-sym" aria-hidden="true" dangerouslySetInnerHTML={html} />;
}

interface RowProps {
  e: LageEvent;
  attachments: Exercise["attachments"];
  sel: boolean;
  korr: boolean;
  flash: boolean;
  q?: EventQuality;
  /** Anzahl Trupps, die es gesehen haben (≥ 2 = bestätigt), sonst 0 */
  zwei: number;
  neu: boolean;
  open: boolean;
  onSelect(id: string): void;
  onCorrect(id: string): void;
  onDelete(id: string): void;
  onToggle(id: string): void;
}

const Row = memo(function Row({ e, attachments, sel, korr, flash, q, zwei, neu, open, onSelect, onCorrect, onDelete, onToggle }: RowProps) {
  const sh = shapeOf(e);
  const [f, word] = SHAPE[sh];
  const own = sh === "eigen";
  const who = own ? (e.unit || e.melder) : e.unit && e.unit !== e.melder ? e.unit : "";
  const place = placeLabel(e);
  const status = journalStatus(e);
  const missing = (q?.missing ?? []).filter((m) => m !== "Ort" && m !== "Melder");
  const att = e.attachments?.length ? attachmentsOf({ attachments }, e.attachments) : [];
  return (
    <li data-id={e.id} className={`jl-row k-${sh}${sel ? " sel" : ""}${korr ? " korr" : ""}${flash ? " flash" : ""}`} tabIndex={0}
      aria-current={sel || undefined}
      onClick={(ev) => { if (!(ev.target as HTMLElement).closest("button")) onSelect(e.id); }}>
      <span className="jl-t mono">{e.t.slice(11, 16)}</span>
      <span className="jl-body">
        <span className="jl-l1">
          <span className={`jl-kind k-${sh}`}><span aria-hidden="true">{f}</span> {word}</span>
          {who && <b className="jl-who">{who}</b>}
          <SymbolMini e={e} />
          <span className="jl-text">{displayText(e)}</span>
        </span>
        <span className="jl-l2">
          {!own && e.melder && <span>von {e.melder}</span>}
          {place ? <span className="mono">{place}</span> : <span className="jl-warn">Ort fehlt</span>}
          {!own && zwei > 1 && <span>von {zwei} Trupps gesehen</span>}
          {missing.length > 0 && <span>Fehlt noch: {missing.join(", ")}</span>}
          {status && <button type="button" className="jl-hist" aria-expanded={open} onClick={() => onToggle(e.id)}>{status}</button>}
          {e.via === "ki" && <span className="jl-ki"><KiMark size={9} />KI</span>}
          {korr && <span className="jl-korr">wird korrigiert</span>}
          {neu && <span className="jl-neu">neu</span>}
          {att.length > 0 && <><AttachmentChips list={att.filter((a) => a.kind !== "audio")} /><RowMemos list={att} /></>}
        </span>
        {open && e.history?.length ? (
          <ol className="jl-versions" aria-label="Frühere Fassungen">
            {[...e.history].reverse().map((h) => (
              <li key={h.rev}><span className="mono">{h.t.slice(11, 16)}</span> {h.text}{placeLabel(h) ? <span className="mono"> · {placeLabel(h)}</span> : null}
                <span className="jl-vat"> (Fassung von {new Date(h.at).toTimeString().slice(0, 5)})</span></li>
            ))}
          </ol>
        ) : null}
        {sel && !korr && (
          <span className="jl-acts">
            <button type="button" className="jl-btn" onClick={() => onCorrect(e.id)}>Korrigieren</button>
            <button type="button" className="jl-btn" onClick={() => onDelete(e.id)}>Löschen</button>
          </span>
        )}
      </span>
    </li>
  );
});

export function JournalList(p: JournalListProps & JournalListExtra) {
  const { ex, events, selected, onSelect, onCorrect, onDelete, quality, empty } = p;
  const all = ex.events ?? [];
  const box = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const i = window.setInterval(() => setNowMs(Date.now()), 30000); return () => window.clearInterval(i); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setNowMs(Date.now()), [events]);

  // Auswahl von aussen (Karte, Eintragen): Zeile zeigen und kurz hervorheben
  useEffect(() => {
    if (!selected) return;
    const li = box.current?.querySelector<HTMLElement>(`li[data-id="${selected}"]`);
    if (!li) return;
    const side = li.closest<HTMLElement>(".side");
    const r = li.getBoundingClientRect(), pr = side?.getBoundingClientRect();
    if (!pr || r.top < pr.top || r.bottom > pr.bottom) li.scrollIntoView({ block: "nearest" });
    setFlashId(selected);
    const t = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(t);
  }, [selected]);

  const groups = useMemo(() => {
    const out: Array<{ key: string; head: string; list: LageEvent[] }> = [];
    for (const e of events) {
      const k = e.t.slice(0, 13);
      const g = out[out.length - 1];
      if (g && g.key === k) g.list.push(e);
      else out.push({ key: k, head: `${dayLabel(e.t, ex.days)} ${e.t.slice(11, 13)}:00`, list: [e] });
    }
    return out;
  }, [events, ex.days]);

  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);
  const zweiOf = (e: LageEvent): number => {
    const q = quality?.get(e.id);
    if (!q) return 0;
    const by = (q.confirmedBy ?? []).map((id) => byId.get(id)).filter((x) => x && !x.deleted).length;
    return q.status === "bestaetigt" || by > 0 ? Math.max(2, by + 1) : 0;
  };
  const toggle = useCallback((id: string) => setOpenHist((o) => (o === id ? null : id)), []);

  const onKey = (ev: React.KeyboardEvent) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>("li[data-id]");
    if (!li || (ev.target as HTMLElement).closest("button")) return;
    const id = li.dataset.id!;
    if (ev.key === "Enter") { ev.preventDefault(); onSelect(id); }
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const rows = [...(box.current?.querySelectorAll<HTMLElement>("li[data-id]") ?? [])];
      const n = rows[rows.indexOf(li) + (ev.key === "ArrowDown" ? 1 : -1)];
      if (n) { n.focus(); onSelect(n.dataset.id!); }
    } else if (ev.key === "Delete") { ev.preventDefault(); onDelete(id); }
  };

  const strip = p.zeit ? <RueckblickStreifen zeit={p.zeit} days={ex.days} art="liste" /> : null;

  if (!events.length) {
    return (
      <div className="jl" ref={box}>
        {strip}
        <div className="jl-empty">
          {empty === "erststart" || (!empty && !all.some((e) => !e.deleted)) ? (
            <>
              <p><b>Noch keine Meldungen.</b></p>
              <p>Tippe oben, was gemeldet wurde, z. B. <span className="mono">H04 2 Fz in AK7</span>. Beispiele: «?» im Feld.</p>
              {!ex.sheets.length && <>
                <p>Für Planquadrate braucht es ein Führungsraster.</p>
                <div className="jl-empty-b">
                  {p.onPrepare && <button type="button" className="jl-btn" onClick={p.onPrepare}>Übung vorbereiten</button>}
                  {p.onDemo && <button type="button" className="jl-btn" onClick={p.onDemo}>Beispiel ansehen (fiktiv)</button>}
                </div>
              </>}
            </>
          ) : empty === "suche" ? (
            <>
              <p>Nichts gefunden{p.query ? <> für «{p.query}»</> : null}.</p>
              {p.onClearSearch && <button type="button" className="jl-btn" onClick={p.onClearSearch}>Suche leeren</button>}
            </>
          ) : empty === "zeige-letzte" ? (
            <>
              <p>{p.showLast ? `In den letzten ${p.showLast >= 60 ? `${p.showLast / 60} h` : `${p.showLast} min`} keine Meldung.` : "Im gewählten Zeitraum keine Meldung."}</p>
              {p.onShowAll && <button type="button" className="jl-btn" onClick={p.onShowAll}>alles zeigen</button>}
            </>
          ) : empty === "rueckblick" ? (
            <p>Um {p.stand?.slice(11, 16) ?? "dieser Zeit"} gab es noch keine Meldung.</p>
          ) : (
            <p>Keine Meldungen.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="jl" ref={box} onKeyDown={onKey}>
      {strip}
      {groups.map((g) => (
        <section key={g.key} className="jl-group" aria-label={g.head}>
          <h4 className="jl-head mono">{g.head}</h4>
          <ol className="jlist">
            {g.list.map((e) => {
              const c = e.createdAt ? Date.parse(e.createdAt) : NaN;
              return (
                <Row key={e.id} e={e} attachments={ex.attachments} sel={e.id === selected} korr={e.id === p.correcting} flash={e.id === flashId}
                  q={quality?.get(e.id)} zwei={zweiOf(e)} neu={nowMs - c >= -60000 && nowMs - c < NEU_MS} open={openHist === e.id}
                  onSelect={onSelect} onCorrect={onCorrect} onDelete={onDelete} onToggle={toggle} />
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
