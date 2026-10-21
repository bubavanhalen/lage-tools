/**
 * Lage auf der Karte zum Zeitpunkt t (wie Lagebild-Prototyp, Spez. 4.4–4.6):
 * - eigene Elemente am aktuellen Standort (kräftig), Spur gestrichelt mit kleinen Punkten,
 * - Sichtungen (Feind / unklar) bis t: die letzten `recentMin` Minuten kräftig, ältere 45 % blass,
 * - Zusatz am Zeichen («H04», «2× Det 1»), Zeitlabel «hh:mm» an frischen Zeichen,
 * - Kollisionsauflösung (Kern bleibt, Rest aufgefächert, Führungsstrich + Punkt am wahren Ort), neu bei jedem Zoom,
 * - gewählte Meldung: grösser, hervorgehoben, Planquadrat hinterlegt, Linie Melder → Sichtung.
 */
import L from "leaflet";
import {
  cellBounds, declutter, findCells, kindLabel, lastPosition, symbolDef,
  type Box, type DeclutterItem, type LageEvent, type RasterSheet,
} from "@lage/core";
import { escapeHtml, symbolSvg, toLatLng } from "@lage/map";
import { MAP_INK, SIDE_COLOR, situationModel, type SituationItem } from "./journalLayer";
import type { LayerFlags } from "./layers";
import { dayLabel } from "./Timeline";
import "./mapoverlays.css";

export interface SituationOptions {
  /** Zeitpunkt (ISO lokal), nie null – Live wird vorher aufgelöst */
  t: string;
  flags: LayerFlags;
  selectedId: string | null;
  sheets: RasterSheet[];
  onClick: (e: LageEvent) => void;
  /** Meldungen jünger als so viele Minuten kräftig, ältere blass (Standard 30) */
  recentMin?: number;
  /** Übungstage (für «T2 06:15» im Tooltip) */
  days?: string[];
}

const SIZE = 18;
const SIZE_SEL = 24;
const TIME_W = 44;
const TIME_H = 14;

// ---------- Layout-Info für die Legende (z. B. «Führungsstrich» nur zeigen, wenn es welche gibt)
let layoutInfo = { moved: 0 };
const subs = new Set<() => void>();
export const subscribeSituationLayout = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export const getSituationLayout = () => layoutInfo;
function publish(moved: number) {
  if (moved === layoutInfo.moved) return;
  layoutInfo = { moved };
  subs.forEach((cb) => cb());
}

interface Placed {
  it: SituationItem;
  ll: L.LatLng;
  marker: L.Marker;
  core: Box;
  box: Box;
  /** Zeichenbreite und Anker (für den Führungsstrich) */
  w: number;
  ax: number;
}

class SituationLayer extends L.LayerGroup {
  private placed: Placed[] = [];
  private leaders = L.layerGroup();

  constructor(private events: LageEvent[], private o: SituationOptions) {
    super();
    this.build();
  }

  override onAdd(map: L.Map): this {
    super.onAdd(map);
    this.layout();
    map.on("zoomend viewreset", this.layout, this);
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off("zoomend viewreset", this.layout, this);
    publish(0);
    return super.onRemove(map);
  }

  private build() {
    const o = this.o;
    const model = situationModel(this.events, o.t, o.flags, { recentMin: o.recentMin, selectedId: o.selectedId });
    const selected = model.items.find((i) => i.selected);

    // Planquadrate der Sichtungen (Seitenfarbe 12 %, ältere blass), je Farbe/Deckkraft eine Fläche
    const fills = new Map<string, { col: string; o: number; rings: L.LatLng[][][]; seen: Set<string> }>();
    for (const it of model.items) {
      if (it.kind === "eigen" || it.selected || !it.e.cells?.length) continue;
      const col = SIDE_COLOR[it.e.side];
      const key = `${col}|${it.opacity}`;
      const f = fills.get(key) ?? { col, o: it.opacity, rings: [], seen: new Set<string>() };
      fills.set(key, f);
      for (const label of it.e.cells) {
        const ring = cellRing(label, o.sheets);
        if (!ring || f.seen.has(label)) continue;
        f.seen.add(label);
        f.rings.push([ring]);
      }
    }
    for (const f of [...fills.values()].sort((a, b) => a.o - b.o)) {
      if (f.rings.length) L.polygon(f.rings, { color: f.col, weight: 1.2, opacity: 0.8 * f.o, fillColor: f.col, fillOpacity: 0.12 * f.o, interactive: false }).addTo(this);
    }

    // gewählte Meldung: Planquadrat(e) hinterlegt (inkl. Unterquadrant)
    if (selected) {
      const col = SIDE_COLOR[selected.e.side];
      for (const label of selected.e.cells ?? []) {
        const ring = cellRing(label, o.sheets);
        if (ring) {
          L.polygon(ring, { color: "#fff", weight: 5, opacity: 0.85, fill: false, interactive: false }).addTo(this);
          L.polygon(ring, { color: col, weight: 2.5, opacity: 1, dashArray: "7 4", fillColor: col, fillOpacity: 0.24, interactive: false, className: "lt-selcell" }).addTo(this);
        }
      }
    }

    // Spuren der Elemente: gestrichelt, kleine Punkte an früheren Standorten
    for (const tr of model.tracks) {
      const col = SIDE_COLOR[tr.side];
      const ll = tr.pts.map(toLatLng);
      L.polyline(ll, { color: "#fff", weight: 4.5, opacity: 0.6, interactive: false }).addTo(this);
      L.polyline(ll, { color: col, weight: 2, opacity: 0.85, dashArray: "6 5", interactive: false }).addTo(this);
      for (const p of ll.slice(0, -1)) L.circleMarker(p, { radius: 2.5, color: col, weight: 1.5, fillColor: "#fff", fillOpacity: 1, opacity: 0.9, interactive: false }).addTo(this);
    }

    // Sichtung: feine Linie vom Melder zur Sichtung
    if (selected && selected.kind !== "eigen" && selected.e.melder) {
      const from = lastPosition(this.events, "blau", selected.e.melder, selected.e.t);
      if (from && (Math.abs(from.e - selected.pos.e) > 1 || Math.abs(from.n - selected.pos.n) > 1)) {
        const ll = [toLatLng(from), toLatLng(selected.pos)];
        L.polyline(ll, { color: "#fff", weight: 4, opacity: 0.8, interactive: false }).addTo(this);
        L.polyline(ll, { color: SIDE_COLOR.blau, weight: 1.5, opacity: 0.95, dashArray: "5 4", interactive: false }).addTo(this);
        L.circleMarker(ll[0]!, { radius: 3, color: "#fff", weight: 1.5, fillColor: SIDE_COLOR.blau, fillOpacity: 1, interactive: false }).addTo(this);
      }
    }

    this.leaders.addTo(this);

    // Zeichen (gewählte zuletzt → oben; zusätzlich zIndexOffset)
    const items = [...model.items].sort((a, b) => Number(a.selected) - Number(b.selected) || a.e.t.localeCompare(b.e.t));
    for (const it of items) {
      const size = it.selected ? SIZE_SEL : SIZE;
      const s = symbolSvg(it.sym, it.aff, size, { dir: it.e.dir });
      const [ax, ay] = s.anchor;
      const udW = it.ud ? it.ud.length * 7 + 6 : 0;
      const ext = Math.max(udW, it.showTime ? TIME_W : 0);
      const top = -ay - 2 - (it.showTime ? TIME_H : 0);
      const core: Box = [-ax, -ay, s.w - ax, s.h - ay];
      const box: Box = [-ax - 2, top, s.w - ax + 2 + ext, s.h - ay + 2];
      const cls = ["lt-ev", `k-${it.kind}`, it.selected ? "sel" : "", it.opacity < 1 ? "old" : ""].filter(Boolean).join(" ");
      const html = `${s.svg}`
        + (it.ud ? `<span class="lt-ud" style="--x:${s.w + 2}px;top:${Math.max(0, ay - 8)}px">${escapeHtml(it.ud)}</span>` : "")
        + (it.showTime ? `<span class="lt-tl" style="--x:${s.w + 2}px">${it.e.t.slice(11, 16)}</span>` : "");
      const ll = toLatLng(it.pos);
      const z = it.selected ? 1000 : (it.fresh ? 200 : 0) + (it.kind !== "eigen" ? 100 : 0);
      const marker = L.marker(ll, {
        icon: L.divIcon({ className: cls, html, iconSize: [s.w, s.h], iconAnchor: [ax, ay] }),
        opacity: it.opacity,
        zIndexOffset: z,
        keyboard: false,
        riseOnHover: true,
      });
      marker.bindTooltip(() => this.tooltip(it), { direction: "top", offset: [0, -ay - 2], className: "lt-tip", opacity: 1 });
      marker.on("click", () => o.onClick(it.e));
      marker.addTo(this);
      this.placed.push({ it, ll, marker, core, box, w: s.w, ax });
    }
  }

  private tooltip(it: SituationItem): string {
    const e = it.e;
    const time = (this.o.days?.length ? dayLabel(e.t, this.o.days) + " " : "") + e.t.slice(11, 16);
    const who = e.unit || (it.kind === "eigen" ? e.melder ?? "" : "");
    const via = it.kind !== "eigen" && e.melder ? `via ${e.melder}` : "";
    const where = (e.cells?.length ? e.cells.join(", ") : e.where) ?? "";
    const meta = [where, symbolDef(it.sym).name, e.nai && e.nai !== where ? e.nai : "", via].filter(Boolean).join(" · ");
    return `<div class="lt-tip-h"><b class="tnum">${escapeHtml(time)}</b><span class="lt-kind k-${it.kind}">${escapeHtml(kindLabel(e))}</span>${who ? `<b class="lt-tip-u">${escapeHtml(who)}</b>` : ""}</div>`
      + `<div class="lt-tip-t">${escapeHtml(e.text)}</div>`
      + (meta ? `<div class="lt-tip-m tnum">${escapeHtml(meta)}</div>` : "");
  }

  /** Kollisionsauflösung in Bildschirmpixeln, nach jedem Zoom neu */
  private layout() {
    const map = this._map;
    if (!map) return;
    const pts = this.placed.map((p) => map.latLngToLayerPoint(p.ll));
    const input: DeclutterItem[] = this.placed.map((p, i) => ({ x: pts[i]!.x, y: pts[i]!.y, core: p.core, box: p.box, pinned: p.it.selected }));
    // weit herausgezoomt (Feld kleiner als ca. 10 px): nicht auffächern, sonst entstehen kilometerlange Striche
    const mPerPx = 1 / map.options.crs!.scale(map.getZoom());
    const cell = Math.min(...this.o.sheets.map((s) => Math.min(s.cellW, s.cellH)), 2000);
    const res = cell / mPerPx < 10
      ? input.map((it) => ({ x: it.x, y: it.y, moved: false, side: 1 as const, group: -1 }))
      : declutter(input);
    this.leaders.clearLayers();
    const lines: Record<"on" | "off", L.LatLng[][]> = { on: [], off: [] };
    let moved = 0;
    res.forEach((r, i) => {
      const p = this.placed[i]!;
      const el = p.marker.getElement();
      if (el) el.classList.toggle("left", r.side < 0);
      if (!r.moved) {
        if (!p.marker.getLatLng().equals(p.ll)) p.marker.setLatLng(p.ll);
        return;
      }
      moved++;
      p.marker.setLatLng(map.layerPointToLatLng(L.point(r.x, r.y)));
      // Strich vom wahren Ort zum Zeichenrand (der dem Ort zugewandten Seite)
      const edge = map.layerPointToLatLng(L.point(r.x + (r.side < 0 ? p.w - p.ax : -p.ax), r.y));
      lines[p.it.opacity < 1 ? "off" : "on"].push([p.ll, edge]);
      L.circleMarker(p.ll, { radius: 3.5, color: "#fff", weight: 1.5, fillColor: MAP_INK, fillOpacity: 1, opacity: p.it.opacity, interactive: false }).addTo(this.leaders);
    });
    for (const k of ["on", "off"] as const) {
      if (!lines[k].length) continue;
      const opacity = k === "on" ? 1 : 0.45;
      L.polyline(lines[k], { color: "#fff", weight: 4, opacity, interactive: false }).addTo(this.leaders);
      L.polyline(lines[k], { color: MAP_INK, weight: 1.5, opacity, interactive: false }).addTo(this.leaders);
    }
    publish(moved);
  }
}

/** Umriss eines Planquadrats (inkl. Unterquadrant), null wenn unbekannt */
function cellRing(label: string, sheets: RasterSheet[]): L.LatLng[] | null {
  const c = findCells(label, sheets)[0];
  const sh = c && sheets.find((s) => s.id === c.sheetId);
  if (!c || !sh) return null;
  const b = cellBounds(sh, c.col, c.row, c.quadrant);
  return [{ e: b.minE, n: b.maxN }, { e: b.maxE, n: b.maxN }, { e: b.maxE, n: b.minN }, { e: b.minE, n: b.minN }].map(toLatLng);
}

export function situationLayer(_map: L.Map, events: LageEvent[], o: SituationOptions): L.LayerGroup {
  return new SituationLayer(events, o);
}

