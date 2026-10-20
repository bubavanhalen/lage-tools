/**
 * PDF-Druck eines Führungsraster-Blattes im Layout der Übungsvorlagen:
 * Kopfzeile mit A B / D C, Massstabsbalken, Klassifizierung, Codename und Kompass,
 * Beschriftung auf allen vier Seiten, Referenzkreuz mit Koordinaten, Karte von swisstopo.
 */
import {
  formatShortRef,
  sheetBounds,
  type Area,
  type RasterSheet,
} from "@lage/core";
import { renderTiles, tileLevel } from "./tiles";

export type Paper = "A4" | "A3";

/** Lädt die swisstopo-Kacheln für das Blatt und setzt sie zu einem Bild zusammen. */
async function mapImage(sheet: RasterSheet, metersPerPx: number, onProgress?: (p: number) => void): Promise<HTMLCanvasElement> {
  const b = sheetBounds(sheet);
  const z = tileLevel(b, metersPerPx, { maxZ: sheet.basemap === "img" ? 28 : 27, maxTiles: 400 });
  return (await renderTiles(b, z, sheet.basemap, onProgress)).canvas;
}

export interface PrintOptions {
  paper: Paper;
  areas?: Area[];
  onProgress?: (p: number) => void;
}

export async function printSheet(sheet: RasterSheet, opts: PrintOptions): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const [pw, ph] = opts.paper === "A3" ? [420, 297] : [297, 210];
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: opts.paper.toLowerCase() });
  const m = 8; // Rand
  const lab = opts.paper === "A3" ? 10 : 7.5; // Höhe Beschriftungsfeld
  const cols = sheet.colLabels.length, rows = sheet.rowLabels.length;
  const leftW = lab * 2, rightW = lab * 1.6;
  const topH = lab * 2, botH = lab * 1.8;
  const availW = pw - 2 * m - leftW - rightW, availH = ph - 2 * m - topH - botH;
  const cw = Math.min(availW / cols, (availH / rows) * (sheet.cellW / sheet.cellH));
  const ch = cw * (sheet.cellH / sheet.cellW);
  const gw = cw * cols, gh = ch * rows;
  const fx = m, fy = m; // Rahmen oben links
  const gx = fx + leftW, gy = fy + topH; // Raster oben links
  const fw = leftW + gw + rightW, fh = topH + gh + botH;
  const fs = opts.paper === "A3" ? 11 : 8.5; // Schriftgrösse Beschriftung

  // Karte
  const mmPerPx = 25.4 / 220;
  const metersPerPx = (sheet.cellW / cw) * mmPerPx;
  const map = await mapImage(sheet, metersPerPx, opts.onProgress);
  doc.addImage(map.toDataURL("image/jpeg", 0.88), "JPEG", gx, gy, gw, gh, undefined, "FAST");

  // NAI
  if (opts.areas?.length) {
    const b = sheetBounds(sheet);
    const tx = (e: number) => gx + ((e - b.minE) / (b.maxE - b.minE)) * gw;
    const ty = (n: number) => gy + ((b.maxN - n) / (b.maxN - b.minN)) * gh;
    for (const a of opts.areas) {
      const pts = a.ring.map((p) => [tx(p.e), ty(p.n)] as [number, number]);
      if (pts.length < 3) continue;
      doc.setDrawColor(a.color ?? "#1f78d1");
      doc.setLineWidth(0.6);
      doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i]![0], p[1] - pts[i]![1]]), pts[0]![0], pts[0]![1], [1, 1], "S", true);
      const top = pts.reduce((best, p) => (p[1] < best[1] ? p : best), pts[0]!);
      doc.setFontSize(fs);
      doc.setTextColor(a.color ?? "#1f78d1");
      doc.text(a.name, top[0], top[1] - 1, { align: "center" });
    }
    doc.setTextColor(0);
  }

  // Rasterlinien
  doc.setDrawColor(0);
  doc.setLineWidth(0.15);
  for (let c = 1; c < cols; c++) doc.line(gx + c * cw, gy, gx + c * cw, gy + gh);
  for (let r = 1; r < rows; r++) doc.line(gx, gy + r * ch, gx + gw, gy + r * ch);

  // Beschriftung
  const box = (x: number, y: number, w: number, h: number, text: string, fill?: string, color = 0, bold = true, size = fs) => {
    if (fill) { doc.setFillColor(fill); doc.rect(x, y, w, h, "F"); }
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.rect(x, y, w, h, "S");
    if (text) {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(color);
      doc.text(text, x + w / 2, y + h / 2, { align: "center", baseline: "middle" });
    }
  };
  const grey = "#c8c8c8";
  // Kopf: A B / D C
  box(fx, fy, lab, lab, "A", "#ffffff"); box(fx + lab, fy, lab, lab, "B", "#ffffff");
  box(fx, fy + lab, lab, lab, "D", "#ffffff"); box(fx + lab, fy + lab, lab, lab, "C", "#ffffff");
  // Kopfband: Massstab | Klassifizierung | Codename | Kompass
  const bandW = gw;
  const scaleW = bandW * 0.33, clsW = bandW * 0.33, nameW = bandW - scaleW - clsW;
  box(gx, fy, scaleW, lab, "", grey);
  box(gx + scaleW, fy, clsW, lab, sheet.classification || "", "#111111", 255);
  box(gx + scaleW + clsW, fy, nameW, lab, `“${sheet.name}“`, grey, 255);
  box(gx + gw, fy, rightW, topH, "", grey);
  // Massstabsbalken als Pfeil
  const barMM = Math.min(scaleW - 4, (sheet.scaleBar / sheet.cellW) * cw);
  const ay = fy + lab / 2, ax = gx + 2;
  doc.setFillColor("#ffffff"); doc.setDrawColor(0); doc.setLineWidth(0.25);
  const hd = lab * 0.35;
  doc.lines([[hd, -hd * 0.8], [0, hd * 0.45], [barMM - 2 * hd, 0], [0, -hd * 0.45], [hd, hd * 0.8], [-hd, hd * 0.8], [0, -hd * 0.45], [-(barMM - 2 * hd), 0], [0, hd * 0.45]], ax, ay, [1, 1], "FD", true);
  doc.setFont("helvetica", "bold"); doc.setFontSize(fs * 0.85); doc.setTextColor(0);
  doc.text(`${sheet.scaleBar >= 1000 ? sheet.scaleBar / 1000 + " km" : sheet.scaleBar + " m"}`, ax + barMM / 2, ay, { align: "center", baseline: "middle" });
  // Kompass
  const ccx = gx + gw + rightW / 2, ccy = fy + topH / 2, cr = Math.min(rightW, topH) * 0.36;
  doc.setFillColor("#ffffff"); doc.circle(ccx, ccy, cr, "FD");
  doc.setFillColor("#111111");
  doc.triangle(ccx, ccy - cr * 0.85, ccx - cr * 0.22, ccy, ccx + cr * 0.22, ccy, "F");
  doc.setFillColor("#ffffff"); doc.setDrawColor(0);
  doc.triangle(ccx, ccy + cr * 0.85, ccx - cr * 0.22, ccy, ccx + cr * 0.22, ccy, "FD");
  doc.setFontSize(fs * 0.7); doc.text("N", ccx, ccy - cr - 0.6, { align: "center" });

  // Spaltenbeschriftung oben (Zeile 2) und unten, Zeilenbeschriftung links und rechts
  for (let c = 0; c < cols; c++) {
    box(gx + c * cw, fy + lab, cw, lab, sheet.colLabels[c]!, "#ffffff");
    box(gx + c * cw, gy + gh, cw, lab, sheet.colLabels[c]!, "#ffffff");
  }
  for (let r = 0; r < rows; r++) {
    box(fx, gy + r * ch, leftW, ch, sheet.rowLabels[r]!, grey);
    box(gx + gw, gy + r * ch, rightW, ch, sheet.rowLabels[r]!, grey);
  }
  // Fussband
  box(fx, gy + gh, leftW, botH, "", grey);
  box(gx + gw, gy + gh, rightW, botH, "", grey);
  box(gx, gy + gh + lab, gw, botH - lab, "", grey);
  const scale = Math.round(((sheet.cellW * 1000) / cw) / 500) * 500;
  doc.setFont("helvetica", "normal"); doc.setFontSize(fs * 0.75); doc.setTextColor(40);
  doc.text(`Massstab ca. 1:${scale.toLocaleString("de-CH").replace(/\s/g, "'")}  ·  Feld ${sheet.cellW} m  ·  Karte © swisstopo  ·  erstellt ${new Date().toLocaleDateString("de-CH")}`,
    gx + 2, gy + gh + lab + (botH - lab) / 2, { baseline: "middle" });

  // Referenzkreuz
  if (sheet.reference) {
    const b = sheetBounds(sheet);
    const rx = gx + ((sheet.reference.e - b.minE) / (b.maxE - b.minE)) * gw;
    const ry = gy + ((b.maxN - sheet.reference.n) / (b.maxN - b.minN)) * gh;
    doc.setDrawColor(0); doc.setLineWidth(0.6);
    doc.line(rx, ry - ch * 1.1, rx, ry + ch * 1.1);
    doc.line(rx - cw * 1.1, ry, rx + cw * 1.1, ry);
    const [e, n] = formatShortRef(sheet.reference).split(" / ");
    const tw = cw * 1.85, th = ch * 0.62;
    box(rx - tw - cw * 0.15, ry - th - ch * 0.15, tw, th, e!, "#d9d9d9", 0, true, fs * 0.9);
    box(rx + cw * 0.15, ry + ch * 0.15, tw, th, n!, "#d9d9d9", 0, true, fs * 0.9);
  }
  // Rahmen
  doc.setLineWidth(0.8); doc.setDrawColor(0);
  doc.rect(fx, fy, fw, fh, "S");
  doc.rect(gx, gy, gw, gh, "S");
  return doc.output("blob");
}
