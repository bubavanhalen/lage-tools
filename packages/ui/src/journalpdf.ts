/**
 * Lagejournal als PDF (A4 hoch): Zeit, Seite, Element, Meldung, Ort – chronologisch.
 */
import { jsPDF } from "jspdf";
import { kindLabel, type Exercise, type Hint } from "@lage/core";
import { appendHintsPdf } from "./hintsExport";
import type { LageRotState } from "./lageRot";
import { appendLageRotPdf } from "./lageRotExport";

/**
 * `hints`: Hinweise zu Rot mit Entscheid als Anhang (neue Seite); `lageRot`: Lage Rot zur Lagezeit `t` davor;
 * `kiNote`: Vermerk zur KI unter dem Journal (siehe `kiPdfNote`: aus den Meldungen abgeleitet, dazu das Geräte-Protokoll);
 * Meldungen aus einem KI-Vorschlag (`via: "ki"`) sind in der Tabelle mit «[KI]» markiert
 */
export function journalPdf(ex: Exercise, classification = "INTERN", hints?: Hint[], lageRot?: { lage: LageRotState; t: string }, kiNote?: string | null): Blob {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 12;
  const cols = [
    { h: "Tag", w: 10 }, { h: "Zeit", w: 12 }, { h: "Art", w: 14 }, { h: "Melder", w: 18 }, { h: "Element", w: 18 }, { h: "Meldung", w: 80 }, { h: "Ort", w: 34 },
  ];
  const events = (ex.events ?? []).filter((e) => !e.deleted).sort((a, b) => a.t.localeCompare(b.t));
  let page = 1;
  let y = 0;
  const header = () => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text(`Lagejournal – ${ex.name}`, M, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(classification, W - M, 10, { align: "right" });
    doc.text(`Seite ${page} · erstellt ${new Date().toLocaleString("de-CH")}`, W - M, 14, { align: "right" });
    y = 22;
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
      di >= 0 ? `T${di + 1}` : e.t.slice(5, 10), e.t.slice(11, 16), e.side === "rot" && e.aff === "N" ? "Neutral" : kindLabel(e), e.melder ?? "", e.side === "blau" && e.unit === e.melder ? "" : e.unit, e.via === "ki" ? `${e.text} [KI]` : e.text,
      [e.where, ...(e.cells ?? []).filter((c) => c !== e.where)].filter(Boolean).join(", "),
    ];
    const lines = cells.map((c, i) => doc.splitTextToSize(c, cols[i]!.w - 2) as string[]);
    const h = Math.max(...lines.map((l) => l.length)) * 3.6 + 1.6;
    if (y + h > 285) { doc.addPage(); page++; header(); }
    if (e.side === "rot" && e.aff === "U") { doc.setFillColor(252, 244, 214); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    else if (e.side === "rot") { doc.setFillColor(253, 232, 235); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    else if (e.side === "blau") { doc.setFillColor(232, 240, 252); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    let x = M + 1;
    lines.forEach((l, i) => { doc.text(l, x, y); x += cols[i]!.w; });
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
  return doc.output("blob");
}
