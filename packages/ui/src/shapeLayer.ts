/**
 * Flächen- und Linienzeichen auf der Lagekarte (unter den Punktzeichen, im LV95-CRS):
 * - Farbe nach Art (eigen blau, Feind rot, unklar gelb, neutral grün), vermutet gestrichelt,
 * - Muster: Minenfeld «M», verseuchtes Gebiet schraffiert; Linien: Stacheldraht (Schlaufen), Panzergraben (Zähne),
 *   Sperrlinie (Zacken), Kontaktlinie (Bögen), Grenze (Strich-Punkt), Achse (Pfeil),
 * - Beschriftung Kurzname + Zeit (Fläche oben innen, Linie am Ende),
 * - klickbar (wählt die Meldung), Lagezeit und Zeitfenster wie die Zeichen (Form erscheint ab Meldungszeit).
 * Das Punktzeichen am Schwerpunkt zeichnet die Lageebene (`situationLayer`) wie jedes andere Zeichen.
 */
import L from "leaflet";
import { eventShape, geometryOf, shapeShortName, shapeStyleOf, type Area, type EventShape, type LageEvent, type LV95, type RasterSheet, type ShapeStyle } from "@lage/core";
import { escapeHtml, isAnticipated, toLatLng } from "@lage/map";
import { KIND_COLOR, kindOf, kindText, type ItemKind } from "./journalLayer";
import type { LayerFlags } from "./layers";
import "./shapes.css";

export interface ShapeLayerOptions {
  /** Lagezeit (ISO lokal) */
  t: string;
  /** Anfang des Zeitfensters (ISO lokal), null/undefined = alles */
  from?: string | null;
  flags: Pick<LayerFlags, "eigene" | "feind" | "zeiten"> & { flaechen?: boolean };
  selectedId: string | null;
  sheets: RasterSheet[];
  areas: Area[];
  onClick?: (e: LageEvent) => void;
  /** Meldungen jünger als so viele Minuten kräftig, ältere blass (Standard 30, wie die Zeichen) */
  recentMin?: number;
}

export interface ShapeItem {
  e: LageEvent;
  shape: EventShape;
  style: ShapeStyle;
  kind: ItemKind;
  color: string;
  dashed: boolean;
  opacity: number;
  selected: boolean;
  label: string;
}

const PANE = "lt-shapes";
const LABEL_PANE = "lt-shapelbl";
const KINDS: ItemKind[] = ["eigen", "feind", "unklar", "neutral", "ul"];

/** Formen, die zur Lagezeit (und im Zeitfenster) sichtbar sind – ohne Leaflet, auch für Legende/PDF */
export function shapeItems(events: LageEvent[], o: Omit<ShapeLayerOptions, "onClick">): ShapeItem[] {
  if (o.flags.flaechen === false) return [];
  const recent = o.recentMin ?? 30;
  const ctx = { sheets: o.sheets, areas: o.areas };
  const out: ShapeItem[] = [];
  for (const e of events) {
    if (e.deleted || e.t > o.t) continue;
    const selected = e.id === o.selectedId;
    if (o.from && e.t < o.from && !selected) continue;
    if (geometryOf(e.sym) === "punkt" && (!e.shape || e.shape.auto)) continue;
    if (!(e.side === "blau" ? o.flags.eigene : o.flags.feind)) continue;
    const shape = eventShape(e, ctx);
    if (!shape) continue;
    const kind = kindOf(e);
    const age = (Date.parse(o.t) - Date.parse(e.t)) / 60000;
    const time = e.t.slice(11, 16);
    out.push({
      e, shape, style: shapeStyleOf(e.sym), kind, color: KIND_COLOR[kind].line, dashed: isAnticipated(e.sidc, e.status), selected,
      opacity: kind === "eigen" || selected || age <= recent ? 1 : 0.55,
      label: [shapeShortName(e.sym), o.flags.zeiten !== false ? time : ""].filter(Boolean).join(" "),
    });
  }
  // gewählte zuletzt (oben)
  return out.sort((a, b) => Number(a.selected) - Number(b.selected) || a.e.t.localeCompare(b.e.t));
}

// ---------- Leaflet

function ensurePanes(map: L.Map): L.SVG {
  if (!map.getPane(PANE)) {
    const p = map.createPane(PANE);
    p.style.zIndex = "410"; // über NAI/Spuren (400), unter Zeitlabels und Zeichen (600)
    const l = map.createPane(LABEL_PANE);
    l.style.zIndex = "450";
    l.style.pointerEvents = "none";
  }
  const m = map as L.Map & { _ltShapeRenderer?: L.SVG };
  if (!m._ltShapeRenderer) {
    m._ltShapeRenderer = L.svg({ pane: PANE, padding: 0.5 });
    m._ltShapeRenderer.addTo(map);
    const svg = (m._ltShapeRenderer as unknown as { _container: SVGSVGElement })._container;
    svg.insertAdjacentHTML("afterbegin", patternDefs());
  }
  return m._ltShapeRenderer;
}

/** Muster je Kartenfarbe: Minen («M»), ABC (Schraffur) */
function patternDefs(): string {
  const defs = KINDS.map((k) => {
    const c = KIND_COLOR[k].line;
    return `<pattern id="lt-pat-minen-${k}" width="34" height="30" patternUnits="userSpaceOnUse">`
      + `<rect width="34" height="30" fill="${c}" fill-opacity=".1"/>`
      + `<text x="8" y="12" font-family="Arial" font-weight="700" font-size="12" fill="${c}" fill-opacity=".95" text-anchor="middle">M</text>`
      + `<text x="25" y="27" font-family="Arial" font-weight="700" font-size="12" fill="${c}" fill-opacity=".95" text-anchor="middle">M</text>`
      + `</pattern>`
      + `<pattern id="lt-pat-abc-${k}" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
      + `<rect width="9" height="9" fill="${c}" fill-opacity=".08"/><line x1="0" y1="0" x2="0" y2="9" stroke="${c}" stroke-width="1.6" stroke-opacity=".6"/>`
      + `</pattern>`;
  }).join("");
  return `<defs>${defs}</defs>`;
}

type Px = L.Point;

/** Punkte entlang eines Linienzugs (Bildschirm) im Abstand `step`, mit Richtung (Radiant) */
function walk(pts: Px[], step: number, start = step / 2): Array<{ p: Px; a: number }> {
  const out: Array<{ p: Px; a: number }> = [];
  let d = start;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const l = a.distanceTo(b);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    while (d <= l) {
      out.push({ p: L.point(a.x + ((b.x - a.x) * d) / l, a.y + ((b.y - a.y) * d) / l), a: ang });
      d += step;
    }
    d -= l;
  }
  return out;
}

class ShapeLayer extends L.LayerGroup {
  private main = L.layerGroup();
  private deco = L.layerGroup();
  /** dargestellte Punkte je Form (kurze Linien an der Strasse werden auf mindestens ~64 px verlängert) */
  private disp = new Map<ShapeItem, LV95[]>();
  private items: ShapeItem[];
  private renderer: L.SVG | null = null;

  constructor(events: LageEvent[], private o: ShapeLayerOptions) {
    super();
    this.items = shapeItems(events, o);
  }

  override onAdd(map: L.Map): this {
    this.renderer = ensurePanes(map);
    super.onAdd(map);
    this.main.addTo(this);
    this.deco.addTo(this);
    this.redraw();
    map.on("zoomend viewreset", this.redraw, this);
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off("zoomend viewreset", this.redraw, this);
    return super.onRemove(map);
  }

  private base(extra: L.PathOptions): L.PathOptions {
    return { pane: PANE, renderer: this.renderer ?? undefined, interactive: false, ...extra };
  }

  /** bei jedem Zoom: Formen und Verzierungen neu */
  private redraw() {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (!map) return;
    const mPerPx = 1 / map.options.crs!.scale(map.getZoom());
    this.disp.clear();
    for (const it of this.items) this.disp.set(it, displayPts(it, mPerPx));
    this.main.clearLayers();
    this.build();
    this.decorate();
  }

  private build() {
    const g = this.main;
    for (const it of this.items) {
      const ll = (this.disp.get(it) ?? it.shape.pts).map(toLatLng);
      const op = it.opacity;
      const w = it.selected ? 1.5 : 0;
      const dash = it.dashed ? "9 6" : it.style === "grenze" ? "16 5 3 5" : undefined;
      let hit: L.Path;
      if (it.shape.kind === "flaeche") {
        if (it.selected) L.polygon(ll, this.base({ color: "#F2B705", weight: 9, opacity: 0.55, fill: false })).addTo(g);
        L.polygon(ll, this.base({ color: "#fff", weight: 5 + w, opacity: 0.75 * op, fill: false })).addTo(g);
        const pattern = it.style === "minen" || it.style === "abc" ? `url(#lt-pat-${it.style}-${it.kind})` : undefined;
        hit = L.polygon(ll, this.base({
          color: it.color, weight: 2.2 + w, opacity: op, dashArray: dash, lineJoin: "round",
          fillColor: pattern ?? KIND_COLOR[it.kind].fill, fillOpacity: pattern ? op : (KIND_COLOR[it.kind].fill === it.color ? 0.12 : 0.2) * op,
          interactive: !!this.o.onClick, bubblingMouseEvents: false, className: "lt-shape",
        })).addTo(g);
      } else {
        if (it.selected) L.polyline(ll, this.base({ color: "#F2B705", weight: 11, opacity: 0.55 })).addTo(g);
        const heavy = it.style === "achse" ? 3.5 : 2.6;
        L.polyline(ll, this.base({ color: "#fff", weight: heavy + 4 + w, opacity: 0.8 * op, lineCap: "round", lineJoin: "round" })).addTo(g);
        L.polyline(ll, this.base({ color: it.color, weight: heavy + w, opacity: op, dashArray: dash, lineCap: it.style === "achse" ? "butt" : "round", lineJoin: "round" })).addTo(g);
        // breite unsichtbare Linie zum Antippen
        hit = L.polyline(ll, this.base({ color: "#000", weight: 18, opacity: 0, interactive: !!this.o.onClick, bubblingMouseEvents: false, className: "lt-shape" })).addTo(g);
      }
      if (this.o.onClick) {
        hit.on("click", () => this.o.onClick!(it.e));
        hit.bindTooltip(() => tooltip(it), { sticky: true, direction: "top", offset: [0, -8], className: "lt-tip", opacity: 1 });
      }
    }
  }

  /** Beschriftung und pixelgenaue Verzierungen (Zähne, Schlaufen, Pfeil) – bei jedem Zoom neu */
  private decorate() {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (!map) return;
    this.deco.clearLayers();
    for (const it of this.items) {
      const px = (this.disp.get(it) ?? it.shape.pts).map((p) => map.latLngToLayerPoint(toLatLng(p)));
      const back = (p: Px) => map.layerPointToLatLng(p);
      const op = it.opacity;
      const c = it.color;
      if (it.shape.kind === "linie") this.lineDeco(it, px, back);
      // Beschriftung
      const lbl = labelAt(it, px);
      if (lbl) {
        const html = `<span class="lt-shape-lbl${it.selected ? " sel" : ""}" style="--c:${c};opacity:${op};--tx:${lbl.tx};--ty:${lbl.ty}">${escapeHtml(it.label)}</span>`;
        L.marker(back(lbl.p), { pane: LABEL_PANE, interactive: false, keyboard: false, icon: L.divIcon({ className: "lt-shape-lblwrap", html, iconSize: [0, 0] }) }).addTo(this.deco);
      }
    }
  }

  private lineDeco(it: ShapeItem, px: Px[], back: (p: Px) => L.LatLng) {
    const g = this.deco;
    const c = it.color;
    const op = it.opacity;
    const len = px.reduce((s, p, i) => (i ? s + p.distanceTo(px[i - 1]!) : 0), 0);
    if (len < 6) return;
    const opts = <T extends L.PathOptions>(x: T): T => ({ ...this.base({ opacity: op }), ...x });
    // Seite: links der Zeichenrichtung (Bildschirm: -90°)
    const side = (p: Px, a: number, d: number) => L.point(p.x + Math.cos(a - Math.PI / 2) * d, p.y + Math.sin(a - Math.PI / 2) * d);
    const fwd = (p: Px, a: number, d: number) => L.point(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
    switch (it.style) {
      case "draht": {
        // Concertina: überlappende Schlaufen
        for (const { p } of walk(px, 9)) {
          L.circleMarker(back(p), opts({ radius: 4.5, color: "#fff", weight: 3.2, fill: false, opacity: 0.8 * op })).addTo(g);
        }
        for (const { p } of walk(px, 9)) L.circleMarker(back(p), opts({ radius: 4.5, color: c, weight: 1.4, fill: false })).addTo(g);
        break;
      }
      case "graben": {
        // Zähne auf einer Seite
        for (const { p, a } of walk(px, 12)) {
          const tri = [fwd(p, a, -4), side(p, a, 7), fwd(p, a, 4)].map(back);
          L.polygon(tri, opts({ color: "#fff", weight: 1, fillColor: c, fillOpacity: op })).addTo(g);
        }
        break;
      }
      case "sperre": {
        // Zacken über der Linie
        const z: L.LatLng[] = [];
        walk(px, 6, 0).forEach(({ p, a }, i) => z.push(back(side(p, a, i % 2 ? 6 : -6))));
        if (z.length > 1) {
          L.polyline(z, opts({ color: "#fff", weight: 4.5, opacity: 0.8 * op, lineJoin: "miter" })).addTo(g);
          L.polyline(z, opts({ color: c, weight: 2, lineJoin: "miter" })).addTo(g);
        }
        break;
      }
      case "front": {
        // Bögen (Halbkreise) auf der Feindseite
        for (const { p, a } of walk(px, 14)) {
          const arc: L.LatLng[] = [];
          for (let k = 0; k <= 8; k++) {
            const t = Math.PI * (k / 8);
            arc.push(back(L.point(p.x + Math.cos(a) * -6 * Math.cos(t) + Math.cos(a - Math.PI / 2) * 6 * Math.sin(t),
              p.y + Math.sin(a) * -6 * Math.cos(t) + Math.sin(a - Math.PI / 2) * 6 * Math.sin(t))));
          }
          L.polyline(arc, opts({ color: c, weight: 2 })).addTo(g);
        }
        break;
      }
      case "achse": {
        // Pfeilspitze am Ende
        const b = px[px.length - 1]!, a0 = px[px.length - 2]!;
        const a = Math.atan2(b.y - a0.y, b.x - a0.x);
        const head = [side(fwd(b, a, -16), a, 9), b, side(fwd(b, a, -16), a, -9)].map(back);
        L.polygon(head, opts({ color: "#fff", weight: 2, fillColor: c, fillOpacity: op, opacity: 0.9 * op })).addTo(g);
        break;
      }
      case "phase": {
        // kurze Endstriche
        for (const [p, q] of [[px[0]!, px[1]!], [px[px.length - 1]!, px[px.length - 2]!]] as Array<[Px, Px]>) {
          const a = Math.atan2(q.y - p.y, q.x - p.x);
          L.polyline([back(side(p, a, 7)), back(side(p, a, -7))], opts({ color: c, weight: 2.6 })).addTo(g);
        }
        break;
      }
    }
  }
}

/** Kurze automatische Linie an der Strasse (60 m) bei kleinem Massstab mindestens ~64 px lang zeigen */
function displayPts(it: ShapeItem, mPerPx: number): LV95[] {
  const p = it.shape.pts;
  if (it.shape.kind !== "linie" || !it.shape.auto || it.e.angle === undefined || p.length !== 2) return p;
  const [a, b] = p as [LV95, LV95];
  const len = Math.hypot(b.e - a.e, b.n - a.n);
  const min = 64 * mPerPx;
  if (!len || len >= min) return p;
  const k = min / len, c = { e: (a.e + b.e) / 2, n: (a.n + b.n) / 2 };
  return [a, b].map((q) => ({ e: c.e + (q.e - c.e) * k, n: c.n + (q.n - c.n) * k }));
}

/** Ort der Beschriftung: Fläche oben innen (Mitte), Linie am Ende (in Linienrichtung weiter) */
function labelAt(it: ShapeItem, px: Px[]): { p: Px; tx: string; ty: string } | null {
  if (!it.label || px.length < 2) return null;
  if (it.shape.kind === "flaeche") {
    const minY = Math.min(...px.map((p) => p.y));
    const maxY = Math.max(...px.map((p) => p.y));
    const minX = Math.min(...px.map((p) => p.x));
    const maxX = Math.max(...px.map((p) => p.x));
    if (maxX - minX < 40 || maxY - minY < 30) return { p: L.point((minX + maxX) / 2, minY), tx: "-50%", ty: "-115%" };
    return { p: L.point((minX + maxX) / 2, minY + 5), tx: "-50%", ty: "0" };
  }
  const b = px[px.length - 1]!, a = px[px.length - 2]!;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const p = L.point(b.x + Math.cos(ang) * 10, b.y + Math.sin(ang) * 10);
  const cx = Math.cos(ang), cy = Math.sin(ang);
  return { p, tx: cx >= 0.3 ? "0" : cx <= -0.3 ? "-100%" : "-50%", ty: cy >= 0.3 ? "0" : cy <= -0.3 ? "-100%" : "-50%" };
}

function tooltip(it: ShapeItem): string {
  const e = it.e;
  const head = `<div class="lt-tip-h"><span class="lt-kind k-${it.kind}">${escapeHtml(kindText(e))}</span><b class="tnum">${e.t.slice(11, 16)}</b>`
    + `<span class="lt-tip-u">${escapeHtml(shapeShortName(e.sym))}</span></div>`;
  const desc = e.desc ? `<div class="lt-tip-d">${escapeHtml(e.desc)}</div>` : "";
  const meta = [e.melder ? `Melder ${e.melder}` : "", e.where ?? "", it.shape.auto ? "Form automatisch" : "Form gezeichnet"].filter(Boolean).join(" · ");
  return head + desc + `<div class="lt-tip-t">${escapeHtml(e.text)}</div><div class="lt-tip-m">${escapeHtml(meta)}</div>`;
}

export function shapeLayer(events: LageEvent[], o: ShapeLayerOptions): L.LayerGroup {
  return new ShapeLayer(events, o);
}

/** Ausdehnung einer Form in LV95 (für Fokus/Zoom) */
export function shapeBounds(s: EventShape): { minE: number; maxE: number; minN: number; maxN: number } {
  const es = s.pts.map((p) => p.e), ns = s.pts.map((p) => p.n);
  return { minE: Math.min(...es), maxE: Math.max(...es), minN: Math.min(...ns), maxN: Math.max(...ns) };
}
