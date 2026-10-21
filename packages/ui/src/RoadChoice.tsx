/**
 * Strassenwahl an Kreuzungen: Chip «📍 AG13 · auf X ▾» mit kleiner Auswahl der wahrscheinlichsten Strassen
 * (aus `placeOnRoad`-Kandidaten), «Kein Strassenbezug» und «Ort auf Karte». Hinweis-Punkt, wenn mehrdeutig.
 * Solange die Auswahl offen ist, zeigt die Karte die Kandidaten (Nummer am Ort, Strasse hervorgehoben).
 */
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import {
  NAMED_ROAD_NEAR, catalogEntry, cellBounds, findCells, normRoadText,
  type Bounds, type Exercise, type LageEvent, type LV95, type RoadHint, type RoadPlacement, type RoadSegment, type RoadTarget,
} from "@lage/core";
import { flyToBoundsSharp, toLatLng } from "@lage/map";
import { cachedRoads, placeWith, roadsForTarget, targetBounds } from "./roadsource";
import "./roadchoice.css";

/** Von Hand gewählt: bestimmte Strasse (Name bzw. Stück-Kennung bei unbenannten) oder bewusst keine */
export interface RoadPick { none?: boolean; road?: string; segId?: string }

/** Zielgebiet für die Strassenlage (Planquadrat/Unterquadrant als Rechteck, NAI als Ring) */
export interface RoadTargetInfo { key: string; target: RoadTarget; along?: boolean; hint?: RoadHint }

export interface RoadChoiceResult {
  /** gültige Lage (null: keine Strasse bekannt, noch am Laden oder «Kein Strassenbezug») */
  pl: RoadPlacement | null;
  /** automatische Lage (ohne Wahl) – für Kandidaten und «mehrdeutig» */
  auto: RoadPlacement | null;
  /** Lage gemäss Wahl (auch wenn «Kein Strassenbezug» gewählt ist: die zuletzt sinnvolle) */
  chosen: RoadPlacement | null;
  loading: boolean;
  roads: RoadSegment[];
  target: RoadTarget | null;
}

const grow = (b: Bounds, m: number): Bounds => ({ minE: b.minE - m, maxE: b.maxE + m, minN: b.minN - m, maxN: b.maxN + m });
const geoKey = (t: RoadTarget) => { const b = targetBounds(t); return [b.minE, b.minN, b.maxE, b.maxN].map((v) => Math.round(v)).join(","); };

/**
 * Strassen fürs Gebiet laden (sofort aus dem Speicher, sonst Netz) und die Lage gemäss Text und Wahl rechnen.
 * Tippen im Meldungstext rechnet nur neu (kein neues Laden) – kein Flackern.
 */
export function useRoadChoice(t: RoadTargetInfo | null, text: string, pick: RoadPick | null): RoadChoiceResult {
  const gk = t ? geoKey(t.target) : null;
  const [data, setData] = useState<{ key: string; roads: RoadSegment[]; complete: boolean } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!t || !gk) return;
    if (data?.key === gk && data.complete) return;
    const cached = cachedRoads(grow(targetBounds(t.target), NAMED_ROAD_NEAR));
    if (cached) { setData({ key: gk, roads: cached, complete: true }); return; }
    const ctl = new AbortController();
    const timer = window.setTimeout(async () => {
      const { roads, missing } = await roadsForTarget(t.target, { signal: ctl.signal });
      if (!ctl.signal.aborted) setData({ key: gk, roads, complete: missing === 0 });
    }, 150);
    return () => { ctl.abort(); window.clearTimeout(timer); };
  }, [gk, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  // offline gestartet: sobald wieder Netz da ist, nochmals laden
  useEffect(() => {
    if (!data || data.complete) return;
    const on = () => setRetry((n) => n + 1);
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [data]);
  const valid = !!t && !!data && data.key === gk;
  const roads = valid ? data!.roads : [];
  const along = t?.along, hint = t?.hint;
  const auto = useMemo(() => (t && valid ? placeWith(t.target, roads, undefined, { along, hint, text }) : null),
    [gk, valid, roads, along, hint, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = useMemo(() => {
    if (!t || !valid || !pick || pick.none || (!pick.road && !pick.segId)) return auto;
    return placeWith(t.target, roads, undefined, { along, hint, text, road: pick.road, segId: pick.segId }) ?? auto;
  }, [auto, pick?.road, pick?.segId, pick?.none]); // eslint-disable-line react-hooks/exhaustive-deps
  return { pl: pick?.none ? null : chosen, auto, chosen, loading: !!t && !valid, roads, target: t?.target ?? null };
}

/** Wahl für einen Kandidaten: benannte Strasse über den Namen (bleibt auch in einem anderen Feld), sonst Stück */
export const pickOf = (c: RoadPlacement): RoadPick => (c.road ? { road: c.road } : { segId: c.segId });
const sameRoad = (a: RoadPlacement, b: RoadPlacement) => (a.road || b.road ? !!a.road && !!b.road && normRoadText(a.road) === normRoadText(b.road) : a.segId === b.segId);
const roadLabel = (c: RoadPlacement) => c.road ?? `${c.kind} (ohne Name)`;

/** Strassen eines Kandidaten (für die Hervorhebung auf der Karte) */
function roadPts(c: RoadPlacement, roads: RoadSegment[]): LV95[][] {
  if (c.road) { const n = normRoadText(c.road); return roads.filter((s) => s.name && normRoadText(s.name) === n).map((s) => s.pts); }
  return roads.filter((s) => s.id === c.segId).map((s) => s.pts);
}

interface Props {
  /** Ortsangabe ohne Strasse, z. B. «AG13» */
  where: string;
  res: RoadChoiceResult;
  pick: RoadPick | null;
  onPick: (p: RoadPick | null) => void;
  /** «Ort auf Karte» (Punkt von Hand setzen) */
  onMap?: () => void;
  map?: L.Map;
  /** kleinere Schrift (Bearbeiten-Zeile) */
  compact?: boolean;
  /** als von Hand gewählt zeigen (Standard: wenn `pick` gesetzt) */
  manual?: boolean;
  /** Hinweis «mehrdeutig» zeigen (Standard: ohne Wahl und mehrdeutig) */
  hint?: boolean;
}

export function RoadChoice({ where, res, pick, onPick, onMap, map, compact, manual = !!pick, hint }: Props) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [box, setBox] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const pl = res.pl;
  // Reihenfolge bleibt wie automatisch bestimmt (die Liste springt bei der Wahl nicht); Gewähltes ausserhalb davor
  const cands = useMemo(() => {
    const list = res.auto?.candidates ?? [];
    const sel = res.chosen;
    return sel && !list.some((c) => sameRoad(c, sel)) ? [sel.candidates?.[0] ?? sel, ...list].slice(0, 4) : list;
  }, [res.auto, res.chosen]);
  const cur = pick?.none ? -1 : pl ? cands.findIndex((c) => sameRoad(c, pl)) : -1;
  const ambiguous = hint ?? (!pick && !!res.auto?.ambiguous);
  const hasChoice = cands.length > 0 || !!pick?.none;

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(320, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    const below = window.innerHeight - r.bottom - 12;
    const top = below >= 220 ? r.bottom + 6 : Math.max(12, r.top - 6 - Math.min(320, r.top - 18));
    setBox({ left, top, maxH: below >= 220 ? below - 6 : Math.min(320, r.top - 18) });
  };
  /** Gebiet auf der Karte zu klein oder nicht sichtbar: hinzoomen, damit die Kandidaten unterscheidbar sind */
  const showArea = () => {
    if (!map || !res.target) return;
    const b = targetBounds(res.target);
    const a = map.latLngToContainerPoint(toLatLng({ e: b.minE, n: b.maxN })), z = map.latLngToContainerPoint(toLatLng({ e: b.maxE, n: b.minN }));
    const sz = map.getSize();
    const visible = a.x >= 0 && a.y >= 0 && z.x <= sz.x && z.y <= sz.y;
    if (visible && Math.min(z.x - a.x, z.y - a.y) >= 180) return;
    const pad = Math.max(b.maxE - b.minE, b.maxN - b.minN) * 0.6;
    flyToBoundsSharp(map, { minE: b.minE - pad, minN: b.minN - pad, maxE: b.maxE + pad, maxN: b.maxN + pad }, { maxZoom: 22.5 });
  };
  const toggle = () => { if (open) { setOpen(false); return; } place(); setOpen(true); showArea(); };
  const close = (focus = true) => { setOpen(false); setHover(null); if (focus) btn.current?.focus(); };
  const choose = (p: RoadPick | null) => { onPick(p); close(); };

  // schliessen: Klick daneben, Esc, Scrollen/Grösse ändern
  useEffect(() => {
    if (!open) return;
    const down = (ev: PointerEvent) => {
      const n = ev.target as Node;
      if (pop.current?.contains(n) || btn.current?.contains(n)) return;
      close(false);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        const items = [...(pop.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        if (!items.length) return;
        ev.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]!.focus();
      }
    };
    // Scrollen der Seitenleiste: mitführen; Chip nicht mehr sichtbar ⇒ schliessen
    const scroll = (ev: Event) => {
      if (pop.current?.contains(ev.target as Node)) return;
      const r = btn.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) close(false);
      else place();
    };
    const resize = () => close(false);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    // erstes (bzw. gewähltes) Element fokussieren
    requestAnimationFrame(() => (pop.current?.querySelector<HTMLButtonElement>("button[aria-checked=true]") ?? pop.current?.querySelector<HTMLButtonElement>("button"))?.focus());
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Karte: Kandidaten zeigen, solange die Auswahl offen ist
  useEffect(() => {
    if (!open || !map || !cands.length) return;
    const g = L.layerGroup();
    if (res.target) {
      const ring = Array.isArray(res.target) ? res.target : [
        { e: res.target.minE, n: res.target.minN }, { e: res.target.maxE, n: res.target.minN },
        { e: res.target.maxE, n: res.target.maxN }, { e: res.target.minE, n: res.target.maxN }];
      g.addLayer(L.polygon(ring.map(toLatLng), { className: "rc-area", interactive: false }));
    }
    const lit = hover ?? (cur >= 0 ? cur : null);
    if (lit !== null && cands[lit]) for (const pts of roadPts(cands[lit]!, res.roads)) {
      g.addLayer(L.polyline(pts.map(toLatLng), { className: "rc-road-halo", interactive: false }));
      g.addLayer(L.polyline(pts.map(toLatLng), { className: "rc-road", interactive: false }));
    }
    cands.forEach((c, i) => {
      const icon = L.divIcon({ className: "rc-pin" + (i === lit ? " lit" : ""), html: `<span>${i + 1}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      g.addLayer(L.marker(toLatLng(c.pos), { icon, interactive: false, keyboard: false, zIndexOffset: i === lit ? 20000 : 10000 }));
    });
    g.addTo(map);
    return () => { g.remove(); };
  }, [open, hover, cur, cands.map((c) => `${c.segId}@${c.pos.e},${c.pos.n}`).join("|"), map]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = pl ? `auf ${roadLabel(pl)}` : pick?.none ? "ohne Strasse" : res.loading ? "Strasse …" : "";
  if (!hasChoice) {
    return <span className={"chip where" + (compact ? " rc-compact" : "")} title={res.loading ? "Strassen werden geladen …" : "keine Strasse bekannt"}>📍 {where}{label && label !== "Strasse …" ? ` · ${label}` : ""}</span>;
  }
  return (
    <span className="rc-wrap">
      <button
        ref={btn}
        type="button"
        className={"chip where rc-chip" + (manual ? " manual" : "") + (compact ? " rc-compact" : "")}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={ambiguous ? "Mehrere Strassen möglich – bitte prüfen" : manual ? "Strasse von Hand gewählt – ändern" : pl?.named === "text" ? "Strasse aus der Meldung – ändern" : "Strasse ändern"}
      >
        📍 {where}{label ? ` · ${label}` : ""} ▾
        {ambiguous && <span className="rc-dot" aria-label="mehrdeutig" />}
      </button>
      {open && createPortal(
        <div ref={pop} className="rc-pop" role="dialog" aria-label="Strasse wählen"
          style={box && window.innerWidth > 560 ? { left: box.left, top: box.top, maxHeight: box.maxH } : undefined}>
          <div className="rc-head">
            <b>Strasse für das Zeichen</b>
            {ambiguous && <span className="rc-amb">mehrdeutig – bitte wählen</span>}
          </div>
          <div className="rc-list" role="radiogroup">
            {cands.map((c, i) => (
              <button key={`${c.segId}-${i}`} type="button" role="radio" aria-checked={i === cur}
                className={"rc-item" + (i === cur ? " on" : "")}
                onClick={() => choose(pickOf(c))}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)}>
                <span className="rc-num">{i + 1}</span>
                <span className="rc-txt">
                  <span className="rc-name">{roadLabel(c)}</span>
                  <span className="rc-meta">{c.road ? c.kind : "Strasse ohne Namen"}{c.named === "text" ? " · in der Meldung genannt" : i === 0 && c.named !== "wahl" ? " · wahrscheinlichste" : ""}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="rc-list rc-more">
            <button type="button" role="radio" aria-checked={!!pick?.none} className={"rc-item" + (pick?.none ? " on" : "")} onClick={() => choose({ none: true })} onFocus={() => setHover(null)}>
              <span className="rc-num rc-ico">⌀</span>
              <span className="rc-txt"><span className="rc-name">Kein Strassenbezug</span><span className="rc-meta">Zeichen in der Mitte von {where}</span></span>
            </button>
            {onMap && (
              <button type="button" className="rc-item" onClick={() => { close(false); onMap(); }} onFocus={() => setHover(null)}>
                <span className="rc-num rc-ico">✛</span>
                <span className="rc-txt"><span className="rc-name">Ort auf Karte</span><span className="rc-meta">Punkt von Hand setzen</span></span>
              </button>
            )}
            {pick && (
              <button type="button" className="rc-item" onClick={() => choose(null)} onFocus={() => setHover(null)}>
                <span className="rc-num rc-ico">↺</span>
                <span className="rc-txt"><span className="rc-name">Automatisch</span><span className="rc-meta">wieder nach Meldung und Strassenklasse</span></span>
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

// ---------------------------------------------------------------- Bearbeiten (EditRow)

/** Ortsangabe ohne Strassenzusatz («AG13 · auf X» → «AG13») */
export const baseWhere = (w?: string) => (w ?? "").replace(/\s*·\s*auf\s.*$/, "");

/** Zielgebiet einer gespeicherten Meldung (Planquadrat bzw. NAI), wenn sie auf eine Strasse gehört */
export function eventRoadTarget(e: LageEvent, ex: Exercise, symKey = e.sym): RoadTargetInfo | null {
  if (e.where === "Karte") return null;
  if (catalogEntry(symKey)?.placement !== "strasse" && !e.roadHint && !e.road && !e.roadNone) return null;
  const c = e.cells?.[0] ? findCells(e.cells[0], ex.sheets)[0] : undefined;
  const sh = c && ex.sheets.find((x) => x.id === c.sheetId);
  const along = symKey === "hinterhalt";
  if (c && sh) return { key: `${symKey}|${e.cells![0]}|${e.roadHint ?? ""}`, target: cellBounds(sh, c.col, c.row, c.quadrant), along, hint: e.roadHint };
  const a = e.nai ? ex.areas.find((x) => x.name === e.nai) : undefined;
  if (a) return { key: `${symKey}|${a.id}|${e.roadHint ?? ""}`, target: a.ring, along, hint: e.roadHint };
  return null;
}

function centerOf(t: RoadTarget): LV95 {
  if (!Array.isArray(t)) return { e: (t.minE + t.maxE) / 2, n: (t.minN + t.maxN) / 2 };
  return { e: t.reduce((s, p) => s + p.e, 0) / t.length, n: t.reduce((s, p) => s + p.n, 0) / t.length };
}

/** Änderung aus der Strassenwahl beim Bearbeiten */
export interface RoadPatch { pos: LV95; where: string; angle?: number; road?: string; roadNone?: boolean }

/**
 * Strassenwahl in der Bearbeiten-Zeile. Ändert nichts, solange nicht gewählt wird.
 * `fallback` wird gezeigt, wenn die Meldung keinen Strassenbezug haben kann (oder von Hand auf der Karte gesetzt ist).
 */
export function RoadEdit({ e, ex, map, symKey, text, where, onChange, onMap, fallback }: {
  e: LageEvent; ex: Exercise; map?: L.Map; symKey: string; text: string; where?: string;
  onChange: (p: RoadPatch) => void; onMap?: () => void; fallback: ReactNode;
}) {
  const t = where === "Karte" ? null : eventRoadTarget(e, ex, symKey);
  const [pick, setPick] = useState<RoadPick | null>(() => (e.roadNone ? { none: true } : null));
  const res = useRoadChoice(t, text, pick);
  const [touched, setTouched] = useState(false);
  // noch nichts gewählt: gespeicherte Strasse zeigen (nicht neu bestimmen)
  const stored = !touched && e.road ? res.auto?.candidates?.find((c) => c.road === e.road) : undefined;
  const shown: RoadChoiceResult = stored ? { ...res, pl: stored, chosen: stored } : res;
  useEffect(() => {
    if (!touched || !t || res.loading) return;
    const w = baseWhere(e.where) || baseWhere(where);
    if (pick?.none || !res.pl) onChange({ pos: centerOf(t.target), where: w, roadNone: !!pick?.none, angle: undefined, road: undefined });
    else onChange({ pos: res.pl.pos, where: `${w}${res.pl.road ? ` · auf ${res.pl.road}` : ""}`, angle: res.pl.angle, road: res.pl.road, roadNone: undefined });
  }, [touched, pick, res.pl?.segId, res.pl?.pos.e, res.pl?.pos.n, res.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <>{fallback}</>;
  return (
    <RoadChoice where={baseWhere(e.where) || "Ort"} res={shown} pick={pick} compact map={map} onMap={onMap}
      manual={touched && !!pick} hint={touched || e.road || e.roadNone ? false : undefined}
      onPick={(p) => { setPick(p); setTouched(true); }} />
  );
}
