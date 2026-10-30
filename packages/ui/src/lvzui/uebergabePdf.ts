/**
 * Übergabe als PDF (Spez. MVP 3, Kap. 3.8): dieselben Abschnitte wie die Seite (`uebergabeDaten`), A4 hoch, Ziel eine
 * Seite (höchstens zwei), Klassifizierung oben und unten, «Seite n von m», Visum-Zeilen mit Strich zum Unterschreiben.
 * Schrift so gross, wie es auf eine Seite passt (10 → 9 → 8.5 pt, nie unter 8 pt); Zeit · Nr · Text in Spalten, die
 * Nummer grau (nie als Menge gelesen, Prüfung M4).
 * Setzt `window.__ltPdfInfo` (Testhaken, nur lesen, keine Daten nach aussen).
 * MVP 3.5 (D7/D8): «Nr 56» überall; dringend und Zeichen der offenen Punkte als Vektorzeichen (⚠ dringend/Konflikt,
 * • offen/Begehren) statt «! »; «Von oben» mit «+n weitere im Journal».
 */
import { jsPDF } from "jspdf";
import { glyphBreite, glyphPunkt, glyphWarn, safePdf } from "../pdfSafe";
import { pdfInfo } from "../perf";
import type { UebergabeDaten, UebergabeZeileNeu } from "./uebergabeDaten";

const W = 210, H = 297, M = 14, FUSS = 284;
/** Schriftstufen: Text (pt), Zeilenhöhe (mm), Abschnittstitel (pt) */
const STUFEN = [{ fs: 10, lh: 4.4, h: 11.5 }, { fs: 9, lh: 4.0, h: 10.5 }, { fs: 8.5, lh: 3.75, h: 10 }, { fs: 8, lh: 3.55, h: 9.5 }];
/**
 * Kürzen, wenn auch 8 pt nicht auf eine Seite passt (MVP 3 Fix 3: Visum nie allein auf Seite 2): «Neu» und «Offen»
 * schrittweise auf weniger Zeilen, der Rest steht als «+n weitere» da (vollständig im Journal bzw. in «Offen»).
 */
const KUERZEN: Array<{ neu: number; offen: number }> = [{ neu: 8, offen: 10 }, { neu: 5, offen: 8 }, { neu: 3, offen: 6 }, { neu: 0, offen: 4 }];

/** Übergabe mit höchstens `k.neu` Zeilen «Neu» und `k.offen` Zeilen «Offen» (Rest als «+n weitere») */
function gekuerzt(d: UebergabeDaten, k: { neu: number; offen: number }): UebergabeDaten {
  const neu = d.neu.zeilen.slice(0, k.neu), offen = d.offen.slice(0, k.offen);
  return {
    ...d, offen, offenWeitere: d.offenWeitere + d.offen.length - offen.length,
    neu: { ...d.neu, zeilen: neu, weitere: d.neu.weitere + d.neu.zeilen.length - neu.length },
  };
}
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
    // Vektorzeichen statt «!»/«•» (D8); übrige Zeichen als Text (✎, ⇄ entfallen in der Standardschrift)
    if (mark === "!" || mark === "⚠") glyphWarn(doc, M, y);
    else if (mark === "•" || mark === "●") glyphPunkt(doc, M, y);
    else if (mark) { doc.setFont("helvetica", "bold"); text(mark, M, y); normal(); }
    if (t) text(t, xT, y);
    if (nr) { doc.setTextColor(GRAU); text(`Nr ${nr}`, xNr, y); doc.setTextColor(0); }
    text(l, xText, y);
    y += l.length * LH;
  };
  /** Zeile «Neu»/«Von oben»; dringend: Vektorzeichen ⚠ vor dem Text (nie «! », D8) */
  const zeileNeu = (z: UebergabeZeileNeu) => {
    if (!z.bang) { spalten(null, z.t, z.nr, `${z.text}${z.meta ? ` · ${z.meta}` : ""}`); return; }
    const xText = M + COL.t + COL.nr;
    const l = doc.splitTextToSize(`${z.text}${z.meta ? ` · ${z.meta}` : ""}`, W - M - xText - glyphBreite(doc)) as string[];
    platz(l.length * LH);
    if (z.t) text(z.t, M, y);
    if (z.nr) { doc.setTextColor(GRAU); text(`Nr ${z.nr}`, M + COL.t, y); doc.setTextColor(0); }
    glyphWarn(doc, xText, y);
    text(l, xText + glyphBreite(doc), y);
    y += l.length * LH;
  };
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
  if (d.vonObenWeitere) absatz(`+${d.vonObenWeitere} weitere im Journal`);
  luecke();

  titel(`4 Offene Punkte (${d.offenTotal})`);
  if (!d.offen.length) absatz("Nichts offen.");
  for (const o of d.offen) spalten(o.mark, o.t, o.nr, `${o.text}${o.meta ? ` · ${o.meta}` : ""}`);
  if (d.offenWeitere) absatz(`+${d.offenWeitere} weitere in «Offen»`);
  luecke();

  titel(`5 ${d.neu.titel}`);
  if (!d.neu.zeilen.length && !d.neu.weitere) absatz("Noch nichts Neues in dieser Schicht.");
  for (const z of d.neu.zeilen) zeileNeu(z);
  if (d.neu.weitere) absatz(`+${d.neu.weitere} weitere im Journal`);
  luecke();

  // «Zahlen» und «Visum» zusammen halten: passt beides nicht mehr, beginnen beide auf der neuen Seite (Visum nie allein)
  platz(LH * (d.zahlen.length + 4) + 28);
  titel("6 Zahlen für den Rapport");
  tabelle([{ h: "", w: 74 }, { h: "Schicht", w: 32 }, { h: "ganze Übung", w: 32 }], d.zahlen.map((r) => [...r]), false);

  // 7 Visum mit Strich zum Unterschreiben – nie allein auf einer Seite: passt es nicht mehr, kommt die Tabelle «Zahlen»
  // mit (uebergabePdf kürzt vorher, damit alles auf eine Seite passt)
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

/** Seitenwahl (rein, für Tests): grösste Schrift, die auf eine Seite passt; sonst 8 pt und «Neu»/«Offen» gekürzt */
export function uebergabePdfDoc(d: UebergabeDaten, visum: { von: string; an: string; um: string }): { doc: jsPDF; zeilen: string[]; fs: number; gekuerzt: boolean } {
  for (const st of STUFEN) {
    const r = zeichne(d, visum, st);
    if (r.doc.getNumberOfPages() === 1) return { ...r, fs: st.fs, gekuerzt: false };
  }
  const st = STUFEN[STUFEN.length - 1]!;
  let r = zeichne(d, visum, st);
  for (const k of KUERZEN) {
    r = zeichne(gekuerzt(d, k), visum, st);
    if (r.doc.getNumberOfPages() === 1) break;
  }
  return { ...r, fs: st.fs, gekuerzt: true };
}

export function uebergabePdf(d: UebergabeDaten, visum: { von: string; an: string; um: string }): Blob {
  // grösste Schrift, die auf eine Seite passt; sonst 8 pt und gekürzt (eine Seite, Visum nie allein auf Seite 2)
  const r = uebergabePdfDoc(d, visum);
  // Testhaken (perf.ts); sammelt `safePdf` keine Zeilen, die eigenen
  const info = pdfInfo(r.doc, "a4", false);
  if (!info.zeilen.length) { info.zeilen = r.zeilen; window.__ltPdfInfo = info; }
  return r.doc.output("blob");
}
