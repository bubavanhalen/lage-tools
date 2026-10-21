/**
 * Messen auf der Karte: Distanz und Azimut (Grad und Artilleriepromille, 6400 ‰) pro Teilstrecke und gesamt.
 * Klick setzt Punkte, Doppelklick/Enter beendet, Backspace nimmt den letzten Punkt zurück, Esc bricht ab.
 * Azimut bezogen auf Gitternord (LV95). Pro Karte läuft höchstens eine Messung.
 * Änderungen werden als Karten-Ereignis «lt-measure» gemeldet (für die Werkzeugleiste).
 */
import L from "leaflet";
import { distanceAzimuth, type LV95 } from "@lage/core";
import { overlayPane } from "./flash";
import { toLatLng, toLv95 } from "./swissmap";

export interface MeasureLeg {
  from: LV95;
  to: LV95;
  /** Meter */
  m: number;
  /** Grad (0–360, Gitternord) */
  deg: number;
  /** Artilleriepromille (0–6400) */
  mils: number;
}

export interface MeasureState {
  points: LV95[];
  legs: MeasureLeg[];
  /** Gesamtlänge in Metern */
  total: number;
  /** Teilstrecke zum Mauszeiger (nur während des Messens) */
  live?: MeasureLeg;
  /** Messung abgeschlossen (bleibt sichtbar bis zum Schliessen) */
  done: boolean;
}

export interface MeasureEvent extends L.LeafletEvent {
  /** null = Messung beendet und entfernt */
  state: MeasureState | null;
}

export interface MeasureController {
  add(p: LV95): void;
  undo(): void;
  finish(): void;
  /** Messung abbrechen bzw. Ergebnis entfernen */
  cancel(): void;
  state(): MeasureState;
}

/** «420 m», «1.24 km», «12.5 km» */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(2)} km`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** Azimut «073°» und «1298 ‰» (4-stellig, 6400 = Vollkreis) */
export function formatAzimuth(deg: number, mils: number): { deg: string; mils: string } {
  const d = Math.round(deg) % 360;
  const a = Math.round(mils) % 6400;
  return { deg: `${String(d).padStart(3, "0")}°`, mils: `${String(a).padStart(4, "0")} ‰` };
}

/** Während des Messens sind Zeichen/Flächen nicht klickbar (Klick setzt einen Messpunkt statt eine Meldung zu wählen). */
function injectStyle() {
  if (typeof document === "undefined" || document.getElementById("lt-measure-style")) return;
  const st = document.createElement("style");
  st.id = "lt-measure-style";
  st.textContent = ".lt-measuring .leaflet-interactive{pointer-events:none!important}";
  document.head.appendChild(st);
}

const legOf = (a: LV95, b: LV95): MeasureLeg => ({ from: a, to: b, ...distanceAzimuth(a, b) });

const active = new WeakMap<L.Map, MeasureController>();

export function isMeasuring(map: L.Map): boolean {
  const c = active.get(map);
  return !!c && !c.state().done;
}

export function activeMeasure(map: L.Map): MeasureController | undefined {
  return active.get(map);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const LBL = "font:600 11px/1.25 var(--f-mono,ui-monospace,monospace);font-variant-numeric:tabular-nums;color:#101414;background:rgba(255,255,255,.92);border:1px solid rgba(0,0,0,.18);border-radius:3px;padding:1px 5px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.18);";

type Place = "c" | "up" | "down" | "left" | "right";
const TRANSFORM: Record<Place, string> = {
  c: "-50%,-50%",
  up: "-50%,calc(-100% - 7px)",
  down: "-50%,7px",
  left: "calc(-100% - 9px),-50%",
  right: "9px,-50%",
};

function label(html: string, kind: "leg" | "total" | "live", place: Place = "right"): L.DivIcon {
  const extra = kind === "total" ? "background:#101414;color:#fff;border-color:#101414;font-weight:600;" : kind === "live" ? "opacity:.92;" : "";
  return L.divIcon({
    className: "lt-measure-lbl",
    html: `<span style="position:absolute;left:0;top:0;transform:translate(${TRANSFORM[place]});${LBL}${extra}">${html}</span>`,
    iconSize: [0, 0],
  });
}

/** Geschätzte Box (px) einer Beschriftung relativ zum Ankerpunkt. */
function labelBox(at: L.Point, text: string, lines: number, place: Place): [number, number, number, number] {
  const w = text.length * 6.7 + 12, h = 16 * lines + 4;
  const [dx, dy] = place === "up" ? [-w / 2, -h - 7] : place === "down" ? [-w / 2, 7] : place === "left" ? [-w - 9, -h / 2] : place === "right" ? [9, -h / 2] : [-w / 2, -h / 2];
  return [at.x + dx, at.y + dy, at.x + dx + w, at.y + dy + h];
}
const overlaps = (a: number[], b: number[]) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;

function legHtml(l: MeasureLeg): string {
  const a = formatAzimuth(l.deg, l.mils);
  return `${esc(formatDistance(l.m))} · ${a.deg} · ${a.mils}`;
}

/**
 * Startet eine Messung (eine laufende wird ersetzt).
 * @param start erster Punkt (z. B. «Messen ab hier» im Kontextmenü)
 */
export function startMeasure(map: L.Map, opts: { start?: LV95 } = {}): MeasureController {
  active.get(map)?.cancel();
  const points: LV95[] = [];
  let live: LV95 | null = null;
  let done = false;
  let gone = false;
  const g = L.layerGroup().addTo(map);
  const pane = overlayPane(map, "ltMeasure", 640);
  const container = map.getContainer();
  container.classList.add("lt-picking", "lt-measuring");
  injectStyle();

  const state = (): MeasureState => {
    const legs = points.slice(1).map((p, i) => legOf(points[i]!, p));
    const total = legs.reduce((s, l) => s + l.m, 0);
    const last = points[points.length - 1];
    return { points: [...points], legs, total, done, live: !done && last && live ? legOf(last, live) : undefined };
  };

  const fire = () => map.fire("lt-measure", { state: gone ? null : state() });

  const draw = () => {
    g.clearLayers();
    const s = state();
    const lls = points.map(toLatLng);
    if (lls.length > 1) {
      L.polyline(lls, { pane, color: "#fff", weight: 6, opacity: 0.9, interactive: false }).addTo(g);
      L.polyline(lls, { pane, color: "#101414", weight: 2.5, opacity: 1, interactive: false }).addTo(g);
    }
    if (s.live && live) {
      const seg = [toLatLng(s.live.from), toLatLng(live)];
      L.polyline(seg, { pane, color: "#fff", weight: 5, opacity: 0.8, interactive: false }).addTo(g);
      L.polyline(seg, { pane, color: "#101414", weight: 2, opacity: 0.9, dashArray: "6 5", interactive: false }).addTo(g);
    }
    // Teilstrecken: abwechselnd ober-/unterhalb (bzw. links/rechts bei steilen Strecken); zu kurze oder
    // überlappende Beschriftungen weglassen – die Tabelle in der Werkzeugleiste zeigt alle Werte.
    const taken: number[][] = [];
    const endAt = s.live && live ? live : points[points.length - 1];
    if (endAt) taken.push(labelBox(map.latLngToContainerPoint(toLatLng(endAt)), "0000000000000000000000000000", s.live ? 2 : 1, "right"));
    const midLabels = s.legs.length >= 2 || (!!s.live && s.legs.length >= 1);
    if (midLabels) s.legs.forEach((l, i) => {
      const a = map.latLngToContainerPoint(toLatLng(l.from)), b = map.latLngToContainerPoint(toLatLng(l.to));
      if (a.distanceTo(b) < 70) return;
      const mid = toLatLng({ e: (l.from.e + l.to.e) / 2, n: (l.from.n + l.to.n) / 2 });
      const at = map.latLngToContainerPoint(mid);
      const steep = Math.abs(b.y - a.y) > Math.abs(b.x - a.x) * 1.5;
      const pref: Place[] = steep ? (i % 2 ? ["right", "left"] : ["left", "right"]) : i % 2 ? ["down", "up"] : ["up", "down"];
      const text = legHtml(l).replace(/&[a-z]+;/g, "x");
      for (const place of pref) {
        const box = labelBox(at, text, 1, place);
        if (taken.some((t) => overlaps(t, box))) continue;
        taken.push(box);
        L.marker(mid, { icon: label(legHtml(l), "leg", place), pane, interactive: false, keyboard: false }).addTo(g);
        break;
      }
    });
    points.forEach((p, i) => {
      L.circleMarker(toLatLng(p), { pane, radius: i === 0 ? 5 : 4, color: "#101414", weight: 2, fillColor: i === 0 ? "#101414" : "#fff", fillOpacity: 1, interactive: false }).addTo(g);
    });
    if (s.live && live) {
      const tot = s.total + s.live.m;
      // rechts im Kartenbild (unter den Werkzeugen) links vom Mauszeiger beschriften
      const left = map.latLngToContainerPoint(toLatLng(live)).x > map.getSize().x - 560;
      L.marker(toLatLng(live), { icon: label(`${legHtml(s.live)}${s.legs.length ? `<br>Σ ${esc(formatDistance(tot))}` : ""}`, "live", left ? "left" : "right"), pane, interactive: false, keyboard: false }).addTo(g);
    } else if (s.legs.length) {
      const last = points[points.length - 1]!;
      const html = s.legs.length === 1 ? legHtml(s.legs[0]!) : `Σ ${esc(formatDistance(s.total))}`;
      const left = map.latLngToContainerPoint(toLatLng(last)).x > map.getSize().x - 560;
      L.marker(toLatLng(last), { icon: label(html, "total", left ? "left" : "right"), pane, interactive: false, keyboard: false }).addTo(g);
    }
    fire();
  };

  const near = (a: LV95, b: LV95) => {
    const pa = map.latLngToContainerPoint(toLatLng(a)), pb = map.latLngToContainerPoint(toLatLng(b));
    return pa.distanceTo(pb) < 4;
  };

  const onClick = (ev: L.LeafletMouseEvent) => {
    if (done) return;
    ctl.add(toLv95(ev.latlng));
  };
  const onMove = (ev: L.LeafletMouseEvent) => {
    if (done || !points.length) return;
    live = toLv95(ev.latlng);
    draw();
  };
  const onDbl = (ev: L.LeafletMouseEvent) => {
    if (done) return;
    L.DomEvent.stop(ev.originalEvent);
    ctl.finish();
  };
  const onKey = (ev: KeyboardEvent) => {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    const stop = () => { ev.preventDefault(); ev.stopPropagation(); };
    if (ev.key === "Escape") { stop(); ctl.cancel(); }
    else if (done) return;
    else if (ev.key === "Enter") { stop(); ctl.finish(); }
    else if (ev.key === "Backspace" || (ev.key === "z" && (ev.ctrlKey || ev.metaKey))) { stop(); ctl.undo(); }
  };
  const detach = () => {
    map.off("click", onClick);
    map.off("mousemove", onMove);
    map.off("dblclick", onDbl);
    container.classList.remove("lt-picking", "lt-measuring");
  };

  const ctl: MeasureController = {
    add(p) {
      if (done || gone) return;
      const last = points[points.length - 1];
      if (last && near(last, p)) return; // zweiter Klick eines Doppelklicks
      points.push(p);
      draw();
    },
    undo() {
      if (done || gone || !points.length) return;
      points.pop();
      if (!points.length) live = null;
      draw();
    },
    finish() {
      if (done || gone) return;
      if (points.length < 2) { ctl.cancel(); return; }
      done = true;
      live = null;
      detach();
      draw();
    },
    cancel() {
      if (gone) return;
      gone = true;
      detach();
      document.removeEventListener("keydown", onKey, true);
      map.off("zoomend", draw);
      map.removeLayer(g);
      if (active.get(map) === ctl) active.delete(map);
      fire();
    },
    state,
  };

  map.on("click", onClick);
  map.on("zoomend", draw);
  map.on("mousemove", onMove);
  map.on("dblclick", onDbl);
  document.addEventListener("keydown", onKey, true);
  active.set(map, ctl);
  if (opts.start) points.push(opts.start);
  draw();
  return ctl;
}
