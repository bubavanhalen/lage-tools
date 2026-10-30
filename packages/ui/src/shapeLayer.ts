/**
 * Flächen- und Linienzeichen auf der Lagekarte (unter den Punktzeichen, im LV95-CRS):
 * - Farbe nach Art (eigen blau, Feind rot, unklar gelb, neutral grün), vermutet gestrichelt,
 * - Muster: Minenfeld «M», verseuchtes Gebiet schraffiert; Linien: Stacheldraht (Schlaufen), Panzergraben (Zähne),
 *   Sperrlinie (Zacken), Kontaktlinie (Bögen), Grenze (Strich-Punkt), Achse (Pfeil),
 * - Beschriftung Kurzname (die Zeit steht am Punktzeichen): Fläche innen oben/unten/seitlich, Linie am Ende/Anfang/
 *   seitlich – jeweils der erste Platz, der weder Zeichen noch andere Beschriftungen überdeckt; ausgeblendet, wenn die
 *   Form am Bildschirm kleiner als der Text ist oder kein Platz frei ist (gewählte Form: immer beschriftet),
 * - klickbar (wählt die Meldung), Lagezeit und Zeitfenster wie die Zeichen (Form erscheint ab Meldungszeit).
 * Das Punktzeichen am Schwerpunkt zeichnet die Lageebene (`situationLayer`) wie jedes andere Zeichen.
 */
import L from "leaflet";
import { eventShape, geometryOf, isLage, liftMap, shapeShortName, shapeStyleOf, zeitBis, zeitCmp, zeitMs, type Area, type EventShape, type LageEvent, type LV95, type RasterSheet, type ShapeStyle } from "@lage/core";
import { escapeHtml, isAnticipated, toLatLng } from "@lage/map";
import { KIND_COLOR, kindOf, kindText, type ItemKind } from "./journalLayer";
import { ensureSchraffur, SCHRAFFUR_FLAECHE_ID } from "./map/schraffur";
import type { LayerFlags } from "./layers";
import { quietShapeOpacity } from "./map/quiet";
import { LAGE_KARTE } from "./colors";
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
  /** MVP 1: ruhige Karte der Grundansicht (ältere 55 % wie die Zeichen, map/quiet.ts); fehlt = Experte */
  quiet?: boolean;
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
  // aufgehoben (Spez. MVP 3, Kap. 3.5): ab der Aufhebung weg, Rückblick davor zeigt die Form; Nicht-Meldungen nie
  const lifts = liftMap(events);
  for (const e of events) {
    if (e.deleted || !zeitBis(e, o.t) || !isLage(e)) continue;
    const lift = lifts.get(e.id);
    if (lift && zeitBis(lift.t, o.t)) continue;
    const selected = e.id === o.selectedId;
    if (o.from && zeitCmp(e, o.from) < 0 && !selected) continue;
    if (geometryOf(e.sym) === "punkt" && (!e.shape || e.shape.auto)) continue;
    if (!(e.side === "blau" ? o.flags.eigene : o.flags.feind)) continue;
    const shape = eventShape(e, ctx);
    if (!shape) continue;
    const kind = kindOf(e);
    const age = (zeitMs(o.t) - zeitMs(e)) / 60000;
    out.push({
      e, shape, style: shapeStyleOf(e.sym), kind, color: KIND_COLOR[kind].line, dashed: isAnticipated(e.sidc, e.status), selected,
      opacity: quietShapeOpacity({ kind, ageMin: age, selected }, { quiet: !!o.quiet, neuMin: recent }),
      label: shapeShortName(e.sym, e.side),
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
    // Unklar-Flächen schraffiert statt gelb gefüllt (MVP 3.5, S11)
    ensureSchraffur(svg, SCHRAFFUR_FLAECHE_ID);
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
  private labels: LabelSlot[] = [];
  private raf = 0;
  /** Zeichen werden neu gesetzt (Stapel, Auffächern, Zeitlabels): Beschriftungen neu platzieren */
  private watch: MutationObserver | null = null;

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
    map.on("moveend", this.schedulePlace, this);
    const pane = map.getPane("markerPane");
    if (pane && typeof MutationObserver !== "undefined") {
      this.watch = new MutationObserver(() => this.schedulePlace());
      this.watch.observe(pane, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    }
    return this;
  }

  override onRemove(map: L.Map): this {
    cancelAnimationFrame(this.raf);
    this.watch?.disconnect();
    this.watch = null;
    map.off("zoomend viewreset", this.redraw, this);
    map.off("moveend", this.schedulePlace, this);
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
        // gewählt: dunkler Rahmen (Auswahl = Tinte, Kap. 5.1)
        if (it.selected) L.polygon(ll, this.base({ color: LAGE_KARTE.ink, weight: 9, opacity: 0.3, fill: false })).addTo(g);
        L.polygon(ll, this.base({ color: "#fff", weight: 5 + w, opacity: 0.75 * op, fill: false })).addTo(g);
        const pattern = it.style === "minen" || it.style === "abc" ? `url(#lt-pat-${it.style}-${it.kind})`
          : it.kind === "unklar" ? `url(#${SCHRAFFUR_FLAECHE_ID})` : undefined;
        hit = L.polygon(ll, this.base({
          color: it.color, weight: 2.2 + w, opacity: op, dashArray: dash, lineJoin: "round",
          fillColor: pattern ?? KIND_COLOR[it.kind].fill, fillOpacity: pattern ? (pattern.includes(SCHRAFFUR_FLAECHE_ID) ? 0.7 : 1) * op : (KIND_COLOR[it.kind].fill === it.color ? 0.12 : 0.2) * op,
          interactive: !!this.o.onClick, bubblingMouseEvents: false, className: "lt-shape",
        })).addTo(g);
      } else {
        if (it.selected) L.polyline(ll, this.base({ color: LAGE_KARTE.ink, weight: 11, opacity: 0.3 })).addTo(g);
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
    this.labels = [];
    for (const it of this.items) {
      const px = (this.disp.get(it) ?? it.shape.pts).map((p) => map.latLngToLayerPoint(toLatLng(p)));
      const back = (p: Px) => map.layerPointToLatLng(p);
      const op = it.opacity;
      const c = it.color;
      if (it.shape.kind === "linie") this.lineDeco(it, px, back);
      // Beschriftung: zuerst unsichtbar am ersten Platz, nach dem Layout der Zeichen den freien Platz wählen
      const cands = labelSpots(it, px);
      if (cands.length) {
        const c0 = cands[0]!;
        const html = `<span class="lt-shape-lbl${it.selected ? " sel" : ""}" style="--c:${c};opacity:${op};--tx:${c0.tx};--ty:${c0.ty};visibility:hidden">${escapeHtml(it.label)}</span>`;
        const marker = L.marker(back(c0.p), { pane: LABEL_PANE, interactive: false, keyboard: false, icon: L.divIcon({ className: "lt-shape-lblwrap", html, iconSize: [0, 0] }) }).addTo(this.deco);
        this.labels.push({ it, marker, cands, px });
      }
    }
    this.schedulePlace();
  }

  private schedulePlace() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.placeLabels());
  }

  /**
   * Beschriftungen setzen: gewählte zuerst, dann die jüngsten. Je Beschriftung der erste Platz, der kein Zeichen, keine
   * NAI-/Raum-Beschriftung und keine schon gesetzte Beschriftung überdeckt; sonst ausblenden (gewählte: erster Platz).
   * Ausblenden auch, wenn die Form am Bildschirm kleiner ist als der Text.
   */
  private placeLabels() {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (!map || !this.labels.length) return;
    const cont = map.getContainer();
    const cr = cont.getBoundingClientRect();
    const rel = (b: DOMRect): Rect => [b.left - cr.left, b.top - cr.top, b.right - cr.left, b.bottom - cr.top];
    // nur um den sichtbaren Ausschnitt (beim Verschieben der Karte wird neu gesetzt)
    const M = 400;
    const obstacles: Rect[] = [];
    /** Gewicht je Hindernis: Zeichen und Beschriftungen schwer, Feldbezeichnungen leicht */
    const weight: number[] = [];
    // Zeichen (mit Zeitlabel/Beschriftung), NAI-/Raum-Beschriftungen und die Feldbezeichnungen des Rasters
    cont.querySelectorAll<Element>(".leaflet-marker-pane .lt-ev:not(.hid), .leaflet-marker-pane .lt-ev:not(.hid) span, .lt-area-lbl span, .lt-cell-t text").forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && b.right > cr.left - M && b.bottom > cr.top - M && b.left < cr.right + M && b.top < cr.bottom + M) {
        obstacles.push(rel(b));
        weight.push(el.tagName.toLowerCase() === "text" ? 1 : 1000);
      }
    });
    const area = (r: Rect) => obstacles.reduce((s, o, i) => s + (weight[i] ?? 1000) * Math.max(0, Math.min(r[2], o[2]) - Math.max(r[0], o[0])) * Math.max(0, Math.min(r[3], o[3]) - Math.max(r[1], o[1])), 0);
    // Feldbezeichnung darf ein wenig überdeckt werden (≤ 30 % des Texts), Zeichen und Beschriftungen nie
    const hit = (r: Rect) => area(r) > 0.3 * (r[2] - r[0]) * (r[3] - r[1]);
    const order = [...this.labels].sort((a, b) => Number(b.it.selected) - Number(a.it.selected) || b.it.e.t.localeCompare(a.it.e.t));
    for (const l of order) {
      const sp = l.marker.getElement()?.querySelector<HTMLElement>(".lt-shape-lbl");
      if (!sp) continue;
      const w = sp.offsetWidth, h = sp.offsetHeight;
      const fits = labelFits(l.it, l.px, w, h);
      let pick: LabelSpot | undefined;
      let rect: Rect | undefined;
      if (fits || l.it.selected) {
        // gewählte Form: notfalls der Platz mit der kleinsten Überdeckung
        let least = Infinity;
        for (const c of l.cands) {
          if (!fits && !c.outside) continue;
          const a = map.layerPointToContainerPoint(c.p);
          const x0 = a.x + frac(c.tx) * w, y0 = a.y + frac(c.ty) * h;
          const r: Rect = [x0 - 2, y0 - 1, x0 + w + 2, y0 + h + 1];
          if (!hit(r)) { pick = c; rect = r; break; }
          const ov = l.it.selected ? area(r) : Infinity;
          if (ov < least) { least = ov; pick = c; rect = r; }
        }
      }
      if (!pick) { sp.style.visibility = "hidden"; sp.style.display = "none"; continue; }
      l.marker.setLatLng(map.layerPointToLatLng(pick.p));
      sp.style.setProperty("--tx", pick.tx);
      sp.style.setProperty("--ty", pick.ty);
      sp.style.display = "";
      sp.style.visibility = "";
      if (rect) { obstacles.push(rect); weight.push(1000); }
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

type Rect = [number, number, number, number];
/** möglicher Platz einer Beschriftung: Ankerpunkt (Ebenen-Pixel) und Verschiebung des Texts; `outside` = ausserhalb der Form */
interface LabelSpot { p: Px; tx: string; ty: string; outside?: boolean }
interface LabelSlot { it: ShapeItem; marker: L.Marker; cands: LabelSpot[]; px: Px[] }
const frac = (t: string) => (t === "0" ? 0 : t === "-100%" ? -1 : t === "-115%" ? -1.15 : -0.5);

const bboxPx = (px: Px[]) => ({
  minX: Math.min(...px.map((p) => p.x)), maxX: Math.max(...px.map((p) => p.x)),
  minY: Math.min(...px.map((p) => p.y)), maxY: Math.max(...px.map((p) => p.y)),
});

/** Plätze der Beschriftung in der Reihenfolge der Wahl. Fläche: innen oben, unten, links, rechts, Mitte; Linie: Ende, Anfang, Mitte seitlich */
export function labelSpots(it: Pick<ShapeItem, "label" | "shape">, px: Px[]): LabelSpot[] {
  if (!it.label || px.length < 2) return [];
  if (it.shape.kind === "flaeche") {
    const { minX, maxX, minY, maxY } = bboxPx(px);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return [
      { p: L.point(cx, minY + 5), tx: "-50%", ty: "0" },
      { p: L.point(cx, maxY - 5), tx: "-50%", ty: "-100%" },
      { p: L.point(minX + 6, cy), tx: "0", ty: "-50%" },
      { p: L.point(maxX - 6, cy), tx: "-100%", ty: "-50%" },
      { p: L.point(cx, cy + 14), tx: "-50%", ty: "0" },
      // nur für die gewählte Form, wenn sie zu klein ist: über bzw. unter der Form
      { p: L.point(cx, minY - 3), tx: "-50%", ty: "-100%", outside: true },
      { p: L.point(cx, maxY + 3), tx: "-50%", ty: "0", outside: true },
      { p: L.point(cx, minY - 24), tx: "-50%", ty: "-100%", outside: true },
      { p: L.point(cx, maxY + 24), tx: "-50%", ty: "0", outside: true },
    ];
  }
  const end = (b: Px, a: Px, d = 10): LabelSpot => {
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const cx = Math.cos(ang), cy = Math.sin(ang);
    return { p: L.point(b.x + cx * d, b.y + cy * d), tx: cx >= 0.3 ? "0" : cx <= -0.3 ? "-100%" : "-50%", ty: cy >= 0.3 ? "0" : cy <= -0.3 ? "-100%" : "-50%", outside: true };
  };
  // Mitte der Linie (Länge), seitlich darüber/darunter
  let total = 0;
  for (let i = 1; i < px.length; i++) total += px[i]!.distanceTo(px[i - 1]!);
  let rest = total / 2, mid = px[0]!;
  for (let i = 1; i < px.length; i++) {
    const l = px[i]!.distanceTo(px[i - 1]!);
    if (rest <= l) { const t = l ? rest / l : 0; mid = L.point(px[i - 1]!.x + (px[i]!.x - px[i - 1]!.x) * t, px[i - 1]!.y + (px[i]!.y - px[i - 1]!.y) * t); break; }
    rest -= l;
  }
  return [
    end(px[px.length - 1]!, px[px.length - 2]!),
    end(px[0]!, px[1]!),
    { p: L.point(mid.x, mid.y - 9), tx: "-50%", ty: "-100%", outside: true },
    { p: L.point(mid.x, mid.y + 9), tx: "-50%", ty: "0", outside: true },
    // weiter weg (dichte Lage um eine kurze Linie)
    end(px[px.length - 1]!, px[px.length - 2]!, 34),
    end(px[0]!, px[1]!, 34),
    { p: L.point(mid.x, mid.y - 30), tx: "-50%", ty: "-100%", outside: true },
    { p: L.point(mid.x, mid.y + 30), tx: "-50%", ty: "0", outside: true },
  ];
}

/** Passt der Text zur Form? Fläche: Text kleiner als die Fläche am Bildschirm; Linie: Text nicht länger als die Linie */
export function labelFits(it: Pick<ShapeItem, "shape">, px: Px[], w: number, h: number): boolean {
  if (px.length < 2) return false;
  if (it.shape.kind === "flaeche") {
    const { minX, maxX, minY, maxY } = bboxPx(px);
    return maxX - minX >= w + 10 && maxY - minY >= h + 10;
  }
  let len = 0;
  for (let i = 1; i < px.length; i++) len += px[i]!.distanceTo(px[i - 1]!);
  return len >= w;
}

function tooltip(it: ShapeItem): string {
  const e = it.e;
  const head = `<div class="lt-tip-h"><span class="lt-kind k-${it.kind}">${escapeHtml(kindText(e))}</span><b class="tnum">${e.t.slice(11, 16)}</b>`
    + `<span class="lt-tip-u">${escapeHtml(shapeShortName(e.sym, e.side))}</span></div>`;
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
