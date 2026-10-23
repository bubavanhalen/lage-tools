/**
 * Kartenebene «Aktionen Rot»: für die wahrscheinlichste und die gefährlichste Möglichkeit die erwartete Annäherung
 * (rot gestrichelter Pfeil mit weissem Saum, wie das Pendel), am Ziel ein Ring (eigener Stao) bzw. ein Warnzeichen
 * (Engnis/NAI) und ein Fähnchen «Überfall? 07:40–08:30». Das Fähnchen steht auf der Seite, die der Annäherung
 * abgewandt ist, mit Abstand zum Ring – Zeichen, Stapel und Hinweis-Fähnchen (NW-Ecke) bleiben frei.
 * Die gewählte Möglichkeit hebt ihre Indikatoren hervor: Auslöser-Zeichen kräftig, übrige blass (Klasse `lt-coasel`),
 * Hinweis-Fähnchen, die keine Indikatoren sind, ebenfalls blass.
 */
import L from "leaflet";
import type { Exercise, LV95, RedCoa } from "@lage/core";
import { escapeHtml, toLatLng } from "@lage/map";
import { COA_SHORT, coaHintIds, windowLabel } from "./lageRot";
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

  type Box = [number, number, number, number];
  let placed: Box[] = [];
  const RANK = { wahrscheinlichste: 1, gefaehrlichste: 2, weitere: 3 } as const;
  const layout = () => {
    dyn.clearLayers();
    // Ringe/Warnzeichen zuerst belegen, dann Fähnchen nach Rang (gewählte zuerst) ohne Überdeckung setzen
    placed = shown.flatMap((c): Box[] => {
      const p = c.target?.pos ?? c.approach?.at(-1);
      if (!p) return [];
      const q = map.latLngToLayerPoint(toLatLng(p)).add(isWarn(c) ? L.point(26, -22) : L.point(0, 0));
      const r = isWarn(c) ? 18 : RING;
      return [[q.x - r, q.y - r, q.x + r, q.y + r]];
    });
    for (const c of [...shown].sort((a, b) => (a === sel ? 0 : RANK[a.label]) - (b === sel ? 0 : RANK[b.label]))) draw(c);
  };
  const hits = (b: Box) => placed.some((p) => b[0] < p[2] + 3 && b[2] > p[0] - 3 && b[1] < p[3] + 3 && b[3] > p[1] - 3);

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
    const wOff = warn ? L.point(26, -22) : L.point(0, 0);
    const size = warn ? 40 : 2 * r + 10;
    L.marker(map.layerPointToLatLng(tpx.add(wOff)), {
      pane: GEO_PANE, interactive: false, keyboard: false,
      icon: L.divIcon({ className: "lt-coa-ring", iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<div style="opacity:${dim ? 0.55 : 1}">${ring}</div>` }),
    }).addTo(dyn);

    // Fähnchen: auf der Seite, die der Annäherung abgewandt ist (sonst rechts), leicht unterhalb
    const w = windowLabel(c, o.ex.days, o.t);
    const where = c.target?.nai ?? c.target?.unit ?? c.target?.cell ?? "";
    // Breite grob aus dem Text (für Kartenrand und Überdeckung)
    const fw = 30 + COA_SHORT[c.kind].length * 7.4 + (w ? w.text.length : where.length) * 7.3;
    const FH = 22;
    const cp = map.latLngToContainerPoint(toLatLng(target)).add(wOff);
    const W = map.getSize().x;
    let right = !dir || dir.x >= -0.2;
    if (right && cp.x + r + 20 + fw > W - 8 && cp.x - r - 20 - fw > 8) right = false;
    else if (!right && cp.x - r - 20 - fw < 8 && cp.x + r + 20 + fw < W - 8) right = true;
    const anchor = warn ? wOff.add(L.point(right ? 15 : -15, 8)) : L.point(right ? r * 0.8 : -r * 0.8, r * 0.6);
    const fx = anchor.x + (right ? 16 : -16);
    let fy = anchor.y + 14;
    const boxAt = (y: number): Box => { const x0 = tpx.x + fx - (right ? 0 : fw), y0 = tpx.y + y - 10; return [x0, y0, x0 + fw, y0 + FH]; };
    for (let k = 0; k < 6 && hits(boxAt(fy)); k++) fy += FH + 4;
    placed.push(boxAt(fy));
    const leadLen = Math.hypot(fx - anchor.x, fy - anchor.y);
    const leadDeg = (Math.atan2(fy - anchor.y, fx - anchor.x) * 180) / Math.PI;
    const label = `<b>${escapeHtml(COA_SHORT[c.kind])}</b>${w ? `<span class="tm">${escapeHtml(w.text)}</span>` : where ? `<span class="tm">${escapeHtml(where)}</span>` : ""}`;
    const title = `${c.label === "wahrscheinlichste" ? "Wahrscheinlichste" : c.label === "gefaehrlichste" ? "Gefährlichste" : "Weitere"}: ${c.title}${w ? ` (ca. ${w.text})` : ""}`;
    const m = L.marker(toLatLng(target), {
      pane: FLAG_PANE, keyboard: false, zIndexOffset: on ? 1000 : c.label === "wahrscheinlichste" ? 500 : 0,
      icon: L.divIcon({
        className: "", iconSize: [0, 0],
        html: `<div style="opacity:${dim ? 0.6 : 1}"><div class="lt-coa-lead" style="width:${leadLen}px;transform:translate(${anchor.x}px,${anchor.y}px) rotate(${leadDeg}deg)"></div>`
          + `<div class="lt-coa-flag k-${c.label}${on ? " sel" : ""}" tabindex="0" role="button" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" style="transform:translate(${fx}px,${fy - 10}px)${right ? "" : " translateX(-100%)"}">${ICON[warn ? "warn" : "ring"]}${label}</div></div>`,
      }),
    });
    m.on("click", (ev: L.LeafletMouseEvent) => { if ((ev.originalEvent?.target as HTMLElement | null)?.closest?.(".lt-coa-flag")) o.onClick(c); });
    m.on("add", () => {
      const el = m.getElement();
      if (el) L.DomEvent.on(el, "keydown", (ev) => { const k = (ev as KeyboardEvent).key; if (k === "Enter" || k === " ") { ev.preventDefault(); o.onClick(c); } });
    });
    m.addTo(dyn);
  };

  layout();
  // nach Zoom und Verschieben neu (Seite des Fähnchens hängt vom Kartenrand ab)
  g.on("add", () => map.on("moveend", layout));
  g.on("remove", () => map.off("moveend", layout));

  // gewählte Möglichkeit: übrige Zeichen blass (wie gewählter Hinweis), Hinweis-Fähnchen ohne Bezug ebenfalls
  const container = map.getContainer();
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

/** Ausdehnung einer Möglichkeit (Ziel und Annäherung) für «Auf Karte» */
export function coaExtent(c: RedCoa): { minE: number; minN: number; maxE: number; maxN: number } | null {
  const pts: LV95[] = [...(c.approach ?? []), ...(c.target ? [c.target.pos] : [])];
  if (!pts.length) return null;
  return { minE: Math.min(...pts.map((p) => p.e)), maxE: Math.max(...pts.map((p) => p.e)), minN: Math.min(...pts.map((p) => p.n)), maxN: Math.max(...pts.map((p) => p.n)) };
}

