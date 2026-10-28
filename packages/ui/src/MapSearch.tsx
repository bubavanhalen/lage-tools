/**
 * Ein Suchfeld für alles: Planquadrat («AK7 C», «ak7c», «G 19 Delta»), NAI/Flächen, Elemente (letzter Standort),
 * Koordinaten (LV95/LV03/WGS84/Link), bekannte Orte und – nur online – die swisstopo-Ortssuche.
 * Treffer: Karte fliegt hin (scharfe Zoomstufe) und der Bereich blitzt gelb auf.
 * Tasten: «/» oder Strg+K = Suchfeld, ↑/↓ = Auswahl, Enter = hin, Esc = schliessen.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  cellAtAny,
  cellLabel,
  isPlaceName,
  onlineAllowed,
  searchAll,
  wantsPlaceLookup,
  type Bounds,
  type Exercise,
  type LV95,
  type SearchHit,
} from "@lage/core";
import { boundsAround, flashBounds, flashPoint, flashRing, flyToBoundsSharp, flyToCell, growBounds, NAV_MAX_ZOOM, toLatLng, whenSettled } from "@lage/map";
import { IconClose, IconGlobe, IconSearch } from "./navicons";
import "./navigation.css";

interface OnlineHit extends SearchHit {
  online: true;
}
type Hit = SearchHit | OnlineHit;

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** Pause nach der letzten Taste, bevor online gesucht wird (ms) */
export const ONLINE_PAUSE_MS = 600;

/** swisstopo-Ortssuche (online). */
async function lookupPlaces(q: string, signal: AbortSignal): Promise<OnlineHit[]> {
  const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&limit=6&sr=2056&lang=de&searchText=${encodeURIComponent(q)}`;
  const r = await fetch(url, { signal });
  if (!r.ok) return [];
  const j = (await r.json()) as { results?: Array<{ attrs: { label: string; x: number; y: number; geom_st_box2d?: string } }> };
  const seen = new Set<string>();
  return (j.results ?? []).flatMap((x) => {
    const cat = /<i>([^<]*)<\/i>/.exec(x.attrs.label)?.[1]?.trim();
    const label = x.attrs.label.replace(/<i>[^<]*<\/i>/, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const pos: LV95 = { e: x.attrs.y, n: x.attrs.x };
    let bounds: Bounds | undefined;
    const m = /BOX\(([\d.]+) ([\d.]+),([\d.]+) ([\d.]+)\)/.exec(x.attrs.geom_st_box2d ?? "");
    if (m && +m[3]! - +m[1]! > 150 && +m[4]! - +m[2]! > 150) bounds = { minE: +m[1]!, minN: +m[2]!, maxE: +m[3]!, maxN: +m[4]! };
    const k = label.toLowerCase();
    if (seen.has(k)) return [];
    seen.add(k);
    return [{ kind: "ort", label, badge: "Ort", detail: cat ?? "Ort", pos, bounds, score: 0, online: true } as OnlineHit];
  });
}

export function MapSearch({ ex, map, onSelectEvent }: { ex: Exercise; map: L.Map; onSelectEvent?: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [online, setOnline] = useState<OnlineHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [miss, setMiss] = useState(false);
  const [shown, setShown] = useState<string | null>(null); // Text des zuletzt gewählten Treffers
  const inp = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const pin = useRef<L.Marker | null>(null);
  const listId = useId();

  const local = useMemo(
    () => searchAll(q, { sheets: ex.sheets, areas: ex.areas, events: ex.events, units: ex.units, places: ex.places, days: ex.days }),
    [q, ex.sheets, ex.areas, ex.events, ex.units, ex.places, ex.days],
  );
  const hits: Hit[] = useMemo(() => [...local, ...online.filter((o) => !local.some((l) => l.kind === "ort" && l.label === o.label))].slice(0, 14), [local, online]);

  // Online-Ortssuche: erst nach einer Pause, nur für echte Ortsnamen (nicht «Alpha Kilo 7», «AK77»), nur wenn für
  // die Übung erlaubt (Online-Dienste); offline still weglassen
  useEffect(() => {
    setOnline([]);
    setLoading(false);
    if (!open || q === shown || !navigator.onLine || !onlineAllowed(ex, "ortssuche") || !wantsPlaceLookup(q, local) || !isPlaceName(q)) return;
    const ctl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(async () => {
      try { setOnline(await lookupPlaces(q.trim(), ctl.signal)); } catch { /* offline oder abgebrochen */ }
      if (!ctl.signal.aborted) setLoading(false);
    }, ONLINE_PAUSE_MS);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [q, open, ex.onlineDienste?.ortssuche]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setActive(0); setMiss(false); }, [q]);

  // «/» (nicht beim Tippen) und Strg+K / ⌘K fokussieren das Suchfeld
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  useEffect(() => () => { pin.current?.remove(); }, []);

  const setPin = (p: LV95 | null, title = "") => {
    pin.current?.remove();
    pin.current = null;
    if (!p) return;
    pin.current = L.marker(toLatLng(p), {
      icon: L.divIcon({
        className: "nav-pin",
        html: `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="8" fill="rgba(255,255,255,.55)" stroke="#fff" stroke-width="4"/><circle cx="13" cy="13" r="8" fill="none" stroke="#101414" stroke-width="2"/><path d="M13 1v7M13 18v7M1 13h7M18 13h7" stroke="#fff" stroke-width="4"/><path d="M13 1v7M13 18v7M1 13h7M18 13h7" stroke="#101414" stroke-width="1.8"/></svg>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
      interactive: false,
      keyboard: false,
      title,
      zIndexOffset: 3000,
    }).addTo(map);
  };

  const go = (h: Hit) => {
    setShown(h.label);
    setQ(h.label);
    setOpen(false);
    setPin(null);
    if (h.kind === "element" && h.eventId) onSelectEvent?.(h.eventId);
    if (h.bounds) {
      const b = h.bounds, ring = h.ring;
      whenSettled(map, () => (ring ? flashRing(map, ring) : flashBounds(map, b)));
      // Planquadrat/Unterquadrant mit Nachbarkontext (höchstens Stufe 23/24), Flächen/Orte höchstens Stufe 23
      if (h.kind === "pq") flyToCell(map, b, !!h.quadrant);
      else flyToBoundsSharp(map, h.kind === "blatt" ? b : growBounds(b, Math.max(b.maxE - b.minE, b.maxN - b.minN) * 0.25), { maxZoom: NAV_MAX_ZOOM.feld });
      if (h.kind === "ort") setPin(h.pos ?? { e: (b.minE + b.maxE) / 2, n: (b.minN + b.maxN) / 2 }, h.label);
      return;
    }
    if (!h.pos) return;
    const p = h.pos;
    // Punkt: Feld mit Nachbarfeldern zeigen (wie Auswahl im Journal), sonst ca. 1 km
    const ref = cellAtAny(ex.sheets, p);
    const s = ref && ex.sheets.find((x) => x.id === ref.sheetId);
    const half = s ? Math.max(s.cellW, s.cellH) * (h.kind === "element" ? 1.5 : 1) : 500;
    whenSettled(map, () => flashPoint(map, p));
    flyToBoundsSharp(map, boundsAround(p, half), { maxZoom: NAV_MAX_ZOOM.feld });
    if (h.kind === "koordinate" || h.kind === "ort") setPin(p, h.label);
  };

  const clear = () => {
    setQ("");
    setShown(null);
    setPin(null);
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

  // Beispiele aus der geladenen Übung (keine festen Namen)
  const examples = useMemo(() => {
    const out: Array<{ k: string; v: string }> = [];
    const s = ex.sheets[0];
    if (s) {
      const c = Math.min(Math.floor(s.colLabels.length / 2), s.colLabels.length - 1), r = Math.min(Math.floor(s.rowLabels.length / 2), s.rowLabels.length - 1);
      out.push({ k: "Planquadrat", v: cellLabel(s, c, r, s.quadrants ? "C" : undefined) });
    }
    const a = ex.areas.find((x) => x.kind === "nai") ?? ex.areas[0];
    if (a) out.push({ k: "NAI / Fläche", v: a.name });
    const u = ex.units.blau[0] ?? ex.units.rot[0];
    if (u) out.push({ k: "Element", v: u });
    if (s) out.push({ k: "Koordinate", v: `${Math.round((s.origin.e + s.cellW * 3) / 100) * 100} ${Math.round((s.origin.n - s.cellH * 3) / 100) * 100}` });
    return out;
  }, [ex.sheets, ex.areas, ex.units]);

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
                  <b>Nichts gefunden.</b> Planquadrat z. B. <code>{examples[0]?.v ?? "W18"}</code>, NAI-Name, Element, Koordinate <code>2600000 1200000</code>
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
