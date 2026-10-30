/**
 * Journal-Liste (Spez. MVP 1, Kap. 2.1, 3.4): neueste zuerst, Stundenköpfe «T2 07:00», je Zeile Zeit · Form + Art
 * (◆ Feind, ● Eigene, ■ Unklar, ▲ Neutral) · Text, darunter «von H05 · AP11 · von 2 Trupps gesehen · korrigiert
 * 07:34 · neu». Klick/Enter = wählen; gewählte Zeile zeigt «Korrigieren», «Mehr …» und «Streichen» (Text, 44 px);
 * ↑/↓ wechseln, Entf streicht. «korrigiert 07:34» öffnet die früheren Fassungen. Die Zeile in Korrektur ist dunkel gerahmt.
 * Leerzustände Kap. 4.5. Struktur: `.jlist` mit `li` je Meldung (Stundenköpfe stehen ausserhalb, nicht als `li`).
 * Vertrag `JournalListProps`; Ergänzungen (optional) unten.
 *
 * MVP 3 (Spez. MVP 3, Kap. 2.1, 2.4, 2.5, 3.3, 3.6): laufende Nummer unter der Zeit (`data-nr`, aria «Nummer 54»),
 * Art ausgeschrieben mit Form (✎ Auftrag/Rückfrage/Orientierung/Notiz, ⇄ Verbindung; `data-art`), «!» dringend,
 * Zeile 2 mit Vermerken («dringend · Massnahme: … · weitergemeldet Bat 07:15 · bis 12:00 · offen · beantwortet …»),
 * «Eingang 07:40» ab 5 min Abstand, Trenner «Neu in deiner Schicht ↑ · seit 06:00 (BSP)» (Klasse `jl-trenner`, kein
 * `li`) statt der 10-Minuten-Marke «neu», gestrichene Einträge an ihrer Zeit (grau, durchgestrichen, «Zurückholen»),
 * Link «Gestrichene zeigen (n)» am Ende, gewählte Zeile mit «Mehr …» (`LvzMenu`). Messpunkt P1 `lt:zeile`.
 *
 * MVP 3.5 (E3, S22, S25): Nummer als «Nr 56» (aria «Nummer 56»), «von 2 Trupps gesehen» zählt **verschiedene Melder**
 * (Trupps im `title`), Ausgang «↗ Ausgang an Bat», «4 min nach jetzt» für Meldungen nach der Geräteuhr (bis erreicht),
 * Zeiten der doppelten Stunde «02:45 MESZ»; alle Zeitvergleiche über `zeitCmp`.
 *
 * Tastatur (Spez. 3.4): die Liste ist **ein** Tab-Stopp (roving tabindex): nur eine Zeile hat `tabIndex=0` (zuletzt
 * fokussiert, sonst gewählt, sonst die oberste); ↑/↓ (Pos1/Ende) wechseln die Zeile, Entf löscht, danach steht der
 * Fokus auf der nächsten Zeile. Knöpfe in nicht aktiven Zeilen sind aus der Tab-Reihenfolge genommen.
 * Ab `VIRT_AB` Meldungen ist die Liste virtualisiert: nur Zeilen im sichtbaren Bereich der scrollenden Spalte (plus
 * Vorrat) stehen im DOM, gemessene Höhen werden gemerkt, Platzhalter oben/unten halten die Bildlaufleiste richtig.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { artOf, artText, bestaetigtVon, journalStatus, lvzIndex, nrLabel, placeLabel, zeitBis, zeitCmp, zeitText, type EventQuality, type Exercise, type LageEvent, type SchichtWechsel } from "@lage/core";
import { iconSvg } from "@lage/map";
import { AttachmentChips } from "../Attachments";
import { attachmentsOf } from "../attachmentStore";
import { RowMemos } from "../VoiceInput";
import { KiMark } from "../ki/context";
import { dayLabel } from "../Timeline";
import { RueckblickStreifen } from "../time/RueckblickBanner";
import { PERF_MARK, type JournalListProps, type ZeitApi } from "../shell/contracts";
import { dayTitle, displayText, eingangText, FORM_ZEICHEN, formOf, hm, missLabel, nichtLageText, vermerkTeile, type ZeilenForm } from "../entry/labels";
import { LvzMenu } from "./LvzMenu";
import { nachJetztText } from "../time/useLageZeit";
import "./journal.css";
import "./lvz.css";

export interface JournalListExtra {
  /** Meldung, die gerade im Meldungsfeld korrigiert wird (dunkler Rahmen) */
  correcting?: string | null;
  /** Lagezeit für den Streifen «Liste bis 05:30» (nur Rückblick); `tNow` bei LIVE: Meldungen danach als «nach LIVE» kennzeichnen; `tUhr` (MVP 3.5): «4 min nach jetzt» */
  zeit?: Pick<ZeitApi, "zeit"> & { tNow?: string; tUhr?: string };
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
  /** (MVP 3) Anzahl gestrichener Einträge im Fenster der Liste (Standard: alle gestrichenen bis zur Lagezeit) */
  gestricheneN?: number;
  /** (MVP 3) gestrichenen Eintrag zurückholen (gewählte Zeile, «Zurückholen») */
  onRestore?(id: string): void;
  /** (MVP 3) laufende Nummer für «Aufgehoben (jetzt)» */
  onNr?(): number;
  /** Übergaben als Zeile «Schichtwechsel 06:45 BSP → WMA» an ihrer Zeit (Prüfung Übergabe M1); fehlt → keine */
  wechsel?: SchichtWechsel[];
}

const WORT: Partial<Record<ZeilenForm, string>> = { feind: "Feind", eigen: "Eigene", unklar: "Unklar", neutral: "Neutral", aufheb: "Aufhebung" };
/** Trennzeichen für Vermerke (Zeichenkette statt Array: Zeilen bleiben `memo`) */
const SEP = "\u0001";

export { displayText, nichtLageText } from "../entry/labels";

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
  /** (MVP 3.5, C14) verschiedene Trupps, die es gesehen haben («H02, H04»; ≥ 2 = bestätigt), sonst "" */
  gesehen: string;
  /** (MVP 3.5, S22) «4 min nach jetzt» (Meldung nach der Geräteuhr, in der Toleranz) */
  nachJetzt?: string;
  /** Uhrzeit der Zeile («07:25», in der doppelten Stunde «02:45 MESZ») */
  hm: string;
  open: boolean;
  onSelect(id: string): void;
  onCorrect(id: string): void;
  onDelete(id: string): void;
  onToggle(id: string): void;
  /** roving tabindex: 0 = Tab-Stopp der Liste, sonst -1 */
  tab: 0 | -1;
  /** LIVE: Meldung liegt nach der LIVE-Zeit (bestätigte Zukunftszeit) → «nach LIVE (T2 15:35)», noch nicht auf der Karte */
  spaeter?: string;
  // ---- MVP 3 (nur Zeichenketten/Zahlen, damit `memo` greift)
  /** Anzeige-Nummer («54», «12a») */
  nr: string;
  /** Art in Worten für Nicht-Meldungen («Auftrag an H03», «Verbindung H02 gut») */
  artWort: string;
  /** Vermerke und Bezüge, getrennt mit SEP; dringend zuerst mit «!» */
  vm: string;
  dringend: boolean;
  /** «gestrichen 07:22 von BSP» */
  del?: string;
  /** «Mehr …» offen an dieser Zeile */
  menu: boolean;
  onMenu(id: string, btn: HTMLElement): void;
  onRestore?(id: string): void;
  /** eigene Trupps (für den Art-Hinweis im Text) – gleiches Array, solange sich die Trupps nicht ändern */
  blau: string[];
}

const Row = memo(function Row({ e, attachments, sel, korr, flash, q, gesehen, nachJetzt, hm: zeitHm, open, onSelect, onCorrect, onDelete, onToggle, tab, spaeter, nr, artWort, vm, dringend, del, menu, onMenu, onRestore, blau }: RowProps) {
  const form = formOf(e);
  const art = artOf(e);
  const lage = art === "meldung" && !e.hebtAuf;
  const own = form === "eigen";
  const word = lage || form === "aufheb" ? WORT[form]! : artWort;
  const who = !lage ? "" : own ? (e.unit || e.melder) : e.unit && e.unit !== e.melder ? e.unit : "";
  const orte = (e.orte ?? []).join(", ");
  // Aufhebung: der Ort steht meist schon im Text («Sperre AG13 aufgehoben»)
  const place = lage ? placeLabel(e) : orte && !(form === "aufheb" && e.text.includes(orte)) ? orte : "";
  const status = journalStatus(e);
  const missing = !lage ? [] : (q?.missing ?? []).filter((m) => m !== "Ort" && m !== "Melder").map(missLabel);
  const att = e.attachments?.length ? attachmentsOf({ attachments }, e.attachments) : [];
  // «von H04»: Sichtungen und Rückfragen an jemanden; bei Vbk/Rückfrage von … steht der Trupp schon in der Art
  const von = e.melder && !own && (lage || form === "aufheb" || (art === "rueckfrage" && !!e.an) || art === "orientierung" || art === "auftrag" || (art === "notiz" && e.bezugArt !== "quittung")) ? e.melder : "";
  const teile = vm ? vm.split(SEP) : [];
  const eingang = eingangText(e);
  const truppe = gesehen ? gesehen.split(", ") : [];
  return (
    <li data-id={e.id} data-art={art} data-nr={nr || undefined} className={`jl-row k-${form}${sel ? " sel" : ""}${korr ? " korr" : ""}${flash ? " flash" : ""}${del ? " is-del" : ""}${dringend ? " is-dringend" : ""}`} tabIndex={tab}
      aria-current={sel || undefined}
      onClick={(ev) => { if (!(ev.target as HTMLElement).closest("button")) onSelect(e.id); }}>
      <span className="jl-tcol">
        <span className="jl-t mono">{zeitHm}</span>
        {nr && <span className="jl-nr" aria-label={`Nummer ${nr}`} title={`Nummer ${nr}`}>Nr {nr}</span>}
      </span>
      <span className="jl-body">
        <span className="jl-l1">
          {dringend && !del && <span className="jl-bang" aria-hidden="true" title="dringend">!</span>}
          <span className={`jl-kind k-${form}`}><span aria-hidden="true">{FORM_ZEICHEN[form]}</span> {word}</span>
          {who && <b className="jl-who">{who}</b>}
          {lage && <SymbolMini e={e} />}
          <span className="jl-text">{lage ? displayText(e) : nichtLageText(e, blau)}</span>
        </span>
        <span className="jl-l2">
          {del && <span className="jl-del">{del}</span>}
          {spaeter && <span className="jl-spaeter">nach LIVE ({spaeter}) – noch nicht auf der Karte</span>}
          {nachJetzt && <span className="jl-nachjetzt">{nachJetzt}</span>}
          {von && <span>von {von}</span>}
          {place ? <span className="mono">{place}</span> : lage ? <span className="jl-warn">Ort fehlt</span> : null}
          {teile.map((t) => <span key={t} className={t === "dringend" ? "jl-vm-dringend" : "jl-vm"}>{t}</span>)}
          {eingang && <span>{eingang}</span>}
          {lage && truppe.length > 1 && <span title={gesehen}>von {truppe.length} Trupps gesehen</span>}
          {missing.length > 0 && <span>Fehlt noch: {missing.join(", ")}</span>}
          {status && !(del && !e.history?.length) && <button type="button" className="jl-hist" aria-expanded={open} onClick={() => onToggle(e.id)}>{status}</button>}
          {e.via === "ki" && <span className="jl-ki"><KiMark size={9} />KI</span>}
          {korr && <span className="jl-korr">wird korrigiert</span>}
          {att.length > 0 && <><AttachmentChips list={att.filter((a) => a.kind !== "audio")} /><RowMemos list={att} /></>}
        </span>
        {open && e.history?.length ? (
          <ol className="jl-versions" aria-label="Frühere Fassungen">
            {[...e.history].reverse().map((h) => (
              <li key={h.rev}><span className="mono">{h.t.slice(11, 16)}</span> {h.text}{placeLabel(h) ? <span className="mono"> · {placeLabel(h)}</span> : null}
                <span className="jl-vat"> (Fassung von {new Date(h.at).toTimeString().slice(0, 5)}{h.von ? ` ${h.von}` : ""})</span></li>
            ))}
          </ol>
        ) : null}
        {sel && !korr && (del ? (
          <span className="jl-acts">
            {onRestore && <button type="button" className="jl-btn" onClick={() => onRestore(e.id)}>Zurückholen</button>}
          </span>
        ) : (
          <span className="jl-acts">
            <button type="button" className="jl-btn" onClick={() => onCorrect(e.id)}>Korrigieren</button>
            {/* Tablet: Lücke in der Mitte (CSS), «Streichen» ganz rechts – ein Tipp in die Mitte der Zeile trifft keinen Knopf */}
            <button type="button" className="jl-btn" aria-haspopup="dialog" aria-expanded={menu} onClick={(ev) => onMenu(e.id, ev.currentTarget)}>Mehr …</button>
            <button type="button" className="jl-btn" onClick={() => onDelete(e.id)}>Streichen</button>
          </span>
        ))}
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

type Item = { k: "h"; key: string; head: string } | { k: "r"; key: string; e: LageEvent } | { k: "t"; key: string; text: string } | { k: "w"; key: string; text: string };

/** «Schichtwechsel 06:45 BSP → WMA (Übergabe)» */
export const wechselText = (w: Pick<SchichtWechsel, "t" | "von" | "an">) => `Schichtwechsel ${w.t.slice(11, 16)} ${w.von ?? "–"} → ${w.an} (Übergabe)`;
const H_TRENNER = 34;

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
  /** «Mehr …» offen an dieser Zeile (Knopf als Anker) */
  const [menu, setMenu] = useState<{ id: string; btn: HTMLElement } | null>(null);
  /** roving tabindex: zuletzt fokussierte Zeile */
  const [rove, setRove] = useState<string | null>(null);
  /** nach dem Darstellen fokussieren (↑/↓, nach Löschen) */
  const focusNext = useRef<string | null>(null);
  // «Mehr …» schliesst, wenn eine andere Zeile gewählt wird
  useEffect(() => { setMenu((m) => (m && m.id !== selected ? null : m)); }, [selected]);
  // Messpunkt P1 «lt:zeile»: neue Zeile steht im DOM (nach dem letzten «lt:enter»)
  useLayoutEffect(() => {
    try {
      const en = performance.getEntriesByName(PERF_MARK.enter);
      const last = en[en.length - 1];
      if (!last) return;
      const z = performance.getEntriesByName(PERF_MARK.zeile);
      const lz = z[z.length - 1];
      if (!lz || lz.startTime < last.startTime) performance.mark(PERF_MARK.zeile);
    } catch { /* ohne Performance-API */ }
  }, [events]);

  const seit = p.schichtSeit ?? null;
  const items = useMemo(() => {
    const out: Item[] = [];
    let k = "";
    // Trenner «Neu in deiner Schicht ↑» unter dem ältesten Eintrag, der in der eigenen Schicht erfasst wurde (Kap. 3.6)
    let lastNew = -2;
    if (seit) { lastNew = -1; events.forEach((e, i) => { if ((e.createdAt ?? e.updatedAt) >= seit.seit) lastNew = i; }); }
    const trenner: Item | null = seit ? { k: "t", key: "trenner", text: `Neu in deiner Schicht ↑ · seit ${hm(seit.seit)} (${seit.kuerzel})` } : null;
    if (trenner && lastNew === -1) out.push(trenner);
    // Übergaben (neueste zuerst) an ihrer Lagezeit zwischen den Einträgen
    const ws = [...(p.wechsel ?? [])].filter((w) => w.art === "uebergabe").sort((a, b) => zeitCmp(b.t, a.t));
    let wi = 0;
    const head = (t: string) => {
      const h = t.slice(0, 13);
      if (h !== k) { k = h; out.push({ k: "h", key: "h:" + h, head: `${dayLabel(t, ex.days)} ${t.slice(11, 13)}:00` }); }
    };
    /** Wechsel über dem Eintrag `e`: später, oder gleiche Minute und nach dem Erfassen von `e` */
    const ueber = (w: SchichtWechsel, e: LageEvent | null) => {
      if (!e) return true;
      const c = zeitCmp(w.t.slice(0, 16), e);
      return c > 0 || (c === 0 && w.at >= (e.createdAt ?? e.updatedAt));
    };
    const wechselBis = (e: LageEvent | null) => {
      while (wi < ws.length && ueber(ws[wi]!, e)) {
        const w = ws[wi++]!;
        head(w.t);
        out.push({ k: "w", key: "w:" + w.id, text: wechselText(w) });
      }
    };
    events.forEach((e, i) => {
      wechselBis(e);
      head(e.t);
      out.push({ k: "r", key: e.id, e });
      if (trenner && i === lastNew) out.push(trenner);
    });
    // ältere Übergaben nur, solange sie im gezeigten Zeitraum liegen (nach dem ältesten Eintrag nicht mehr)
    if (!events.length) wechselBis(null);
    return out;
  }, [events, ex.days, seit?.seit, seit?.kuerzel, p.wechsel]); // eslint-disable-line react-hooks/exhaustive-deps
  const idx = useMemo(() => lvzIndex(all), [all]);
  const virt = events.length >= VIRT_AB;
  const index = useMemo(() => new Map(events.map((e, i) => [e.id, i])), [events]);
  const itemIndex = useMemo(() => new Map(items.map((it, i) => [it.key, i])), [items]);

  // ---------- Fenster (nur virtualisiert)
  const heights = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const offs = useMemo(() => {
    const o = new Array<number>(items.length + 1);
    o[0] = 0;
    for (let i = 0; i < items.length; i++) { const it = items[i]!; o[i + 1] = o[i]! + (heights.current.get(it.key) ?? (it.k === "h" ? H_HEAD : it.k === "t" || it.k === "w" ? H_TRENNER : H_ROW)); }
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

  /**
   * (MVP 3.5, C14) «von n Trupps gesehen» = verschiedene Melder, wie `bestaetigtVon` (Kern) – hier aus der schon
   * gerechneten Qualität (`confirmedBy`), damit nicht jede Zeile die ganze Übung neu prüft
   */
  const gesehenVon = (e: LageEvent): string => (quality ? bestaetigtVon(e, all, quality).join(", ") : "");
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
  const cb = useRef({ onSelect, onCorrect, del, onRestore: p.onRestore });
  cb.current = { onSelect, onCorrect, del, onRestore: p.onRestore };
  const rowSelect = useCallback((id: string) => cb.current.onSelect(id), []);
  const rowCorrect = useCallback((id: string) => cb.current.onCorrect(id), []);
  const rowDelete = useCallback((id: string) => { setMenu(null); cb.current.del(id); }, []);
  const rowRestore = useCallback((id: string) => cb.current.onRestore?.(id), []);
  const rowMenu = useCallback((id: string, btn: HTMLElement) => setMenu((m) => (m?.id === id ? null : { id, btn })), []);

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

  /** LIVE-Zeit (mit Offset); Meldungen danach fehlen auf der Karte (Zukunftszeit bestätigt) */
  const liveT = p.zeit?.zeit.kind === "live" && p.zeit.tNow ? p.zeit.tNow : null;
  /** Geräteuhr (MVP 3.5, S22): Meldungen danach, aber in der Lage, zeigen «4 min nach jetzt» */
  const uhr = p.zeit?.zeit.kind === "live" ? p.zeit.tUhr ?? null : null;
  /** Umstellungstage dieser Übung (Anzeige «02:45 MESZ» nur dort) */
  const hmOf = (e: LageEvent) => zeitText(e);
  const strip = p.zeit ? <RueckblickStreifen zeit={p.zeit} days={ex.days} art="liste" /> : null;
  /** «Gestrichene zeigen (n)» am Listenende (nur wenn es gestrichene gibt) */
  const nDel = p.gestricheneN ?? all.filter((e) => e.deleted && (!liveT || zeitBis(e, liveT))).length;
  const endLink = p.onGestrichene && (nDel > 0 || p.gestrichene) ? (
    <div className="jl-end">
      <button type="button" className="jl-link" aria-pressed={!!p.gestrichene} onClick={() => p.onGestrichene!(!p.gestrichene)}>
        {p.gestrichene ? "Gestrichene ausblenden" : `Gestrichene zeigen (${nDel})`}
      </button>
    </div>
  ) : null;
  const menuEv = menu ? all.find((e) => e.id === menu.id && !e.deleted) : undefined;
  const lvzMenu = menu && menuEv && p.lvz ? (
    <LvzMenu e={menuEv} ex={ex} {...p.lvz} anchor={menu.btn} onNr={p.onNr} onClose={() => setMenu(null)} />
  ) : null;

  if (!events.length && !items.length) {
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
        {endLink}
      </div>
    );
  }

  // gezeichnete Teile zu Stundengruppen zusammenfassen (Kopf nur, wenn er selbst im Fenster liegt)
  // Trenner teilt eine Stundengruppe in zwei `ol` (er selbst ist kein `li`)
  type Part = { ol: LageEvent[] } | { trenner: string; wechsel?: boolean; key: string };
  const groups: Array<{ key: string; head?: string; parts: Part[] }> = [];
  const lastOl = (g: { parts: Part[] }) => { const l = g.parts[g.parts.length - 1]; if (l && "ol" in l) return l.ol; const n: LageEvent[] = []; g.parts.push({ ol: n }); return n; };
  for (const it of shown) {
    if (it.k === "h") groups.push({ key: it.key, head: it.head, parts: [] });
    else if (it.k === "t" || it.k === "w") { if (!groups.length) groups.push({ key: "t:oben", parts: [] }); groups[groups.length - 1]!.parts.push({ trenner: it.text, wechsel: it.k === "w", key: it.key }); }
    else if (groups.length) lastOl(groups[groups.length - 1]!).push(it.e);
    // Fenster beginnt mitten in einer Stunde: gleicher Schlüssel wie mit Kopf (sonst baut React die Zeilen neu – Fokus weg)
    else groups.push({ key: "h:" + it.e.t.slice(0, 13), parts: [{ ol: [it.e] }] });
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
            {g.parts.map((part, pi) => "trenner" in part
              ? part.wechsel
                ? <div key={`w${pi}`} className="jl-wechsel" role="separator" aria-label={part.trenner} {...vk(part.key)}><span aria-hidden="true">⇅ </span>{part.trenner}</div>
                : <div key={`t${pi}`} className="jl-trenner" role="separator" aria-label={part.trenner} {...vk("trenner")}>{part.trenner}</div>
              : (
                <ol key={`o${pi}`} className="jlist">
                  {part.ol.map((e) => {
                    const spaeter = liveT && !e.deleted && zeitCmp(e, liveT) > 0 ? `${dayLabel(e.t, ex.days)} ${e.t.slice(11, 16)}` : undefined;
                    const nachJetzt = !spaeter && uhr && !e.deleted ? nachJetztText(e, uhr) ?? undefined : undefined;
                    const teile = vermerkTeile(e, ex, idx);
                    return (
                      <Row key={e.id} e={e} attachments={ex.attachments} sel={e.id === selected} korr={e.id === p.correcting} flash={e.id === flashId}
                        q={quality?.get(e.id)} gesehen={gesehenVon(e)} nachJetzt={nachJetzt} hm={hmOf(e)} open={openHist === e.id}
                        onSelect={rowSelect} onCorrect={rowCorrect} onDelete={rowDelete} onToggle={toggle} tab={e.id === active ? 0 : -1} spaeter={spaeter}
                        nr={nrLabel(e, ex)} artWort={artOf(e) === "meldung" ? "" : artText(e)} vm={teile.map((x) => x.t).join(SEP)}
                        dringend={teile.some((x) => x.k === "dringend")}
                        del={e.deleted ? `gestrichen ${hm(e.updatedAt)}${e.geaendertVon ? ` von ${e.geaendertVon}` : ""}` : undefined}
                        menu={menu?.id === e.id} onMenu={rowMenu} onRestore={p.onRestore ? rowRestore : undefined} blau={ex.units.blau} />
                    );
                  })}
                </ol>
              ))}
          </section>
        ))}
        {virt && <div aria-hidden="true" style={{ height: offs[items.length]! - offs[b + 1]! }} />}
      </div>
      {endLink}
      {lvzMenu}
    </div>
  );
}
