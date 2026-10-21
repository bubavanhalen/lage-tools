/**
 * Fläche/Linie von Hand zeichnen oder bearbeiten.
 * - Klick/Tippen setzt Punkte, Doppelklick oder Enter beendet (der Doppelklick setzt keinen zusätzlichen Punkt),
 *   Backspace nimmt den letzten Punkt zurück, Esc bricht ab. Klick auf den ersten Punkt schliesst eine Fläche.
 * - Touch: Tippen setzt Punkte, Knopf «Fertig».
 * - Bestehende (auch automatisch berechnete) Form: Eckpunkte ziehen (Maus und Touch), Zwischenpunkte (auf der Kante)
 *   ziehen fügt einen Punkt ein, Doppelklick auf einen Eckpunkt löscht ihn; «Neu» verwirft die Punkte und zeichnet neu.
 * `drawShape` liefert die Punkte (LV95) oder null (abgebrochen bzw. von `takeDrawing` übernommen).
 * `takeDrawing` schliesst ein laufendes Zeichnen ab (z. B. Enter im Meldungsfeld). `ShapeButton` ist der Knopf im Journal.
 */
import { useState } from "react";
import L from "leaflet";
import { catalogEntry, cellAtAny, eventShape, geometryOf, shapeCenter, type Area, type EventShape, type LageEvent, type LV95, type RasterSheet } from "@lage/core";
import { toLatLng, toLv95 } from "@lage/map";
import "./shapes.css";

export interface DrawOptions {
  kind: "flaeche" | "linie";
  /** bestehende Form zum Bearbeiten */
  initial?: LV95[];
  /** `initial` ist die automatisch berechnete Form (nur Ausgangspunkt) */
  fromAuto?: boolean;
  /** Linienfarbe (Kartenfarbe der Art) */
  color?: string;
  /** Titel in der Werkzeugleiste, z. B. «Minensperre» */
  title?: string;
  /** wer zeichnet (z. B. «neu» für die Meldungszeile) – für `takeDrawing` */
  owner?: string;
}

interface ActiveDraw {
  owner?: string;
  abort: () => void;
  take: () => { kind: "flaeche" | "linie"; pts: LV95[] } | "unfertig" | "unveraendert";
}
let active: ActiveDraw | null = null;
/** Doppelklick-Zoom war vor dem Zeichnen an (nach dem Zeichnen wieder einschalten) */
let restoreDblZoom = false;

/** Doppelklick: so kurz nach dem Setzen eines Punkts gehört dieser Punkt zum Doppelklick (ms) */
const DBL_MS = 600;
const round = (pts: LV95[]) => pts.map((p) => ({ e: Math.round(p.e * 10) / 10, n: Math.round(p.n * 10) / 10 }));

export function drawShape(map: L.Map, o: DrawOptions): Promise<LV95[] | null> {
  active?.abort();
  return new Promise((resolve) => {
    const color = o.color ?? "#101414";
    const min = o.kind === "flaeche" ? 3 : 2;
    const pts: LV95[] = (o.initial ?? []).map((p) => ({ ...p }));
    const start = JSON.stringify(round(pts));
    /** bestehende Form bearbeiten: Klick auf die Karte setzt keine neuen Punkte */
    let editing = pts.length >= min;
    let live: LV95 | null = null;
    /** Zeitpunkt des zuletzt per Klick gesetzten Punkts (Doppelklick erkennen) */
    let lastAdd = 0;
    const el = map.getContainer();
    el.classList.add("lt-drawing");
    // Doppelklick beendet das Zeichnen – nicht zoomen
    if (map.doubleClickZoom?.enabled()) { restoreDblZoom = true; map.doubleClickZoom.disable(); }
    // Handy: Karte liegt über dem Journal – beim Zeichnen ins Bild holen
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "nearest" });
    // bestehende Form am Bildschirm zu klein zum Bearbeiten (oder nicht sichtbar): hinzoomen
    if (editing) {
      const bb = L.latLngBounds(pts.map(toLatLng));
      const a = map.latLngToContainerPoint(bb.getNorthWest()), z = map.latLngToContainerPoint(bb.getSouthEast());
      const sz = map.getSize();
      const small = Math.max(Math.abs(z.x - a.x), Math.abs(z.y - a.y)) < 140;
      const off = a.x < 0 || a.y < 0 || z.x > sz.x || z.y > sz.y;
      if (small || off) map.fitBounds(bb.pad(0.6), { animate: false, maxZoom: Math.max(map.getZoom(), map.getBoundsZoom(bb.pad(0.6))) });
    }
    const g = L.layerGroup().addTo(map);
    const handles = L.layerGroup().addTo(map);

    // Werkzeugleiste
    const bar = L.DomUtil.create("div", "lt-drawbar", el);
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.disableScrollPropagation(bar);
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", o.kind === "flaeche" ? "Fläche zeichnen" : "Linie zeichnen");
    const what = o.kind === "flaeche" ? "Fläche" : "Linie";
    const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    bar.innerHTML = `<b class="lt-db-title"></b>`
      + `<span class="lt-db-n" aria-live="polite"></span>`
      + `<span class="lt-db-help"></span>`
      + `<button type="button" data-a="new" title="Punkte verwerfen und neu zeichnen" aria-label="Neu zeichnen">Neu<span class="lt-db-t"> zeichnen</span></button>`
      + `<button type="button" data-a="undo" title="Letzten Punkt entfernen (Backspace)" aria-label="Letzten Punkt entfernen">↶<span class="lt-db-t"> Punkt</span></button>`
      + `<button type="button" data-a="cancel" title="Abbrechen (Esc)" aria-label="Abbrechen"><span class="lt-db-x">✕</span><span class="lt-db-t">Abbrechen</span></button>`
      + `<button type="button" data-a="done" class="primary" title="Fertig (Enter / Doppelklick)">Fertig</button>`;
    const titleEl = bar.querySelector(".lt-db-title") as HTMLElement;
    const helpEl = bar.querySelector(".lt-db-help") as HTMLElement;
    const nEl = bar.querySelector(".lt-db-n") as HTMLElement;
    const doneBtn = bar.querySelector('[data-a="done"]') as HTMLButtonElement;
    const undoBtn = bar.querySelector('[data-a="undo"]') as HTMLButtonElement;
    const newBtn = bar.querySelector('[data-a="new"]') as HTMLButtonElement;
    bar.addEventListener("click", (ev) => {
      const a = (ev.target as HTMLElement).closest("button")?.dataset.a;
      if (a === "done") finish();
      else if (a === "cancel") cancel();
      else if (a === "undo") undo();
      else if (a === "new") restart();
    });
    const labels = () => {
      titleEl.textContent = `${editing ? `${what} bearbeiten` : `${what} zeichnen`}${o.title ? ` · ${o.title}` : ""}${editing && o.fromAuto ? " (automatisch)" : ""}`;
      helpEl.textContent = editing
        ? (touch ? "Punkte ziehen · Kantenmitte ziehen = neuer Punkt" : "Punkte ziehen · Kantenmitte ziehen = neuer Punkt · Doppelklick auf Punkt = löschen")
        : touch ? "Tippen = Punkt · «Fertig» beendet" : "Klicken = Punkt · Doppelklick/Enter = fertig · ⌫ = zurück · Esc";
      newBtn.hidden = !editing;
    };

    const draw = () => {
      g.clearLayers();
      const ll = pts.map(toLatLng);
      const withLive = live && pts.length ? [...ll, toLatLng(live)] : ll;
      if (withLive.length >= 2) {
        const closed = o.kind === "flaeche" && withLive.length >= 3;
        const shape = closed ? L.polygon(withLive, { interactive: false, color, weight: 2.5, fillColor: color, fillOpacity: 0.12 })
          : L.polyline(withLive, { interactive: false, color, weight: 2.5 });
        L.polyline(closed ? [...withLive, withLive[0]!] : withLive, { interactive: false, color: "#fff", weight: 6, opacity: 0.8 }).addTo(g);
        shape.addTo(g);
        if (live && pts.length) L.polyline([ll[ll.length - 1]!, toLatLng(live)], { interactive: false, color, weight: 1.5, dashArray: "5 5" }).addTo(g);
      }
      nEl.textContent = `${pts.length} ${pts.length === 1 ? "Punkt" : "Punkte"}`;
      doneBtn.disabled = pts.length < min;
      undoBtn.disabled = !pts.length;
    };

    const vertexIcon = (cls: string) => L.divIcon({ className: `lt-vtx ${cls}`, html: `<i style="--c:${color}"></i>`, iconSize: [0, 0] });
    const drawHandles = () => {
      handles.clearLayers();
      pts.forEach((p, i) => {
        const m = L.marker(toLatLng(p), { icon: vertexIcon(i === 0 ? "first" : ""), draggable: true, keyboard: false, zIndexOffset: 1000, bubblingMouseEvents: false });
        m.on("drag", () => { pts[i] = toLv95(m.getLatLng()); draw(); });
        m.on("dragend", () => drawHandles());
        // Zeichnen: Klick auf den ersten Punkt schliesst die Fläche; Doppelklick (auch auf einem Griff) = fertig.
        // Löschen per Doppelklick nur beim Bearbeiten.
        m.on("click", () => { if (!editing && i === 0 && o.kind === "flaeche" && pts.length >= 3) finish(); });
        m.on("dblclick", (ev) => {
          L.DomEvent.stop(ev.originalEvent);
          if (!editing) { dblFinish(); return; }
          if (pts.length > min) { pts.splice(i, 1); draw(); drawHandles(); }
        });
        m.addTo(handles);
      });
      // Zwischenpunkte zum Einfügen
      const n = pts.length;
      const segs = o.kind === "flaeche" && n >= 3 ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const a = pts[i]!, b = pts[(i + 1) % n]!;
        const mid = { e: (a.e + b.e) / 2, n: (a.n + b.n) / 2 };
        const m = L.marker(toLatLng(mid), { icon: vertexIcon("mid"), draggable: true, keyboard: false, zIndexOffset: 900, bubblingMouseEvents: false });
        let inserted = false;
        m.on("dragstart", () => { pts.splice(i + 1, 0, mid); inserted = true; });
        m.on("drag", () => { if (inserted) { pts[i + 1] = toLv95(m.getLatLng()); draw(); } });
        m.on("dragend", () => drawHandles());
        m.on("dblclick", (ev) => { L.DomEvent.stop(ev.originalEvent); if (!editing) dblFinish(); });
        m.addTo(handles);
      }
    };

    const near = (a: LV95, b: LV95) => {
      const pa = map.latLngToContainerPoint(toLatLng(a)), pb = map.latLngToContainerPoint(toLatLng(b));
      return pa.distanceTo(pb) < 6;
    };
    const onClick = (ev: L.LeafletMouseEvent) => {
      if (editing) return;
      const p = toLv95(ev.latlng);
      const last = pts[pts.length - 1];
      if (last && near(last, p)) return; // zweiter Klick eines Doppelklicks
      pts.push(p);
      lastAdd = Date.now();
      draw(); drawHandles();
    };
    /**
     * Doppelklick = fertig, ohne zusätzlichen Punkt: der Punkt, den der erste Klick des Doppelklicks eben gesetzt hat,
     * fällt wieder weg – ausser er wird gebraucht, damit die Form gültig ist (z. B. dritter Punkt einer Fläche).
     */
    const dblFinish = () => {
      if (editing) { finish(); return; }
      if (Date.now() - lastAdd < DBL_MS && pts.length > min) pts.pop();
      lastAdd = 0;
      if (pts.length >= min) finish();
      else { draw(); drawHandles(); }
    };
    const onMove = (ev: L.LeafletMouseEvent) => { if (pts.length && !editing) { live = toLv95(ev.latlng); draw(); } };
    const onOut = () => { live = null; draw(); };
    const onDbl = (ev: L.LeafletMouseEvent) => { L.DomEvent.stop(ev.originalEvent); dblFinish(); };
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
      if (ev.key === "Escape") { stop(); cancel(); }
      else if (ev.key === "Enter") { stop(); finish(); }
      else if (ev.key === "Backspace" || (ev.key === "z" && (ev.ctrlKey || ev.metaKey))) { stop(); undo(); }
    };
    const undo = () => { if (pts.length) { pts.pop(); if (editing && pts.length < min) editing = false; labels(); draw(); drawHandles(); } };
    const restart = () => { pts.length = 0; editing = false; live = null; labels(); draw(); drawHandles(); };
    const cleanup = () => {
      map.off("click", onClick); map.off("mousemove", onMove); map.off("mouseout", onOut); map.off("dblclick", onDbl);
      document.removeEventListener("keydown", onKey, true);
      el.classList.remove("lt-drawing");
      g.remove(); handles.remove(); bar.remove();
      // Doppelklick-Zoom erst nach dem Doppelklick wieder einschalten (sonst zoomt dessen zweiter Teil noch)
      window.setTimeout(() => { if (!active && restoreDblZoom) { restoreDblZoom = false; map.doubleClickZoom?.enable(); } }, 350);
      if (active === me) active = null;
    };
    const finish = () => {
      if (pts.length < min) return;
      cleanup();
      // unverändert übernommene automatische Form bleibt automatisch
      resolve(o.fromAuto && JSON.stringify(round(pts)) === start ? null : round(pts));
    };
    const cancel = () => { cleanup(); resolve(null); };
    const me: ActiveDraw = {
      owner: o.owner,
      abort: cancel,
      take: () => {
        if (pts.length < min) return "unfertig";
        const out = round(pts);
        const same = o.fromAuto && JSON.stringify(out) === start;
        cleanup();
        resolve(null);
        return same ? "unveraendert" as const : { kind: o.kind, pts: out };
      },
    };
    active = me;

    map.on("click", onClick); map.on("mousemove", onMove); map.on("mouseout", onOut); map.on("dblclick", onDbl);
    document.addEventListener("keydown", onKey, true);
    labels(); draw(); drawHandles();
  });
}

/** läuft gerade ein Zeichenwerkzeug? (z. B. für andere Klick-Werkzeuge) */
export const isDrawingShape = () => active !== null;

/**
 * Laufendes Zeichnen von `owner` abschliessen und die Form übernehmen (z. B. Enter im Meldungsfeld während des Zeichnens).
 * @returns die Form; «unfertig», wenn noch zu wenige Punkte gesetzt sind (Zeichnen läuft weiter); null, wenn nichts
 *   läuft (oder eine automatische Form unverändert blieb – dann gilt weiter die automatische)
 */
export function takeDrawing(owner?: string): EventShape | "unfertig" | null {
  if (!active || (owner !== undefined && active.owner !== owner)) return null;
  const r = active.take();
  if (r === "unveraendert") return null;
  return r === "unfertig" ? r : { kind: r.kind, pts: r.pts, auto: false };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Änderung einer Meldung nach dem Zeichnen: Form (von Hand), Punktzeichen an den Schwerpunkt, Planquadrat neu,
 * Strassenlage weg.
 */
export function shapePatch(shape: EventShape, sheets: RasterSheet[]): Partial<LageEvent> {
  const c = shapeCenter(shape);
  const pos = { e: Math.round(c.e), n: Math.round(c.n) };
  const cell = cellAtAny(sheets, pos);
  return { shape, pos, where: "Karte", cells: cell ? [cell.label] : undefined, angle: undefined, road: undefined };
}

/** passt die gezeichnete Form zum Zeichen? (Zeichen nachträglich auf ein Punktzeichen geändert → Form verwerfen) */
export const shapeFits = (shape: EventShape, sym: string) => geometryOf(sym) === shape.kind;

const ICON_AREA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5 8 2l5.5 3.5-1.5 7-8 1z" fill="currentColor" fill-opacity=".15" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const ICON_LINE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 12 6 6l4 4 4-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Knopf «Fläche zeichnen» / «Fläche bearbeiten» (nur bei Flächen- und Linienzeichen). Eine automatisch berechnete Form
 * (Planquadrat, NAI, Strasse) ist der Ausgangspunkt zum Bearbeiten; «×» setzt eine gezeichnete Form zurück auf automatisch.
 * @param base angezeigte Form (z. B. automatisch aus dem Planquadrat) als Ausgangspunkt zum Bearbeiten
 */
export function ShapeButton({ map, sym, value, base, onChange, color, className = "chipbtn", ctx, owner }: {
  map: L.Map;
  sym: string;
  /** von Hand gezeichnete Form (auto: false) oder undefined */
  value?: EventShape;
  base?: EventShape;
  onChange: (s: EventShape | undefined) => void;
  color?: string;
  className?: string;
  /** für die Ausgangsform, wenn `base` fehlt (Planquadrat/NAI der Meldung) */
  ctx?: { sheets: RasterSheet[]; areas: Area[]; event?: Pick<LageEvent, "sym" | "pos" | "cells" | "nai" | "where" | "angle" | "dir" | "shape"> };
  /** Kennung für `takeDrawing` (z. B. «neu») */
  owner?: string;
}) {
  const [busy, setBusy] = useState(false);
  const geo = value?.kind ?? geometryOf(sym);
  if (geo === "punkt") return null;
  const kind = geo;
  const manual = value && !value.auto ? value : undefined;
  // von Hand gezeichnete Form bearbeiten; sonst die automatisch berechnete als Ausgangspunkt
  const auto0 = !manual ? base ?? (ctx?.event ? eventShape({ ...ctx.event, sym }, ctx) : undefined) : undefined;
  const auto = auto0?.kind === kind ? auto0 : undefined;
  const start = manual?.kind === kind ? manual : auto;
  const word = kind === "flaeche" ? "Fläche" : "Linie";
  const run = async () => {
    setBusy(true);
    const pts = await drawShape(map, { kind, initial: start?.pts, fromAuto: !manual && !!auto, color, title: catalogEntry(sym)?.name.split(" / ")[0], owner });
    setBusy(false);
    if (pts) onChange({ kind, pts, auto: false });
  };
  return (
    <span className="shapebtn">
      <button type="button" className={className} onClick={run} disabled={busy}
        title={manual ? `${word} auf der Karte bearbeiten (Punkte ziehen)` : auto ? `Automatische ${word} (aus dem Ort) auf der Karte anpassen oder neu zeichnen` : `${word} auf der Karte zeichnen`}>
        <span dangerouslySetInnerHTML={{ __html: kind === "flaeche" ? ICON_AREA : ICON_LINE }} />
        {busy ? "Auf Karte zeichnen …" : start ? `${word} bearbeiten` : `${word} zeichnen`}
      </button>
      {manual && !busy && <button type="button" className={className} onClick={() => onChange(undefined)} title={`Gezeichnete ${word} entfernen (wieder automatisch aus dem Ort)`} aria-label={`Gezeichnete ${word} entfernen`}>×</button>}
    </span>
  );
}
