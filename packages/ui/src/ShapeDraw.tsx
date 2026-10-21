/**
 * Fläche/Linie von Hand zeichnen oder bearbeiten.
 * - Klick/Tippen setzt Punkte, Doppelklick oder Enter beendet, Backspace nimmt den letzten Punkt zurück, Esc bricht ab.
 * - Touch: Tippen setzt Punkte, Knopf «Fertig».
 * - Bestehende Form: Eckpunkte ziehen (Maus und Touch), Zwischenpunkte (auf der Kante) ziehen fügt einen Punkt ein,
 *   Doppelklick auf einen Eckpunkt löscht ihn.
 * `drawShape` liefert die Punkte (LV95) oder null (abgebrochen). `ShapeButton` ist der Knopf im Journal.
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
  /** Linienfarbe (Kartenfarbe der Art) */
  color?: string;
  /** Titel in der Werkzeugleiste, z. B. «Minensperre» */
  title?: string;
}

let active: (() => void) | null = null;

export function drawShape(map: L.Map, o: DrawOptions): Promise<LV95[] | null> {
  active?.();
  return new Promise((resolve) => {
    const color = o.color ?? "#101414";
    const min = o.kind === "flaeche" ? 3 : 2;
    const pts: LV95[] = (o.initial ?? []).map((p) => ({ ...p }));
    /** bestehende Form bearbeiten: Klick auf die Karte setzt keine neuen Punkte */
    const editing = pts.length >= min;
    let live: LV95 | null = null;
    const el = map.getContainer();
    el.classList.add("lt-drawing");
    // Handy: Karte liegt über dem Journal – beim Zeichnen ins Bild holen
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "nearest" });
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
    bar.innerHTML = `<b>${o.initial?.length ? `${what} bearbeiten` : `${what} zeichnen`}${o.title ? ` · ${esc(o.title)}` : ""}</b>`
      + `<span class="lt-db-n" aria-live="polite"></span>`
      + `<span class="lt-db-help">${o.initial?.length ? (touch ? "Punkte ziehen · Kantenmitte ziehen = neuer Punkt" : "Punkte ziehen · Kantenmitte ziehen = neuer Punkt · Doppelklick auf Punkt = löschen")
        : touch ? "Tippen = Punkt · «Fertig» beendet" : "Klicken = Punkt · Doppelklick/Enter = fertig · ⌫ = zurück · Esc"}</span>`
      + `<button type="button" data-a="undo" title="Letzten Punkt entfernen (Backspace)" aria-label="Letzten Punkt entfernen">↶<span class="lt-db-t"> Punkt</span></button>`
      + `<button type="button" data-a="cancel" title="Abbrechen (Esc)" aria-label="Abbrechen"><span class="lt-db-x">✕</span><span class="lt-db-t">Abbrechen</span></button>`
      + `<button type="button" data-a="done" class="primary" title="Fertig (Enter / Doppelklick)">Fertig</button>`;
    const nEl = bar.querySelector(".lt-db-n") as HTMLElement;
    const doneBtn = bar.querySelector('[data-a="done"]') as HTMLButtonElement;
    const undoBtn = bar.querySelector('[data-a="undo"]') as HTMLButtonElement;
    bar.addEventListener("click", (ev) => {
      const a = (ev.target as HTMLElement).closest("button")?.dataset.a;
      if (a === "done") finish();
      else if (a === "cancel") cancel();
      else if (a === "undo") undo();
    });

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
        m.on("click", () => { if (i === 0 && o.kind === "flaeche" && pts.length >= 3 && !o.initial?.length) finish(); });
        m.on("dblclick", () => { if (pts.length > min) { pts.splice(i, 1); draw(); drawHandles(); } });
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
      draw(); drawHandles();
    };
    const onMove = (ev: L.LeafletMouseEvent) => { if (pts.length && !editing) { live = toLv95(ev.latlng); draw(); } };
    const onOut = () => { live = null; draw(); };
    const onDbl = (ev: L.LeafletMouseEvent) => { L.DomEvent.stop(ev.originalEvent); finish(); };
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
      if (ev.key === "Escape") { stop(); cancel(); }
      else if (ev.key === "Enter") { stop(); finish(); }
      else if (ev.key === "Backspace" || (ev.key === "z" && (ev.ctrlKey || ev.metaKey))) { stop(); undo(); }
    };
    const undo = () => { if (pts.length) { pts.pop(); draw(); drawHandles(); } };
    const cleanup = () => {
      map.off("click", onClick); map.off("mousemove", onMove); map.off("mouseout", onOut); map.off("dblclick", onDbl);
      document.removeEventListener("keydown", onKey, true);
      el.classList.remove("lt-drawing");
      g.remove(); handles.remove(); bar.remove();
      if (active === abort) active = null;
    };
    const finish = () => {
      if (pts.length < min) return;
      cleanup();
      resolve(pts.map((p) => ({ e: Math.round(p.e * 10) / 10, n: Math.round(p.n * 10) / 10 })));
    };
    const cancel = () => { cleanup(); resolve(null); };
    const abort = () => cancel();
    active = abort;

    map.on("click", onClick); map.on("mousemove", onMove); map.on("mouseout", onOut); map.on("dblclick", onDbl);
    document.addEventListener("keydown", onKey, true);
    draw(); drawHandles();
  });
}

/** läuft gerade ein Zeichenwerkzeug? (z. B. für andere Klick-Werkzeuge) */
export const isDrawingShape = () => active !== null;

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
 * Knopf «Fläche zeichnen» / «Linie zeichnen» (nur bei Flächen- und Linienzeichen). Zeigt «bearbeiten», wenn schon
 * eine von Hand gezeichnete Form da ist, und «×» zum Zurücksetzen auf die automatische Form.
 * @param base angezeigte Form (z. B. automatisch aus dem Planquadrat) als Ausgangspunkt zum Bearbeiten
 */
export function ShapeButton({ map, sym, value, base, onChange, color, className = "chipbtn", ctx }: {
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
}) {
  const [busy, setBusy] = useState(false);
  const geo = value?.kind ?? geometryOf(sym);
  if (geo === "punkt") return null;
  const kind = geo;
  const manual = value && !value.auto ? value : undefined;
  // von Hand gezeichnete Form bearbeiten; sonst neu zeichnen (die automatische Form ist nur der Hinweis im Titel)
  const start = manual;
  const auto = !manual ? base ?? (ctx?.event ? eventShape({ ...ctx.event, sym }, ctx) : undefined) : undefined;
  const word = kind === "flaeche" ? "Fläche" : "Linie";
  const run = async () => {
    setBusy(true);
    const pts = await drawShape(map, { kind, initial: start?.kind === kind ? start.pts : undefined, color, title: catalogEntry(sym)?.name.split(" / ")[0] });
    setBusy(false);
    if (pts) onChange({ kind, pts, auto: false });
  };
  return (
    <span className="shapebtn">
      <button type="button" className={className} onClick={run} disabled={busy}
        title={manual ? `${word} auf der Karte bearbeiten (Punkte ziehen)` : auto ? `${word} genau auf der Karte zeichnen – sonst automatisch aus dem Ort` : `${word} auf der Karte zeichnen`}>
        <span dangerouslySetInnerHTML={{ __html: kind === "flaeche" ? ICON_AREA : ICON_LINE }} />
        {busy ? "Auf Karte zeichnen …" : manual ? `${word} bearbeiten` : `${word} zeichnen`}
      </button>
      {manual && !busy && <button type="button" className={className} onClick={() => onChange(undefined)} title={`Gezeichnete ${word} entfernen (wieder automatisch aus dem Ort)`} aria-label={`Gezeichnete ${word} entfernen`}>×</button>}
    </span>
  );
}
