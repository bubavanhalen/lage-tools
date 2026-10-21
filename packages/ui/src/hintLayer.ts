/**
 * Kartenebene «Hinweise»: pro Hinweis ein dezentes Fähnchen (Regel-Kürzel, Stufe) an der Nordwest-Ecke des Planquadrats
 * bzw. NAI (oder links oberhalb des Orts) – so bleiben die Zeichen und ihre Stapel frei.
 * Mehrere Hinweise am selben Ort teilen sich ein Fähnchen. Pendelverkehr (C2) als gestrichelte Route mit Pfeilen,
 * D1 als Kreis 500 m um den eigenen Stao. Der gewählte Hinweis umrandet PQ/NAI; die Zeichen der Auslöser bleiben
 * kräftig, alle anderen werden blass (Klasse `lt-hintsel` am Kartencontainer, `hl` an den Zeichen).
 */
import L from "leaflet";
import { cellBounds, findCells, lastPosition, type Bounds, type Exercise, type Hint, type LV95 } from "@lage/core";
import { escapeHtml, toLatLng } from "@lage/map";
import { decisionOf, hhmm, isOver } from "./hintsData";
import "./hints.css";

export interface HintLayerOptions {
  hints: Hint[];
  ex: Exercise;
  /** Lagezeit (ISO lokal) */
  t: string;
  selectedId: string | null;
  /** gewählten Hinweis hervorheben (übrige Zeichen blass) */
  focus: boolean;
  onClick: (h: Hint) => void;
}

/** Kartenfarben (Karte bleibt auch im Dunkelmodus hell) – entsprechen --m-flash, --m-rot, --m-ink */
const FLASH = "#F2B705";
const ROT = "#D3262D";
const INK = "#101414";
const D1_RADIUS = 500;
const MAX_PILLS = 3;
const LEVEL_RANK = { hoch: 0, mittel: 1, info: 2 } as const;

const GEO_PANE = "lt-hint-geo";
const BADGE_PANE = "lt-hint-badge";
function panes(map: L.Map) {
  if (!map.getPane(GEO_PANE)) { const p = map.createPane(GEO_PANE); p.style.zIndex = "430"; p.style.pointerEvents = "none"; }
  if (!map.getPane(BADGE_PANE)) map.createPane(BADGE_PANE).style.zIndex = "615";
}

/** Umrisse der Planquadrate eines Hinweises */
function cellRects(h: Hint, ex: Exercise): Bounds[] {
  const out: Bounds[] = [];
  for (const label of h.cells ?? []) {
    const c = findCells(label, ex.sheets)[0];
    const sh = c && ex.sheets.find((s) => s.id === c.sheetId);
    if (c && sh) out.push(cellBounds(sh, c.col, c.row, c.quadrant));
  }
  return out;
}
const naiOf = (h: Hint, ex: Exercise) => (h.nai ? ex.areas.find((a) => a.name === h.nai) : undefined);
const bbox = (pts: LV95[]): Bounds => ({ minE: Math.min(...pts.map((p) => p.e)), maxE: Math.max(...pts.map((p) => p.e)), minN: Math.min(...pts.map((p) => p.n)), maxN: Math.max(...pts.map((p) => p.n)) });

/** Positionen der Auslöser (chronologisch) */
function triggerPts(h: Hint, ex: Exercise): Array<{ p: LV95; t: string }> {
  const by = new Map((ex.events ?? []).map((e) => [e.id, e]));
  return h.events.map((id) => by.get(id)).filter((e) => !!e && !e.deleted && !!e.pos).map((e) => ({ p: e!.pos!, t: e!.t })).sort((a, b) => a.t.localeCompare(b.t));
}

/** Ort und Ausdehnung eines Hinweises (für «Auf Karte» und das Fähnchen) */
export function hintExtent(h: Hint, ex: Exercise): { box: Bounds | null; anchor: LV95 | null; point: boolean } {
  const rects = cellRects(h, ex);
  const a = naiOf(h, ex);
  const pts = [...rects.flatMap((b) => [{ e: b.minE, n: b.minN }, { e: b.maxE, n: b.maxN }]), ...(a?.ring ?? [])];
  const tp = triggerPts(h, ex).map((x) => x.p);
  const all = h.pos ? [h.pos, ...tp] : tp;
  // Fähnchen an der NW-Ecke von PQ/NAI; Ausschnitt umfasst zusätzlich alle Auslöser (z. B. ganze Pendel-Route)
  if (pts.length) {
    const b = bbox(pts);
    // nur NAI: an der Ecke des Umrisses, die der NW-Ecke am nächsten liegt (bleibt am NAI, auch wenn er schräg liegt)
    const anchor = !rects.length && a ? a.ring.reduce((m, p) => (Math.hypot(p.e - b.minE, p.n - b.maxN) < Math.hypot(m.e - b.minE, m.n - b.maxN) ? p : m), a.ring[0]!) : { e: b.minE, n: b.maxN };
    return { box: bbox([...pts, ...all]), anchor, point: false };
  }
  if (!all.length) return { box: null, anchor: null, point: true };
  return { box: bbox(all), anchor: h.pos ?? all[0]!, point: true };
}

export function hintLayer(map: L.Map, o: HintLayerOptions): L.LayerGroup {
  panes(map);
  const g = L.layerGroup();
  const { ex } = o;
  const sel = o.hints.find((h) => h.id === o.selectedId) ?? null;
  // auf der Karte: offene und bestätigte Hinweise, die noch gelten (gewählter immer)
  const shown = o.hints.filter((h) => h === sel || (h.level !== "info" && decisionOf(ex, h) !== "verworfen" && !isOver(h, o.t)));

  // gewählt: Planquadrate und NAI umrandet (weisser Saum, gestrichelt in Signalgelb)
  if (sel) {
    const rings: L.LatLng[][] = cellRects(sel, ex).map((b) => [{ e: b.minE, n: b.minN }, { e: b.maxE, n: b.minN }, { e: b.maxE, n: b.maxN }, { e: b.minE, n: b.maxN }].map(toLatLng));
    const a = naiOf(sel, ex);
    if (a) rings.push(a.ring.map(toLatLng));
    for (const r of rings) {
      L.polygon(r, { pane: GEO_PANE, color: "#fff", weight: 6, opacity: 0.9, fill: false, interactive: false }).addTo(g);
      L.polygon(r, { pane: GEO_PANE, color: INK, weight: 2.5, opacity: 1, dashArray: "8 5", fillColor: FLASH, fillOpacity: 0.16, interactive: false }).addTo(g);
    }
  }

  for (const h of shown) {
    const on = h === sel;
    // Pendel: Route durch die Auslöser, gestrichelt mit Pfeilen, Prognose am Ende
    if (h.rule === "C2") {
      const pts = triggerPts(h, ex).map((x) => x.p).filter((p, i, a) => i === 0 || Math.hypot(p.e - a[i - 1]!.e, p.n - a[i - 1]!.n) > 5);
      if (pts.length >= 2) {
        const ll = pts.map(toLatLng);
        L.polyline(ll, { pane: GEO_PANE, color: "#fff", weight: on ? 6 : 4.5, opacity: on ? 0.9 : 0.6, interactive: false }).addTo(g);
        L.polyline(ll, { pane: GEO_PANE, color: ROT, weight: on ? 3 : 2, opacity: on ? 1 : 0.55, dashArray: on ? "9 6" : "6 6", interactive: false }).addTo(g);
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]!, b = pts[i]!;
          const deg = (Math.atan2(-(b.n - a.n), b.e - a.e) * 180) / Math.PI;
          const s = on ? 16 : 12;
          L.marker(toLatLng({ e: (a.e + b.e) / 2, n: (a.n + b.n) / 2 }), {
            pane: GEO_PANE, interactive: false, keyboard: false,
            icon: L.divIcon({ className: "lt-hb-arrow", iconSize: [s, s], iconAnchor: [s / 2, s / 2], html: `<svg width="${s}" height="${s}" viewBox="0 0 16 16" style="transform:rotate(${deg}deg);opacity:${on ? 1 : 0.7}"><path d="M4 2.5L12 8 4 13.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` }),
          }).addTo(g);
        }
        // Prognose nur, solange sie noch aktuell ist (höchstens 60 Min überfällig)
        if (on && h.next && Date.parse(o.t) - Date.parse(h.next) <= 60 * 60000) {
          const last = pts.at(-1)!;
          L.marker(toLatLng(last), {
            pane: BADGE_PANE, interactive: false, keyboard: false,
            icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="lt-hb-next" style="margin-top:26px">nächste ca. ${escapeHtml(hhmm(h.next, ex.days, o.t))}</div>` }),
          }).addTo(g);
        }
      }
    }
    // Rot sieht Blau: Kreis 500 m um den eigenen Stao (Kern: `pos`; sonst letzter Standort des Elements)
    if (h.rule === "D1") {
      const st = h.pos ?? (h.unit ? lastPosition(ex.events ?? [], "blau", h.unit, o.t) : undefined);
      if (st) {
        const ring = Array.from({ length: 72 }, (_, i) => toLatLng({ e: st.e + D1_RADIUS * Math.cos((i / 72) * 2 * Math.PI), n: st.n + D1_RADIUS * Math.sin((i / 72) * 2 * Math.PI) }));
        L.polygon(ring, { pane: GEO_PANE, color: "#fff", weight: on ? 5 : 4, opacity: on ? 0.9 : 0.6, fill: false, interactive: false }).addTo(g);
        L.polygon(ring, { pane: GEO_PANE, color: INK, weight: on ? 2.2 : 1.5, opacity: on ? 1 : 0.7, dashArray: "3 5", fillColor: FLASH, fillOpacity: on ? 0.1 : 0.05, interactive: false }).addTo(g);
      }
    }
  }

  // Fähnchen: je Ort eines, mehrere Hinweise nebeneinander (wichtigste zuerst). Liegen Fähnchen auf dem Bildschirm
  // übereinander (Übersicht, kleiner Massstab), werden sie zusammengefasst – nach jedem Zoom neu.
  const groups = new Map<string, { at: LV95; point: boolean; hs: Hint[] }>();
  for (const h of shown) {
    const x = hintExtent(h, ex);
    if (!x.anchor) continue;
    const k = `${Math.round(x.anchor.e)}|${Math.round(x.anchor.n)}`;
    const gr = groups.get(k) ?? { at: x.anchor, point: x.point, hs: [] };
    gr.hs.push(h);
    groups.set(k, gr);
  }
  const rank = (h: Hint) => (h === sel ? -1 : LEVEL_RANK[h.level]);
  const badges = L.layerGroup().addTo(g);
  const layout = () => {
    badges.clearLayers();
    const placed: Array<{ at: LV95; point: boolean; hs: Hint[]; box: [number, number, number, number] }> = [];
    const list = [...groups.values()].map((gr) => ({ ...gr, hs: [...gr.hs].sort((a, b) => rank(a) - rank(b)) }))
      .sort((a, b) => rank(a.hs[0]!) - rank(b.hs[0]!));
    const boxOf = (at: LV95, point: boolean, n: number): [number, number, number, number] => {
      const pt = map.latLngToContainerPoint(toLatLng(at));
      const x = pt.x - (point ? 10 : 3), y = pt.y - (point ? 12 : 3);
      return [x - Math.min(n, MAX_PILLS) * 40, y - 22, x, y];
    };
    for (const gr of list) {
      const b = boxOf(gr.at, gr.point, gr.hs.length);
      const hit = placed.find((p) => b[0] < p.box[2] + 4 && b[2] > p.box[0] - 4 && b[1] < p.box[3] + 4 && b[3] > p.box[1] - 4);
      if (hit) { hit.hs.push(...gr.hs); hit.hs.sort((a, c) => rank(a) - rank(c)); hit.box = boxOf(hit.at, hit.point, hit.hs.length); }
      else placed.push({ ...gr, hs: [...gr.hs], box: b });
    }
    for (const gr of placed) badge(gr);
  };
  const badge = (gr: { at: LV95; point: boolean; hs: Hint[] }) => {
    const hs = gr.hs;
    const vis = hs.slice(0, hs.length > MAX_PILLS ? MAX_PILLS - 1 : MAX_PILLS);
    const rest = hs.slice(vis.length);
    const pills = vis.map((h) => {
      const st = decisionOf(ex, h);
      const title = `${h.title} (Regel ${h.rule}${st === "bestaetigt" ? ", bestätigt" : ""})`;
      return `<span class="lt-hb-pill l-${h.level} d-${st}${h === sel ? " sel" : ""}" data-h="${escapeHtml(h.id)}" tabindex="0" role="button" title="${escapeHtml(title)}" aria-label="Hinweis ${escapeHtml(title)}"><i></i>${escapeHtml(h.rule)}</span>`;
    }).join("") + (rest.length ? `<span class="lt-hb-pill more" data-h="${escapeHtml(rest[0]!.id)}" tabindex="0" role="button" title="${escapeHtml(rest.map((h) => `${h.rule}: ${h.title}`).join("\n"))}">+${rest.length}</span>` : "");
    const m = L.marker(toLatLng(gr.at), {
      pane: BADGE_PANE, keyboard: false, zIndexOffset: sel && hs.includes(sel) ? 1000 : 0,
      icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="lt-hb" style="${gr.point ? "margin:-12px 0 0 -10px" : "margin:-3px 0 0 -3px"}">${pills}</div>` }),
    });
    const pick = (target: EventTarget | null) => {
      const id = (target as HTMLElement | null)?.closest?.("[data-h]")?.getAttribute("data-h");
      const h = id ? hs.find((x) => x.id === id) : undefined;
      if (h) o.onClick(h);
    };
    m.on("click", (ev: L.LeafletMouseEvent) => pick(ev.originalEvent?.target ?? null));
    m.on("add", () => {
      const el = m.getElement();
      if (el) L.DomEvent.on(el, "keydown", (ev) => { const k = (ev as KeyboardEvent).key; if (k === "Enter" || k === " ") { ev.preventDefault(); pick(ev.target); } });
    });
    m.addTo(badges);
  };
  layout();
  g.on("add", () => map.on("zoomend", layout));
  g.on("remove", () => map.off("zoomend", layout));

  const container = map.getContainer();
  const dim = !!sel && o.focus;
  g.on("add", () => container.classList.toggle("lt-hintsel", dim));
  g.on("remove", () => container.classList.remove("lt-hintsel"));
  return g;
}
