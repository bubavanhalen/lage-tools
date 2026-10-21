/**
 * Kleines Bild für Flächen- und Linienzeichen (Liste, Zeichen-Auswahl, Vorschau-Chip, Legende, Banner).
 *
 * milsymbol kennt Räume und Linien nur als Punkt-Grafik (Stecknadel mit Kürzel) – in 14 px unleserlich.
 * Hier stattdessen: Fläche = umrandetes Vieleck in der Farbe der Art mit Muster/Kürzel (Minen «M», ABC schraffiert,
 * Zielraum mit Kreuz, sonst Kürzel ab 18 px), Linie = Linienart wie auf der Karte (Draht-Schlaufen, Graben-Zähne,
 * Sperr-Zacken, Achsen-Pfeil, Kontaktlinie mit Bögen, Grenze Strich-Punkt, Phasenlinie mit Endstrichen).
 * Vermutet (Status A) gestrichelt. Für Punktzeichen `null` – dann gilt `symbolSvg`.
 */
import { catalogEntry, type Affiliation, type ShapeStyle, type Status } from "@lage/core";

/** wie `SymbolGraphic` in `symbol.ts` (hier ohne Leaflet, damit testbar) */
export interface ShapeIcon { svg: string; w: number; h: number; anchor: [number, number] }

/** Zugehörigkeit aus dem SIDC (Stelle 2: F/H/U/N und Übungs-/Verdachtsformen), sonst `aff` */
function affOf(sidc: string | undefined, aff: Affiliation): Affiliation {
  const a = sidc?.[1]?.toUpperCase();
  if (a === "F" || a === "A" || a === "D" || a === "M") return "F";
  if (a === "H" || a === "S" || a === "J" || a === "K") return "H";
  if (a === "U" || a === "P" || a === "G" || a === "W") return "U";
  if (a === "N" || a === "L") return "N";
  return aff;
}

/** Linien- und Füllfarbe je Zugehörigkeit (wie die Formen auf der Karte, `KIND_COLOR`) */
const COLOR: Record<Affiliation, { line: string; fill: string; fillOp: number }> = {
  F: { line: "#1F5FB8", fill: "#1F5FB8", fillOp: 0.14 },
  H: { line: "#D3262D", fill: "#D3262D", fillOp: 0.14 },
  U: { line: "#B88A00", fill: "#FFD400", fillOp: 0.3 },
  N: { line: "#2D7A4B", fill: "#2D7A4B", fillOp: 0.14 },
};

const VW = 30, VH = 20;
const AREA = "3,6.5 12,2.5 25.5,4 27,15 15.5,18 4,16";
const cache = new Map<string, ShapeIcon>();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * Bild eines Flächen-/Linienzeichens, oder null bei Punktzeichen.
 * @param size Grösse wie bei `symbolSvg` (≈ Höhe in px)
 */
export function shapeIconSvg(key: string, aff: Affiliation, size = 14, o: { sidc?: string; status?: Status } = {}): ShapeIcon | null {
  const c = catalogEntry(key);
  if (!c?.geometry || c.geometry === "punkt") return null;
  const a = affOf(o.sidc, aff);
  const dashed = o.status === "anticipated" || o.sidc?.[3]?.toUpperCase() === "A";
  const ck = `${key}|${a}|${size}|${dashed ? 1 : 0}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const h = Math.max(12, Math.round(size * 1.15));
  const w = Math.round((h * VW) / VH);
  const col = COLOR[a];
  const style: ShapeStyle = c.style ?? (c.geometry === "linie" ? "grenze" : "rand");
  const body = c.geometry === "flaeche" ? area(style, col, dashed, size >= 18 ? c.tag : undefined) : line(style, col.line, dashed);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${VW} ${VH}" class="lt-shapeicon">${body}</svg>`;
  const g: ShapeIcon = { svg, w, h, anchor: [w / 2, h / 2] };
  if (cache.size > 300) cache.clear();
  cache.set(ck, g);
  return g;
}

function area(style: ShapeStyle, col: { line: string; fill: string; fillOp: number }, dashed: boolean, tag?: string): string {
  const dash = dashed ? ' stroke-dasharray="3 2"' : "";
  let inner = "";
  if (style === "minen") {
    inner = `<text x="15" y="14.2" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="11" fill="${col.line}">M</text>`;
  } else if (style === "abc") {
    // Schraffur, auf das Vieleck beschnitten (ohne clipPath-Kennung: Linien nur innen gezogen)
    inner = [[7, 16, 12, 4], [11, 17.5, 17, 3], [15.5, 18, 21.5, 3.5], [20, 17, 25.5, 4.5]]
      .map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col.line}" stroke-width="1.3"/>`).join("");
  } else if (style === "ziel") {
    inner = `<path d="M15 5.5v9M10.5 10h9" stroke="${col.line}" stroke-width="1.6" fill="none"/>`;
  } else if (tag) {
    const fs = Math.min(9, Math.floor(36 / Math.max(2, tag.length)));
    inner = `<text x="15" y="10.6" text-anchor="middle" dominant-baseline="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${fs}" fill="${col.line}">${esc(tag)}</text>`;
  }
  return `<polygon points="${AREA}" fill="none" stroke="#fff" stroke-width="4.2" stroke-linejoin="round"/>`
    + `<polygon points="${AREA}" fill="${col.fill}" fill-opacity="${col.fillOp}" stroke="${col.line}" stroke-width="1.9" stroke-linejoin="round"${dash}/>`
    + inner;
}

function line(style: ShapeStyle, c: string, dashed: boolean): string {
  const halo = (d: string, w = 4.5) => `<path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const stroke = (d: string, w = 1.9, extra = "") => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
  const dash = dashed ? ' stroke-dasharray="3 2"' : "";
  const base = "M2.5 12H27.5";
  switch (style) {
    case "draht": {
      const xs = [6, 10.5, 15, 19.5, 24];
      const ring = (x: number, s: string, w: number) => `<circle cx="${x}" cy="9.5" r="2.9" fill="none" stroke="${s}" stroke-width="${w}"/>`;
      return halo(base) + xs.map((x) => ring(x, "#fff", 3)).join("") + stroke(base, 1.6, dash) + xs.map((x) => ring(x, c, 1.3)).join("");
    }
    case "graben": {
      const teeth = [5, 10.5, 16, 21.5].map((x) => `<path d="M${x} 12l2.7-5 2.7 5z" fill="${c}" stroke="#fff" stroke-width=".7" stroke-linejoin="round"/>`).join("");
      return halo(base) + stroke(base, 2, dash) + teeth;
    }
    case "sperre": {
      const z = "M2.5 13.5 6 7.5 9.5 13.5 13 7.5 16.5 13.5 20 7.5 23.5 13.5 27 7.5";
      return halo(z) + stroke(z, 1.9, dash);
    }
    case "achse": {
      const shaft = "M2.5 10H20";
      return halo(shaft, 6) + `<path d="M19 4.5 28 10 19 15.5z" fill="${c}" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>`
        + stroke(shaft, 3, dashed ? ' stroke-dasharray="3.5 2.5" stroke-linecap="butt"' : "");
    }
    case "front": {
      const arcs = [6, 12, 18, 24].map((x) => `<path d="M${x - 2.6} 12a2.6 2.6 0 0 1 5.2 0" fill="none" stroke="${c}" stroke-width="1.6"/>`).join("");
      return halo(base) + stroke(base, 1.9, dash) + arcs;
    }
    case "phase":
      return halo("M2.5 10H27.5M3 5.5v9M27 5.5v9") + stroke("M2.5 10H27.5", 1.9, dash) + stroke("M3 5.5v9M27 5.5v9", 2);
    case "grenze":
    default:
      return halo("M2.5 10H27.5") + stroke("M2.5 10H27.5", 2, dashed ? ' stroke-dasharray="3 2"' : ' stroke-dasharray="7 2.5 1.5 2.5" stroke-linecap="butt"');
  }
}
