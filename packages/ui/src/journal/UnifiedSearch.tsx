/**
 * Eine Suche über der Journal-Liste (Spez. MVP 1, Kap. 3.4): Trupp, PQ, NAI, Ort, Koordinate, Text. Tippen filtert die
 * Liste sofort (`onQuery`); darunter Vorschläge (Trupp «H03 – zuletzt 06:50 · AM5», PQ, NAI, Ort – Logik `useSearch`),
 * Auswahl = Karte fliegt hin bzw. Meldung gewählt (`onPickEvent`). Stichwörter «feind», «eigene», «unklar»,
 * «nur 1 Trupp» werden zum Chip «Art: Feind ✕». Ctrl+K oder «/» = Suchfeld, ↑/↓ = Vorschlag, Enter = hin, Esc = leeren.
 * Vertrag `UnifiedSearchProps`; `value`/`art` (optional) erlauben, die Suche von aussen zu leeren («Suche leeren»).
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { dayLabel } from "../Timeline";
import type { SearchArt, UnifiedSearchProps } from "../shell/contracts";
import { ART_LABEL, takeKeyword } from "./filter";
import { registerUnified, useSearch, type Hit } from "./useSearch";
import { hitText } from "./hitText";
import "./journal.css";

export { hitText } from "./hitText";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function UnifiedSearch(p: UnifiedSearchProps & {
  /** Tag der Lage als Label («T2»): «zuletzt 06:50» statt «zuletzt T2 06:50» */
  today?: string;
  /** von aussen zurücksetzen (zählt hoch) */
  reset?: number;
}) {
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
  const { hits, loading, go } = useSearch(ex, map, q, open && q !== shown);
  const list = q.length >= 1 ? hits.slice(0, 8) : [];
  const showList = open && list.length > 0;
  /** letzte Meldung je Trupp (für «zuletzt 07:20 gemeldet») */
  const lastRep = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of ex.events ?? []) if (!e.deleted && e.melder && (m.get(e.melder) ?? "") < e.t) m.set(e.melder, e.t);
    return m;
  }, [ex.events]);
  const repOf = (label: string) => { const t = lastRep.get(label); return t ? { t, day: dayLabel(t, ex.days) } : undefined; };

  useEffect(() => registerUnified(), []);
  useEffect(() => { onQuery(q, art); }, [q, art]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(-1); }, [q]);
  useEffect(() => { if (p.reset) { setText(""); setArt(null); setShown(null); } }, [p.reset]);

  // Ctrl+K / ⌘K und «/» (nicht beim Tippen) fokussieren die Suche
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); inp.current?.focus(); inp.current?.select(); }
      else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) { e.preventDefault(); inp.current?.focus(); inp.current?.select(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open]);

  const change = (v: string, complete = false) => {
    const k = takeKeyword(v, complete);
    if (k.art) { setArt(k.art); setText(k.q ? k.q + (/\s$/.test(v) ? " " : "") : ""); }
    else setText(v);
    setShown(null);
    setOpen(true);
  };
  const pick = (h: Hit) => {
    setShown(h.label);
    setText(h.label);
    setOpen(false);
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
        <input ref={inp} type="search" value={text} placeholder="Suchen: Trupp, PQ, NAI, Text" aria-label="Suchen: Trupp, PQ, NAI, Ort, Text"
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
              const k = takeKeyword(text, true);
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
          {loading && <li className="us-load" aria-hidden="true">Ortssuche …</li>}
        </ul>
      )}
    </div>
  );
}
