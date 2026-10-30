/**
 * Eine Suche über der Journal-Liste (Spez. MVP 1, Kap. 3.4): Trupp, PQ, NAI, Ort, Koordinate, Text. Tippen filtert die
 * Liste sofort (`onQuery`); darunter Vorschläge (Trupp «H03 – zuletzt 06:50 · AM5», PQ, NAI, Ort – Logik `useSearch`),
 * Auswahl = Karte fliegt hin bzw. Meldung gewählt (`onPickEvent`). Stichwörter «feind», «eigene», «unklar»,
 * «nur 1 Trupp» werden zum Chip «Art: Feind ✕». Ctrl+K = Suchfeld (MVP 3.5: «/» entfällt – Tippen springt ins Meldungsfeld), ↑/↓ = Vorschlag, Enter = hin, Esc = leeren.
 * Vertrag `UnifiedSearchProps`; `value`/`art` (optional) erlauben, die Suche von aussen zu leeren («Suche leeren»).
 * Ein Stichwort filtert schon beim Tippen («feind» ohne Enter); der Chip entsteht erst mit Leerschlag/Enter, damit
 * man weiterschreiben kann.
 *
 * MVP 3: eine Zahl («54», «Nr 54», «12a») schlägt zuerst den Eintrag mit dieser laufenden Nummer vor («Nr 54 – 07:12 Feind
 * 2 Kpz …»); Stichwörter «gestrichen», «dringend», «offen», «Auftrag», «Rückfrage», «Vbk» … werden zum Chip.
 *
 * `PlaceSearch` (unten): dieselbe Suche nur für Orte (PQ, NAI, Ort, Koordinate, Trupp) – für den Erststart ohne Meldungen
 * und den Modus «Vorbereiten» (Raster anlegen: hinzoomen). Filtert keine Liste.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { dayLabel } from "../Timeline";
import type { SearchArt, UnifiedSearchProps } from "../shell/contracts";
import { artOf, artText, isPlaceName, kindLabel, nrLabel, onlineAllowed, uebergabeEintragZu, zeitCmp, type SearchHit } from "@lage/core";
import { ART_LABEL, matchesQuery, nrQuery, takeKeyword, wechselSuche } from "./filter";
import { registerUnified, useSearch, type Hit } from "./useSearch";
import { hitText } from "./hitText";
import "./journal.css";

export { hitText } from "./hitText";

/** Platzhalter und Name der Suche – überall gleich (MVP 3.5, S25; Leerzustand: gleicher Text, Verhalten «Ort suchen») */
export const SUCHTEXT = "Suchen: Trupp, Planquadrat, NAI, Ort";

/** Ctrl+K und «/» gehören der zuletzt eingehängten Suche (Journal bzw. Ortssuche im Vorbereiten) */
const keyOwners: number[] = [];
let ownerSeq = 0;

export function UnifiedSearch(p: UnifiedSearchProps & {
  /** Tag der Lage als Label («T2»): «zuletzt 06:50» statt «zuletzt T2 06:50» */
  today?: string;
  /** von aussen zurücksetzen (zählt hoch) */
  reset?: number;
  /** «ort» = nur Orte suchen (keine Stichwörter, kein Listenfilter); Platzhalter gleich (MVP 3.5) */
  variant?: "journal" | "ort";
  /** (MVP 3.5, E3) Anzahl gestrichener Einträge: Vorschlag «Gestrichene zeigen (3)» bei «gestr…» */
  gestricheneN?: number;
  onGestrichene?(): void;
}) {
  const ortOnly = p.variant === "ort";
  const { ex, map, onQuery, onPickEvent } = p;
  const [text, setText] = useState("");
  const [art, setArt] = useState<SearchArt>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [shown, setShown] = useState<string | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const q = text.trim();
  // Text, der als Listenfilter wirkt (Stichwort «feind», Chip «Art», oder Wörter aus Meldungen): keine Online-Orte vorschlagen –
  // die Liste ist die Antwort, Vorschläge «Feindsee · online» führten nur in die Irre
  // MVP 3.5 (S20): Übergaben mit eigenem Journal-Eintrag findet die Suche über den Eintrag – keine «Schichtwechsel»-Zeile
  const uebergaben = useMemo(() => (ex.schichten ?? []).filter((w) => w.art === "uebergabe" && !uebergabeEintragZu(ex, w.id)), [ex.schichten, ex.events]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtering = useMemo(() => !ortOnly && (!!art || !!takeKeyword(q, true).art || wechselSuche(q, uebergaben)
    || (q.length >= 2 && (ex.events ?? []).some((e) => !e.deleted && matchesQuery(e, q)))), [ortOnly, art, q, ex.events, uebergaben]);
  const { hits, loading, go, online } = useSearch(ex, map, q, open && q !== shown, !filtering);
  /** laufende Nummer («54») → Eintrag vorschlagen (Kap. 1.1) */
  const nrHits = useMemo((): Hit[] => {
    const n = ortOnly ? null : nrQuery(q);
    if (!n) return [];
    const evs = ex.events ?? [];
    return evs.filter((e) => !e.deleted && (nrLabel(e, ex).toLowerCase() === n || nrLabel(e, ex).toLowerCase().replace(/[a-z]+$/, "") === n)).slice(0, 3)
      .map((e): SearchHit => ({
        kind: "element", label: `Nr ${nrLabel(e, ex)}`, badge: "Nr", eventId: e.id, pos: e.pos, score: 100,
        detail: `${dayLabel(e.t, ex.days)} ${e.t.slice(11, 16)} ${artOf(e) === "meldung" ? kindLabel(e) : artText(e)} ${e.text}`.slice(0, 80),
      }));
  }, [q, ex, ortOnly]);
  /** Zeilen «Schichtwechsel 07:30 BSP → MU» (Fix 3): per Suche auffindbar, Auswahl zeigt die Zeile in der Liste */
  const wechselHits = useMemo((): Hit[] => (ortOnly || !wechselSuche(q, uebergaben) ? [] : [...uebergaben].sort((a, b) => zeitCmp(b.t, a.t)).slice(0, 4)
    .map((w): SearchHit => ({ kind: "element", label: `Schichtwechsel ${w.t.slice(11, 16)} ${w.von ?? "–"} → ${w.an}`, badge: "Übergabe", detail: `${dayLabel(w.t, ex.days)} ${w.t.slice(11, 16)} · Übergabe`, score: 100 }))),
  [q, uebergaben, ortOnly, ex.days]);
  const list = q.length >= 1 ? [...wechselHits, ...nrHits, ...hits].slice(0, 8) : [];
  // MVP 3.5 (S3, E3): Online-Ortssuche nie automatisch – letzte Zeile «‹q› bei swisstopo suchen» (erst der Klick fragt);
  // Ortssuche aus und ein Ortsname ohne Treffer: Zeile «Ortsnamen sind aus – …» (nicht wählbar)
  const onlineZeile = !!online?.moeglich && q.length >= 2;
  const ausZeile = !onlineZeile && q.length >= 3 && !list.length && !filtering && isPlaceName(q) && !onlineAllowed(ex, "ortssuche");
  const gestrZeile = !ortOnly && !!p.onGestrichene && (p.gestricheneN ?? 0) > 0 && q.length >= 3 && "gestrichene".startsWith(q.toLowerCase());
  const showList = open && (list.length > 0 || onlineZeile || ausZeile || gestrZeile || !!online?.laeuft);
  /** letzte Meldung je Trupp (für «zuletzt 07:20 gemeldet») */
  const lastRep = useMemo(() => {
    const m = new Map<string, NonNullable<typeof ex.events>[number]>();
    for (const e of ex.events ?? []) { const b = e.melder ? m.get(e.melder) : undefined; if (!e.deleted && e.melder && (!b || zeitCmp(e, b) > 0)) m.set(e.melder, e); }
    return new Map([...m].map(([k, e]) => [k, e.t]));
  }, [ex.events]);
  const repOf = (label: string) => { const t = lastRep.get(label); return t ? { t, day: dayLabel(t, ex.days) } : undefined; };

  useEffect(() => registerUnified(), []);
  // Liste filtern: ein fertiges Stichwort am Ende («feind») gilt schon ohne Enter/Leerschlag
  useEffect(() => {
    if (ortOnly) return;
    const k = art ? null : takeKeyword(q, true);
    if (k?.art) onQuery(k.q, k.art); else onQuery(q, art);
  }, [q, art]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(-1); }, [q]);
  useEffect(() => { if (p.reset) { setText(""); setArt(null); setShown(null); } }, [p.reset]);

  // Ctrl+K / ⌘K fokussieren die Suche
  useEffect(() => {
    const me = ++ownerSeq;
    keyOwners.push(me);
    const key = (e: KeyboardEvent) => {
      if (keyOwners[keyOwners.length - 1] !== me) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); inp.current?.focus(); inp.current?.select(); }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); const i = keyOwners.indexOf(me); if (i >= 0) keyOwners.splice(i, 1); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open]);

  const change = (v: string, complete = false) => {
    const k = ortOnly ? { q: v, art: null } : takeKeyword(v, complete);
    if (k.art) { setArt(k.art); setText(k.q ? k.q + (/\s$/.test(v) ? " " : "") : ""); }
    else setText(v);
    setShown(null);
    setOpen(true);
  };
  const pick = (h: Hit) => {
    setShown(h.label);
    setText(h.label);
    setOpen(false);
    if (h.badge === "Übergabe") {
      // Zeile «Schichtwechsel …» in der Liste zeigen (die Suche filtert die Liste auf die Wechsel)
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`.jl-wechsel[aria-label^="${h.label.replace(/"/g, "")}"]`)?.scrollIntoView({ block: "nearest" }));
      return;
    }
    go(h, onPickEvent);
  };
  const clear = () => { setText(""); setArt(null); setShown(null); inp.current?.focus(); };

  return (
    <div className="us" ref={box}>
      <div className="us-field" data-zaehl="suche">
        <span className="us-ico" aria-hidden="true">⌕</span>
        {art && (
          <button type="button" className="us-chip" onClick={() => setArt(null)} aria-label={`Filter Art: ${ART_LABEL[art]} entfernen`}>
            Art: {ART_LABEL[art]} <span aria-hidden="true">✕</span>
          </button>
        )}
        <input ref={inp} type="search" value={text}
          placeholder={SUCHTEXT} aria-label={SUCHTEXT}
          enterKeyHint="search" autoCorrect="off" autoCapitalize="off"
          role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off" spellCheck={false}
          onChange={(e) => change(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(list.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
            else if (e.key === "Enter") {
              e.preventDefault();
              const k = ortOnly ? { art: null } : takeKeyword(text, true);
              if (k.art) { change(text, true); return; }
              const h = list[active] ?? list[0];
              if (h) pick(h);
            } else if (e.key === "Escape") {
              e.preventDefault(); e.stopPropagation();
              if (showList) setOpen(false); else if (text || art) clear(); else inp.current?.blur();
            } else if (e.key === "Backspace" && !text && art) { setArt(null); }
            else if (e.key === "Tab") setOpen(false);
          }} />
        {(text || art) && <button type="button" className="us-x" onClick={clear} aria-label="Suchtext löschen">✕</button>}
      </div>
      {showList && (
        <ul id={listId} className="us-list" role="listbox" aria-label="Vorschläge">
          {list.map((h, i) => (
            <li key={`${h.kind}-${h.label}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? "act" : ""}
              onPointerDown={(e) => e.preventDefault()} onClick={() => pick(h)}>
              {hitText(h, p.today, h.kind === "element" ? repOf(h.label) : undefined)}{"online" in h ? <span className="us-online"> · online</span> : null}
            </li>
          ))}
          {gestrZeile && (
            <li role="option" aria-selected={false} onPointerDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); p.onGestrichene?.(); }}>
              Gestrichene zeigen ({p.gestricheneN})
            </li>
          )}
          {onlineZeile && !online!.laeuft && (
            <li role="option" aria-selected={false} className="us-online-q" onPointerDown={(e) => e.preventDefault()} onClick={() => online!.suchen()}>
              ‹{q}› bei swisstopo suchen
            </li>
          )}
          {(loading || online?.laeuft) && <li className="us-load" aria-hidden="true">Ortssuche …</li>}
          {online?.fehler && <li className="us-load" aria-disabled="true">{online.fehler}</li>}
          {ausZeile && <li className="us-load us-aus" aria-disabled="true">Ortsnamen sind aus – Planquadrat oder NAI suchen</li>}
        </ul>
      )}
    </div>
  );
}

/**
 * Ortssuche ohne Journal (Erststart ohne Meldungen, Modus «Vorbereiten»): Planquadrat, NAI, Ort (online, wenn erlaubt),
 * Koordinate, Trupp – Auswahl lässt die Karte hinfliegen. Props: Übung und Karte; `className` optional für die Hülle.
 */
export function PlaceSearch({ ex, map, className }: Pick<UnifiedSearchProps, "ex" | "map"> & { className?: string }) {
  const none = () => {};
  return (
    <div className={"us-place" + (className ? ` ${className}` : "")}>
      <UnifiedSearch ex={ex} map={map} onQuery={none} onPickEvent={none} variant="ort" />
    </div>
  );
}
