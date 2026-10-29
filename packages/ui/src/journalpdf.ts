/**
 * Lagejournal als PDF (A4 hoch): Zeit, Seite, Element, Meldung, Ort – chronologisch.
 */
import { jsPDF } from "jspdf";
import { compareEvents, historyText, journalStatus, kindLabel, type Exercise, type Hint } from "@lage/core";
import { appendHintsPdf } from "./hintsExport";
import type { LageRotState } from "./lageRot";
import { appendLageRotPdf, pdfPageNumbers } from "./lageRotExport";

/**
 * `hints`: Hinweise zu Rot mit Entscheid als Anhang (neue Seite); `lageRot`: Lage Rot zur Lagezeit `t` davor;
 * `kiNote`: Vermerk zur KI unter dem Journal (siehe `kiPdfNote`: aus den Meldungen abgeleitet, dazu das Geräte-Protokoll);
 * Meldungen aus einem KI-Vorschlag (`via: "ki"`) sind in der Tabelle mit «[KI]» markiert.
 * Journalführung (Spez. MVP 1, Kap. 3.3): gelöschte Meldungen bleiben als «gestrichen» (grau, durchgestrichen) stehen,
 * korrigierte tragen «korrigiert 07:34» und die früheren Fassungen.
 */
export function journalPdf(ex: Exercise, classification = "INTERN", hints?: Hint[], lageRot?: { lage: LageRotState; t: string }, kiNote?: string | null): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 12;
  const cols = [
    { h: "Tag", w: 10 }, { h: "Zeit", w: 12 }, { h: "Art", w: 14 }, { h: "Melder", w: 18 }, { h: "Element", w: 18 }, { h: "Meldung", w: 80 }, { h: "Ort", w: 34 },
  ];
  const events = [...(ex.events ?? [])].sort(compareEvents);
  let page = 1;
  let y = 0;
  const header = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text(`Lagejournal – ${ex.name}`, M, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(classification, W - M, 10, { align: "right" });
    doc.text(`erstellt ${new Date().toLocaleString("de-CH")}`, W - M, 14, { align: "right" });
    // Übungstage mit Datum («T2» allein ist im Ausdruck nicht verständlich)
    if (ex.days.length) doc.text(ex.days.map((d, i) => `T${i + 1} = ${d.split("-").reverse().join(".")}`).join(" · "), M, 18.5);
    y = 24;
    doc.setFillColor(29, 29, 29); doc.rect(M, y - 4, W - 2 * M, 6, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    let x = M + 1;
    for (const c of cols) { doc.text(c.h, x, y); x += c.w; }
    doc.setTextColor(0); doc.setFont("helvetica", "normal");
    y += 5;
  };
  header();
  for (const e of events) {
    const di = ex.days.indexOf(e.t.slice(0, 10));
    const cells = [
      di >= 0 ? `T${di + 1}` : e.t.slice(5, 10), e.t.slice(11, 16), e.side === "rot" && e.aff === "N" ? "Neutral" : kindLabel(e), e.melder ?? "", e.side === "blau" && e.unit === e.melder ? "" : e.unit,
      (e.via === "ki" ? `${e.text} [KI]` : e.text) + (journalStatus(e) ? `\n[${journalStatus(e)}${!e.deleted && historyText(e) ? ` – ${historyText(e)}` : ""}]` : ""),
      [e.where, ...(e.cells ?? []).filter((c) => c !== e.where)].filter(Boolean).join(", "),
    ];
    const lines = cells.map((c, i) => doc.splitTextToSize(c, cols[i]!.w - 2) as string[]);
    const h = Math.max(...lines.map((l) => l.length)) * 3.6 + 1.6;
    if (y + h > 284) { doc.addPage(); page++; header(); }
    if (e.deleted) { /* gestrichen: ohne Farbe */ }
    else if (e.side === "rot" && e.aff === "U") { doc.setFillColor(252, 244, 214); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    else if (e.side === "rot") { doc.setFillColor(253, 232, 235); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    else if (e.side === "blau") { doc.setFillColor(232, 240, 252); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    let x = M + 1;
    if (e.deleted) doc.setTextColor(120);
    lines.forEach((l, i) => {
      doc.text(l, x, y);
      // gestrichen: Meldung durchstreichen (Status-Zeile nicht)
      if (e.deleted && i === 5) {
        const lh = (doc.getFontSize() * doc.getLineHeightFactor()) / doc.internal.scaleFactor;
        l.slice(0, -1).forEach((ln, k) => { const w = doc.getTextWidth(ln); doc.setDrawColor(120); doc.line(x, y + k * lh - 1, x + w, y + k * lh - 1); });
      }
      x += cols[i]!.w;
    });
    doc.setTextColor(0);
    doc.setDrawColor(210); doc.line(M, y - 3.2 + h, W - M, y - 3.2 + h);
    y += h;
  }
  if (kiNote) {
    const l = doc.splitTextToSize(kiNote, W - 2 * M) as string[];
    if (y + l.length * 3.6 + 4 > 285) { doc.addPage(); page++; header(); }
    doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(80);
    doc.text(l, M, y + 4);
    doc.setFont("helvetica", "normal"); doc.setTextColor(0);
    y += l.length * 3.6 + 4;
  }
  if (lageRot) page = appendLageRotPdf(doc, ex, lageRot.lage, lageRot.t, classification, page);
  if (hints?.length) appendHintsPdf(doc, ex, hints, classification, page);
  // «Seite n von m» als Fusszeile auf allen Seiten
  pdfPageNumbers(doc);
  return doc.output("blob");
}
