/**
 * Taktische Zeichen (milsymbol) als SVG bzw. Leaflet-Icons.
 * Späher / Beob Posten werden als Dreieck gezeichnet (wie im Lagebild-Prototyp):
 * weisser Halo, Füllung nach Zugehörigkeit, Schrägstrich beim Späher-Trupp, Punkt im Schwerpunkt,
 * Anker im Schwerpunkt (das Dreieck sitzt mit seiner Mitte auf dem Ort).
 * Beschriftungen (Anzahl, Element) zeichnet die Kartenebene selbst neben das Zeichen.
 */
import L from "leaflet";
import ms from "milsymbol";
import { sidcFor, symbolDef, type Affiliation } from "@lage/core";

export const SYMBOL_FILL: Record<Affiliation, string> = { F: "#80E0FF", H: "#FF8080", U: "#FFFF80", N: "#AAFFAA" };

export interface SymbolText {
  /** Elementbezeichnung, z. B. «Det 2» (nur für `symbolIcon`, wird neben das Zeichen geschrieben) */
  unit?: string;
  /** Anzahl (nur für `symbolIcon`, «2×») */
  count?: number;
  /** Bewegungsrichtung in Grad (Pfeil am Zeichen) */
  dir?: number;
}

export interface SymbolGraphic {
  svg: string;
  w: number;
  h: number;
  /** Ankerpunkt im Zeichen (Pixel ab oben links) */
  anchor: [number, number];
}

const cache = new Map<string, SymbolGraphic>();

/**
 * @param outline Farbe der Umrandung (Standard weiss); z. B. blau für «von Blau gemeldet»
 */
export function symbolSvg(key: string, aff: Affiliation, size = 22, text: SymbolText = {}, outline = "#ffffff"): SymbolGraphic {
  const ck = `${key}|${aff}|${size}|${text.dir ?? ""}|${outline}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const g = draw(key, aff, size, text, outline);
  if (cache.size > 400) cache.clear();
  cache.set(ck, g);
  return g;
}

function draw(key: string, aff: Affiliation, size: number, text: SymbolText, outline: string): SymbolGraphic {
  const def = symbolDef(key);
  if (def.triangle) {
    const w = Math.round(size * 1.15), h = Math.round(size), p = 3;
    const W = w + 2 * p, H = h + 2 * p;
    const A = [p, H - p], B = [W - p, H - p], C = [W / 2, p];
    const pts = `${A} ${B} ${C}`;
    const coloured = outline.toLowerCase() !== "#ffffff" && outline.toLowerCase() !== "#fff";
    const slash = key === "beob_aufkl"
      ? `<line x1="${A[0]}" y1="${A[1]}" x2="${(B[0]! + C[0]!) / 2}" y2="${(B[1]! + C[1]!) / 2}" stroke="#000" stroke-width="1.5"/>`
      : "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
      + `<polygon points="${pts}" fill="none" stroke="${outline}" stroke-width="${coloured ? 6 : 4}" stroke-linejoin="round"/>`
      + `<polygon points="${pts}" fill="${SYMBOL_FILL[aff]}" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>`
      + slash
      + `<circle cx="${W / 2}" cy="${p + (h * 2) / 3}" r="1.6" fill="#000"/></svg>`;
    return { svg, w: W, h: H, anchor: [W / 2, p + (h * 2) / 3] };
  }
  const opts: Record<string, unknown> = { size, outlineWidth: 4, outlineColor: outline, fill: true };
  if (text.dir !== undefined) opts.direction = String(text.dir);
  const sym = new ms.Symbol(sidcFor(key, aff), opts);
  const a = sym.getAnchor();
  const s = sym.getSize();
  return { svg: sym.asSVG(), w: Math.ceil(s.width), h: Math.ceil(s.height), anchor: [a.x, a.y] };
}

/** Zusatz neben dem Zeichen: «2× Det 2» */
export function symbolLabel(text: SymbolText): string {
  return [text.count && text.count > 1 ? `${text.count}×` : "", text.unit ?? ""].join(" ").trim();
}

/** Einfaches Icon (Zeichen + Zusatz rechts), z. B. für Vorschauen. Die Lagekarte baut ihre Icons selbst. */
export function symbolIcon(key: string, aff: Affiliation, size = 22, text: SymbolText = {}, cls = ""): L.DivIcon {
  const s = symbolSvg(key, aff, size, text);
  const lbl = symbolLabel(text);
  const extra = lbl
    ? `<span class="lt-ud" style="left:${s.w + 2}px;top:${Math.max(0, s.anchor[1] - 8)}px">${escapeHtml(lbl)}</span>`
    : "";
  return L.divIcon({ className: `lt-sym ${cls}`.trim(), html: s.svg + extra, iconSize: [s.w, s.h], iconAnchor: s.anchor });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
