/**
 * Suchlogik für alles (aus MapSearch herausgelöst, Spez. MVP 1, Kap. 3.4): Planquadrat («AK7 C»), NAI/Flächen,
 * Elemente (letzter Standort), Koordinaten, bekannte Orte und – nur online und erlaubt – die swisstopo-Ortssuche.
 * `go(hit)` lässt die Karte hinfliegen (scharfe Zoomstufe), der Bereich blitzt auf; Ort/Koordinate mit Nadel.
 * Genutzt von `UnifiedSearch` (Journal) und `MapSearch` (Karte, alt).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { cellAtAny, cellLabel, isPlaceName, onlineAllowed, searchAll, wantsPlaceLookup, type Bounds, type Exercise, type LV95, type SearchHit } from "@lage/core";
import { boundsAround, flashBounds, flashPoint, flashRing, flyToBoundsSharp, flyToCell, growBounds, NAV_MAX_ZOOM, toLatLng, whenSettled } from "@lage/map";
import { LAGE_KARTE } from "../colors";

export interface OnlineHit extends SearchHit { online: true }
export type Hit = SearchHit | OnlineHit;

/** Pause nach der letzten Taste, bevor online gesucht wird (ms) */
export const ONLINE_PAUSE_MS = 600;

/** Anzahl eingehängter Journal-Suchen: solange eine da ist, gehören Ctrl+K und «/» ihr (nicht der alten Kartensuche) */
let unified = 0;
export const unifiedSearchMounted = () => unified > 0;
export function registerUnified(): () => void { unified++; return () => { unified--; }; }

/** swisstopo-Ortssuche (online). */
export async function lookupPlaces(q: string, signal: AbortSignal): Promise<OnlineHit[]> {
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

const PIN_HTML = (() => {
  const w = LAGE_KARTE.halo, k = LAGE_KARTE.ink;
  return `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="8" fill="rgba(255,255,255,.55)" stroke="${w}" stroke-width="4"/><circle cx="13" cy="13" r="8" fill="none" stroke="${k}" stroke-width="2"/><path d="M13 1v7M13 18v7M1 13h7M18 13h7" stroke="${w}" stroke-width="4"/><path d="M13 1v7M13 18v7M1 13h7M18 13h7" stroke="${k}" stroke-width="1.8"/></svg>`;
})();

export interface SearchApi {
  hits: Hit[];
  loading: boolean;
  /** Karte zum Treffer; Element mit Meldung → `onEvent(id)` */
  go(h: Hit, onEvent?: (id: string) => void): void;
  clearPin(): void;
  /** Beispiele aus der Übung (keine festen Namen) */
  examples: Array<{ k: string; v: string }>;
}

/**
 * @param q Suchtext
 * @param active Online-Suche nur, solange die Vorschlagsliste offen ist und `q` nicht der eben gewählte Treffer ist
 */
export function useSearch(ex: Exercise, map: L.Map, q: string, active: boolean): SearchApi {
  const [online, setOnline] = useState<OnlineHit[]>([]);
  const [loading, setLoading] = useState(false);
  const pin = useRef<L.Marker | null>(null);

  const local = useMemo(
    () => searchAll(q, { sheets: ex.sheets, areas: ex.areas, events: ex.events, units: ex.units, places: ex.places, days: ex.days }),
    [q, ex.sheets, ex.areas, ex.events, ex.units, ex.places, ex.days],
  );
  const hits: Hit[] = useMemo(() => [...local, ...online.filter((o) => !local.some((l) => l.kind === "ort" && l.label === o.label))].slice(0, 14), [local, online]);

  // Online-Ortssuche: erst nach einer Pause, nur für echte Ortsnamen, nur wenn für die Übung erlaubt; offline still weglassen
  useEffect(() => {
    setOnline([]);
    setLoading(false);
    if (!active || !navigator.onLine || !onlineAllowed(ex, "ortssuche") || !wantsPlaceLookup(q, local) || !isPlaceName(q)) return;
    const ctl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(async () => {
      try { setOnline(await lookupPlaces(q.trim(), ctl.signal)); } catch { /* offline oder abgebrochen */ }
      if (!ctl.signal.aborted) setLoading(false);
    }, ONLINE_PAUSE_MS);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [q, active, ex.onlineDienste?.ortssuche]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { pin.current?.remove(); }, []);

  const setPin = (p: LV95 | null, title = "") => {
    pin.current?.remove();
    pin.current = null;
    if (!p) return;
    pin.current = L.marker(toLatLng(p), {
      icon: L.divIcon({ className: "nav-pin", html: PIN_HTML, iconSize: [26, 26], iconAnchor: [13, 13] }),
      interactive: false, keyboard: false, title, zIndexOffset: 3000,
    }).addTo(map);
  };

  const go = (h: Hit, onEvent?: (id: string) => void) => {
    setPin(null);
    if (h.kind === "element" && h.eventId) onEvent?.(h.eventId);
    if (h.bounds) {
      const b = h.bounds, ring = h.ring;
      whenSettled(map, () => (ring ? flashRing(map, ring) : flashBounds(map, b)));
      // Planquadrat/Unterquadrant mit Nachbarkontext, Flächen/Orte höchstens Stufe 23
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

  const examples = useMemo(() => {
    const out: Array<{ k: string; v: string }> = [];
    const s = ex.sheets[0];
    const u = ex.units.blau[0] ?? ex.units.rot[0];
    if (u) out.push({ k: "Trupp", v: u });
    if (s) {
      const c = Math.min(Math.floor(s.colLabels.length / 2), s.colLabels.length - 1), r = Math.min(Math.floor(s.rowLabels.length / 2), s.rowLabels.length - 1);
      out.push({ k: "Planquadrat", v: cellLabel(s, c, r, s.quadrants ? "C" : undefined) });
    }
    const a = ex.areas.find((x) => x.kind === "nai") ?? ex.areas[0];
    if (a) out.push({ k: "NAI / Raum", v: a.name });
    if (s) out.push({ k: "Koordinate", v: `${Math.round((s.origin.e + s.cellW * 3) / 100) * 100} ${Math.round((s.origin.n - s.cellH * 3) / 100) * 100}` });
    return out;
  }, [ex.sheets, ex.areas, ex.units]);

  return { hits, loading, go, clearPin: () => setPin(null), examples };
}
