/**
 * Taktische Zeichen (milsymbol) als Leaflet-Icons.
 * Späher / Beob Posten werden als Dreieck gezeichnet (wie im Lagebild der Übungen).
 */
import L from "leaflet";
import ms from "milsymbol";
import { sidcFor, symbolDef, type Affiliation } from "@lage/core";

const FILL: Record<Affiliation, string> = { F: "#80E0FF", H: "#FF8080", U: "#FFFF80", N: "#AAFFAA" };

export interface SymbolText {
  /** Elementbezeichnung (rechts angeschrieben), z. B. «Det 2» */
  unit?: string;
  /** Anzahl (oben angeschrieben) */
  count?: number;
  /** Bewegungsrichtung in Grad (Pfeil) */
  dir?: number;
}

export function symbolSvg(key: string, aff: Affiliation, size = 22, text: SymbolText = {}): { svg: string; w: number; h: number; anchor: [number, number] } {
  const def = symbolDef(key);
  if (def.triangle) {
    const w = Math.round(size * 1.15), h = Math.round(size), p = 3;
    const W = w + 2 * p, H = h + 2 * p;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <polygon points="${p},${H - p} ${W - p},${H - p} ${W / 2},${p}" fill="${FILL[aff]}" stroke="#000" stroke-width="2" stroke-linejoin="round"/>
      <line x1="${W * 0.32}" y1="${H - p}" x2="${W * 0.68}" y2="${p + h * 0.35}" stroke="#000" stroke-width="1.6"/></svg>`;
    return { svg, w: W, h: H, anchor: [W / 2, H - p] };
  }
  const opts: Record<string, unknown> = { size, outlineWidth: 3, outlineColor: "#ffffff" };
  if (text.unit) opts.uniqueDesignation = text.unit;
  if (text.count && text.count > 1) opts.quantity = String(text.count);
  if (text.dir !== undefined) opts.direction = String(text.dir);
  const sym = new ms.Symbol(sidcFor(key, aff), opts);
  const a = sym.getAnchor();
  const s = sym.getSize();
  return { svg: sym.asSVG(), w: s.width, h: s.height, anchor: [a.x, a.y] };
}

export function symbolIcon(key: string, aff: Affiliation, size = 22, text: SymbolText = {}, cls = ""): L.DivIcon {
  const s = symbolSvg(key, aff, size, text);
  // Dreieck (eigene Zeichnung): Bezeichnung daneben als Text
  const extra = symbolDef(key).triangle && (text.unit || (text.count ?? 0) > 1)
    ? `<span class="lt-sym-lbl" style="left:${s.w + 2}px">${escapeHtml([text.count && text.count > 1 ? `${text.count}×` : "", text.unit ?? ""].join(" ").trim())}</span>`
    : "";
  return L.divIcon({ className: `lt-sym ${cls}`.trim(), html: s.svg + extra, iconSize: [s.w, s.h], iconAnchor: s.anchor });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
