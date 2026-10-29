/**
 * Journal-Liste (Spez. MVP 1, Kap. 2.1, 3.4): neueste zuerst, Stundenköpfe «T2 07:00», je Zeile Zeit · Form + Art
 * (◆ Feind, ● Eigene, ■ Unklar, ▲ Neutral) · Text, darunter «von H05 · AP11 · von 2 Trupps gesehen · korrigiert
 * 07:34 · neu». Klick/Enter = wählen; gewählte Zeile zeigt «Korrigieren» und «Löschen» (Text, 44 px); ↑/↓ wechseln,
 * Entf löscht. «korrigiert 07:34» öffnet die früheren Fassungen. Die Zeile in Korrektur ist dunkel gerahmt.
 * Leerzustände Kap. 4.5. Struktur: `.jlist` mit `li` je Meldung (Stundenköpfe stehen ausserhalb, nicht als `li`).
 * Vertrag `JournalListProps`; Ergänzungen (optional) unten.
 *
 * Tastatur (Spez. 3.4): die Liste ist **ein** Tab-Stopp (roving tabindex): nur eine Zeile hat `tabIndex=0` (zuletzt
 * fokussiert, sonst gewählt, sonst die oberste); ↑/↓ (Pos1/Ende) wechseln die Zeile, Entf löscht, danach steht der
 * Fokus auf der nächsten Zeile. Knöpfe in nicht aktiven Zeilen sind aus der Tab-Reihenfolge genommen.
 * Ab `VIRT_AB` Meldungen ist die Liste virtualisiert: nur Zeilen im sichtbaren Bereich der scrollenden Spalte (plus
 * Vorrat) stehen im DOM, gemessene Höhen werden gemerkt, Platzhalter oben/unten halten die Bildlaufleiste richtig.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { journalStatus, placeLabel, type EventQuality, type Exercise, type LageEvent } from "@lage/core";
import { iconSvg } from "@lage/map";
import { AttachmentChips } from "../Attachments";
import { attachmentsOf } from "../attachmentStore";
import { RowMemos } from "../VoiceInput";
import { KiMark } from "../ki/context";
import { dayLabel } from "../Timeline";
import { RueckblickStreifen } from "../time/RueckblickBanner";
import type { JournalListProps, ZeitApi } from "../shell/contracts";
import { dayTitle, missLabel } from "../entry/labels";
import "./journal.css";

export interface JournalListExtra {
  /** Meldung, die gerade im Meldungsfeld korrigiert wird (dunkler Rahmen) */
  correcting?: string | null;
  /** Lagezeit für den Streifen «Liste bis 05:30» (nur Rückblick); `tNow` bei LIVE: Meldungen danach als «nach LIVE» kennzeichnen */
  zeit?: Pick<ZeitApi, "zeit"> & { tNow?: string };
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

type Shape = "feind" | "eigen" | "unklar" | "neutral" | "notiz";
const SHAPE: Record<Shape, [string, string]> = { feind: ["◆", "Feind"], eigen: ["●", "Eigene"], unklar: ["■", "Unklar"], neutral: ["▲", "Neutral"], notiz: ["✎", "Notiz"] };
const shapeOf = (e: Pick<LageEvent, "side" | "aff" | "notiz">): Shape => (e.notiz ? "notiz" : e.side === "blau" ? "eigen" : e.aff === "N" ? "neutral" : e.aff === "U" ? "unklar" : "feind");
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
  /** roving tabindex: 0 = Tab-Stopp der Liste, sonst -1 */
  tab: 0 | -1;
  /** LIVE: Meldung liegt nach der LIVE-Zeit (bestätigte Zukunftszeit) → «nach LIVE (T2 15:35)», noch nicht auf der Karte */
  spaeter?: string;
}

const Row = memo(function Row({ e, attachments, sel, korr, flash, q, zwei, neu, open, onSelect, onCorrect, onDelete, onToggle, tab, spaeter }: RowProps) {
  const sh = shapeOf(e);
  const [f, word] = SHAPE[sh];
  const own = sh === "eigen";
  const note = sh === "notiz";
  const who = own ? (e.unit || e.melder) : e.unit && e.unit !== e.melder ? e.unit : "";
  const place = placeLabel(e);
  const status = journalStatus(e);
  const missing = note ? [] : (q?.missing ?? []).filter((m) => m !== "Ort" && m !== "Melder").map(missLabel);
  const att = e.attachments?.length ? attachmentsOf({ attachments }, e.attachments) : [];
  return (
    <li data-id={e.id} className={`jl-row k-${sh}${sel ? " sel" : ""}${korr ? " korr" : ""}${flash ? " flash" : ""}`} tabIndex={tab}
      aria-current={sel || undefined}
      onClick={(ev) => { if (!(ev.target as HTMLElement).closest("button")) onSelect(e.id); }}>
      <span className="jl-t mono">{e.t.slice(11, 16)}</span>
      <span className="jl-body">
        <span className="jl-l1">
          <span className={`jl-kind k-${sh}`}><span aria-hidden="true">{f}</span> {word}</span>
          {who && <b className="jl-who">{who}</b>}
          {!note && <SymbolMini e={e} />}
          <span className="jl-text">{displayText(e)}</span>
        </span>
        <span className="jl-l2">
          {spaeter && <span className="jl-spaeter">nach LIVE ({spaeter}) – noch nicht auf der Karte</span>}
          {!own && e.melder && <span>von {e.melder}</span>}
          {note ? null : place ? <span className="mono">{place}</span> : <span className="jl-warn">Ort fehlt</span>}
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

/** ab so vielen Meldungen nur sichtbare Zeilen ins DOM (kleine Listen bleiben vollständig, z. B. für Abnahme-Zählungen) */
export const VIRT_AB = 120;
/** Vorrat über/unter dem sichtbaren Bereich (px) */
const VORRAT = 900;
/** geschätzte Höhen, bis gemessen */
const H_HEAD = 34, H_ROW = 62;

type Item = { k: "h"; key: string; head: string } | { k: "r"; key: string; e: LageEvent };

const FOCUSABLE = "button, a[href], input, select, textarea, audio[controls], [tabindex]";

/** nächster scrollender Vorfahre (Spalte), sonst das Dokument */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}
const viewOf = (sc: HTMLElement | null) => (sc ? { top: sc.getBoundingClientRect().top, h: sc.clientHeight } : { top: 0, h: window.innerHeight });

/** erster Index i mit offs[i + 1] > y (binäre Suche) */
function indexAt(offs: number[], y: number): number {
  let lo = 0, hi = offs.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) { const m = (lo + hi) >> 1; if (offs[m + 1]! <= y) lo = m + 1; else hi = m; }
  return lo;
}

export function JournalList(p: JournalListProps & JournalListExtra) {
  const { ex, events, selected, onSelect, onCorrect, onDelete, quality, empty } = p;
  const all = ex.events ?? [];
  const box = useRef<HTMLDivElement>(null);
  const vbox = useRef<HTMLDivElement>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** roving tabindex: zuletzt fokussierte Zeile */
  const [rove, setRove] = useState<string | null>(null);
  /** nach dem Darstellen fokussieren (↑/↓, nach Löschen) */
  const focusNext = useRef<string | null>(null);
  useEffect(() => { const i = window.setInterval(() => setNowMs(Date.now()), 30000); return () => window.clearInterval(i); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setNowMs(Date.now()), [events]);

  const items = useMemo(() => {
    const out: Item[] = [];
    let k = "";
    for (const e of events) {
      const h = e.t.slice(0, 13);
      if (h !== k) { k = h; out.push({ k: "h", key: "h:" + h, head: `${dayLabel(e.t, ex.days)} ${e.t.slice(11, 13)}:00` }); }
      out.push({ k: "r", key: e.id, e });
    }
    return out;
  }, [events, ex.days]);
  const virt = events.length >= VIRT_AB;
  const index = useMemo(() => new Map(events.map((e, i) => [e.id, i])), [events]);
  const itemIndex = useMemo(() => new Map(items.map((it, i) => [it.key, i])), [items]);

  // ---------- Fenster (nur virtualisiert)
  const heights = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const offs = useMemo(() => {
    const o = new Array<number>(items.length + 1);
    o[0] = 0;
    for (let i = 0; i < items.length; i++) { const it = items[i]!; o[i + 1] = o[i]! + (heights.current.get(it.key) ?? (it.k === "h" ? H_HEAD : H_ROW)); }
    return o;
  }, [items, measured]); // eslint-disable-line react-hooks/exhaustive-deps
  const [range, setRange] = useState<[number, number]>([0, 40]);
  const scroller = useRef<HTMLElement | null>(null);
  const recompute = useCallback(() => {
    const v = vbox.current;
    if (!v) return;
    const view = viewOf(scroller.current);
    const top = v.getBoundingClientRect().top - view.top;
    const a = indexAt(offs, Math.max(0, -top - VORRAT));
    const b = indexAt(offs, Math.max(0, -top + view.h + VORRAT));
    setRange((r) => (r[0] === a && r[1] === b ? r : [a, b]));
  }, [offs]);
  const recRef = useRef(recompute);
  recRef.current = recompute;
  useEffect(() => {
    if (!virt) return;
    scroller.current = scrollParent(vbox.current);
    let raf = 0;
    const on = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; recRef.current(); }); };
    const target: HTMLElement | Window = scroller.current ?? window;
    target.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    on();
    return () => { target.removeEventListener("scroll", on); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, [virt]);
  useLayoutEffect(() => { if (virt) recompute(); }, [virt, recompute]);
  // gemessene Höhen merken (nur gezeichnete Teile)
  useLayoutEffect(() => {
    if (!virt) return;
    let changed = false;
    vbox.current?.querySelectorAll<HTMLElement>("[data-vk], li[data-id]").forEach((el) => {
      const k = el.dataset.vk ?? el.dataset.id!, h = el.offsetHeight;
      if (h > 0 && Math.abs((heights.current.get(k) ?? -1) - h) > 0.5) { heights.current.set(k, h); changed = true; }
    });
    if (changed) setMeasured((n) => n + 1);
  });

  /** Zeile sichtbar machen (auch wenn sie im virtualisierten Fenster noch nicht gezeichnet ist) */
  const reveal = useCallback((id: string, focus: boolean) => {
    const li = box.current?.querySelector<HTMLElement>(`li[data-id="${id}"]`);
    const sc = virt ? scroller.current : (box.current?.closest<HTMLElement>(".side") ?? null);
    if (li) {
      const r = li.getBoundingClientRect(), view = viewOf(sc ?? null);
      if (r.top < view.top || r.bottom > view.top + view.h) li.scrollIntoView({ block: "nearest" });
      if (focus) li.focus({ preventScroll: true });
      return;
    }
    const i = itemIndex.get(id);
    const v = vbox.current;
    if (i === undefined || !v) return;
    const view = viewOf(scroller.current);
    const y = v.getBoundingClientRect().top - view.top + offs[i]!;
    const dy = y < 0 ? y - 8 : y + (offs[i + 1]! - offs[i]!) > view.h ? y + (offs[i + 1]! - offs[i]!) - view.h + 8 : 0;
    if (dy) { if (scroller.current) scroller.current.scrollTop += dy; else window.scrollBy(0, dy); }
    if (focus) focusNext.current = id;
    recRef.current();
  }, [virt, itemIndex, offs]);

  // Auswahl von aussen (Karte, Eintragen): Zeile zeigen und kurz hervorheben
  useEffect(() => {
    if (!selected) return;
    if (!index.has(selected)) return;
    setRove(selected);
    reveal(selected, false);
    setFlashId(selected);
    const t = window.setTimeout(() => setFlashId(null), 1600);
    return () => window.clearTimeout(t);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fokus nach ↑/↓ bzw. Löschen, sobald die Zeile gezeichnet ist
  useLayoutEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    const li = box.current?.querySelector<HTMLElement>(`li[data-id="${id}"]`);
    if (li) { focusNext.current = null; li.focus({ preventScroll: true }); }
  });

  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);
  const zweiOf = (e: LageEvent): number => {
    const q = quality?.get(e.id);
    if (!q) return 0;
    const by = (q.confirmedBy ?? []).map((id) => byId.get(id)).filter((x) => x && !x.deleted).length;
    return q.status === "bestaetigt" || by > 0 ? Math.max(2, by + 1) : 0;
  };
  const toggle = useCallback((id: string) => setOpenHist((o) => (o === id ? null : id)), []);

  // gezeichnete Teile
  const [a, b] = virt ? [Math.min(range[0], Math.max(0, items.length - 1)), Math.min(range[1], items.length - 1)] : [0, items.length - 1];
  const shown = items.slice(a, b + 1);
  const shownIds = new Set(shown.filter((x) => x.k === "r").map((x) => x.key));
  /** Tab-Stopp: zuletzt fokussiert → gewählt → oberste gezeichnete Zeile */
  const active = (rove && shownIds.has(rove) ? rove : null) ?? (selected && shownIds.has(selected) ? selected : null) ?? shown.find((x) => x.k === "r")?.key ?? null;

  // Knöpfe in nicht aktiven Zeilen aus der Tab-Reihenfolge nehmen (eine Liste = ein Tab-Stopp)
  useLayoutEffect(() => {
    box.current?.querySelectorAll<HTMLElement>("li[data-id]").forEach((li) => {
      const on = li.dataset.id === active;
      li.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
        if (el === li) return;
        if (!on && el.getAttribute("tabindex") !== "-1") { el.setAttribute("tabindex", "-1"); el.dataset.rv = "1"; }
        else if (on && el.dataset.rv) { el.removeAttribute("tabindex"); delete el.dataset.rv; }
      });
    });
  });

  const move = (id: string, to: string | undefined, select = true) => {
    if (!to || to === id) return;
    setRove(to);
    focusNext.current = to;
    if (select) onSelect(to);
    reveal(to, true);
  };
  const del = (id: string) => {
    const i = index.get(id) ?? -1;
    const next = events[i + 1]?.id ?? events[i - 1]?.id;
    const hadFocus = !!box.current?.contains(document.activeElement);
    onDelete(id);
    if (next) { setRove(next); if (hadFocus || document.activeElement === document.body) { focusNext.current = next; reveal(next, true); } }
  };

  // feste Rückrufe für die Zeilen (memo): neue Funktionen der Hülle zeichnen sonst bei jedem Tastendruck alle Zeilen neu
  const cb = useRef({ onSelect, onCorrect, del });
  cb.current = { onSelect, onCorrect, del };
  const rowSelect = useCallback((id: string) => cb.current.onSelect(id), []);
  const rowCorrect = useCallback((id: string) => cb.current.onCorrect(id), []);
  const rowDelete = useCallback((id: string) => cb.current.del(id), []);

  const onKey = (ev: React.KeyboardEvent) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>("li[data-id]");
    if (!li || (ev.target as HTMLElement).closest("button")) return;
    const id = li.dataset.id!;
    const i = index.get(id) ?? 0;
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect(id); }
    else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); move(id, events[i + (ev.key === "ArrowDown" ? 1 : -1)]?.id); }
    else if (ev.key === "Home" || ev.key === "End") { ev.preventDefault(); move(id, (ev.key === "Home" ? events[0] : events[events.length - 1])?.id); }
    else if (ev.key === "Delete") { ev.preventDefault(); del(id); }
  };
  const onFocus = (ev: React.FocusEvent) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>("li[data-id]");
    if (li?.dataset.id && li.dataset.id !== rove) setRove(li.dataset.id);
  };

  /** LIVE-Zeit (Minute); Meldungen danach fehlen auf der Karte (Zukunftszeit bestätigt) */
  const liveT = p.zeit?.zeit.kind === "live" && p.zeit.tNow ? p.zeit.tNow.slice(0, 16) : null;
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

  // gezeichnete Teile zu Stundengruppen zusammenfassen (Kopf nur, wenn er selbst im Fenster liegt)
  const groups: Array<{ key: string; head?: string; rows: LageEvent[] }> = [];
  for (const it of shown) {
    if (it.k === "h") groups.push({ key: it.key, head: it.head, rows: [] });
    else if (groups.length) groups[groups.length - 1]!.rows.push(it.e);
    // Fenster beginnt mitten in einer Stunde: gleicher Schlüssel wie mit Kopf (sonst baut React die Zeilen neu – Fokus weg)
    else groups.push({ key: "h:" + it.e.t.slice(0, 13), rows: [it.e] });
  }
  const vk = virt ? (k: string) => ({ "data-vk": k }) : () => ({});

  return (
    <div className="jl" ref={box} onKeyDown={onKey} onFocus={onFocus}>
      {strip}
      <div ref={vbox} className="jl-v">
        {virt && <div aria-hidden="true" style={{ height: offs[a] }} />}
        {groups.map((g) => (
          <section key={g.key} className="jl-group" aria-label={g.head}>
            {g.head && <h4 className="jl-head mono" title={dayTitle(g.key.slice(2), ex.days)} {...vk(g.key)}>{g.head}</h4>}
            <ol className="jlist">
              {g.rows.map((e) => {
                const c = e.createdAt ? Date.parse(e.createdAt) : NaN;
                const spaeter = liveT && e.t.slice(0, 16) > liveT ? `${dayLabel(e.t, ex.days)} ${e.t.slice(11, 16)}` : undefined;
                return (
                  <Row key={e.id} e={e} attachments={ex.attachments} sel={e.id === selected} korr={e.id === p.correcting} flash={e.id === flashId}
                    q={quality?.get(e.id)} zwei={zweiOf(e)} neu={nowMs - c >= -60000 && nowMs - c < NEU_MS} open={openHist === e.id}
                    onSelect={rowSelect} onCorrect={rowCorrect} onDelete={rowDelete} onToggle={toggle} tab={e.id === active ? 0 : -1} spaeter={spaeter} />
                );
              })}
            </ol>
          </section>
        ))}
        {virt && <div aria-hidden="true" style={{ height: offs[items.length]! - offs[b + 1]! }} />}
      </div>
    </div>
  );
}
