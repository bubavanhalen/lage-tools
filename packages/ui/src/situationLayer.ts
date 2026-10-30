/**
 * Lage auf der Karte zum Zeitpunkt t (wie Lagebild-Prototyp, Spez. 4.4–4.6, mit neuer Darstellung bei Überlagerung):
 * - eigene Elemente am aktuellen Standort (kräftig), Spur gestrichelt mit kleinen Punkten,
 * - Sichtungen (Feind / unklar) bis t: die letzten `recentMin` Minuten kräftig, ältere 45 % blass; optional Zeitfenster,
 * - Zusatz am Zeichen («H04», «2× Det 1»), Zeitlabel «hh:mm» an frischen Zeichen,
 * - Zeichen, die sich auf dem Bildschirm überlappen, bilden einen **Stapel** (bis 3 sichtbar, Zahl-Marke), keine
 *   Führungsstriche; Klick fächert den Stapel im Kreis auf (dünne Linie zum Ort nur dann), Klick daneben/Esc/Zoom klappt zu,
 * - Zeichen verschieben: Maus nur das gewählte Zeichen ziehen (ab 4 px; Ziehen auf anderen Zeichen schiebt die Karte),
 *   Finger/Stift langes Drücken (350 ms) hebt das Zeichen an → ziehen; während des Ziehens kein Neuaufbau (`whenNotDragging`),
 * - Tastatur: Tab erreicht Stapel und Zeichen, Enter fächert auf bzw. wählt, Esc klappt zu,
 * - gewählte Meldung: grösser, 2 px Tinte-Ring mit weissem Halo, Planquadrat mit Tinte 8 % hinterlegt (nicht rot),
 *   Linie Melder → Sichtung, ihr Stapel offen,
 * - MVP 1 ruhige Karte (`quiet`, Grundansicht): Beschriftungsregel aus map/quiet.ts – ältere Feind/Unklar 55 % ohne
 *   Fähnchen und Zusatz, eigene Trupps immer mit Namen; Stapel-Zahl bleibt kräftig.
 * - MVP 3.5 (K3, Variante V4 der Symbolstudie, Spez. 3.2 B1–B6): Grundmass je Massstab und Stufe S/M/L bzw.
 *   Präsentation (`map/symbolSize.ts`), Linie/Halo 7/8, Nacht-Rand schwarz; Neuaufbau der Zeichen nur beim Wechsel der
 *   Grössenklasse (Messpunkte `lt:zeichen:start|ende`); ältere 72 % und entsättigt; Feind-PQ 0.22/0.4, Unklar-PQ
 *   schraffiert; bisherige Wege punktiert; Stapelmarke als Element `.lt-stk` (nur Zahl); Tipp neben Zeichen trifft im
 *   Radius 24/16 px, bei ≥ 2 verschiedenen Zeichen Auswahlliste (`map/pick.ts`, `map/Auswahlliste.tsx`).
 */
import L from "leaflet";
import {
  buildStacks, catalogEntry, cellAtAny, cellBounds, fanLayout, findCells, lastPosition, mirrorBox, peekOffset, positionSource,
  type Box, type LageEvent, type LV95, type RasterSheet, type Stack,
} from "@lage/core";
import { escapeHtml, iconSvg, symbolSvg, toLatLng, toLv95 } from "@lage/map";
import { ohneAufgehobene } from "./aufgehoben";
import { KIND_COLOR, kindText, MAP_INK, SIDE_COLOR, situationModel, type SituationItem } from "./journalLayer";
import { isLocked, subscribeLock, type LayerFlags } from "./layers";
import { clickSuppressed, longPress, suppressClick, suppressContextMenu } from "./longpress";
import { dayLabel } from "./Timeline";
import { quietLook } from "./map/quiet";
import { beschriftungPx, mPerPxOf, symbolGrundmass, symbolKlasse, ZEICHEN_STRICH } from "./map/symbolSize";
import { pickAt, pickAktion, istGrob, trefferRadius, type PickTreffer, type PickZiel } from "./map/pick";
import { auswahlOffen, schliesseAuswahl, zeigeAuswahl, type AuswahlZeile } from "./map/Auswahlliste";
import { ensureSchraffur, SCHRAFFUR_ID } from "./map/schraffur";
import { ZEICHEN, PQ_FLAECHE } from "@lage/core";
import { LAGE_KARTE } from "./colors";
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
  /** Anfang des Zeitfensters (ISO lokal); Sichtungen/Ereignisse davor ausgeblendet, Elemente bleiben */
  from?: string | null;
  /** Zeichen auf der Karte verschoben: neuer Ort der Meldung (ohne Angabe kein Verschieben) */
  onMove?: (e: LageEvent, pos: LV95) => void;
  /** Meldungen eines gewählten Hinweises: Zeichen erhalten die Klasse `hl` (übrige blass, siehe hints.css) */
  highlight?: ReadonlySet<string> | null;
  /** MVP 1: ruhige Karte der Grundansicht (Beschriftungsregel Kap. 3.7); false/fehlt = Experte (wie bisher) */
  quiet?: boolean;
  /**
   * (MVP 3.5, K3 – Phase 0 verdrahtet, Paket B nutzt es) Zeichengrösse: Stufe S/M/L pro Gerät, Präsentation
   * (`symbolGrundmass`, map/symbolSize.ts). Fehlt → wie bisher.
   */
  groesse?: import("./shell/contracts").ZeichenGroesse;
  /** (MVP 3.5) Nacht: Rand der Zeichen `KARTE.haloNacht` (schwarz) statt weiss – Paket B */
  nacht?: boolean;
}

/** geparste Zeichen-SVG je Gestalt (Text → Element), geklont statt neu geparst */
const svgParsed = new Map<string, Element>();
function svgClone(svg: string): Node {
  let n = svgParsed.get(svg);
  if (!n) {
    const t = document.createElement("template");
    t.innerHTML = svg;
    n = t.content.firstElementChild ?? document.createElement("span");
    if (svgParsed.size > 500) svgParsed.clear();
    svgParsed.set(svg, n);
  }
  return n.cloneNode(true);
}
interface MarkerParts {
  svg: string;
  ud: { text: string; x: number; top: number } | null;
  /** Zeit-Fähnchen; `opt` = nur im aufgefächerten Stapel (wird erst dann als Element angelegt, `place`) */
  time: { text: string; x: number; opt: boolean } | null;
  /** Grundmass in px ohne «gewählt» (Testhaken `data-groesse`) */
  groesse: number;
}
/**
 * Icon eines Lage-Zeichens: SVG, Zusatz («H04», «2× Det 1»), Zeit-Fähnchen – gleiche Struktur wie früher als HTML-Text
 * (`.lt-ev > svg`, `> .lt-ud`, `> .lt-tl`), aber als DOM gebaut (SVG geklont statt geparst).
 */
class LageIcon extends L.DivIcon {
  constructor(opts: L.DivIconOptions, private parts: MarkerParts) { super(opts); }
  override createIcon(old?: HTMLElement): HTMLElement {
    const div = old && old.tagName === "DIV" ? old : document.createElement("div");
    div.textContent = "";
    const { svg, ud, time, groesse } = this.parts;
    div.dataset.groesse = String(groesse);
    div.appendChild(svgClone(svg));
    if (ud) {
      const sp = document.createElement("span");
      sp.className = "lt-ud";
      sp.style.setProperty("--x", `${ud.x}px`);
      sp.style.top = `${ud.top}px`;
      sp.textContent = ud.text;
      div.appendChild(sp);
    }
    if (time && !time.opt) div.appendChild(timeSpan(time));
    (this as unknown as { _setIconStyles(el: HTMLElement, name: string): void })._setIconStyles(div, "icon");
    return div;
  }
}

function timeSpan(time: { text: string; x: number; opt: boolean }): HTMLSpanElement {
  const sp = document.createElement("span");
  sp.className = time.opt ? "lt-tl opt" : "lt-tl";
  sp.style.setProperty("--x", `${time.x}px`);
  sp.textContent = time.text;
  return sp;
}

/** LatLng je Ort-Objekt der Meldung (gleiche Meldung → gleiches Objekt → Projektion aus dem Zwischenspeicher, swissmap.ts) */
const llCache = new WeakMap<LV95, { e: number; n: number; ll: L.LatLng }>();
function latLngOf(p: LV95): L.LatLng {
  const c = llCache.get(p);
  if (c && c.e === p.e && c.n === p.n) return c.ll;
  const ll = toLatLng(p);
  llCache.set(p, { e: p.e, n: p.n, ll });
  return ll;
}

/** ohne Angabe `groesse` (wie bis MVP 3): feste Grösse */
const SIZE = 18;
const SIZE_SEL = 24;
/** Maus: ab so vielen Pixeln Bewegung wird aus dem Klick ein Verschieben */
const DRAG_PX = 4;
/** Finger/Stift: so lange drücken, bis sich das Zeichen anhebt */
const LIFT_MS = 350;
/** angehobenes Zeichen über dem Finger zeigen (sonst verdeckt der Finger das Zeichen) */
const TOUCH_LIFT_Y = -26;

// ---------- Layout-Info für die Legende (Stapel vorhanden?)
let layoutInfo = { stacks: 0 };
const subs = new Set<() => void>();
export const subscribeSituationLayout = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export const getSituationLayout = () => layoutInfo;
function publish(stacks: number) {
  if (stacks === layoutInfo.stacks) return;
  layoutInfo = { stacks };
  subs.forEach((cb) => cb());
}

// ---------- Zustand pro Karte (überlebt das Neuzeichnen der Ebene bei jeder Änderung)
interface Ctl {
  map: L.Map;
  /** Meldung, deren Stapel aufgefächert ist */
  openFor: string | null;
  /** bis dann schliesst ein Zoom den Stapel nicht (Flug zur eben gewählten Meldung) */
  stickyUntil: number;
  lastSel: string | null | undefined;
  layer: SituationLayer | null;
  /** Zeiger auf einem Zeichen gedrückt seit (ms, 0 = nicht): Neuaufbau ebenfalls aufschieben */
  pressing: number;
  /** während des Ziehens aufgeschobener Neuaufbau (der jüngste gewinnt) */
  pending: (() => void) | null;
  /** zuletzt mit der Tastatur fokussiertes Zeichen (Meldung), Fokus überlebt den Neuaufbau */
  focusId: string | null;
}
const ctls = new WeakMap<L.Map, Ctl>();
function ctlOf(map: L.Map): Ctl {
  const have = ctls.get(map);
  if (have) return have;
  const c: Ctl = { map, openFor: null, stickyUntil: 0, lastSel: undefined, layer: null, pressing: 0, pending: null, focusId: null };
  ctls.set(map, c);
  // Klick/Tipp auf die Karte neben ein Zeichen: Treffer im Radius (S12), sonst wie bisher (offenen Stapel zuklappen)
  map.on("click", (e: L.LeafletMouseEvent) => { if (c.layer?.mapClick(e)) return; if (c.openFor) setOpen(c, null); });
  map.on("zoomstart", () => { if (c.openFor && Date.now() > c.stickyUntil) c.openFor = null; });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !c.layer?.fanOpen()) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    e.stopPropagation(); // erst den Stapel schliessen, die Auswahl bleibt (zweites Esc)
    const inFan = t?.closest?.(".lt-ev.fan");
    setOpen(c, null);
    if (inFan) c.layer?.focusStackOf(c.focusId);
  }, true);
  return c;
}

/** Wird gerade ein Zeichen gezogen (oder ist der Zeiger auf einem Zeichen gedrückt)? */
export function isDragging(map: L.Map): boolean {
  const c = ctls.get(map);
  // gedrückt höchstens 10 s berücksichtigen (falls ein «Loslassen» verloren geht)
  return !!c && ((c.pressing > 0 && Date.now() - c.pressing < 10000) || !!c.layer?.dragging());
}

/**
 * Lageebene neu aufbauen – ausser während ein Zeichen gezogen wird (Live-Takt, Abgleich, Abspielen, Zeitfenster
 * würden das Ziehen sonst abbrechen): dann nach dem Loslassen nachholen (nur der jüngste Aufbau zählt).
 */
export function whenNotDragging(map: L.Map, rebuild: () => void): void {
  const c = ctlOf(map);
  if (isDragging(map)) { c.pending = rebuild; return; }
  c.pending = null;
  rebuild();
}
/** aufgeschobenen Neuaufbau ausführen (true = es gab einen) */
function flushPending(c: Ctl): boolean {
  const f = c.pending;
  c.pending = null;
  if (!f) return false;
  f();
  return true;
}
/** Stapel öffnen/schliessen, kurz animiert (≤ 180 ms; prefers-reduced-motion schaltet Übergänge ab) */
function setOpen(c: Ctl, id: string | null) {
  c.openFor = id;
  const el = c.map.getContainer();
  el.classList.add("lt-fanmove");
  window.setTimeout(() => el.classList.remove("lt-fanmove"), 200);
  c.layer?.relayout();
}

interface Placed {
  it: SituationItem;
  /** Index in `placed` */
  idx: number;
  /** wahrer Ort */
  ll: L.LatLng;
  marker: L.Marker;
  core: Box;
  /** Rahmen samt Beschriftung, wie im Normalzustand gezeigt */
  box: Box;
  /** Rahmen samt Beschriftung im aufgefächerten Zustand (immer mit Zeit) */
  boxFan: Box;
  /** Zeichen neben dem wahren Ort (Hindernis an der Strasse): Versatz in Bildschirmpixeln */
  offset?: [number, number];
  /** Rang im Stapel (0 = wichtigstes) und Reihenfolge beim Auffächern (ohne Auswahl, damit nichts springt) */
  rank: number;
  fanRank: number;
  z: number;
  parts: MarkerParts;
}

/** Sammlung der Strassen-Hindernisse: je Gestaltung ein Pfad */
interface RoadOut {
  groups: Map<string, { z: number; o: L.PolylineOptions; lines: L.LatLng[][] }>;
  circles: L.CircleMarker[];
}

interface Drag {
  p: Placed;
  pointerId: number;
  touch: boolean;
  /** Abstand Zeiger ↔ Anker (Containerpixel) */
  grab: L.Point;
  start: L.Point;
  moved: boolean;
  tip: HTMLDivElement;
  ghost: L.LayerGroup;
  dragWasOn: boolean;
  off: () => void;
}

class SituationLayer extends L.LayerGroup {
  private placed: Placed[] = [];
  private byEl = new WeakMap<Element, Placed>();
  private roadMarks = L.layerGroup();
  private fanLines = L.layerGroup();
  private roadItems: SituationItem[] = [];
  private stacks: Stack[] = [];
  private stackIdx: number[] = [];
  private openStack = -1;
  /** Massstab, mit dem die Strassen-Hindernisse zuletzt gezeichnet wurden */
  private roadK = 0;
  /** Seite der Zacken je Hindernis (hängt nicht vom Zoom ab) */
  private roadSide = new Map<SituationItem, number>();
  private drag: Drag | null = null;
  private unbind: Array<() => void> = [];
  private ctl: Ctl;
  private hoverNone = typeof matchMedia === "function" && matchMedia("(hover: none)").matches;
  /** Grössenklasse (Spalte der Tabelle 3.2.1), mit der die Zeichen gebaut sind; -1 = ohne `groesse` (fest) */
  private klasse = -1;
  /** Grundmass und Grösse der gewählten Meldung in px */
  private base = SIZE;
  private selSize = SIZE_SEL;
  /** Zeichen samt Beschriftung (Layer-Pixel) für das Ausweichen der Flächenbeschriftung */
  private rects: Rects = [];

  constructor(map: L.Map, private events: LageEvent[], private o: SituationOptions) {
    super();
    this.ctl = ctlOf(map);
    this.setSizes(mPerPxOf(map));
    // Auswahl geändert (Liste, Suche, Karte): ihr Stapel öffnet sich (auch nach dem Flug dorthin)
    if (this.ctl.lastSel !== o.selectedId) {
      if (this.ctl.lastSel !== undefined || o.selectedId) {
        this.ctl.openFor = o.selectedId;
        this.ctl.stickyUntil = Date.now() + 1500;
      }
      this.ctl.lastSel = o.selectedId;
    }
    this.build();
  }

  override onAdd(map: L.Map): this {
    const t0 = performance.now();
    super.onAdd(map);
    this.ctl.layer = this;
    for (const p of this.placed) { const el = p.marker.getElement(); if (el) this.byEl.set(el, p); }
    this.bindPointer(map);
    this.unbind.push(subscribeLock(() => this.layout()));
    // Schraffur der Unklar-Planquadrate in der SVG der Vektorebene (einmal je SVG)
    ensureSchraffur(map.getPanes().overlayPane.querySelector("svg"));
    this.layout();
    map.on("zoomend viewreset", this.onZoomEnd, this);
    map.on("moveend", this.onMoveEnd, this);
    // Tastatur: Fokus nach dem Neuaufbau (z. B. Auswahl mit Enter) auf dasselbe Zeichen zurück
    const fid = this.ctl.focusId;
    const ae = document.activeElement;
    if (fid && (!ae || ae === document.body || !ae.isConnected)) this.focusEvent(fid);
    try { performance.measure("Lage: Einfügen", { start: t0 }); } catch { /* ältere Browser */ }
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off("zoomend viewreset", this.onZoomEnd, this);
    map.off("moveend", this.onMoveEnd, this);
    schliesseAuswahl(map);
    this.endDrag(false, true);
    this.unbind.forEach((f) => f());
    this.unbind = [];
    if (this.ctl.layer === this) this.ctl.layer = null;
    map.getContainer().classList.remove("lt-fanopen");
    publish(0);
    return super.onRemove(map);
  }

  relayout(): void { this.layout(); }

  /** Grösse aus Massstab und Einstellung (V4); ohne `groesse` fest 18/24 px wie bisher */
  private setSizes(mPerPx: number): void {
    const g = this.o.groesse;
    if (!g) { this.klasse = -1; this.base = SIZE; this.selSize = SIZE_SEL; return; }
    this.klasse = symbolKlasse(mPerPx);
    this.base = symbolGrundmass(mPerPx, g);
    this.selSize = this.base + ZEICHEN.gewaehlt;
  }

  /** nach dem Verschieben: Lineal und Randbeschriftung stehen anders – Flächenbeschriftung neu setzen */
  private onMoveEnd(): void { if (this._map) avoidAreaLabelsSoon(this._map, this.rects); }

  /** Zeichen, Beschriftung und Rahmen einer Meldung in der aktuellen Grösse */
  private graphic(it: SituationItem): { parts: MarkerParts; core: Box; box: Box; boxFan: Box; anchor: [number, number]; w: number; h: number } {
    const g = this.o.groesse;
    const size = it.selected ? this.selSize : this.base;
    const outline = this.o.nacht ? LAGE_KARTE.haloNacht : undefined;
    const s = g
      ? symbolSvg(it.sym, it.aff, size, { dir: it.e.dir, sidc: it.sidc, status: it.status }, outline, ZEICHEN_STRICH)
      : symbolSvg(it.sym, it.aff, size, { dir: it.e.dir, sidc: it.sidc, status: it.status });
    const [ax, ay] = s.anchor;
    // Beschriftung: 12 px (Präsentation 16 px), Plex Mono ≈ 0.6 em je Zeichen; Abstand zum Zeichen wächst mit dem Grundmass
    const fs = g ? beschriftungPx(g) : 12;
    const cw = fs * 0.6;
    const gap = g ? Math.max(2, Math.round(this.base / 12)) : 2;
    const timeW = Math.ceil(5 * cw + 10), timeH = Math.round(fs * 1.17) + 2;
    const udW = it.ud ? Math.ceil(it.ud.length * cw) + 6 : 0;
    const core: Box = [-ax, -ay, s.w - ax, s.h - ay];
    const boxWith = (time: boolean): Box => [-ax - 2, -ay - 2 - (time ? timeH : 0), s.w - ax + gap + Math.max(udW, time ? timeW : 0), s.h - ay + 2];
    const showTimes = this.o.flags.zeiten;
    const parts: MarkerParts = {
      svg: s.svg, groesse: this.base,
      ud: it.ud ? { text: it.ud, x: s.w + gap, top: Math.max(0, Math.round(ay - fs * 0.6)) } : null,
      time: showTimes ? { text: it.e.t.slice(11, 16), x: s.w + gap, opt: !it.showTime } : null,
    };
    return { parts, core, box: boxWith(it.showTime), boxFan: boxWith(showTimes), anchor: [ax, ay], w: s.w, h: s.h };
  }

  private iconFor(it: SituationItem, gr: ReturnType<SituationLayer["graphic"]>, cls: string): LageIcon {
    return new LageIcon({ className: cls, iconSize: [gr.w, gr.h], iconAnchor: gr.anchor }, gr.parts);
  }

  /**
   * Massstab geändert: wechselt die Grössenklasse, die Zeichen in der neuen Grösse aufbauen (an Ort und Stelle: das
   * Element bleibt, damit Fokus, Tastatur und Zeiger-Bindungen erhalten bleiben), sonst nichts. Danach Stapel neu.
   */
  private onZoomEnd(): void {
    const map = this._map;
    if (!map) return;
    const mpp = mPerPxOf(map);
    if (this.o.groesse && symbolKlasse(mpp) !== this.klasse && !this.drag) {
      const t0 = performance.now();
      performance.mark("lt:zeichen:start");
      this.setSizes(mpp);
      for (const p of this.placed) {
        const gr = this.graphic(p.it);
        p.core = gr.core; p.box = gr.box; p.boxFan = gr.boxFan; p.parts = gr.parts;
        p.offset = p.it.road ? roadOffset(p.it, gr.core) : undefined;
        const icon = this.iconFor(p.it, gr, p.marker.options.icon!.options.className ?? "lt-ev");
        p.marker.options.icon = icon;
        const el = p.marker.getElement();
        if (el) { const cls = el.className; icon.createIcon(el); el.className = cls; el.classList.remove("stacktop"); }
        const tt = p.marker.getTooltip();
        if (tt) tt.options.offset = L.point(0, -gr.anchor[1] - 2);
      }
      this.layout();
      performance.mark("lt:zeichen:ende");
      try { performance.measure("lt:zeichen", "lt:zeichen:start", "lt:zeichen:ende"); } catch { /* ältere Browser */ }
      zeichenMessung(performance.now() - t0);
      return;
    }
    this.layout();
  }
  fanOpen(): boolean { return this.openStack >= 0; }
  dragging(): boolean { return !!this.drag; }

  /** Zeichen der Meldung `id` fokussieren (sichtbares Zeichen bzw. oberstes seines Stapels) */
  private focusEvent(id: string): boolean {
    const p = this.placed.find((x) => x.it.e.id === id);
    if (!p) return false;
    const s = this.stackOf(p);
    const q = s && s.si !== this.openStack ? this.placed[s.st.members[0]!]! : p;
    const el = q.marker.getElement();
    if (!el) return false;
    el.focus({ preventScroll: true });
    return true;
  }
  /** nach dem Zuklappen: Fokus auf das oberste Zeichen des Stapels */
  focusStackOf(id: string | null): void { if (id) this.focusEvent(id); }

  private build() {
    const t0 = performance.now();
    try { this.buildItems(); } finally {
      try { performance.measure("Lage: Aufbau", { start: t0 }); } catch { /* ältere Browser */ }
    }
  }

  private buildItems() {
    const o = this.o;
    const model = situationModel(ohneAufgehobene(this.events, o.t), o.t, o.flags, { recentMin: o.recentMin, selectedId: o.selectedId, from: o.from });
    // Beschriftungs- und Deckkraftregel (Grundansicht ruhig, Experte wie bisher)
    for (const it of model.items) {
      const q = quietLook(it, { quiet: !!o.quiet, zeiten: o.flags.zeiten, neuMin: o.recentMin });
      it.opacity = q.opacity;
      it.showTime = q.showTime;
      if (!q.showUd) it.ud = "";
    }
    const selected = model.items.find((i) => i.selected);

    // Planquadrate der Sichtungen (MVP 3.5, S11): Feind Füllung 0.22, Rahmen 0.4; Unklar schraffiert (Muster
    // `lt-schraffur-unklar`, kein Gelb), Rahmen 0.4; ältere blass. Je Planquadrat und Art nur die kräftigste Fassung,
    // je Art/Deckkraft eine Fläche; die kräftigen zuerst (Testhaken liest die erste Fläche).
    const cellOp = new Map<string, { kind: SituationItem["kind"]; label: string; o: number }>();
    for (const it of model.items) {
      if (it.kind === "eigen" || it.selected || !it.e.cells?.length) continue;
      // Flächen und Linien zeichnen ihre Form selbst – keine zusätzliche Planquadrat-Füllung
      const geo = catalogEntry(it.sym)?.geometry;
      if (geo && geo !== "punkt") continue;
      for (const label of it.e.cells) {
        const k = `${it.kind}|${label}`;
        const have = cellOp.get(k);
        if (!have || have.o < it.opacity) cellOp.set(k, { kind: it.kind, label, o: it.opacity });
      }
    }
    const fills = new Map<string, { kind: SituationItem["kind"]; o: number; rings: L.LatLng[][][] }>();
    for (const c of cellOp.values()) {
      const ring = cellRing(c.label, o.sheets);
      if (!ring) continue;
      const key = `${c.kind}|${c.o}`;
      const f = fills.get(key) ?? { kind: c.kind, o: c.o, rings: [] };
      fills.set(key, f);
      f.rings.push([ring]);
    }
    for (const f of [...fills.values()].sort((a, b) => b.o - a.o)) {
      const c = KIND_COLOR[f.kind];
      const unklar = f.kind === "unklar";
      L.polygon(f.rings, {
        color: c.line, weight: 1.2, opacity: PQ_FLAECHE.rahmen * f.o, interactive: false,
        fillColor: unklar ? `url(#${SCHRAFFUR_ID})` : c.fill, fillOpacity: (unklar ? 0.6 : PQ_FLAECHE.feindFuellung) * f.o,
        className: (unklar ? "lt-pq lt-pq-unklar" : "lt-pq") + (f.o < 1 ? " old" : ""),
      }).addTo(this);
    }

    // gewählte Meldung: Planquadrat(e) mit Tinte 8 % hinterlegt, Rand Tinte mit weissem Saum (inkl. Unterquadrant)
    if (selected) {
      for (const label of selected.e.cells ?? []) {
        const ring = cellRing(label, o.sheets);
        if (ring) {
          L.polygon(ring, { color: LAGE_KARTE.halo, weight: 5, opacity: 0.85, fill: false, interactive: false }).addTo(this);
          L.polygon(ring, { color: LAGE_KARTE.ink, weight: 2, opacity: 1, fillColor: LAGE_KARTE.ink, fillOpacity: 0.08, interactive: false, className: "lt-selcell" }).addTo(this);
        }
      }
    }

    // Spuren der Elemente (MVP 3.5, S13): punktiert «1 6» mit runden Enden – gestrichelt heisst nur «vermutet»;
    // weisse Punkte als Halo darunter, kleine Ringe an früheren Standorten
    for (const tr of model.tracks) {
      const col = SIDE_COLOR[tr.side];
      const ll = tr.pts.map(toLatLng);
      L.polyline(ll, { color: LAGE_KARTE.halo, weight: 5.5, opacity: 0.85, dashArray: "1 6", lineCap: "round", interactive: false, className: "lt-weg" }).addTo(this);
      L.polyline(ll, { color: col, weight: 3, opacity: 0.95, dashArray: "1 6", lineCap: "round", interactive: false, className: "lt-weg" }).addTo(this);
      for (const p of ll.slice(0, -1)) L.circleMarker(p, { radius: 2.5, color: col, weight: 1.5, fillColor: LAGE_KARTE.halo, fillOpacity: 1, opacity: 0.9, interactive: false }).addTo(this);
    }

    // Sichtung: feine Linie vom Melder zur Sichtung (durchgezogen – gestrichelt heisst nur «vermutet»)
    if (selected && selected.kind !== "eigen" && selected.e.melder) {
      const from = lastPosition(this.events, "blau", selected.e.melder, selected.e.t);
      if (from && (Math.abs(from.e - selected.pos.e) > 1 || Math.abs(from.n - selected.pos.n) > 1)) {
        const ll = [toLatLng(from), toLatLng(selected.pos)];
        L.polyline(ll, { color: "#fff", weight: 4, opacity: 0.8, interactive: false }).addTo(this);
        L.polyline(ll, { color: SIDE_COLOR.blau, weight: 1.5, opacity: 0.95, interactive: false }).addTo(this);
        L.circleMarker(ll[0]!, { radius: 3, color: "#fff", weight: 1.5, fillColor: SIDE_COLOR.blau, fillOpacity: 1, interactive: false }).addTo(this);
      }
    }

    // Hindernisse / Zeichen quer zur Strasse (im Gelände; bei jedem Zoom neu, damit sie nie zu klein werden)
    for (const it of model.items) if (it.road) this.roadItems.push(it);
    this.roadMarks.addTo(this);
    this.fanLines.addTo(this);

    // Rang im Stapel: gewählt > frisch > Feind/unklar > Element > neuer
    const kindRank = { feind: 3, unklar: 3, neutral: 2, ul: 1, eigen: 0 } as const;
    const cmp = (withSel: boolean) => (a: SituationItem, b: SituationItem) =>
      (withSel ? Number(b.selected) - Number(a.selected) : 0) || Number(b.fresh) - Number(a.fresh) || kindRank[b.kind] - kindRank[a.kind]
      || Number(b.isUnit) - Number(a.isUnit) || b.e.t.localeCompare(a.e.t) || a.e.id.localeCompare(b.e.id);
    const rankOf = new Map([...model.items].sort(cmp(true)).map((it, i) => [it, i]));
    const fanOf = new Map([...model.items].sort(cmp(false)).map((it, i) => [it, i]));

    for (const it of [...model.items].sort((a, b) => rankOf.get(b)! - rankOf.get(a)!)) {
      const gr = this.graphic(it);
      const { core } = gr;
      const ay = gr.anchor[1];
      const cls = ["lt-ev", `k-${it.kind}`, it.selected ? "sel" : "", it.opacity < 1 ? "old" : "", it.opacity < 1 && o.quiet ? "q" : "", o.highlight?.has(it.e.id) ? "hl" : ""].filter(Boolean).join(" ");
      // Inhalt als Element statt HTML-Text: das Zeichen-SVG wird pro Gestalt einmal geparst und dann geklont
      // (800 Meldungen: Parsen war der grösste Teil des Neuaufbaus)
      const ll = latLngOf(it.pos);
      const z = it.selected ? 1000 : (it.fresh ? 200 : 0) + (it.kind !== "eigen" ? 100 : 0);
      const marker = L.marker(ll, {
        icon: this.iconFor(it, gr, cls),
        // ältere blass über CSS (.old), damit die Zahl-Marke eines Stapels kräftig bleibt
        zIndexOffset: z,
        keyboard: false,
      });
      const p: Placed = {
        it, idx: this.placed.length, ll, marker, core, box: gr.box, boxFan: gr.boxFan, rank: rankOf.get(it)!, fanRank: fanOf.get(it)!, z,
        offset: it.road ? roadOffset(it, core) : undefined, parts: gr.parts,
      };
      // Hinweis: Einzelzeichen = Meldung; Stapel = kurze Liste (gewählte Meldung: Band zeigt dasselbe)
      marker.bindTooltip(() => this.tooltipFor(p), { direction: "top", offset: [0, -ay - 2], className: "lt-tip", opacity: 1 });
      // gewählte Meldung: das Band zeigt dasselbe – nur der Hinweis zum Ziehen (Maus), sonst kein Tooltip
      marker.on("tooltipopen", () => { if (this.drag || auswahlOffen(this.ctl.map) || (it.selected && !this.isClosedStack(p) && (this.hoverNone || !this.canDrag()))) marker.closeTooltip(); });
      marker.on("click", () => { marker.closeTooltip(); if (!clickSuppressed()) this.activate(p); });
      marker.addTo(this);
      this.placed.push(p);
    }
  }

  /**
   * Klick/Tipp auf die Karte (nicht auf ein Zeichen): Zeichen im Trefferradius suchen (Spez. MVP 3.5, S12) – eines →
   * wählen bzw. Stapel auffächern, ≥ 2 verschiedene → Auswahlliste. Nicht beim Ziehen, Messen, Zeichnen, «Ort setzen».
   * @returns true, wenn der Klick ein Zeichen getroffen hat
   */
  mapClick(e: L.LeafletMouseEvent): boolean {
    const hits = this.treffer(e.containerPoint);
    if (!hits.length) return false;
    // Flächen (NAI) unter dem Tipp: ihr eigener Klick entfällt (areasLayer, packages/map/src/tools.ts)
    if (e.originalEvent) (e.originalEvent as MouseEvent & { __ltGetroffen?: boolean }).__ltGetroffen = true;
    if (pickAktion(hits.length) === "waehlen") { this.activate(hits[0]!.data!); return true; }
    this.zeigeListe(hits, e.containerPoint);
    return true;
  }

  /** Kandidaten im Trefferradius um einen Containerpunkt (leer, wenn ein Werkzeug läuft oder gezogen wird) */
  private treffer(cp: L.Point): Array<PickTreffer<Placed>> {
    const map = this._map;
    if (!map || this.drag || clickSuppressed()) return [];
    const cl = map.getContainer().classList;
    if (cl.contains("lt-picking") || cl.contains("lt-drawing") || cl.contains("lt-measuring")) return [];
    const ziele: Array<PickZiel<Placed>> = this.placed.map((p) => {
      const el = p.marker.getElement();
      const pt = map.latLngToContainerPoint(p.marker.getLatLng());
      const st = this.stackOf(p);
      const closed = !!st && st.st.members.length > 1 && st.si !== this.openStack;
      return {
        id: p.it.e.id, x: pt.x, y: pt.y, data: p,
        stapel: closed ? st!.si : -1,
        oben: !closed || st!.st.members[0] === p.idx,
        verdeckt: !el || el.classList.contains("hid") || el.classList.contains("under"),
      };
    });
    const r = trefferRadius(istGrob());
    const hits = pickAt(cp, r, ziele);
    // Testhaken (nur lesen): letzter Treffer auf der Karte
    (window as unknown as { __ltPick?: unknown }).__ltPick = { x: Math.round(cp.x), y: Math.round(cp.y), r, was: pickAktion(hits.length), ids: hits.map((h) => h.id) };
    return hits;
  }

  private zeigeListe(hits: Array<PickTreffer<Placed>>, cp: L.Point): void {
    const map = this._map;
    if (!map) return;
    const zeilen: AuswahlZeile[] = hits.map((h) => this.auswahlZeile(h.data!, h.dist));
    const byId = new Map(hits.map((h) => [h.id, h.data!]));
    const stack = hits.find((h) => h.stapel >= 0)?.data;
    for (const p of this.placed) p.marker.closeTooltip();
    zeigeAuswahl(map, cp, zeilen, (id) => { const p = byId.get(id); if (p) this.activate(p); },
      () => { if (stack) this.activate(stack); else map.setZoomAround(cp, map.getZoom() + 1); });
  }

  /**
   * Finger/Stift: Der Browser verschiebt einen Tipp auf das nächste antippbare Element (Chromium «touch adjustment») –
   * liegen zwei verschiedene Zeichen nahe, gewänne still das nächste. Deshalb hier mit dem **ungerückten** Punkt:
   * liegt er nicht direkt auf einem Zeichen und gibt es ≥ 2 Kandidaten, erscheint die Auswahlliste und der folgende
   * (verschobene) Klick entfällt. Ein Kandidat oder keiner: wie gewohnt über den Klick.
   */
  private tippOhneVersatz(e: PointerEvent, down: { x: number; y: number; ab: number }): void {
    const map = this._map;
    if (!map || this.drag) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || Date.now() - down.ab > LIFT_MS) return;
    const cont = map.getContainer();
    const unter = document.elementFromPoint(e.clientX, e.clientY);
    if (!unter || !cont.contains(unter) || unter.closest(".lt-ev, .leaflet-control-container, .lt-pick-host")) return;
    const cp = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
    const hits = this.treffer(cp);
    if (pickAktion(hits.length) !== "liste") return;
    suppressClick();
    this.zeigeListe(hits, cp);
  }

  /** Zeile der Auswahlliste: «2× Kpz · 07:12 · von H05» bzw. «H05 · seit 03:30 · AQ11 C»; Stapel «3 Zeichen übereinander» */
  private auswahlZeile(p: Placed, dist: number): AuswahlZeile {
    const it = p.it, e = it.e;
    const st = this.stackOf(p);
    const n = st && st.si !== this.openStack ? st.st.members.length : 1;
    const base = { id: e.id, kind: it.kind, dist, sym: it.sym, aff: it.aff, sidc: it.sidc, status: it.status, zeit: e.t.slice(11, 16) };
    if (n > 1) return { ...base, label: `${n} Zeichen übereinander`, extra: `oben: ${[e.desc || it.name, e.unit].filter(Boolean).join(" ")}` };
    if (it.kind === "eigen") return { ...base, label: e.unit || e.melder || it.name, zeit: `seit ${e.t.slice(11, 16)}`, extra: e.cells?.[0] ?? e.where };
    const desc = e.desc || it.name;
    // Anzahl «2×» vor dem Namen – ausser die Beschreibung beginnt schon mit der Zahl («4 Personen»)
    const was = [e.count && e.count > 1 && !/^\d/.test(desc) ? `${e.count}×` : "", desc, e.unit && !desc.includes(e.unit) ? e.unit : ""].filter(Boolean).join(" ");
    return { ...base, label: was, extra: [e.melder ? `von ${e.melder}` : "", e.cells?.[0] ?? ""].filter(Boolean).join(" · ") || undefined };
  }

  /** Klick/Tippen/Enter auf ein Zeichen: geschlossener Stapel → auffächern, sonst Meldung wählen */
  private activate(p: Placed, byKey = false) {
    if (this.isClosedStack(p)) {
      setOpen(this.ctl, p.it.e.id);
      if (byKey) {
        // Fokus auf das erste aufgefächerte Zeichen
        const s = this.stackOf(p);
        const first = s ? [...s.st.members].sort((a, b) => this.placed[a]!.fanRank - this.placed[b]!.fanRank)[0] : undefined;
        const el = first !== undefined ? this.placed[first]!.marker.getElement() : null;
        el?.focus({ preventScroll: true });
      }
      return;
    }
    this.o.onClick(p.it.e);
  }

  private stackOf(p: Placed): { st: Stack; si: number } | null {
    const si = this.stackIdx[p.idx] ?? -1;
    return si >= 0 ? { st: this.stacks[si]!, si } : null;
  }
  private isClosedStack(p: Placed): boolean {
    const s = this.stackOf(p);
    return !!s && s.st.members.length > 1 && s.si !== this.openStack;
  }

  private tooltipFor(p: Placed): string {
    // gewählt (nicht in geschlossenem Stapel): nur der Hinweis, dass es sich ziehen lässt
    if (p.it.selected && !this.isClosedStack(p)) return `<div class="lt-tip-k lt-tip-only">Gewählt: ziehen = Ort korrigieren</div>`;
    const s = this.stackOf(p);
    if (!s || s.st.members.length < 2 || s.si === this.openStack) return this.tooltip(p.it);
    const ms = s.st.members.map((i) => this.placed[i]!.it);
    const rows = ms.slice(0, 8).map((it) => {
      const who = it.kind === "eigen" ? it.e.unit || it.e.melder || "" : [it.e.unit, it.e.melder ? `via ${it.e.melder}` : ""].filter(Boolean).join(" ");
      const sym = iconSvg(it.sym, it.aff, 12, { sidc: it.sidc, status: it.status }).svg;
      return `<li><b class="tnum">${it.e.t.slice(11, 16)}</b><span class="lt-stkl-s">${sym}</span><span class="lt-stkl-n">${escapeHtml(it.e.desc || it.name)}</span>${who ? `<span class="lt-stkl-w">${escapeHtml(who)}</span>` : ""}</li>`;
    }).join("");
    const more = ms.length > 8 ? `<li class="lt-stkl-more">… ${ms.length - 8} weitere</li>` : "";
    return `<div class="lt-tip-h"><b>${ms.length} Meldungen hier</b><span class="lt-stkl-hint">Klick fächert auf</span></div><ul class="lt-stkl">${rows}${more}</ul>`;
  }

  /**
   * Zeichnet ein Hindernis quer zur Strasse: Balken senkrecht zur Strassenrichtung (Sperre mit Zacken
   * zur Gegenseite, Checkpoint als Schranke, sonst kurzer Strich mit Punkt).
   * Länge ca. 44 m im Gelände, auf dem Bildschirm aber mindestens ca. 34 px.
   */
  private drawRoadMark(it: SituationItem, mPerPx: number, out: RoadOut): void {
    const p = it.pos;
    const a = ((it.e.angle ?? 0) * Math.PI) / 180;
    const u = { e: Math.cos(a), n: -Math.sin(a) }; // quer zur Strasse
    const v = { e: Math.sin(a), n: Math.cos(a) }; // entlang der Strasse
    const k = Math.max(1, (20 * mPerPx) / 22); // Massstab: halbe Balkenlänge mind. 20 px (wie `roadK`)
    const at = (du: number, dv: number) => toLatLng({ e: p.e + (u.e * du + v.e * dv) * k, n: p.n + (u.n * du + v.n * dv) * k });
    // Zacken zur Gegenseite: bei Feind/unklar zum Melder (das sind wir), sonst in Strassenrichtung
    let side = this.roadSide.get(it);
    if (side === undefined) {
      side = 1;
      if (it.kind !== "eigen" && it.e.melder) {
        const m = lastPosition(this.events, "blau", it.e.melder, it.e.t);
        if (m) side = Math.sign((m.e - p.e) * v.e + (m.n - p.n) * v.n) || 1;
      }
      this.roadSide.set(it, side);
    }
    const col = KIND_COLOR[it.kind].line;
    const o = it.opacity;
    const opt = (color: string, weight: number, opacity: number): L.PolylineOptions => ({ color, weight, opacity: opacity * o, interactive: false, lineCap: "butt", lineJoin: "miter", dashArray: it.anticipated && color !== "#fff" ? "6 4" : undefined });
    const add = (z: number, ll: L.LatLng[] | L.LatLng[][], o2: L.PolylineOptions) => {
      const key = `${z}|${o2.color}|${o2.weight}|${o2.opacity}|${o2.dashArray ?? ""}`;
      const gr = out.groups.get(key) ?? { z, o: o2, lines: [] };
      out.groups.set(key, gr);
      if (Array.isArray(ll[0])) gr.lines.push(...(ll as L.LatLng[][])); else gr.lines.push(ll as L.LatLng[]);
    };
    const casing = (ll: L.LatLng[] | L.LatLng[][], w: number, op = 0.9) => add(1, ll, opt("#fff", w, op));
    const line = (ll: L.LatLng[] | L.LatLng[][], w: number) => add(2, ll, opt(col, w, 1));
    if (it.road === "sperre") {
      const L2 = 22, depth = 7, n = 4;
      const bar = [at(-L2, 0), at(L2, 0)];
      const teeth: L.LatLng[] = [];
      for (let i = 0; i < n; i++) {
        const a0 = -L2 + (2 * L2 * i) / n, a1 = -L2 + (2 * L2 * (i + 1)) / n;
        teeth.push(at(a0, 0), at((a0 + a1) / 2, side * depth), at(a1, 0));
      }
      // Halo: dunkler Hauch + kräftiger weisser Rand, damit der rote Balken auch auf einer roten Hauptstrasse lesbar ist
      add(0, bar, { ...opt(MAP_INK, 14, 0.35), dashArray: undefined });
      casing(teeth, 6, 1); casing(bar, 11, 1);
      line(teeth, 2); line(bar, 5);
    } else if (it.road === "checkpoint") {
      const L2 = 18;
      const gate = [[at(-L2, -7), at(-L2, 7)], [at(-L2, 0), at(L2, 0)], [at(L2, -7), at(L2, 7)]];
      casing(gate, 6); line(gate, 3);
    } else {
      const tick = [at(-12, 0), at(12, 0)];
      casing(tick, 6); line(tick, 3);
      out.circles.push(L.circleMarker(toLatLng(p), { radius: 3.5, color: col, weight: 2, fillColor: "#fff", fillOpacity: o, opacity: o, interactive: false }));
    }
  }

  private tooltip(it: SituationItem): string {
    const e = it.e;
    const time = (this.o.days?.length ? dayLabel(e.t, this.o.days) + " " : "") + e.t.slice(11, 16);
    const who = e.unit || (it.kind === "eigen" ? e.melder ?? "" : "");
    const via = it.kind !== "eigen" && e.melder ? `via ${e.melder}` : "";
    const where = (e.cells?.length ? e.cells.join(", ") : e.where) ?? "";
    // Herkunft («aus Rtg O») nur als Text – der Pfeil am Zeichen ist der Bewegungsrichtung vorbehalten
    const from = e.fromLabel ?? (e.from !== undefined ? `aus ${["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(e.from / 45) % 8]}` : "");
    const meta = [where, e.road ? `auf ${e.road}` : "", it.name, from, e.nai && e.nai !== where ? e.nai : "", via].filter(Boolean).join(" · ");
    const canMove = !!this.o.onMove && !isLocked();
    return `<div class="lt-tip-h"><b class="tnum">${escapeHtml(time)}</b><span class="lt-kind k-${it.kind}">${escapeHtml(kindText(e))}</span>${who ? `<b class="lt-tip-u">${escapeHtml(who)}</b>` : ""}</div>`
      + (e.desc ? `<div class="lt-tip-d">${escapeHtml(e.desc)}</div>` : "")
      + `<div class="lt-tip-t">${escapeHtml(e.text)}</div>`
      + (meta ? `<div class="lt-tip-m tnum">${escapeHtml(meta)}</div>` : "")
      + (canMove ? `<div class="lt-tip-k">Klick wählt · gewählt ziehen = Ort korrigieren</div>` : "");
  }

  // ---------------------------------------------------------------- Stapel und Auffächern (nach jedem Zoom neu)
  private layout() {
    const map = this._map;
    if (!map) return;
    const t0 = performance.now();
    const mPerPx = 1 / map.options.crs!.scale(map.getZoom());
    // Hindernisse an der Strasse: nur neu zeichnen, wenn sich ihr Massstab ändert (hineingezoomt bleibt er gleich)
    const rk = Math.max(1, (20 * mPerPx) / 22);
    if (rk !== this.roadK) {
      this.roadK = rk;
      this.roadMarks.clearLayers();
      // gleich gestaltete Striche aller Hindernisse in einem Pfad (wenige SVG-Elemente statt 5 je Hindernis);
      // Reihenfolge: Hauch, weisser Rand, Farbe – so liegt kein Rand über der Farbe eines Nachbarn
      const out: RoadOut = { groups: new Map(), circles: [] };
      for (const it of this.roadItems) this.drawRoadMark(it, mPerPx, out);
      for (const gr of [...out.groups.values()].sort((a, b) => a.z - b.z)) L.polyline(gr.lines, gr.o).addTo(this.roadMarks);
      for (const c of out.circles) c.addTo(this.roadMarks);
    }
    this.fanLines.clearLayers();
    if (this.drag) return; // während des Ziehens nicht umstellen

    const truePt = this.placed.map((p) => map.latLngToLayerPoint(p.ll));
    const shownPt = this.placed.map((p, i) => (p.offset ? truePt[i]!.add(L.point(p.offset[0], p.offset[1])) : truePt[i]!));
    const n = this.placed.length;
    // Stapel mit der normalen Zeichengrösse bilden: die grössere gewählte Meldung soll keinen neuen Stapel auslösen
    const k = this.base / this.selSize;
    // V4: der Halo (outlineWidth, ≈ 2 px je Seite) gehört zum Rahmen von milsymbol, verdeckt aber nichts – sich
    // berührende Halos bilden keinen Stapel (Ruhe-Kriterium: ≥ 80 % sichtbare Einzelzeichen)
    const inset = this.o.groesse ? (ZEICHEN.outlineWidth * this.base) / 100 : 0;
    const shrink = (c: Box): Box => (inset ? [c[0] + inset, c[1] + inset, c[2] - inset, c[3] - inset] : c);
    const stackCore = (p: Placed): Box => shrink(p.it.selected ? [p.core[0] * k, p.core[1] * k, p.core[2] * k, p.core[3] * k] : p.core);
    this.stacks = buildStacks(this.placed.map((p, i) => ({ x: shownPt[i]!.x, y: shownPt[i]!.y, core: stackCore(p), box: p.box, prio: n - p.rank })));
    this.stackIdx = new Array(n).fill(-1);
    this.stacks.forEach((st, si) => st.members.forEach((i) => { this.stackIdx[i] = si; }));
    const openFor = this.ctl.openFor;
    this.openStack = openFor ? this.stacks.findIndex((st) => st.members.length > 1 && st.members.some((i) => this.placed[i]!.it.e.id === openFor)) : -1;

    const rects: Array<readonly [number, number, number, number]> = [];
    // Hindernisse für die Flächenbeschriftung in Layer-Pixeln (bleiben beim Verschieben der Karte gültig)
    const toCont = (pt: L.Point) => pt;
    this.stacks.forEach((st, si) => {
      if (si === this.openStack) {
        // ---- aufgefächert: Kreis um den gemeinsamen Ort, Linie zum wahren Ort jedes Zeichens, Punkt markiert
        const mem = [...st.members].sort((a, b) => this.placed[a]!.fanRank - this.placed[b]!.fanRank);
        const cx = mem.reduce((s, i) => s + truePt[i]!.x, 0) / mem.length;
        const cy = mem.reduce((s, i) => s + truePt[i]!.y, 0) / mem.length;
        const slots = fanLayout(mem.map((i) => this.placed[i]!.boxFan), mem.map((i) => this.placed[i]!.core));
        const lines: L.LatLng[][] = [];
        const dots: L.Point[] = [];
        mem.forEach((i, j) => {
          const p = this.placed[i]!;
          const sl = slots[j]!;
          const at = L.point(cx + sl.dx, cy + sl.dy);
          this.place(p, at, { fan: true, left: sl.side < 0, under: false, hid: false, n: 0, z: 5000 - j });
          lines.push([map.layerPointToLatLng(truePt[i]!), map.layerPointToLatLng(at)]);
          if (!dots.some((d) => d.distanceTo(truePt[i]!) < 3)) dots.push(truePt[i]!);
          const b = sl.side < 0 ? mirrorBox(p.boxFan, p.core) : p.boxFan;
          const c = toCont(at);
          rects.push([c.x + b[0], c.y + b[1], c.x + b[2], c.y + b[3]]);
        });
        L.polyline(lines, { color: "#fff", weight: 3.5, opacity: 0.9, interactive: false, className: "lt-fanline" }).addTo(this.fanLines);
        L.polyline(lines, { color: MAP_INK, weight: 1.3, opacity: 0.9, interactive: false, className: "lt-fanline" }).addTo(this.fanLines);
        for (const d of dots) L.circleMarker(map.layerPointToLatLng(d), { radius: 4, color: "#fff", weight: 1.5, fillColor: MAP_INK, fillOpacity: 1, interactive: false, className: "lt-fanline" }).addTo(this.fanLines);
        return;
      }
      // ---- geschlossen: oberstes am Ort, bis zwei weitere leicht nach rechts oben versetzt, Rest verdeckt.
      // Der Versatz richtet sich nach dem obersten Zeichen: ist es grösser (gewählt 24 px), rücken die unteren
      // um den Grössenunterschied weiter hinaus, sonst wären sie ganz verdeckt.
      const top = this.placed[st.members[0]!]!;
      let ext = 0;
      st.members.forEach((i, k) => {
        const p = this.placed[i]!;
        const off = peekOffset(k);
        let at: L.Point | null = null;
        if (off) {
          const ex = k ? Math.max(0, top.core[2] - p.core[2]) : 0;
          const ey = k ? Math.max(0, p.core[1] - top.core[1]) : 0;
          ext = Math.max(ext, ex, ey);
          at = L.point(st.x + off[0] + ex, st.y + off[1] - ey);
        }
        this.place(p, at, {
          fan: false, left: k === 0 && st.side < 0, under: k > 0, hid: !off, n: k === 0 && st.members.length > 1 ? st.members.length : 0, z: top.z - k * 5,
        });
      });
      const b = st.side < 0 ? mirrorBox(top.box, top.core) : top.box;
      const c = toCont(L.point(st.x, st.y));
      const peek = (Math.min(st.members.length, 3) - 1) * 4 + ext;
      rects.push([c.x + b[0], c.y + b[1] - peek, c.x + b[2] + peek, c.y + b[3]]);
    });
    map.getContainer().classList.toggle("lt-fanopen", this.openStack >= 0);
    this.roving();
    publish(this.stacks.filter((s) => s.members.length > 1).length);
    // Flächenbeschriftungen (NAI, AO, Stao) den Zeichen ausweichen lassen – nach dem Zeichnen (kein erzwungenes Layout)
    this.rects = rects;
    avoidAreaLabelsSoon(map, rects);
    try { performance.measure("Lage: Stapel", { start: t0, detail: { n } }); } catch { /* ältere Browser */ }
  }

  /** erreichbare Zeichen (tabindex gesetzt) in Lesereihenfolge: oben nach unten, links nach rechts */
  private reachable(): HTMLElement[] {
    const out: Array<{ el: HTMLElement; x: number; y: number }> = [];
    for (const p of this.placed) {
      const el = p.marker.getElement();
      if (!el || !el.hasAttribute("tabindex")) continue;
      const pt = this._map!.latLngToContainerPoint(p.marker.getLatLng());
      out.push({ el, x: pt.x, y: pt.y });
    }
    return out.sort((a, b) => Math.round(a.y / 24) - Math.round(b.y / 24) || a.x - b.x).map((o) => o.el);
  }
  /**
   * Ein Tab-Stopp für die ganze Karte (Prüfbericht H3: jedes Zeichen war ein eigener Tab-Stopp): tabindex 0 hat das
   * zuletzt fokussierte bzw. gewählte Zeichen, sonst das erste; ←/→/↑/↓ wandern (`moveFocus`).
   */
  private roving(): void {
    const els = this.reachable();
    if (!els.length) return;
    const byId = (id: string | null | undefined) => (id ? this.placed.find((p) => p.it.e.id === id)?.marker.getElement() ?? null : null);
    const want = [byId(this.ctl.focusId), byId(this.o.selectedId)].find((e) => e && els.includes(e)) ?? els[0]!;
    for (const el of els) { const v = el === want ? 0 : -1; if (el.tabIndex !== v) el.tabIndex = v; }
  }
  private moveFocus(from: HTMLElement, dir: 1 | -1): void {
    const els = this.reachable();
    const i = els.indexOf(from);
    const next = els[Math.min(els.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
    if (!next || next === from) return;
    from.tabIndex = -1;
    next.tabIndex = 0;
    next.focus({ preventScroll: true });
  }

  /** Text für Bildschirmleser und Tastatur: was liegt hier, was tut Enter */
  private ariaFor(p: Placed, n: number): string {
    const it = p.it;
    const what = [it.e.t.slice(11, 16), kindText(it.e), it.e.desc || it.name, it.e.unit, it.e.cells?.[0]].filter(Boolean).join(" ");
    if (n > 1) return `${n} Zeichen übereinander – antippen zum Auffächern`;
    return `${what}${it.selected ? " (gewählt)" : ""} – Enter wählt`;
  }

  /** Zeichen an einen Bildschirmort setzen und den Zustand als Klassen am Element führen */
  private place(p: Placed, at: L.Point | null, s: { fan: boolean; left: boolean; under: boolean; hid: boolean; n: number; z: number }) {
    const map = this._map!;
    if (at) {
      const ll = map.layerPointToLatLng(at);
      if (!p.marker.getLatLng().equals(ll)) p.marker.setLatLng(ll);
    }
    if (p.marker.options.zIndexOffset !== s.z) p.marker.setZIndexOffset(s.z);
    const el = p.marker.getElement();
    if (!el) return;
    el.classList.toggle("fan", s.fan);
    el.classList.toggle("left", s.left);
    el.classList.toggle("under", s.under);
    el.classList.toggle("hid", s.hid);
    el.classList.toggle("stacktop", s.n > 1);
    // Stapelmarke als Element (Testhaken `.lt-stk`, nur die Zahl; Spez. MVP 3.5, S13)
    let stk = el.querySelector<HTMLElement>(":scope > .lt-stk");
    if (s.n > 1) {
      el.dataset.n = String(s.n);
      if (!stk) { stk = document.createElement("span"); stk.className = "lt-stk"; stk.setAttribute("aria-hidden", "true"); el.appendChild(stk); }
      if (stk.textContent !== String(s.n)) stk.textContent = String(s.n);
    } else {
      delete el.dataset.n;
      stk?.remove();
    }
    // Zeit-Fähnchen, das nur aufgefächert erscheint: erst dann als Element (ältere Zeichen tragen sonst keine Beschriftung)
    const t = p.parts.time;
    if (t?.opt) {
      const have = el.querySelector(":scope > .lt-tl");
      if (s.fan && !have) el.appendChild(timeSpan(t));
      else if (!s.fan && have) have.remove();
    }
    // nur das gewählte Zeichen lässt sich mit der Maus ziehen (Cursor «grab»)
    el.classList.toggle("movable", !s.under && !s.hid && s.n < 2 && this.movable(p));
    // Tastatur: sichtbare Zeichen und oberste Zeichen der Stapel erreichbar, verdeckte nicht. Die Karte ist EIN
    // Tab-Stopp (roving tabindex, `roving()`): ein Zeichen hat tabindex 0, die übrigen -1, Pfeiltasten wechseln
    const reach = !s.under && !s.hid;
    if (reach) {
      if (!el.hasAttribute("tabindex")) { el.tabIndex = -1; el.setAttribute("role", "button"); }
      const label = this.ariaFor(p, s.n);
      if (el.getAttribute("aria-label") !== label) el.setAttribute("aria-label", label);
      if (s.fan) el.setAttribute("aria-expanded", "true"); else if (s.n > 1) el.setAttribute("aria-expanded", "false"); else el.removeAttribute("aria-expanded");
    } else if (el.hasAttribute("tabindex")) {
      el.removeAttribute("tabindex");
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
      el.removeAttribute("aria-expanded");
    }
  }

  // ---------------------------------------------------------------- Zeichen verschieben
  private canDrag(): boolean { return !!this.o.onMove && !isLocked(); }
  /** mit der Maus ziehbar: nur die gewählte Meldung (erster Klick wählt, dann ziehen), nicht in geschlossenem Stapel */
  private movable(p: Placed): boolean { return this.canDrag() && p.it.selected && !this.isClosedStack(p); }
  private placedAt(t: EventTarget | null): Placed | null {
    const el = t instanceof Element ? t.closest(".lt-ev") : null;
    return el ? this.byEl.get(el) ?? null : null;
  }

  private bindPointer(map: L.Map) {
    const pane = map.getPane("markerPane")!;
    // Maus: nur das gewählte Zeichen lässt sich ziehen (ab 4 px, darunter bleibt es ein Klick); die Karte steht dabei still.
    // Ziehen auf einem anderen Zeichen verschiebt wie gewohnt die Karte.
    const onMouseDown = (e: MouseEvent) => {
      const p = e.button === 0 ? this.placedAt(e.target) : null;
      if (p && this.movable(p)) L.DomEvent.stopPropagation(e);
    };
    // gedrückt auf einem Zeichen: Neuaufbau aufschieben, bis losgelassen (sonst ginge die Geste verloren)
    const onPress = (e: PointerEvent) => {
      if (!this.placedAt(e.target) || isDragging(this.ctl.map)) return;
      this.ctl.pressing = Date.now();
      const up = () => {
        document.removeEventListener("pointerup", up, true);
        document.removeEventListener("pointercancel", up, true);
        this.ctl.pressing = 0;
        // nach dem Klick (der noch folgt) nachholen, falls inzwischen nicht gezogen wird
        window.setTimeout(() => { if (!isDragging(this.ctl.map)) flushPending(this.ctl); }, 0);
      };
      document.addEventListener("pointerup", up, true);
      document.addEventListener("pointercancel", up, true);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || !this.canDrag() || this.drag) return;
      const p = this.placedAt(e.target);
      if (!p || !this.movable(p)) return;
      const sx = e.clientX, sy = e.clientY, id = e.pointerId;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== id || Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_PX) return;
        done();
        this.startDrag(p, id, sx, sy, false);
        this.dragMove(ev);
      };
      const done = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", done); };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", done);
    };
    // Finger/Stift: Tipp neben Zeichen mit dem ungerückten Punkt prüfen (S12, `tippOhneVersatz`)
    const cont = map.getContainer();
    let tDown: { id: number; x: number; y: number; ab: number } | null = null;
    const onTDown = (e: PointerEvent) => { tDown = e.pointerType !== "mouse" && e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, ab: Date.now() } : null; };
    const onTUp = (e: PointerEvent) => { const d = tDown; tDown = null; if (d && e.pointerId === d.id) this.tippOhneVersatz(e, d); };
    cont.addEventListener("pointerdown", onTDown, true);
    cont.addEventListener("pointerup", onTUp, true);
    this.unbind.push(() => { cont.removeEventListener("pointerdown", onTDown, true); cont.removeEventListener("pointerup", onTUp, true); });
    // Natives Kontextmenü (langes Drücken mit dem Finger) auf einem Zeichen: nicht das Karten-Menü öffnen
    let touchAt = 0;
    const onAnyDown = (e: PointerEvent) => { if (e.pointerType !== "mouse") touchAt = Date.now(); };
    const onCtx = (e: MouseEvent) => {
      if (Date.now() - touchAt < 2000 && this.placedAt(e.target)) { e.preventDefault(); L.DomEvent.stopPropagation(e); }
    };
    pane.addEventListener("mousedown", onMouseDown);
    pane.addEventListener("pointerdown", onPress, true);
    pane.addEventListener("pointerdown", onPointerDown);
    pane.addEventListener("pointerdown", onAnyDown, true);
    pane.addEventListener("contextmenu", onCtx);
    // Finger/Stift: langes Drücken hebt das Zeichen an (ohne Bewegung danach = wie Tippen)
    const offLong = longPress(pane, {
      delay: LIFT_MS,
      tolerance: 8,
      accept: (e) => e.pointerType !== "mouse" && this.canDrag() && !this.drag && !!this.placedAt(e.target),
      onPress: (pi) => {
        const p = this.placedAt(pi.target);
        if (!p || !this._map) return false;
        this.startDrag(p, pi.pointerId, pi.x, pi.y, pi.pointerType === "touch");
        return true;
      },
    });
    // Tastatur: Enter/Leertaste auf einem Zeichen = wie Klick (Stapel auffächern bzw. Meldung wählen)
    const onKey = (e: KeyboardEvent) => {
      const arrow = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (arrow) {
        const q = this.placedAt(e.target);
        const el = q?.marker.getElement();
        if (!q || !el || e.target !== el) return;
        // Pfeiltasten wechseln das Zeichen (statt die Karte zu verschieben)
        e.preventDefault();
        e.stopPropagation();
        this.moveFocus(el, arrow);
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const p = this.placedAt(e.target);
      if (!p || e.target !== p.marker.getElement()) return;
      e.preventDefault();
      e.stopPropagation();
      this.activate(p, true);
    };
    const onFocus = (e: FocusEvent) => { const p = this.placedAt(e.target); if (p) this.ctl.focusId = p.it.e.id; };
    const onBlur = (e: FocusEvent) => { if (!this.placedAt(e.relatedTarget) && (e.relatedTarget || !this._map)) this.ctl.focusId = null; };
    pane.addEventListener("keydown", onKey);
    pane.addEventListener("focusin", onFocus);
    pane.addEventListener("focusout", onBlur);
    this.unbind.push(() => {
      pane.removeEventListener("keydown", onKey);
      pane.removeEventListener("focusin", onFocus);
      pane.removeEventListener("focusout", onBlur);
    });
    this.unbind.push(() => {
      pane.removeEventListener("mousedown", onMouseDown);
      pane.removeEventListener("pointerdown", onPress, true);
      pane.removeEventListener("pointerdown", onPointerDown);
      pane.removeEventListener("pointerdown", onAnyDown, true);
      pane.removeEventListener("contextmenu", onCtx);
      offLong();
    });
  }

  private startDrag(p: Placed, pointerId: number, x: number, y: number, touch: boolean) {
    const map = this._map;
    if (!map) return;
    const el = p.marker.getElement();
    p.marker.closeTooltip();
    const cont = map.getContainer();
    const r = cont.getBoundingClientRect();
    const anchor = map.latLngToContainerPoint(p.marker.getLatLng());
    const start = L.point(x - r.left, y - r.top);
    const dragWasOn = map.dragging.enabled();
    if (dragWasOn) map.dragging.disable(); // laufendes Verschieben der Karte (Finger) beenden
    el?.classList.add("lift");
    cont.classList.add("lt-dragging");
    const tip = document.createElement("div");
    tip.className = "lt-dragtip";
    cont.appendChild(tip);
    // wahrer Ort als Hohlpunkt, solange gezogen wird
    const ghost = L.layerGroup().addTo(this);
    L.circleMarker(p.ll, { radius: 5, color: MAP_INK, weight: 1.5, dashArray: "2 2", fill: false, interactive: false }).addTo(ghost);
    const onMove = (e: PointerEvent) => { if (e.pointerId === pointerId) this.dragMove(e); };
    const onUp = (e: PointerEvent) => { if (e.pointerId === pointerId) this.endDrag(e.type === "pointerup"); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.endDrag(false); } };
    // zweiter Finger (Pinch) während des Ziehens: abbrechen, Zeichen zurück
    const onDown2 = (e: PointerEvent) => { if (e.pointerId !== pointerId) this.endDrag(false); };
    // Finger: kein Scrollen/Zoomen der Seite, solange das Zeichen angehoben ist
    const onTouchMove = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("pointerdown", onDown2, true);
    this.drag = {
      p, pointerId, touch, grab: start.subtract(anchor), start, moved: false, tip, ghost, dragWasOn,
      off: () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("pointerdown", onDown2, true);
      },
    };
    this.fanLines.eachLayer((l) => (l as L.Path).setStyle?.({ opacity: 0.25 }));
    if (touch) {
      suppressContextMenu(1500);
      this.dragTo(start);
    } else this.updateTip(anchor);
  }

  private dragMove(e: PointerEvent) {
    const d = this.drag, map = this._map;
    if (!d || !map) return;
    const pt = map.mouseEventToContainerPoint(e as unknown as MouseEvent);
    if (!d.moved && pt.distanceTo(d.start) >= DRAG_PX) d.moved = true;
    this.dragTo(pt);
  }

  private dragTo(pointer: L.Point) {
    const d = this.drag, map = this._map;
    if (!d || !map) return;
    const at = pointer.subtract(d.grab).add(L.point(0, d.touch ? TOUCH_LIFT_Y : 0));
    d.p.marker.setLatLng(map.containerPointToLatLng(at));
    this.updateTip(at);
  }

  /** Planquadrat unter dem Zeichen anzeigen (z. B. «AG13 C») */
  private updateTip(at: L.Point) {
    const d = this.drag, map = this._map;
    if (!d || !map) return;
    const pos = toLv95(map.containerPointToLatLng(at));
    const cell = cellAtAny(this.o.sheets, pos);
    d.tip.innerHTML = cell ? `<b>${escapeHtml(cell.label)}</b>` : `<span>ausserhalb Raster</span>`;
    d.tip.style.left = `${Math.round(at.x)}px`;
    d.tip.style.top = `${Math.round(at.y + d.p.core[1] - 8)}px`;
  }

  /** Ziehen beenden: übernehmen (neuer Ort) oder abbrechen (zurück an den alten Ort) */
  /** @param removing Ebene wird gerade entfernt: aufgeschobenen Neuaufbau nicht hier ausführen */
  private endDrag(commit: boolean, removing = false) {
    const d = this.drag, map = this._map;
    if (!d) return;
    this.drag = null;
    d.off();
    d.tip.remove();
    d.ghost.remove();
    d.p.marker.getElement()?.classList.remove("lift");
    map?.getContainer().classList.remove("lt-dragging");
    if (map && d.dragWasOn) map.dragging.enable();
    suppressClick(); // der Klick nach dem Loslassen wählt nicht nochmals
    if (commit && d.moved && map && this.o.onMove) {
      const pos = toLv95(d.p.marker.getLatLng());
      const it = d.p.it;
      const target = it.isUnit ? positionSource(this.events, it.e.side, it.e.unit, this.o.t, it.pos) ?? it.e : it.e;
      this.ctl.openFor = null;
      const onMove = this.o.onMove;
      // aufgeschobenen Neuaufbau (Live-Takt …) zuerst nachholen, dann den neuen Ort übernehmen (baut nochmals auf)
      if (!removing) flushPending(this.ctl);
      onMove(target, { e: Math.round(pos.e), n: Math.round(pos.n) });
      return;
    }
    // angehoben, aber nicht bewegt (Finger): wie Tippen
    if (commit && !d.moved && d.touch) this.activate(d.p);
    if (removing) return;
    if (!flushPending(this.ctl)) this.layout();
  }
}

/**
 * Dauer jedes Neuaufbaus beim Wechsel der Grössenklasse (ms) zusätzlich in `window.__ltZeichen`: unter einer Test-Uhr
 * (Playwright `clock.install`) legt `performance.mark` nichts ab, `performance.now` läuft aber weiter (wie perf.ts).
 */
function zeichenMessung(ms: number): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __ltZeichen?: number[] };
  (w.__ltZeichen ??= []).push(Math.round(ms * 10) / 10);
  if (w.__ltZeichen.length > 50) w.__ltZeichen.shift();
}

type Rects = ReadonlyArray<readonly [number, number, number, number]>;
const avoidQueue = new WeakMap<L.Map, { rects: Rects; queued: boolean }>();
/** `avoidAreaLabels` nach dem nächsten Bild ausführen: dann ist das Layout fertig und das Lesen der Beschriftungen billig */
function avoidAreaLabelsSoon(map: L.Map, rects: Rects) {
  const q = avoidQueue.get(map);
  if (q) { q.rects = rects; if (q.queued) return; q.queued = true; }
  else avoidQueue.set(map, { rects, queued: true });
  requestAnimationFrame(() => window.setTimeout(() => {
    const cur = avoidQueue.get(map);
    if (!cur) return;
    cur.queued = false;
    if (map.getContainer().isConnected) avoidAreaLabels(map, cur.rects);
  }, 0));
}

/**
 * Beschriftungen der Flächen (aus `areasLayer`) ausweichen lassen (Spez. MVP 3.5, B5): Hindernisse sind die Zeichen
 * samt Beschriftung (`rects`, Layer-Pixel), die Randbeschriftung des Rasters, das Lineal und die schon gesetzten
 * Etiketten. NAI/Räume (`data-bb`): zuerst am Pol der Unerreichbarkeit, dann innen oben/unten/links/rechts, dann
 * knapp ausserhalb oben/unten, zuletzt kleine Verschiebungen; passt nichts, die Lage mit der kleinsten Überdeckung –
 * das Etikett eines NAI wird nie ausgeblendet. Wird nach jedem Neuberechnen der Stapel und nach jedem Verschieben der Karte neu gesetzt.
 */
function avoidAreaLabels(map: L.Map, rects: Rects) {
  const cont = map.getContainer();
  const spans = [...cont.querySelectorAll<HTMLElement>(".lt-area-lbl span")];
  if (!spans.length) return;
  const cr = cont.getBoundingClientRect();
  const o0 = map.layerPointToContainerPoint(L.point(0, 0));
  type R = readonly [number, number, number, number];
  const busy: R[] = rects.map((r) => [r[0] + o0.x, r[1] + o0.y, r[2] + o0.x, r[3] + o0.y] as const);
  const rel = (b: DOMRect, m = 1): R => [b.left - cr.left - m, b.top - cr.top - m, b.right - cr.left + m, b.bottom - cr.top + m];
  // erst alle lesen, dann alle schreiben (sonst erzwingt jedes Lesen ein neues Layout der ganzen Seite)
  for (const sp of spans) { sp.style.translate = ""; sp.classList.remove("lt-lbl-aus"); }
  cont.querySelectorAll<Element>(".lt-raster-lbl .lt-edge-t, .leaflet-lt-lineal-pane > *").forEach((el) => {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) busy.push(rel(b, 1));
  });
  const boxes = spans.map((sp) => sp.getBoundingClientRect());
  const W = cr.width, H = cr.height;
  const hit = (a: R) => busy.some((r) => a[0] < r[2] && a[2] > r[0] && a[1] < r[3] && a[3] > r[1]);
  const inMap = (a: R) => a[0] >= 0 && a[1] >= 0 && a[2] <= W && a[3] <= H;
  const nudges: Array<[number, number]> = [[0, -16], [0, 16], [24, 0], [-24, 0], [0, -32], [48, -16], [-48, -16], [0, -48]];
  spans.forEach((sp, i) => {
    const b = boxes[i]!;
    if (!b.width) return;
    const r0 = rel(b, 2);
    const w = r0[2] - r0[0], h = r0[3] - r0[1];
    const cx = (r0[0] + r0[2]) / 2, cy = (r0[1] + r0[3]) / 2;
    const tries: Array<[number, number]> = [[0, 0]];
    const bb = sp.dataset.bb?.split(",").map(Number);
    if (bb && bb.length === 4 && bb.every(Number.isFinite)) {
      const a = map.latLngToContainerPoint(toLatLng({ e: bb[0]!, n: bb[3]! })), z = map.latLngToContainerPoint(toLatLng({ e: bb[2]!, n: bb[1]! }));
      const [L0, T0, R0, B0] = [a.x, a.y, z.x, z.y];
      // innen oben, unten, links, rechts (nur wenn das Etikett in die Fläche passt), dann aussen oben/unten
      if (B0 - T0 > h * 2) tries.push([0, T0 + 2 + h / 2 - cy], [0, B0 - 2 - h / 2 - cy]);
      if (R0 - L0 > w * 1.4) tries.push([L0 + 2 + w / 2 - cx, 0], [R0 - 2 - w / 2 - cx, 0]);
      tries.push([0, T0 - 2 - h / 2 - cy], [0, B0 + 2 + h / 2 - cy], [L0 - 4 - w / 2 - cx, 0], [R0 + 4 + w / 2 - cx, 0]);
    }
    tries.push(...nudges);
    const kand = tries.map(([dx, dy]) => [Math.round(dx), Math.round(dy)] as const);
    const at = ([dx, dy]: readonly [number, number]): R => [r0[0] + dx, r0[1] + dy, r0[2] + dx, r0[3] + dy];
    let ok = kand.find((d) => { const r = at(d); return inMap(r) && !hit(r); });
    // (Paket E, Entscheid Koordinator) das Etikett eines NAI fehlt nie: passt keine Lage frei, die mit der kleinsten
    // Überdeckung im Bild (sonst am Ort) – nie ausblenden
    if (!ok) {
      const deckung = (r: R) => busy.reduce((n, q) => n + Math.max(0, Math.min(r[2], q[2]) - Math.max(r[0], q[0])) * Math.max(0, Math.min(r[3], q[3]) - Math.max(r[1], q[1])), 0);
      ok = kand.filter((d) => inMap(at(d))).sort((x, y) => deckung(at(x)) - deckung(at(y)))[0] ?? ([0, 0] as const);
    }
    if (ok[0] || ok[1]) sp.style.translate = `${ok[0]}px ${ok[1]}px`;
    busy.push([r0[0] + ok[0], r0[1] + ok[1], r0[2] + ok[0], r0[3] + ok[1]]);
  });
}

/**
 * Versatz des Zeichens neben der Strasse (quer dazu; Bildschirm x = Ost, y = Süd), so weit, dass das Zeichen
 * den wahren Ort (Balkenmitte) nicht verdeckt. Ohne Führungsstrich: das Zeichen steht knapp neben dem Balken.
 */
function roadOffset(it: SituationItem, core: Box): [number, number] {
  const a = ((it.e.angle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const M = 24; // Abstand Ort ↔ Zeichenrand (halbe Balkenlänge + etwas Luft)
  const tx = dx > 1e-6 ? (M - core[0]) / dx : dx < -1e-6 ? (core[2] + M) / -dx : Infinity;
  const ty = dy > 1e-6 ? (M - core[1]) / dy : dy < -1e-6 ? (core[3] + M) / -dy : Infinity;
  const t = Math.max(22, Math.min(tx, ty, 60));
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

export { ohneAufgehobene } from "./aufgehoben";

export function situationLayer(map: L.Map, events: LageEvent[], o: SituationOptions): L.LayerGroup {
  return new SituationLayer(map, events, o);
}
