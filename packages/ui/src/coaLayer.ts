/**
 * Kartenebene «Aktionen Rot»: für die wahrscheinlichste und die gefährlichste Möglichkeit die erwartete Annäherung
 * (rot gestrichelter Pfeil mit weissem Saum, wie das Pendel), am Ziel ein Ring (eigener Stao) bzw. ein Warnzeichen
 * (Engnis/NAI) und ein Fähnchen «Überfall? 07:40–08:30».
 * Platzierung der Fähnchen mit Kollisionsprüfung: Kandidaten rund um Ring/Warnzeichen (anliegend, dann etwas weiter
 * weg); belegt sind Ringe, Warnzeichen, schon gesetzte Fähnchen, NAI-Beschriftungen und Hinweis-Fähnchen (hart) sowie
 * Zeichen mit Zeit/Element-Beschriftung (weich); die Seite, aus der die Annäherung kommt, wird gemieden. Ein kurzer
 * Leitstrich nur, wenn das Fähnchen nicht anliegt – so bleibt die Zuordnung eindeutig.
 * Die gewählte Möglichkeit hebt ihre Indikatoren hervor: Auslöser-Zeichen kräftig, übrige blass (Klasse `lt-coasel`),
 * Hinweis-Fähnchen, die keine Indikatoren sind, ebenfalls blass.
 */
import L from "leaflet";
import type { Exercise, Hint, RedCoa } from "@lage/core";
import { escapeHtml, toLatLng } from "@lage/map";
import { COA_LABEL, COA_SHORT, coaHintIds, coaPlaces, windowLabel } from "./lageRot";
import "./lagerot.css";

export interface CoaLayerOptions {
  coas: RedCoa[];
  ex: Exercise;
  /** Lagezeit (ISO lokal) */
  t: string;
  selectedId: string | null;
  /** gewählte Möglichkeit hervorheben (übrige Zeichen blass) */
  focus: boolean;
  onClick: (c: RedCoa) => void;
}

/** Kartenfarben (Karte bleibt hell) – entsprechen --m-rot, --m-ink, --m-flash */
const ROT = "#D3262D";
const INK = "#101414";
const FLASH = "#F2B705";
/** Ring um den Zielort (Bildschirm-Pixel): umschliesst das Zeichen */
const RING = 24;
/** Warnzeichen (Engnis/NAI) oben rechts neben dem Ort, damit Sperre/Zeichen im NAI sichtbar bleiben */
const WARN_OFF = L.point(26, -22);

const GEO_PANE = "lt-coa-geo";
const TIP_PANE = "lt-coa-tip";
const FLAG_PANE = "lt-coa-flag";
function panes(map: L.Map) {
  if (!map.getPane(GEO_PANE)) { const p = map.createPane(GEO_PANE); p.style.zIndex = "428"; p.style.pointerEvents = "none"; }
  // Pfeilspitze über den Zeichen (klein, sonst verdeckt ein Zeichen am Ring die Richtung)
  if (!map.getPane(TIP_PANE)) { const p = map.createPane(TIP_PANE); p.style.zIndex = "605"; p.style.pointerEvents = "none"; }
  if (!map.getPane(FLAG_PANE)) map.createPane(FLAG_PANE).style.zIndex = "612";
}

const isWarn = (c: RedCoa) => c.kind === "hinterhalt" || c.kind === "sperren" || (!!c.target?.nai && !c.target.unit);
const ICON: Record<"ring" | "warn", string> = {
  ring: `<svg width="12" height="12" viewBox="0 0 16 16"><path d="M8 2.2L14.6 13.6H1.4z" fill="currentColor"/></svg>`,
  warn: `<svg width="13" height="13" viewBox="0 0 16 16"><path d="M8 1.8L15 14.2H1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6.2v3.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="8" cy="11.9" r="1.05" fill="currentColor"/></svg>`,
};

export function coaLayer(map: L.Map, o: CoaLayerOptions): L.LayerGroup {
  panes(map);
  const g = L.layerGroup();
  const sel = o.coas.find((c) => c.id === o.selectedId) ?? null;
  // auf der Karte nur wahrscheinlichste und gefährlichste (gewählte immer)
  const shown = o.coas.filter((c) => c.label !== "weitere" || c === sel);
  const dyn = L.layerGroup().addTo(g);
  const container = map.getContainer();

  type Box = [number, number, number, number];
  const RANK = { wahrscheinlichste: 1, gefaehrlichste: 2, weitere: 3 } as const;
  /** Ziel-Box (Ring bzw. Warnzeichen) in Layer-Pixeln */
  const targetBox = (c: RedCoa): Box | null => {
    const p = c.target?.pos ?? c.approach?.at(-1);
    if (!p) return null;
    const q = map.latLngToLayerPoint(toLatLng(p)).add(isWarn(c) ? WARN_OFF : L.point(0, 0));
    const r = isWarn(c) ? 17 : RING + 2;
    return [q.x - r, q.y - r, q.x + r, q.y + r];
  };
  let hard: Box[] = [];
  let soft: Box[] = [];
  /** belegte Flächen auf der Karte (DOM anderer Ebenen) in Layer-Pixeln */
  const measure = () => {
    const cr = container.getBoundingClientRect();
    const W = cr.width, H = cr.height;
    const toBox = (el: Element): Box | null => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      const x = r.left - cr.left, y = r.top - cr.top;
      if (x > W + 50 || y > H + 50 || x + r.width < -50 || y + r.height < -50) return null;
      const a = map.containerPointToLayerPoint([x, y]);
      return [a.x, a.y, a.x + r.width, a.y + r.height];
    };
    const all = (q: string) => [...container.querySelectorAll(q)].map(toBox).filter((b): b is Box => !!b);
    hard = [
      ...shown.map(targetBox).filter((b): b is Box => !!b),
      ...all(".lt-area-lbl span, .lt-hb-pill, .lt-hb-next"),
    ];
    soft = all(".leaflet-marker-pane .lt-ev, .leaflet-marker-pane .lt-ev > .lt-ud, .leaflet-marker-pane .lt-ev > .lt-tl");
  };
  const hit = (a: Box, b: Box, m = 2) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;

  /** Breite eines Fähnchens: einmal unsichtbar messen */
  const widths = new Map<string, number>();
  const flagWidth = (html: string): number => {
    const k = html;
    if (widths.has(k)) return widths.get(k)!;
    const el = document.createElement("div");
    el.className = "lt-coa-flag";
    el.style.visibility = "hidden";
    el.innerHTML = html;
    container.appendChild(el);
    const w = Math.ceil(el.getBoundingClientRect().width) || 120;
    el.remove();
    widths.set(k, w);
    return w;
  };

  const layout = () => {
    dyn.clearLayers();
    measure();
    // Fähnchen nach Rang (gewählte zuerst) ohne Überdeckung setzen
    for (const c of [...shown].sort((a, b) => (a === sel ? 0 : RANK[a.label]) - (b === sel ? 0 : RANK[b.label]))) draw(c);
  };

  const draw = (c: RedCoa) => {
    const on = c === sel;
    const dim = !!sel && !on;
    const target = c.target?.pos ?? c.approach?.at(-1);
    const tpx = target ? map.latLngToLayerPoint(toLatLng(target)) : null;
    const warn = isWarn(c);
    const r = warn ? 18 : RING;
    // Annäherung: endet vor dem Ring, Pfeilspitze am Ring
    let dir: L.Point | null = null;
    const pts = (c.approach ?? []).filter((p, i, a) => i === 0 || Math.hypot(p.e - a[i - 1]!.e, p.n - a[i - 1]!.n) > 5);
    if (pts.length >= 2) {
      const px = pts.map((p) => map.latLngToLayerPoint(toLatLng(p)));
      const n = px.length;
      // Pendel (Versorgung): hin und zurück – Pfeilspitzen an beiden Enden, kein Ausgangspunkt
      const both = c.kind === "versorgung";
      const atT = (p: L.Point) => !!tpx && p.distanceTo(tpx) < 3;
      const endT = atT(px[n - 1]!), startT = atT(px[0]!);
      const dEnd = px[n - 1]!.subtract(px[n - 2]!), dStart = px[0]!.subtract(px[1]!);
      const lenEnd = dEnd.distanceTo(L.point(0, 0)), lenStart = dStart.distanceTo(L.point(0, 0));
      if (lenEnd > r + 14 && lenStart > r + 14) {
        const uEnd = dEnd.divideBy(lenEnd), uStart = dStart.divideBy(lenStart);
        dir = endT || !startT ? uEnd : uStart;
        const tipEnd = px[n - 1]!.subtract(uEnd.multiplyBy(endT ? r + 5 : 4));
        const tipStart = px[0]!.subtract(uStart.multiplyBy(startT ? r + 5 : 4));
        const a = both || startT ? tipStart.subtract(uStart.multiplyBy(6)) : px[0]!;
        const line = [a, ...px.slice(1, -1), tipEnd.subtract(uEnd.multiplyBy(6))].map((p) => map.layerPointToLatLng(p));
        L.polyline(line, { pane: GEO_PANE, color: "#fff", weight: on ? 8 : 6.5, opacity: dim ? 0.5 : 0.9, lineCap: "round", interactive: false }).addTo(dyn);
        L.polyline(line, { pane: GEO_PANE, color: ROT, weight: on ? 3.6 : 2.8, opacity: dim ? 0.55 : 1, dashArray: on ? "11 7" : "9 7", lineCap: "butt", interactive: false }).addTo(dyn);
        // Ausgangsraum: kleiner Punkt am Anfang
        if (!both && !startT) L.circleMarker(map.layerPointToLatLng(px[0]!), { pane: GEO_PANE, radius: on ? 4.5 : 3.8, color: "#fff", weight: 2, fillColor: ROT, fillOpacity: dim ? 0.55 : 1, opacity: dim ? 0.6 : 1, interactive: false }).addTo(dyn);
        const s = on ? 26 : 22;
        const head = (at: L.Point, u: L.Point) => L.marker(map.layerPointToLatLng(at), {
          pane: TIP_PANE, interactive: false, keyboard: false,
          icon: L.divIcon({ className: "lt-coa-arrow", iconSize: [s, s], iconAnchor: [s / 2, s / 2],
            html: `<svg width="${s}" height="${s}" viewBox="0 0 16 16" style="transform:rotate(${(Math.atan2(u.y, u.x) * 180) / Math.PI}deg);opacity:${dim ? 0.55 : 1}"><path d="M3 2.6L14 8 3 13.4z" fill="#fff" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/><path d="M3.6 3.6L13 8 3.6 12.4z" fill="currentColor"/></svg>` }),
        }).addTo(dyn);
        head(tipEnd, uEnd);
        if (both) head(tipStart, uStart);
      }
    }
    if (!target || !tpx) return;
    // Ziel: Ring (Stao) bzw. Warnzeichen (Engnis/NAI)
    const ring = warn
      ? `<svg width="40" height="40" viewBox="-20 -20 40 40"><path d="M0 -16L15.5 12H-15.5z" fill="${FLASH}" stroke="#fff" stroke-width="5" stroke-linejoin="round" paint-order="stroke"/><path d="M0 -16L15.5 12H-15.5z" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M0 -6v8" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="7" r="1.8" fill="${INK}"/></svg>`
      : `<svg width="${2 * r + 10}" height="${2 * r + 10}" viewBox="${-r - 5} ${-r - 5} ${2 * r + 10} ${2 * r + 10}"><circle r="${r}" fill="none" stroke="#fff" stroke-width="${on ? 7 : 6}"/><circle r="${r}" fill="${ROT}" fill-opacity="${on ? 0.1 : 0.05}" stroke="${ROT}" stroke-width="${on ? 3.2 : 2.6}" stroke-dasharray="${on ? "none" : "7 4"}"/></svg>`;
    // Warnzeichen neben dem Ort (oben rechts), damit Sperre/Zeichen im NAI sichtbar bleiben
    const wOff = warn ? WARN_OFF : L.point(0, 0);
    const size = warn ? 40 : 2 * r + 10;
    L.marker(map.layerPointToLatLng(tpx.add(wOff)), {
      pane: GEO_PANE, interactive: false, keyboard: false,
      icon: L.divIcon({ className: "lt-coa-ring", iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<div style="opacity:${dim ? 0.55 : 1}">${ring}</div>` }),
    }).addTo(dyn);

    // Fähnchen
    const w = windowLabel(c, o.ex.days, o.t);
    const where = c.target?.nai ?? c.target?.unit ?? c.target?.cell ?? "";
    const tm = w ? w.short : where;
    const label = `${ICON[warn ? "warn" : "ring"]}<b>${escapeHtml(COA_SHORT[c.kind])}</b>${tm ? `<span class="tm${w ? " w-" + w.state : ""}">${escapeHtml(tm)}</span>` : ""}`;
    const fw = flagWidth(label);
    const FH = 22;
    // Mittelpunkt und Box von Ring/Warnzeichen (Layer-Pixel)
    const cx = tpx.x + wOff.x, cy = tpx.y + wOff.y;
    const rb = warn ? 16 : r + 3;
    const b0: Box = [cx - rb, cy - rb, cx + rb, cy + rb];
    const view = map.getPixelBounds();
    const org = map.getPixelOrigin();
    const vx0 = view.min!.x - org.x + 6, vy0 = view.min!.y - org.y + 6, vx1 = view.max!.x - org.x - 6, vy1 = view.max!.y - org.y - 6;
    // Kandidaten: Richtungen × Abstand (anliegend; weiter weg nur mit kurzem Leitstrich, der nichts kreuzt)
    const DIRS: Array<[number, number]> = [[1, 0.6], [1, 0], [-1, 0.6], [-1, 0], [1, -1], [-1, -1], [0, 1], [0, -1], [1, 1], [-1, 1]];
    const GAPS: Array<[number, number]> = [[4, 0], [18, 14], [34, 32]];
    /** Leitstrich vom Rand des Rings zum nächsten Punkt des Fähnchens */
    const leadOf = (box: Box) => {
      const nx = Math.max(box[0], Math.min(cx, box[2])), ny = Math.max(box[1], Math.min(cy, box[3]));
      const vx = nx - cx, vy = ny - cy, d = Math.hypot(vx, vy) || 1;
      return { sx: cx + (vx / d) * (rb - 1), sy: cy + (vy / d) * (rb - 1), ex: nx, ey: ny, len: Math.max(0, d - rb + 1), deg: (Math.atan2(vy, vx) * 180) / Math.PI };
    };
    const crosses = (l: ReturnType<typeof leadOf>, list: Box[]) => {
      let n = 0;
      for (const h of list) {
        for (let k = 1; k < 8; k++) {
          const x = l.sx + ((l.ex - l.sx) * k) / 8, y = l.sy + ((l.ey - l.sy) * k) / 8;
          if (x > h[0] && x < h[2] && y > h[1] && y < h[3]) { n++; break; }
        }
      }
      return n;
    };
    let best: { box: Box; gap: number; cost: number } | null = null;
    for (const [gap, gapCost] of GAPS) {
      for (const [di, [dx, dy]] of DIRS.entries()) {
        const x0 = dx > 0 ? b0[2] + gap - (Math.abs(dy) === 1 ? rb * 0.5 : 0) : dx < 0 ? b0[0] - gap - fw + (Math.abs(dy) === 1 ? rb * 0.5 : 0) : cx - fw / 2;
        const y0 = dy === 0 ? cy - FH / 2 : dy === 0.6 ? cy + rb * 0.25 : dy > 0 ? b0[3] + gap - (dx !== 0 ? rb * 0.4 : 0) : b0[1] - gap - FH + (dx !== 0 ? rb * 0.4 : 0);
        const box: Box = [x0, y0, x0 + fw, y0 + FH];
        let cost = gapCost + di * 0.2;
        for (const h of hard) if (hit(box, h, 3)) cost += 40;
        for (const sb of soft) if (hit(box, sb, 1)) cost += 6;
        if (box[0] < vx0 || box[2] > vx1 || box[1] < vy0 || box[3] > vy1) cost += 60;
        if (gap > 4) { const l = leadOf(box); cost += crosses(l, hard) * 30 + crosses(l, soft) * 4; }
        // nicht auf die Seite, aus der die Annäherung kommt (dort liegt der Pfeil)
        if (dir) {
          const fx = (box[0] + box[2]) / 2 - cx, fy = (box[1] + box[3]) / 2 - cy;
          const l = Math.hypot(fx, fy) || 1;
          if ((fx * -dir.x + fy * -dir.y) / l > 0.45) cost += 25;
        }
        if (!best || cost < best.cost) best = { box, gap, cost };
      }
    }
    const bx = best!.box;
    hard.push(bx);
    // Leitstrich nur, wenn das Fähnchen nicht anliegt
    let lead = "";
    if (best!.gap > 4) {
      const l = leadOf(bx);
      if (l.len > 3) lead = `<div class="lt-coa-lead" style="width:${l.len.toFixed(1)}px;transform:translate(${(l.sx - tpx.x).toFixed(1)}px,${(l.sy - tpx.y).toFixed(1)}px) rotate(${l.deg.toFixed(1)}deg)"></div>`;
    }
    const title = `${COA_LABEL[c.label]}: ${c.title}${w ? ` (${w.text})` : ""}`;
    const m = L.marker(toLatLng(target), {
      pane: FLAG_PANE, keyboard: false, zIndexOffset: on ? 1000 : c.label === "wahrscheinlichste" ? 500 : 0,
      icon: L.divIcon({
        className: "", iconSize: [0, 0],
        html: `<div style="opacity:${dim ? 0.6 : 1}">${lead}`
          + `<div class="lt-coa-flag k-${c.label}${on ? " sel" : ""}" tabindex="0" role="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" style="transform:translate(${(bx[0] - tpx.x).toFixed(1)}px,${(bx[1] - tpx.y).toFixed(1)}px)">${label}</div></div>`,
      }),
    });
    m.on("click", (ev: L.LeafletMouseEvent) => { if ((ev.originalEvent?.target as HTMLElement | null)?.closest?.(".lt-coa-flag")) o.onClick(c); });
    m.on("add", () => {
      const el = m.getElement();
      if (el) L.DomEvent.on(el, "keydown", (ev) => { const k = (ev as KeyboardEvent).key; if (k === "Enter" || k === " ") { ev.preventDefault(); o.onClick(c); } });
    });
    m.addTo(dyn);
  };

  // nach Zoom und Verschieben neu (Kartenrand, andere Ebenen haben sich neu gesetzt); beim Hinzufügen einmal sofort
  // und einmal im nächsten Bild (Ebenen, die im selben Durchgang dazukommen, sind dann gemessen)
  let raf = 0;
  const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };
  g.on("add", () => { layout(); later(); map.on("moveend", later); });
  g.on("remove", () => { cancelAnimationFrame(raf); map.off("moveend", later); });

  // gewählte Möglichkeit: übrige Zeichen blass (wie gewählter Hinweis), Hinweis-Fähnchen ohne Bezug ebenfalls
  const focus = !!sel && o.focus;
  let style: HTMLStyleElement | null = null;
  g.on("add", () => {
    container.classList.toggle("lt-coasel", focus);
    if (!focus || !sel) return;
    const keep = coaHintIds(sel).map((id) => `:not([data-h="${CSS.escape(id)}"])`).join("");
    style = document.createElement("style");
    style.textContent = `.lt-coasel .lt-hb-pill${keep}{opacity:.35}`;
    document.head.appendChild(style);
  });
  g.on("remove", () => { container.classList.remove("lt-coasel"); style?.remove(); style = null; });
  return g;
}

/** Ausdehnung einer Möglichkeit für «Auf Karte»: Ziel, Annäherung und Orte der zutreffenden Indikatoren */
export function coaExtent(c: RedCoa, ex: Exercise, hints: Hint[]): { minE: number; minN: number; maxE: number; maxN: number } | null {
  const pts = coaPlaces(c, ex, hints);
  if (!pts.length) return null;
  return { minE: Math.min(...pts.map((p) => p.e)), maxE: Math.max(...pts.map((p) => p.e)), minN: Math.min(...pts.map((p) => p.n)), maxN: Math.max(...pts.map((p) => p.n)) };
}
