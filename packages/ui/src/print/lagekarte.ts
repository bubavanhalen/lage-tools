/**
 * «Lagekarte drucken» (Spez. MVP 3, Kap. 2.9, 3.10): eigenes PDF A4/A3 quer mit Karte (grau, aus dem Kachel-Cache –
 * auch offline), Raster und NAI als Vektor, Lage zur Lagezeit (Zeichen mit Zeit bzw. Namen), Flächen und Linien,
 * Legende, Kopf (Stand, Zeitfenster, Klassifizierung), Massstab, Nordpfeil und Fuss.
 *
 * - Abdeckung **vor** dem Druck: `lagekartePlan` (nur `caches.match`). Offline und nicht vollständig: nächstgröbere
 *   gespeicherte Stufe (bis 14), sonst die Stufe mit der besten Abdeckung und Hinweis «n % fehlen – weiss gedruckt».
 *   Nie still ein halbes Bild: ohne Kartenbild steht im Kopf «ohne Kartenhintergrund».
 * - Aufgehobene Sperren/Checkpoints/Flächen fehlen ab der Aufhebung (`ohneAufgehobene`, `shapeItems`); Rückblick
 *   davor zeigt sie.
 * - jsPDF wird erst beim Erstellen geladen; das Modul selbst ist leicht (Dialog, Abdeckung).
 */
import type { jsPDF } from "jspdf";
import { sheetBounds, zeitCmp, type Area, type Exercise, type LV95, type RasterSheet } from "@lage/core";
import { KARTE, RESOLUTIONS, symbolSvg, toLv95 } from "@lage/map";
import type L from "leaflet";
import { renderTiles, tileLevel, type Bounds } from "../tiles";
import { tileCoverage } from "../offline";
import { situationModel, type SituationItem } from "../journalLayer";
import { shapeItems } from "../shapeLayer";
import { ohneAufgehobene } from "../aufgehoben";
import { safePdf } from "../pdfSafe";
import { pdfInfo } from "../perf";
import { LAGE_KARTE } from "../colors";
import type { LagekarteDruck, TileCoverage } from "../shell/contracts";
import { datum, tagKurz } from "./umfang";
import { blattLayout, fitAspect, RAND, type BlattLayout } from "./blatt";

export { blattLayout, fitAspect, rasterBounds, type BlattLayout } from "./blatt";

/** Ausschnitt der Karte jetzt (LV95) */
export function mapBounds(map: L.Map): Bounds {
  const lb = map.getBounds();
  const a = toLv95(lb.getSouthWest()), c = toLv95(lb.getNorthEast());
  return { minE: Math.min(a.e, c.e), maxE: Math.max(a.e, c.e), minN: Math.min(a.n, c.n), maxN: Math.max(a.n, c.n) };
}

/** Zielauflösung 200 dpi */
const DPI = 200;
const pxOf = (mm: number) => Math.round((mm / 25.4) * DPI);

// ---------- Abdeckung

export interface LagekartePlan {
  /** Ausschnitt auf Papierverhältnis */
  bounds: Bounds;
  /** gewählte Kachelstufe */
  z: number;
  /** Meter pro Pixel der gewählten Stufe */
  res: number;
  /** Abdeckung der gewählten Stufe im Cache */
  cov: TileCoverage;
  /** fehlende Kacheln werden beim Erstellen geladen (online) */
  laden: boolean;
  /** auf eine gröbere gespeicherte Stufe ausgewichen */
  groeber: boolean;
}

/**
 * Stufe und Abdeckung für den Druck (vor dem Laden, nur Cache). Online: feinste Stufe, fehlende werden geladen.
 * Offline: feinste vollständig gespeicherte Stufe bis 14, sonst die mit der besten Abdeckung.
 */
export async function lagekartePlan(b0: Bounds, paper: LagekarteDruck["paper"], online = typeof navigator === "undefined" || navigator.onLine !== false): Promise<LagekartePlan> {
  const L0 = blattLayout(paper);
  const bounds = fitAspect(b0, L0.field.w / L0.field.h);
  const mpp = (bounds.maxE - bounds.minE) / pxOf(L0.field.w);
  const z0 = tileLevel(bounds, mpp, { maxTiles: 600, maxZ: 27 });
  const cov0 = await tileCoverage(bounds, z0, "lk");
  const plan = (z: number, cov: TileCoverage, groeber = false): LagekartePlan => ({ bounds, z, res: RESOLUTIONS[z]!, cov, laden: online && cov.share < 1, groeber });
  if (cov0.share >= 0.999 || online) return plan(z0, cov0);
  let best = cov0;
  for (let z = z0 - 1; z >= 14; z--) {
    const c = await tileCoverage(bounds, z, "lk");
    if (c.share >= 0.999) return plan(z, c, true);
    if (c.share > best.share) best = c;
  }
  return plan(best.z, best, best.z !== z0);
}

/** «Landeskarte 2,5 m» / «Landeskarte 10 m» (Auflösung der Stufe) */
export const stufeText = (res: number) => `Landeskarte ${String(res).replace(".", ",")} m`;

// ---------- Zeichnen

const svgImages = new Map<string, Promise<HTMLImageElement | null>>();
function svgImage(svg: string): Promise<HTMLImageElement | null> {
  let p = svgImages.get(svg);
  if (!p) {
    p = new Promise((ok) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => ok(null);
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    });
    if (svgImages.size > 300) svgImages.clear();
    svgImages.set(svg, p);
  }
  return p;
}

/** «07:05» bzw. «T1 18:45», wenn der Tag nicht der der Lagezeit ist */
const zeitLabel = (t: string, ref: string, days: string[]) => (t.slice(0, 10) === ref.slice(0, 10) ? t.slice(11, 16) : `${tagKurz(t, days)} ${t.slice(11, 16)}`);

/** Beschriftung am Zeichen: Feind/Unklar mit Zeit (Papier hat keine Auswahl), eigene Trupps mit Namen */
export function itemLabel(it: SituationItem, t: string, days: string[]): string {
  if (it.kind === "eigen") return it.isUnit ? (it.e.unit || it.ud) : "";
  const extra = [it.e.count && it.e.count > 1 ? `${it.e.count}×` : "", it.isUnit ? it.e.unit : ""].filter(Boolean).join(" ");
  return [zeitLabel(it.e.t, t, days), extra].filter(Boolean).join(" ");
}

const AFF_SUFFIX: Record<string, string> = { H: "", U: " (unklar)", N: " (neutral)", F: " (eigene)" };

/** «Massstab ca. 1:25'000» */
const masstab = (n: number) => `1:${Math.round(n).toLocaleString("de-CH").replace(/[\s’]/g, "'")}`;
const NICE = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

/** Text + Rechteck darunter (weiss, damit die Beschriftung auf der Karte lesbar bleibt) */
function haloText(doc: jsPDF, s: string, x: number, y: number, o: { size: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "center" } = { size: 6 }) {
  doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(o.size);
  const w = doc.getTextWidth(s), h = o.size * 0.3528;
  const x0 = o.align === "center" ? x - w / 2 : x;
  doc.setFillColor(255, 255, 255);
  doc.rect(x0 - 0.4, y - h * 0.85, w + 0.8, h * 1.1, "F");
  doc.setTextColor(...(o.color ?? [27, 35, 32]));
  doc.text(s, x0, y);
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

export interface LagekarteErgebnis {
  blob: Blob;
  /** Anteil fehlender Karte (0…1), 1 = ohne Kartenhintergrund */
  fehlt: number;
  plan: LagekartePlan;
}

/**
 * Lagekarte als PDF. `o.bounds` = Ausschnitt (LV95, wird auf das Papierverhältnis erweitert), `o.t`/`o.from` = Lagezeit
 * und Zeitfenster wie die Karte. Fortschritt `o.onProgress(0…1)`. Setzt `window.__ltPdfInfo`.
 */
export async function lagekartePdf(ex: Exercise, o: LagekarteDruck & { signal?: AbortSignal; plan?: LagekartePlan }): Promise<LagekarteErgebnis> {
  const { jsPDF } = await import("jspdf");
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  const plan = o.plan ?? await lagekartePlan(o.bounds, o.paper, online);
  const b = plan.bounds;
  const lay = blattLayout(o.paper);
  const F = lay.field;
  const W = pxOf(F.w), H = pxOf(F.h);
  const sx = W / (b.maxE - b.minE), sy = H / (b.maxN - b.minN);
  const px = (p: LV95): [number, number] => [(p.e - b.minE) * sx, (b.maxN - p.n) * sy];
  const mm = (p: LV95): [number, number] => [F.x + ((p.e - b.minE) / (b.maxE - b.minE)) * F.w, F.y + ((b.maxN - p.n) / (b.maxN - b.minN)) * F.h];
  o.onProgress?.(0.02);

  // 1 Karte (grau wie die Kartenansicht: Graustufen, weisser Schleier 30 %)
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "rgb(255, 255, 255)";
  ctx.fillRect(0, 0, W, H);
  let fehlt = 1;
  if (plan.cov.share > 0 || online) {
    const r = await renderTiles(b, plan.z, "lk", (p) => o.onProgress?.(0.05 + p * 0.65), { cacheFirst: true, cacheOnly: !online, background: "rgb(255, 255, 255)", signal: o.signal });
    fehlt = r.total ? r.missing / r.total : 1;
    if (fehlt < 1) {
      ctx.filter = "grayscale(1) contrast(.95) brightness(1.05)";
      ctx.drawImage(r.canvas, 0, 0, W, H);
      ctx.filter = "none";
      ctx.fillStyle = "rgba(255, 255, 255, .3)";
      ctx.fillRect(0, 0, W, H);
    }
  }
  if (o.signal?.aborted) throw new Error("abgebrochen");
  o.onProgress?.(0.72);

  // 2 Lage zur Lagezeit
  const events = ohneAufgehobene(ex.events ?? [], o.t);
  const flags = { eigene: true, feind: true, spuren: false, zeiten: true };
  const model = situationModel(events, o.t, flags, { from: o.from, recentMin: 30 });
  const inside = (p: LV95) => p.e >= b.minE && p.e <= b.maxE && p.n >= b.minN && p.n <= b.maxN;
  const items = model.items.filter((it) => inside(it.pos));
  const shapes = shapeItems(ex.events ?? [], { t: o.t, from: o.from, flags: { ...flags, flaechen: true }, selectedId: null, sheets: ex.sheets, areas: ex.areas, quiet: false });
  // Flächen/Linien auf das Bild (unter den Zeichen)
  const lineMm = 0.45;
  for (const s of shapes) {
    const pts = s.shape.pts.map(px);
    if (pts.length < 2) continue;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (s.shape.kind === "flaeche") ctx.closePath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = pxOf(lineMm);
    ctx.setLineDash(s.dashed ? [pxOf(1.6), pxOf(1)] : []);
    if (s.shape.kind === "flaeche") { ctx.globalAlpha = 0.12; ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Zeichen (SVG → Bild), 7 mm A4 / 8 mm A3
  const symPx = pxOf(o.paper === "A3" ? 8 : 7);
  const drawn: Array<{ it: SituationItem; x: number; y: number; w: number }> = [];
  for (const it of [...items].sort((a, c) => Number(a.kind === "eigen") - Number(c.kind === "eigen"))) {
    const g = symbolSvg(it.sym, it.aff, symPx, { sidc: it.sidc, status: it.status, dir: it.e.dir });
    const img = await svgImage(g.svg);
    const [x, y] = px(it.pos);
    if (img) ctx.drawImage(img, x - g.anchor[0], y - g.anchor[1], g.w, g.h);
    drawn.push({ it, x, y, w: g.w - g.anchor[0] });
  }
  o.onProgress?.(0.85);

  // 3 PDF
  const doc = safePdf(new jsPDF({ orientation: "landscape", unit: "mm", format: o.paper.toLowerCase() }));
  doc.addImage(cv.toDataURL("image/jpeg", 0.88), "JPEG", F.x, F.y, F.w, F.h, undefined, "FAST");
  const clipField = () => { doc.saveGraphicsState(); doc.rect(F.x, F.y, F.w, F.h, null); doc.clip(); doc.discardPath(); };

  // Raster (leise) mit Randbeschriftung
  const grid = (s: RasterSheet) => {
    const sb = sheetBounds(s);
    if (sb.maxE < b.minE || sb.minE > b.maxE || sb.maxN < b.minN || sb.minN > b.maxN) return;
    const top = Math.min(sb.maxN, b.maxN), bot = Math.max(sb.minN, b.minN), le = Math.max(sb.minE, b.minE), ri = Math.min(sb.maxE, b.maxE);
    doc.setDrawColor(90); doc.setLineWidth(0.12);
    for (let c = 0; c <= s.colLabels.length; c++) {
      const e = sb.minE + c * s.cellW;
      if (e < b.minE || e > b.maxE) continue;
      const [x1, y1] = mm({ e, n: top }), [, y2] = mm({ e, n: bot });
      doc.line(x1, y1, x1, y2);
    }
    for (let r = 0; r <= s.rowLabels.length; r++) {
      const n = sb.maxN - r * s.cellH;
      if (n < b.minN || n > b.maxN) continue;
      const [x1, y1] = mm({ e: le, n }), [x2] = mm({ e: ri, n });
      doc.line(x1, y1, x2, y1);
    }
  };
  const gridLabels = (s: RasterSheet) => {
    const sb = sheetBounds(s);
    doc.setFont("helvetica", "bold"); doc.setFontSize(o.paper === "A3" ? 7 : 6); doc.setTextColor(60);
    const cw = (s.cellW / (b.maxE - b.minE)) * F.w;
    const every = cw < 4 ? Math.ceil(4 / cw) : 1;
    s.colLabels.forEach((l, c) => {
      const e = sb.minE + (c + 0.5) * s.cellW;
      if (e < b.minE || e > b.maxE || c % every) return;
      doc.text(l, mm({ e, n: 0 })[0], F.y - 1, { align: "center" });
    });
    const ch = (s.cellH / (b.maxN - b.minN)) * F.h;
    const everyR = ch < 3 ? Math.ceil(3 / ch) : 1;
    s.rowLabels.forEach((l, r) => {
      const n = sb.maxN - (r + 0.5) * s.cellH;
      if (n < b.minN || n > b.maxN || r % everyR) return;
      doc.text(l, F.x - 1, mm({ e: 0, n })[1] + 1, { align: "right" });
    });
    doc.setTextColor(0);
  };
  clipField();
  ex.sheets.forEach(grid);
  // NAI / AO / Stao mit Namen
  const areaColor = (a: Area): [number, number, number] => rgb(a.kind === "ao" ? KARTE.ao : a.kind === "stao" ? KARTE.feind : KARTE.nai);
  for (const a of ex.areas) {
    const pts = a.ring.map(mm);
    if (pts.length < 3) continue;
    doc.setDrawColor(...areaColor(a)); doc.setLineWidth(a.kind === "ao" ? 0.6 : 0.45);
    if (a.kind === "ao" || a.kind === "stao") doc.setLineDashPattern([1.5, 1], 0);
    doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i]![0], p[1] - pts[i]![1]]), pts[0]![0], pts[0]![1], [1, 1], "S", true);
    doc.setLineDashPattern([], 0);
  }
  for (const a of ex.areas) {
    const pts = a.ring.map(mm);
    if (pts.length < 3 || a.kind === "ao") continue;
    const top = pts.reduce((best, p) => (p[1] < best[1] ? p : best), pts[0]!);
    if (top[0] < F.x || top[0] > F.x + F.w || top[1] < F.y || top[1] > F.y + F.h) continue;
    haloText(doc, a.trupp ? `${a.name} · ${a.trupp}` : a.name, top[0], Math.max(F.y + 2.5, top[1] - 0.8), { size: o.paper === "A3" ? 7.5 : 6.5, bold: true, color: areaColor(a), align: "center" });
  }
  // Beschriftung der Zeichen: freie Stelle neben dem Zeichen (rechts, links, oben, unten …), eigene Trupps zuerst,
  // dann neueste; ohne freie Stelle keine Beschriftung (auf dem Blatt vermerkt – nie still)
  // Zeitfähnchen ≥ 8 pt, schwarz auf weissem Kasten (MVP 3.5, B6) – das Rot tragen die Zeichen
  const fs = o.paper === "A3" ? 8.5 : 8;
  const pxMm = F.w / W;
  type R = { x0: number; y0: number; x1: number; y1: number };
  const hit = (a: R, b2: R) => a.x0 < b2.x1 && b2.x0 < a.x1 && a.y0 < b2.y1 && b2.y0 < a.y1;
  const busy: R[] = drawn.map((d) => { const r = (d.w * pxMm) * 0.85; const [x, y] = [F.x + d.x * pxMm, F.y + d.y * pxMm]; return { x0: x - r, y0: y - r, x1: x + r, y1: y + r }; });
  const prio = [...drawn].sort((a, c) => Number(c.it.kind === "eigen") - Number(a.it.kind === "eigen") || zeitCmp(c.it.e, a.it.e));
  let ohnePlatz = 0;
  doc.setFont("helvetica", "normal"); doc.setFontSize(fs);
  for (const d of prio) {
    const s = itemLabel(d.it, o.t, ex.days);
    if (!s) continue;
    doc.setFont("helvetica", d.it.kind === "eigen" ? "bold" : "normal"); doc.setFontSize(fs);
    const tw = doc.getTextWidth(s) + 0.8, th = fs * 0.3528 * 1.15;
    const [x, y] = [F.x + d.x * pxMm, F.y + d.y * pxMm];
    const off = d.w * pxMm * 0.85 + 0.4;
    const cand: Array<[number, number]> = [
      [x + off, y - th / 2], [x - off - tw, y - th / 2], [x + off * 0.6, y - off - th * 0.6], [x + off * 0.6, y + off * 0.6],
      [x - off * 0.6 - tw, y - off - th * 0.6], [x - off * 0.6 - tw, y + off * 0.6], [x - tw / 2, y - off - th], [x - tw / 2, y + off],
    ];
    const spot = cand.map(([cx, cy]) => ({ x0: cx, y0: cy, x1: cx + tw, y1: cy + th }))
      .find((r) => r.x0 >= F.x && r.x1 <= F.x + F.w && r.y0 >= F.y && r.y1 <= F.y + F.h && !busy.some((b2) => hit(r, b2)));
    if (!spot) { ohnePlatz++; continue; }
    busy.push(spot);
    const col: [number, number, number] = d.it.kind === "eigen" ? rgb(LAGE_KARTE.eigen) : rgb(LAGE_KARTE.ink);
    haloText(doc, s, spot.x0 + 0.4, spot.y0 + th * 0.78, { size: fs, bold: d.it.kind === "eigen", color: col });
  }
  doc.restoreGraphicsState();
  ex.sheets.forEach(gridLabels);
  doc.setDrawColor(0); doc.setLineWidth(0.4); doc.rect(F.x, F.y, F.w, F.h, "S");

  // Kopf
  const klass = o.klassifizierung;
  const ohneKarte = fehlt >= 0.999;
  const stand = `Stand ${tagKurz(o.t, ex.days)} ${datum(o.t)} ${o.t.slice(11, 16)}`;
  const min = o.from ? Math.round((Date.parse(o.t) - Date.parse(o.from)) / 60000) : 0;
  const fenster = !o.from ? "Meldungen: alle" : min % 60 === 0 && min <= 720 ? `Meldungen: letzte ${min / 60} h` : min < 60 ? `Meldungen: letzte ${min} min` : `Meldungen: ab ${zeitLabel(o.from, o.t, ex.days)}`;
  let x = RAND, y = RAND + 5.5;
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(0);
  doc.text("LAGEKARTE", x, y); x += doc.getTextWidth("LAGEKARTE") + 4;
  doc.setFontSize(10.5);
  const nm = ex.name.length > 60 ? ex.name.slice(0, 58) + "…" : ex.name;
  doc.text(nm, x, y); x += doc.getTextWidth(nm) + 5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.text(stand, x, y); x += doc.getTextWidth(stand) + 5;
  doc.text(fenster, x, y); x += doc.getTextWidth(fenster) + 5;
  if (ohneKarte) { doc.setFont("helvetica", "bold"); doc.text("ohne Kartenhintergrund", x, y); }
  else if (fehlt > 0.005) { doc.setFont("helvetica", "bold"); doc.text(`${Math.max(1, Math.round(fehlt * 100))} % der Karte fehlen – weiss gedruckt`, x, y); }
  doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text(klass, lay.pw - RAND, y, { align: "right" });

  // Legende
  await legende(doc, lay, items, ex.areas.length > 0, ex.sheets.length > 0, o.paper, ohnePlatz);

  // Fuss: Massstab, Nordpfeil, Quelle, erstellt, Seite
  const mPerMm = (b.maxE - b.minE) / F.w;
  const raw = mPerMm * 1000, mag = 10 ** Math.max(2, Math.floor(Math.log10(raw)) - 1);
  const scale = Math.round(raw / mag) * mag;
  const barM = NICE.reduce((best, n) => (Math.abs(n / mPerMm - 25) < Math.abs(best / mPerMm - 25) ? n : best), NICE[0]!);
  const barMm = barM / mPerMm;
  const fy = lay.ph - RAND + 1;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(0);
  x = RAND;
  const ms = `Massstab ca. ${masstab(scale)}`;
  doc.text(ms, x, fy); x += doc.getTextWidth(ms) + 3;
  doc.setFillColor(0, 0, 0); doc.rect(x, fy - 2, barMm / 2, 1.4, "F");
  doc.setDrawColor(0); doc.setLineWidth(0.2); doc.rect(x, fy - 2, barMm, 1.4, "S");
  x += barMm + 1.5;
  const bl = barM >= 1000 ? `${barM / 1000} km` : `${barM} m`;
  doc.text(bl, x, fy); x += doc.getTextWidth(bl) + 5;
  // Nordpfeil
  doc.setFillColor(0, 0, 0); doc.triangle(x + 1.5, fy - 3.4, x, fy + 0.4, x + 3, fy + 0.4, "F");
  doc.text("N", x + 4, fy); x += 9;
  const now = new Date();
  const erstellt = `erstellt ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}${o.kuerzel ? ` von ${o.kuerzel}` : ""}`;
  const quelle = `Karte © swisstopo · ${erstellt}${plan.groeber && !ohneKarte ? ` · Karte gröber (${stufeText(plan.res)}, offline gespeichert)` : ""}`;
  doc.text(quelle, x, fy);
  doc.setFont("helvetica", "bold");
  doc.text(klass, lay.pw - RAND, fy, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text("Seite 1 von 1", lay.pw - RAND - doc.getTextWidth(klass) - 6, fy, { align: "right" });
  o.onProgress?.(1);
  pdfInfo(doc, o.paper === "A3" ? "a3" : "a4", true);
  return { blob: doc.output("blob"), fehlt, plan };
}

/** Legende: Grundformen, vorkommende Zeichen (≤ 16, sonst «+ n weitere»), NAI/Raster */
async function legende(doc: jsPDF, lay: BlattLayout, items: SituationItem[], areas: boolean, raster: boolean, paper: LagekarteDruck["paper"], ohnePlatz = 0) {
  const Lg = lay.legend;
  const entries: Array<{ label: string; draw: (x: number, y: number) => Promise<void> | void }> = [];
  const shape = (kind: "feind" | "unklar" | "eigen") => (x: number, y: number) => {
    const s = 1.6;
    if (kind === "feind") { doc.setFillColor(...rgb(LAGE_KARTE.feind)); doc.lines([[s, s], [-s, s], [-s, -s]], x + s, y - s * 1.6, [1, 1], "F", true); }
    else if (kind === "unklar") { doc.setFillColor(...rgb(LAGE_KARTE.unklarFill)); doc.setDrawColor(...rgb(LAGE_KARTE.unklar)); doc.setLineWidth(0.2); doc.rect(x, y - 2.6, 2.6, 2.6, "FD"); }
    else { doc.setFillColor(...rgb(LAGE_KARTE.eigen)); doc.circle(x + 1.4, y - 1.2, 1.3, "F"); }
  };
  entries.push({ label: "Feind", draw: shape("feind") }, { label: "Unklar", draw: shape("unklar") }, { label: "Eigene", draw: shape("eigen") });
  const seen = new Set<string>();
  const order = { eigen: 0, feind: 1, unklar: 2, neutral: 3, ul: 4 } as const;
  const syms: SituationItem[] = [];
  for (const it of [...items].sort((a, c) => order[a.kind] - order[c.kind] || a.name.localeCompare(c.name))) {
    const k = `${it.name}|${it.aff}`;
    if (seen.has(k)) continue;
    seen.add(k);
    syms.push(it);
  }
  // A4: 4 Zeilen × 5 Spalten inkl. Grundformen, NAI, Raster
  const max = paper === "A3" ? 40 : 13;
  for (const it of syms.slice(0, Math.min(16, max))) {
    entries.push({
      label: it.name + (AFF_SUFFIX[it.aff] ?? ""),
      draw: async (x, y) => {
        const g = symbolSvg(it.sym, it.aff, 48, { sidc: it.sidc ? it.sidc.slice(0, 3) + "P" + it.sidc.slice(4) : undefined });
        const img = await svgImage(g.svg);
        if (!img) return;
        const c = document.createElement("canvas");
        c.width = g.w; c.height = g.h;
        c.getContext("2d")!.drawImage(img, 0, 0, g.w, g.h);
        const hmm = 3.2, wmm = (g.w / g.h) * hmm;
        doc.addImage(c.toDataURL("image/png"), "PNG", x, y - hmm + 0.4, Math.min(wmm, 5), hmm, undefined, "FAST");
      },
    });
  }
  const rest = syms.length - Math.min(syms.length, 16, max);
  if (areas) entries.push({ label: "NAI", draw: (x, y) => { doc.setDrawColor(...rgb(KARTE.nai)); doc.setLineWidth(0.45); doc.rect(x, y - 2.4, 3.6, 2.4, "S"); } });
  if (raster) entries.push({ label: "Raster", draw: (x, y) => { doc.setDrawColor(90); doc.setLineWidth(0.12); doc.line(x, y - 1.2, x + 3.6, y - 1.2); doc.line(x + 1.8, y - 2.6, x + 1.8, y + 0.2); } });
  const extra = [items.some((i) => i.kind !== "eigen") ? "Zeit am Zeichen = Meldung" : "", ohnePlatz ? `${ohnePlatz} Zeichen ohne Beschriftung (kein Platz) – Zeiten im Journal` : ""].filter(Boolean).join(" · ");
  doc.setTextColor(0);
  if (Lg.band) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
    doc.text("Legende", Lg.x, Lg.y + 3.4);
    const cols = 5, cw = (Lg.w - 18) / cols, rh = 4.0;
    let rows = 0;
    for (let i = 0; i < entries.length && i < cols * 4; i++) {
      const cx = Lg.x + 18 + (i % cols) * cw, cy = Lg.y + 3.4 + Math.floor(i / cols) * rh;
      rows = Math.floor(i / cols) + 1;
      await entries[i]!.draw(cx, cy);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(0);
      doc.text(doc.splitTextToSize(entries[i]!.label, cw - 7)[0] as string, cx + 6, cy);
    }
    const weg = Math.max(0, entries.length - cols * 4);
    const tail = [rest + weg > 0 ? `+ ${rest + weg} weitere Zeichen` : "", extra].filter(Boolean).join(" · ");
    // Erklärung als eigene Zeile über die ganze Breite (vorher in schmaler Spalte abgeschnitten)
    if (tail) { doc.setFontSize(7.5); doc.setTextColor(70); doc.text((doc.splitTextToSize(tail, Lg.w - 18) as string[])[0]!, Lg.x + 18, Lg.y + 3.4 + rows * rh); doc.setTextColor(0); }
  } else {
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.rect(Lg.x, Lg.y, Lg.w, Lg.h, "S");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("Legende", Lg.x + 3, Lg.y + 6);
    let y = Lg.y + 12;
    for (const e of entries) {
      if (y > Lg.y + Lg.h - 10) break;
      await e.draw(Lg.x + 3, y);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(0);
      doc.text(doc.splitTextToSize(e.label, Lg.w - 14)[0] as string, Lg.x + 10, y);
      y += 5.2;
    }
    doc.setFontSize(7); doc.setTextColor(80);
    if (rest > 0) { doc.text(`+ ${rest} weitere Zeichen`, Lg.x + 3, y); y += 4.5; }
    if (extra) doc.text(extra, Lg.x + 3, y);
    doc.setTextColor(0);
  }
}
