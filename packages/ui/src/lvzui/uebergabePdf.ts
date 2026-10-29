/**
 * Übergabe als PDF (Spez. MVP 3, Kap. 3.8): dieselben Abschnitte wie die Seite (`uebergabeDaten`), A4 hoch, Ziel eine
 * Seite (höchstens zwei), Klassifizierung oben und unten, «Seite n von m», Visum-Zeilen mit Strich zum Unterschreiben.
 * Schrift so gross, wie es auf eine Seite passt (10 → 9 → 8.5 pt, nie unter 8 pt); Zeit · Nr · Text in Spalten, die
 * Nummer grau (nie als Menge gelesen, Prüfung M4).
 * Setzt `window.__ltPdfInfo` (Testhaken, nur lesen, keine Daten nach aussen).
 */
import { jsPDF } from "jspdf";
import { safePdf } from "../pdfSafe";
import { pdfInfo } from "../perf";
import type { UebergabeDaten, UebergabeZeileNeu } from "./uebergabeDaten";

const W = 210, H = 297, M = 14, FUSS = 284;
/** Schriftstufen: Text (pt), Zeilenhöhe (mm), Abschnittstitel (pt) */
const STUFEN = [{ fs: 10, lh: 4.4, h: 11.5 }, { fs: 9, lh: 4.0, h: 10.5 }, { fs: 8.5, lh: 3.75, h: 10 }];
const GRAU = 95;

function zeichne(d: UebergabeDaten, visum: { von: string; an: string; um: string }, st: (typeof STUFEN)[number]): { doc: jsPDF; zeilen: string[] } {
  const doc = safePdf(new jsPDF({ unit: "mm", format: "a4" }));
  const zeilen: string[] = [];
  const LH = st.lh;
  let y = 0;
  const text = (s: string | string[], x: number, yy: number, o?: { align?: "right" | "left" | "center" }) => {
    doc.text(s, x, yy, o);
    for (const l of Array.isArray(s) ? s : [s]) zeilen.push(l);
  };
  const normal = () => { doc.setFont("helvetica", "normal"); doc.setFontSize(st.fs); doc.setTextColor(0); };
  const kopf = () => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(0);
    text(d.klass, W - M, 9, { align: "right" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    text(`Übergabe – ${d.titel}`, M, 16);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    text(`Stand ${d.stand}`, W - M, 16, { align: "right" });
    text(d.schichtZeile, M, 21.5);
    doc.setDrawColor(0); doc.line(M, 24, W - M, 24);
    y = 30.5;
    normal();
  };
  const platz = (h: number) => { if (y + h > FUSS) { doc.addPage(); kopf(); } };
  const titel = (s: string) => {
    platz(LH * 3);
    y += 1;
    doc.setFont("helvetica", "bold"); doc.setFontSize(st.h);
    text(s.toUpperCase(), M, y);
    normal();
    y += LH + 0.9;
  };
  const absatz = (s: string, x = M, w = W - 2 * M) => {
    const l = doc.splitTextToSize(s, w) as string[];
    platz(l.length * LH);
    text(l, x, y);
    y += l.length * LH;
  };
  /** Zeile in Spalten: Zeichen · Zeit · Nr (grau) · Text (umbricht) */
  const COL = { mark: 5, t: st.fs >= 10 ? 19 : 17.5, nr: st.fs >= 10 ? 15 : 13.5 };
  const spalten = (mark: string | null, t: string, nr: string, inhalt: string) => {
    const xT = M + (mark !== null ? COL.mark : 0), xNr = xT + COL.t, xText = xNr + COL.nr;
    const l = doc.splitTextToSize(inhalt, W - M - xText) as string[];
    platz(l.length * LH);
    if (mark) { doc.setFont("helvetica", "bold"); text(mark, M, y); normal(); }
    if (t) text(t, xT, y);
    if (nr) { doc.setTextColor(GRAU); text(`Nr ${nr}`, xNr, y); doc.setTextColor(0); }
    text(l, xText, y);
    y += l.length * LH;
  };
  const zeileNeu = (z: UebergabeZeileNeu) => spalten(null, z.t, z.nr, `${z.bang ? "! " : ""}${z.text}${z.meta ? ` · ${z.meta}` : ""}`);
  const tabelle = (cols: Array<{ h: string; w: number }>, rows: string[][], fett = true) => {
    platz(LH * 2);
    doc.setFont("helvetica", "bold");
    let x = M;
    cols.forEach((c) => { text(c.h, x, y); x += c.w; });
    normal();
    y += 1.2;
    doc.setDrawColor(150); doc.line(M, y, W - M, y);
    y += LH - 0.4;
    for (const r of rows) {
      const parts = r.map((c, i) => doc.splitTextToSize(c, cols[i]!.w - 1.5) as string[]);
      const h = Math.max(...parts.map((p) => p.length)) * LH;
      platz(h);
      x = M;
      parts.forEach((p, i) => { if (i === 0 && fett) doc.setFont("helvetica", "bold"); text(p, x, y); normal(); x += cols[i]!.w; });
      y += h;
    }
    y += 1.4;
  };
  const luecke = () => { y += 1.6; };

  kopf();
  titel("1 Lage Blau");
  if (d.blau.length) {
    tabelle([{ h: "Trupp", w: 14 }, { h: "Ort", w: 22 }, { h: "seit", w: 20 }, { h: "letzte Meldung", w: 70 }, { h: "letzte Vbk", w: 24 }, { h: "offen", w: 32 }],
      d.blau.map((z) => [z.trupp, z.ort, z.seit, z.letzte + (z.still ? ` · ${z.still}` : ""), z.vbk, z.offen]));
  } else absatz("Keine eigenen Trupps erfasst.");

  titel("2 Lage Rot");
  if (!d.rot.gesehen && !d.rot.moeglich.length) absatz("Noch kein Rot gemeldet.");
  for (const s of [d.rot.gesehen, d.rot.zuletzt, d.rot.aktivitaet, ...d.rot.moeglich]) if (s) absatz(s);
  luecke();

  titel("3 Von oben (gültig)");
  if (!d.vonOben.length) absatz("Keine Orientierung von oben erfasst.");
  for (const z of d.vonOben) zeileNeu(z);
  luecke();

  titel(`4 Offene Punkte (${d.offenTotal})`);
  if (!d.offen.length) absatz("Nichts offen.");
  for (const o of d.offen) spalten(o.mark, o.t, o.nr, `${o.text}${o.meta ? ` · ${o.meta}` : ""}`);
  if (d.offenWeitere) absatz(`+${d.offenWeitere} weitere in «Offen»`);
  luecke();

  titel(`5 ${d.neu.titel}`);
  if (!d.neu.zeilen.length) absatz("Noch nichts Neues in dieser Schicht.");
  for (const z of d.neu.zeilen) zeileNeu(z);
  if (d.neu.weitere) absatz(`+${d.neu.weitere} weitere im Journal`);
  luecke();

  titel("6 Zahlen für den Rapport");
  tabelle([{ h: "", w: 74 }, { h: "Schicht", w: 32 }, { h: "ganze Übung", w: 32 }], d.zahlen.map((r) => [...r]), false);

  // 7 Visum mit Strich zum Unterschreiben
  platz(30);
  titel("7 Visum");
  y += 4;
  doc.setFontSize(Math.max(9.5, st.fs));
  text(`übergeben von ${visum.von || "______"}  um ${visum.um}`, M, y);
  text(`übernommen von ${visum.an || "______"}`, M + 95, y);
  y += 10;
  doc.setDrawColor(0);
  doc.line(M, y, M + 75, y); doc.line(M + 95, y, W - M, y);
  doc.setFontSize(8.5);
  text("Visum", M, y + 4); text("Visum", M + 95, y + 4);

  // Fuss: Klassifizierung und «Seite n von m» auf jeder Seite
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(0);
    text(d.klass, M, H - 8);
    text(`Seite ${i} von ${n}`, W - M, H - 8, { align: "right" });
  }
  return { doc, zeilen };
}

export function uebergabePdf(d: UebergabeDaten, visum: { von: string; an: string; um: string }): Blob {
  // grösste Schrift, die auf eine Seite passt (sonst die kleinste Stufe, höchstens zwei Seiten)
  let r = zeichne(d, visum, STUFEN[0]!);
  for (let i = 1; i < STUFEN.length && r.doc.getNumberOfPages() > 1; i++) r = zeichne(d, visum, STUFEN[i]!);
  // Testhaken (perf.ts); sammelt `safePdf` keine Zeilen, die eigenen
  const info = pdfInfo(r.doc, "a4", false);
  if (!info.zeilen.length) { info.zeilen = r.zeilen; window.__ltPdfInfo = info; }
  return r.doc.output("blob");
}
