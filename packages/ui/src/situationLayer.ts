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
  cellBounds, declutter, mirrorBox, findCells, kindLabel, lastPosition,
  type Box, type DeclutterItem, type LageEvent, type RasterSheet,
} from "@lage/core";
import { escapeHtml, symbolSvg, toLatLng } from "@lage/map";
import { KIND_COLOR, MAP_INK, SIDE_COLOR, situationModel, type SituationItem } from "./journalLayer";
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
  /** Zeichen neben dem wahren Ort (Hindernis an der Strasse): Versatz in Bildschirmpixeln */
  offset?: [number, number];
}

class SituationLayer extends L.LayerGroup {
  private placed: Placed[] = [];
  private leaders = L.layerGroup();
  private roadMarks = L.layerGroup();
  private roadItems: SituationItem[] = [];

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
    const fills = new Map<string, { line: string; fill: string; o: number; rings: L.LatLng[][][]; seen: Set<string> }>();
    for (const it of model.items) {
      if (it.kind === "eigen" || it.selected || !it.e.cells?.length) continue;
      const c = KIND_COLOR[it.kind];
      const key = `${it.kind}|${it.opacity}`;
      const f = fills.get(key) ?? { ...c, o: it.opacity, rings: [], seen: new Set<string>() };
      fills.set(key, f);
      for (const label of it.e.cells) {
        const ring = cellRing(label, o.sheets);
        if (!ring || f.seen.has(label)) continue;
        f.seen.add(label);
        f.rings.push([ring]);
      }
    }
    for (const f of [...fills.values()].sort((a, b) => a.o - b.o)) {
      if (f.rings.length) L.polygon(f.rings, { color: f.line, weight: 1.2, opacity: 0.8 * f.o, fillColor: f.fill, fillOpacity: (f.fill === f.line ? 0.12 : 0.2) * f.o, interactive: false }).addTo(this);
    }

    // gewählte Meldung: Planquadrat(e) hinterlegt (inkl. Unterquadrant)
    if (selected) {
      const kc = KIND_COLOR[selected.kind];
      for (const label of selected.e.cells ?? []) {
        const ring = cellRing(label, o.sheets);
        if (ring) {
          L.polygon(ring, { color: "#fff", weight: 5, opacity: 0.85, fill: false, interactive: false }).addTo(this);
          L.polygon(ring, { color: kc.line, weight: 2.5, opacity: 1, dashArray: "7 4", fillColor: kc.fill, fillOpacity: kc.fill === kc.line ? 0.24 : 0.32, interactive: false, className: "lt-selcell" }).addTo(this);
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

    // Hindernisse / Zeichen quer zur Strasse (im Gelände; bei jedem Zoom neu, damit sie nie zu klein werden)
    for (const it of model.items) if (it.road) this.roadItems.push(it);
    this.roadMarks.addTo(this);
    this.leaders.addTo(this);

    // Zeichen (gewählte zuletzt → oben; zusätzlich zIndexOffset)
    const items = [...model.items].sort((a, b) => Number(a.selected) - Number(b.selected) || a.e.t.localeCompare(b.e.t));
    for (const it of items) {
      const size = it.selected ? SIZE_SEL : SIZE;
      const s = symbolSvg(it.sym, it.aff, size, { dir: it.e.dir, sidc: it.sidc, status: it.status });
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
      // gewählte Meldung: kein Tooltip (das Meldungsband zeigt dasselbe)
      if (!it.selected) marker.bindTooltip(() => this.tooltip(it), { direction: "top", offset: [0, -ay - 2], className: "lt-tip", opacity: 1 });
      marker.on("click", () => { marker.closeTooltip(); o.onClick(it.e); });
      marker.addTo(this);
      this.placed.push({ it, ll, marker, core, box, w: s.w, ax, offset: it.road ? roadOffset(it, core) : undefined });
    }
  }

  /**
   * Zeichnet ein Hindernis quer zur Strasse: Balken senkrecht zur Strassenrichtung (Sperre mit Zacken
   * zur Gegenseite, Checkpoint als Schranke, sonst kurzer Strich mit Punkt).
   * Länge ca. 44 m im Gelände, auf dem Bildschirm aber mindestens ca. 34 px.
   */
  private drawRoadMark(it: SituationItem, mPerPx: number): void {
    const p = it.pos;
    const a = ((it.e.angle ?? 0) * Math.PI) / 180;
    const u = { e: Math.cos(a), n: -Math.sin(a) }; // quer zur Strasse
    const v = { e: Math.sin(a), n: Math.cos(a) }; // entlang der Strasse
    const k = Math.max(1, (20 * mPerPx) / 22); // Massstab: halbe Balkenlänge mind. 20 px
    const at = (du: number, dv: number) => toLatLng({ e: p.e + (u.e * du + v.e * dv) * k, n: p.n + (u.n * du + v.n * dv) * k });
    // Zacken zur Gegenseite: bei Feind/unklar zum Melder (das sind wir), sonst in Strassenrichtung
    let side = 1;
    if (it.kind !== "eigen" && it.e.melder) {
      const m = lastPosition(this.events, "blau", it.e.melder, it.e.t);
      if (m) side = Math.sign((m.e - p.e) * v.e + (m.n - p.n) * v.n) || 1;
    }
    const col = KIND_COLOR[it.kind].line;
    const o = it.opacity;
    const opt = (color: string, weight: number, opacity: number): L.PolylineOptions => ({ color, weight, opacity: opacity * o, interactive: false, lineCap: "butt", lineJoin: "miter", dashArray: it.anticipated && color !== "#fff" ? "6 4" : undefined });
    const g = this.roadMarks;
    const casing = (ll: L.LatLng[] | L.LatLng[][], w: number) => L.polyline(ll, opt("#fff", w, 0.9)).addTo(g);
    const line = (ll: L.LatLng[] | L.LatLng[][], w: number) => L.polyline(ll, opt(col, w, 1)).addTo(g);
    if (it.road === "sperre") {
      const L2 = 22, depth = 7, n = 4;
      const bar = [at(-L2, 0), at(L2, 0)];
      const teeth: L.LatLng[] = [];
      for (let i = 0; i < n; i++) {
        const a0 = -L2 + (2 * L2 * i) / n, a1 = -L2 + (2 * L2 * (i + 1)) / n;
        teeth.push(at(a0, 0), at((a0 + a1) / 2, side * depth), at(a1, 0));
      }
      casing(teeth, 5); casing(bar, 9);
      line(teeth, 2); line(bar, 5);
    } else if (it.road === "checkpoint") {
      const L2 = 18;
      const gate = [[at(-L2, -7), at(-L2, 7)], [at(-L2, 0), at(L2, 0)], [at(L2, -7), at(L2, 7)]];
      casing(gate, 6); line(gate, 3);
    } else {
      const tick = [at(-12, 0), at(12, 0)];
      casing(tick, 6); line(tick, 3);
      L.circleMarker(toLatLng(p), { radius: 3.5, color: col, weight: 2, fillColor: "#fff", fillOpacity: o, opacity: o, interactive: false }).addTo(g);
    }
  }

  private tooltip(it: SituationItem): string {
    const e = it.e;
    const time = (this.o.days?.length ? dayLabel(e.t, this.o.days) + " " : "") + e.t.slice(11, 16);
    const who = e.unit || (it.kind === "eigen" ? e.melder ?? "" : "");
    const via = it.kind !== "eigen" && e.melder ? `via ${e.melder}` : "";
    const where = (e.cells?.length ? e.cells.join(", ") : e.where) ?? "";
    const meta = [where, e.road ? `auf ${e.road}` : "", it.name, e.nai && e.nai !== where ? e.nai : "", via].filter(Boolean).join(" · ");
    return `<div class="lt-tip-h"><b class="tnum">${escapeHtml(time)}</b><span class="lt-kind k-${it.kind}">${escapeHtml(kindLabel(e))}</span>${who ? `<b class="lt-tip-u">${escapeHtml(who)}</b>` : ""}</div>`
      + (e.desc ? `<div class="lt-tip-d">${escapeHtml(e.desc)}</div>` : "")
      + `<div class="lt-tip-t">${escapeHtml(e.text)}</div>`
      + (meta ? `<div class="lt-tip-m tnum">${escapeHtml(meta)}</div>` : "");
  }

  /** Kollisionsauflösung in Bildschirmpixeln, nach jedem Zoom neu */
  private layout() {
    const map = this._map;
    if (!map) return;
    const pts = this.placed.map((p) => map.latLngToLayerPoint(p.ll));
    const input: DeclutterItem[] = this.placed.map((p, i) => ({ x: pts[i]!.x + (p.offset?.[0] ?? 0), y: pts[i]!.y + (p.offset?.[1] ?? 0), core: p.core, box: p.box, pinned: p.it.selected }));
    // weit herausgezoomt (Feld kleiner als ca. 10 px): nicht auffächern, sonst entstehen kilometerlange Striche
    const mPerPx = 1 / map.options.crs!.scale(map.getZoom());
    const cell = Math.min(...this.o.sheets.map((s) => Math.min(s.cellW, s.cellH)), 2000);
    const res = cell / mPerPx < 10
      ? input.map((it) => ({ x: it.x, y: it.y, moved: false, side: 1 as const, group: -1 }))
      : declutter(input);
    this.roadMarks.clearLayers();
    for (const it of this.roadItems) this.drawRoadMark(it, mPerPx);
    this.leaders.clearLayers();
    const lines: Record<"on" | "off", L.LatLng[][]> = { on: [], off: [] };
    let moved = 0;
    res.forEach((r, i) => {
      const p = this.placed[i]!;
      const el = p.marker.getElement();
      if (el) el.classList.toggle("left", r.side < 0);
      if (!r.moved && !p.offset) {
        if (!p.marker.getLatLng().equals(p.ll)) p.marker.setLatLng(p.ll);
        return;
      }
      if (r.moved) moved++;
      p.marker.setLatLng(map.layerPointToLatLng(L.point(r.x, r.y)));
      // Strich vom wahren Ort zum Zeichenrand (der dem Ort zugewandten Seite); neben der Strasse zum Anker
      const edge = map.layerPointToLatLng(r.moved ? L.point(r.x + (r.side < 0 ? p.w - p.ax : -p.ax), r.y) : L.point(r.x, r.y));
      lines[p.it.opacity < 1 ? "off" : "on"].push([p.ll, edge]);
      if (r.moved || !p.offset) L.circleMarker(p.ll, { radius: 3.5, color: "#fff", weight: 1.5, fillColor: MAP_INK, fillOpacity: 1, opacity: p.it.opacity, interactive: false }).addTo(this.leaders);
    });
    for (const k of ["on", "off"] as const) {
      if (!lines[k].length) continue;
      const opacity = k === "on" ? 1 : 0.45;
      L.polyline(lines[k], { color: "#fff", weight: 4, opacity, interactive: false }).addTo(this.leaders);
      L.polyline(lines[k], { color: MAP_INK, weight: 1.5, opacity, interactive: false }).addTo(this.leaders);
    }
    publish(moved);
    // Flächenbeschriftungen (NAI, AO, Stao) den Zeichen ausweichen lassen
    const rects = res.map((r, i) => {
      const p = this.placed[i]!;
      const b = r.side < 0 ? mirrorBox(p.box, p.core) : p.box;
      const c = map.layerPointToContainerPoint(L.point(r.x, r.y));
      return [c.x + b[0], c.y + b[1], c.x + b[2], c.y + b[3]] as const;
    });
    avoidAreaLabels(map, rects);
  }
}

/**
 * Verschiebt die Beschriftungen der Flächen (aus `areasLayer`), wenn sie auf einem Zeichen liegen:
 * zuerst nach oben, dann seitlich. Wird nach jeder Kollisionsauflösung neu berechnet.
 */
function avoidAreaLabels(map: L.Map, rects: ReadonlyArray<readonly [number, number, number, number]>) {
  const cont = map.getContainer();
  const spans = cont.querySelectorAll<HTMLElement>(".lt-area-lbl span");
  if (!spans.length) return;
  const cr = cont.getBoundingClientRect();
  const hit = (a: readonly number[]) => rects.some((r) => a[0]! < r[2] && a[2]! > r[0] && a[1]! < r[3] && a[3]! > r[1]);
  const tries: Array<[number, number]> = [[0, 0], [0, -16], [0, -32], [24, 0], [-24, 0], [48, -16], [-48, -16], [0, -48]];
  spans.forEach((sp) => {
    sp.style.translate = "";
    const b = sp.getBoundingClientRect();
    const r0 = [b.left - cr.left - 2, b.top - cr.top - 1, b.right - cr.left + 2, b.bottom - cr.top + 1];
    const ok = tries.find(([dx, dy]) => !hit([r0[0]! + dx, r0[1]! + dy, r0[2]! + dx, r0[3]! + dy]));
    if (ok && (ok[0] || ok[1])) sp.style.translate = `${ok[0]}px ${ok[1]}px`;
  });
}

/**
 * Versatz des Zeichens neben der Strasse (quer dazu; Bildschirm x = Ost, y = Süd), so weit, dass das Zeichen
 * den wahren Ort (Balkenmitte) nicht verdeckt.
 */
function roadOffset(it: SituationItem, core: Box): [number, number] {
  const a = ((it.e.angle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const M = 26; // Abstand Ort ↔ Zeichenrand (Balken + etwas Luft)
  const tx = dx > 1e-6 ? (M - core[0]) / dx : dx < -1e-6 ? (core[2] + M) / -dx : Infinity;
  const ty = dy > 1e-6 ? (M - core[1]) / dy : dy < -1e-6 ? (core[3] + M) / -dy : Infinity;
  const t = Math.max(24, Math.min(tx, ty, 90));
  return [dx * t, dy * t];
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

