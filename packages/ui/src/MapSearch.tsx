/**
 * Ein Suchfeld für alles: Planquadrat («AK7 C», «ak7c», «G 19 Delta»), NAI/Flächen, Elemente (letzter Standort),
 * Koordinaten (LV95/LV03/WGS84/Link), bekannte Orte und – nur online – die swisstopo-Ortssuche.
 * Treffer: Karte fliegt hin (scharfe Zoomstufe) und der Bereich blitzt gelb auf.
 * Tasten: «/» oder Strg+K = Suchfeld, ↑/↓ = Auswahl, Enter = hin, Esc = schliessen.
 */
import { useEffect, useId, useRef, useState } from "react";
import L from "leaflet";
import { onlineAllowed, type Exercise } from "@lage/core";
import { useSearch, unifiedSearchMounted, type Hit } from "./journal/useSearch";
import { IconClose, IconGlobe, IconSearch } from "./navicons";
import "./navigation.css";

export { ONLINE_PAUSE_MS } from "./journal/useSearch";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function MapSearch({ ex, map, onSelectEvent }: { ex: Exercise; map: L.Map; onSelectEvent?: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [miss, setMiss] = useState(false);
  const [shown, setShown] = useState<string | null>(null); // Text des zuletzt gewählten Treffers
  const inp = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { hits, loading, go: goHit, clearPin, examples } = useSearch(ex, map, q, open && q !== shown);

  useEffect(() => { setActive(0); setMiss(false); }, [q]);

  // «/» (nicht beim Tippen) und Strg+K / ⌘K fokussieren das Suchfeld – ausser die Journal-Suche ist da (sie hat Vorrang)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (unifiedSearchMounted()) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inp.current?.focus();
        inp.current?.select();
      } else if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        inp.current?.focus();
        inp.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Klick daneben schliesst die Liste
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const go = (h: Hit) => {
    setShown(h.label);
    setQ(h.label);
    setOpen(false);
    goHit(h, onSelectEvent);
  };

  const clear = () => {
    setQ("");
    setShown(null);
    clearPin();
    setOpen(true);
    inp.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(hits.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[active] ?? hits[0];
      if (h) { go(h); inp.current?.blur(); }
      else if (q.trim()) { setMiss(true); setOpen(true); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (open && q) setOpen(false);
      else { inp.current?.blur(); setOpen(false); }
    } else if (e.key === "Tab") setOpen(false);
  };

  const showList = open && (q.trim() ? hits.length > 0 || loading || miss || q.trim().length >= 2 : true);
  const activeId = hits[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="nav-search" ref={box}>
      <div className="nav-field">
        <span className="nav-ico"><IconSearch /></span>
        <input
          ref={inp}
          value={q}
          placeholder="PQ, NAI, Element, Ort, Koordinate"
          aria-label="Karte durchsuchen: Planquadrat, NAI, Element, Koordinate oder Ort"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList ? activeId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setQ(e.target.value); setShown(null); setOpen(true); }}
          onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
          onKeyDown={onKeyDown}
        />
        {q ? (
          <button type="button" className="nav-clear" onClick={clear} aria-label="Suche leeren" title="Suche leeren"><IconClose /></button>
        ) : (
          <kbd className="nav-kbd" title="Taste / oder Strg+K">/</kbd>
        )}
      </div>
      {showList && (
        <div className="nav-pop nav-results">
          {!q.trim() ? (
            <div className="nav-help">
              <div className="nav-help-h">Suchen nach</div>
              {examples.map((x) => (
                <button key={x.k} type="button" className="nav-ex" onClick={() => { setQ(x.v); setOpen(true); inp.current?.focus(); }}>
                  <span>{x.k}</span><code>{x.v}</code>
                </button>
              ))}
              <div className="nav-foot">{!onlineAllowed(ex, "ortssuche") ? "Online-Ortssuche für diese Übung aus (Ebenen-Menü)" : navigator.onLine ? "Ortsnamen zusätzlich online (swisstopo)" : "Offline: Planquadrat, NAI, Element, Koordinate"}</div>
            </div>
          ) : (
            <>
              <ul id={listId} role="listbox" aria-label="Treffer">
                {hits.map((h, i) => (
                  <li
                    key={`${h.kind}-${h.label}-${i}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "act" : ""}
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => go(h)}
                  >
                    <span className={`nav-badge b-${badgeClass(h)}`}>{h.badge}</span>
                    <span className={`nav-lbl${h.kind === "pq" || h.kind === "koordinate" ? " mono" : ""}`}>{h.label}</span>
                    <span className="nav-det" title={h.detail}>{"online" in h && <IconGlobe />}{h.detail}</span>
                  </li>
                ))}
              </ul>
              {hits.length === 0 && !loading && (
                <div className="nav-none">
                  <b>Nichts gefunden.</b> Planquadrat z. B. <code>{examples.find((x) => x.k === "Planquadrat")?.v ?? "W18"}</code>, NAI-Name, Element, Koordinate <code>2600000 1200000</code>
                  {!onlineAllowed(ex, "ortssuche") ? " – Online-Ortssuche ist aus." : navigator.onLine ? "" : " – Ortsnamen nur online."}
                </div>
              )}
              {loading && <div className="nav-foot">swisstopo-Ortssuche …</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function badgeClass(h: Hit): string {
  switch (h.badge) {
    case "PQ": return "pq";
    case "NAI": return "nai";
    case "AO": return "ao";
    case "Stao": return "stao";
    case "Eigene": return "blau";
    case "Feind": return "rot";
    case "Unklar": return "unklar";
    case "UL": return "unklar";
    case "Koord": return "koord";
    case "Blatt": return "pq";
    default: return "ort";
  }
}
