/**
 * Übergabe als PDF (Spez. MVP 3, Kap. 3.8): dieselben Abschnitte wie die Seite (`uebergabeDaten`), A4 hoch, Ziel eine
 * Seite (höchstens zwei), Klassifizierung oben und unten, «Seite n von m», Visum-Zeilen mit Strich zum Unterschreiben.
 * Setzt `window.__ltPdfInfo` (Testhaken, nur lesen, keine Daten nach aussen).
 */
import { jsPDF } from "jspdf";
import { safePdf } from "../pdfSafe";
import { pdfInfo } from "../perf";
import type { UebergabeDaten } from "./uebergabeDaten";

const W = 210, H = 297, M = 14, FUSS = 284;

export function uebergabePdf(d: UebergabeDaten, visum: { von: string; an: string; um: string }): Blob {
  const doc = safePdf(new jsPDF({ unit: "mm", format: "a4" }));
  const zeilen: string[] = [];
  let y = 0;
  const text = (s: string | string[], x: number, yy: number, o?: { align?: "right" | "left" | "center" }) => {
    doc.text(s, x, yy, o);
    for (const l of Array.isArray(s) ? s : [s]) zeilen.push(l);
  };
  const kopf = () => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(0);
    text(d.klass, W - M, 9, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    text(`Übergabe – ${d.titel}`, M, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    text(`Stand ${d.stand}`, W - M, 15, { align: "right" });
    text(d.schichtZeile, M, 20.5);
    doc.setDrawColor(0); doc.line(M, 23, W - M, 23);
    y = 29;
  };
  const platz = (h: number) => { if (y + h > FUSS) { doc.addPage(); kopf(); } };
  const titel = (s: string) => {
    platz(10);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    text(s.toUpperCase(), M, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    y += 4.6;
  };
  const LH = 3.7;
  const absatz = (s: string, x = M, w = W - 2 * M) => {
    const l = doc.splitTextToSize(s, w) as string[];
    platz(l.length * LH);
    text(l, x, y);
    y += l.length * LH;
  };
  const tabelle = (cols: Array<{ h: string; w: number }>, rows: string[][], fett = true) => {
    platz(LH * 2);
    doc.setFont("helvetica", "bold");
    let x = M;
    cols.forEach((c) => { text(c.h, x, y); x += c.w; });
    doc.setFont("helvetica", "normal");
    y += 1.2;
    doc.setDrawColor(150); doc.line(M, y, W - M, y);
    y += LH - 0.6;
    for (const r of rows) {
      const parts = r.map((c, i) => doc.splitTextToSize(c, cols[i]!.w - 1.5) as string[]);
      const h = Math.max(...parts.map((p) => p.length)) * LH;
      platz(h);
      x = M;
      parts.forEach((p, i) => { if (i === 0 && fett) doc.setFont("helvetica", "bold"); text(p, x, y); doc.setFont("helvetica", "normal"); x += cols[i]!.w; });
      y += h;
    }
    y += 1.4;
  };

  kopf();
  titel("1 Lage Blau");
  if (d.blau.length) {
    tabelle([{ h: "Trupp", w: 14 }, { h: "Ort", w: 22 }, { h: "seit", w: 20 }, { h: "letzte Meldung", w: 68 }, { h: "letzte Vbk", w: 24 }, { h: "offen", w: 34 }],
      d.blau.map((z) => [z.trupp, z.ort, z.seit, z.letzte + (z.still ? ` · ${z.still}` : ""), z.vbk, z.offen]));
  } else absatz("Keine eigenen Trupps erfasst.");

  titel("2 Lage Rot");
  if (!d.rot.gesehen && !d.rot.moeglich.length) absatz("Noch kein Rot gemeldet.");
  for (const s of [d.rot.gesehen, d.rot.zuletzt, ...d.rot.moeglich]) if (s) absatz(s);
  y += 1.4;

  titel(`3 Offene Punkte (${d.offenTotal})`);
  if (!d.offen.length) absatz("Nichts offen.");
  for (const o of d.offen) absatz(`${o.mark} ${o.t ? o.t + " " : ""}${o.nr ? o.nr + " " : ""}${o.text}${o.meta ? ` · ${o.meta}` : ""}`);
  if (d.offenWeitere) absatz(`+${d.offenWeitere} weitere in «Offen»`);
  y += 1.4;

  titel(`4 ${d.neu.titel}`);
  if (!d.neu.zeilen.length) absatz("Noch nichts Neues in dieser Schicht.");
  for (const z of d.neu.zeilen) absatz(z);
  if (d.neu.weitere) absatz(`+${d.neu.weitere} weitere im Journal`);
  y += 1.4;

  titel("5 Zahlen für den Rapport");
  tabelle([{ h: "", w: 70 }, { h: "Schicht", w: 30 }, { h: "ganze Übung", w: 30 }], d.zahlen.map((r) => [...r]), false);

  // 6 Visum mit Strich zum Unterschreiben
  platz(26);
  titel("6 Visum");
  y += 4;
  doc.setFontSize(9);
  text(`übergeben von ${visum.von || "______"}  um ${visum.um}`, M, y);
  text(`übernommen von ${visum.an || "______"}`, M + 95, y);
  y += 9;
  doc.setDrawColor(0);
  doc.line(M, y, M + 75, y); doc.line(M + 95, y, W - M, y);
  doc.setFontSize(7.5);
  text("Visum", M, y + 3.5); text("Visum", M + 95, y + 3.5);

  // Fuss: Klassifizierung und «Seite n von m» auf jeder Seite
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(0);
    text(d.klass, M, H - 8);
    text(`Seite ${i} von ${n}`, W - M, H - 8, { align: "right" });
  }
  // Testhaken (perf.ts); sammelt `safePdf` keine Zeilen, die eigenen
  const info = pdfInfo(doc, "a4", false);
  if (!info.zeilen.length) { info.zeilen = zeilen; window.__ltPdfInfo = info; }
  return doc.output("blob");
}
