/**
 * Lage Rot exportieren: Abschnitt in der CSV «Hinweise» und Anhang im Journal-PDF (vor den Hinweisen).
 * Möglichkeiten mit Indikatoren, Annäherung und Prüfen; Kräfte erkannt ↔ erwartet; nicht mehr gesehen; Feindannahme.
 */
import type { jsPDF } from "jspdf";
import type { Exercise } from "@lage/core";
import { COA_LABEL, durLabel, expectedLabel, foundLabel, metCount, rowName, STATE_LABEL, type LageRotState } from "./lageRot";

const csvCell = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const dayT = (t: string, days: string[]) => { const i = days.indexOf(t.slice(0, 10)); return `${i >= 0 ? `T${i + 1}` : t.slice(0, 10)} ${t.slice(11, 16)}`; };

/** Zeilen für Export (CSV/PDF) */
export function lageRotRows(ex: Exercise, lage: LageRotState) {
  const coas = lage.coas.map((c) => ({
    einordnung: COA_LABEL[c.label],
    titel: c.title,
    zeitraum: c.window ? `${dayT(c.window.from, ex.days)}–${c.window.to.slice(0, 10) === c.window.from.slice(0, 10) ? c.window.to.slice(11, 16) : dayT(c.window.to, ex.days)}` : "",
    indikatoren: `${metCount(c)} von ${c.indicators.length}`,
    liste: c.indicators.map((i) => `${i.met ? "✓" : "○"} ${i.text}`),
    annaeherung: c.approachText ?? "",
    pruefen: c.check,
  }));
  const kraefte = lage.compare.filter((c) => c.found || c.expected !== undefined).map((c) => {
    const f = foundLabel(c.found);
    const pct = c.state === "teilweise" && c.ratio !== undefined ? ` (~${Math.round(Math.min(1, c.ratio) * 100)} %)` : "";
    return { art: rowName(c), erkannt: f.sub ? `${f.main} (${f.sub})` : f.main, erwartet: lage.spec ? expectedLabel(c) : "", stand: lage.spec ? STATE_LABEL[c.state] + pct : "" };
  });
  const weg = lage.force.notSeen.map((g) => `${g.unit} seit ${dayT(g.since, ex.days)} (${durLabel(g.minutes)})`);
  return { coas, kraefte, weg };
}

/** Abschnitt «Lage Rot» für die CSV (nach den Hinweisen, durch Leerzeile getrennt; ohne BOM) */
export function lageRotCsv(ex: Exercise, lage: LageRotState, t: string): string {
  const r = lageRotRows(ex, lage);
  const out: string[][] = [[], ["Lage Rot", `Stand ${dayT(t, ex.days)}`], ["Einordnung", "Mögliche Aktion Rot", "Zeitraum", "Indikatoren", "Indikatoren (✓ erfüllt, ○ offen)", "Annäherung", "Prüfen"]];
  for (const c of r.coas) out.push([c.einordnung, c.titel, c.zeitraum, c.indikatoren, c.liste.join(" | "), c.annaeherung, c.pruefen.join(" | ")]);
  if (!r.coas.length) out.push(["–", "keine Möglichkeit erkennbar"]);
  out.push([], ["Kräfte Rot", "erkannt", "erwartet", "Stand"]);
  for (const k of r.kraefte) out.push([k.art, k.erkannt, k.erwartet, k.stand]);
  if (r.weg.length) out.push(["Nicht mehr gesehen", r.weg.join(" | ")]);
  out.push(["Feindannahme", ex.feindannahme?.trim() || "keine"]);
  if (lage.from) out.push(["Zeitfenster", `ab ${dayT(lage.from, ex.days)}`]);
  return "\r\n" + out.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

/** Anhang «Lage Rot» (neue Seite A4 hoch); gibt die neue Seitenzahl zurück */
export function appendLageRotPdf(doc: jsPDF, ex: Exercise, lage: LageRotState, t: string, classification: string, page: number): number {
  const r = lageRotRows(ex, lage);
  if (!r.coas.length && !r.kraefte.length && !r.weg.length) return page;
  const W = 210, M = 12, LH = 3.8;
  let y = 0;
  const header = () => {
    doc.addPage(); page++;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(0);
    doc.text(`Anhang: Lage Rot – ${ex.name}`, M, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(classification, W - M, 10, { align: "right" });
    doc.text(`Seite ${page} · Stand ${dayT(t, ex.days)} · Hinweise, keine Fakten – Entscheid durch Zfhr`, W - M, 14, { align: "right" });
    y = 24;
  };
  const need = (h: number) => { if (y + h > 285) header(); };
  const section = (s: string) => {
    need(12);
    doc.setFillColor(29, 29, 29); doc.rect(M, y - 4, W - 2 * M, 6, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
    doc.text(s.toUpperCase(), M + 1.5, y);
    doc.setTextColor(0); doc.setFont("helvetica", "normal");
    y += 6;
  };
  header();
  section("Mögliche Aktionen Rot");
  doc.setFontSize(8.5);
  if (!r.coas.length) { doc.text("Keine Möglichkeit erkennbar (mindestens zwei Indikatoren nötig).", M + 1.5, y); y += 6; }
  // ✓/○ in Helvetica nicht vorhanden: «+» erfüllt, «o» offen
  const txt = (s: string) => s.replace(/✓/g, "+").replace(/○/g, "o").replace(/↔/g, "<->").replace(/→/g, "->").replace(/′/g, "'");
  for (const c of r.coas) {
    const body: Array<[string, string[]]> = [
      ["Indikatoren", [`${c.indikatoren} erfüllt`, ...c.liste.map(txt)]],
      ...(c.annaeherung ? [["Annäherung", [txt(c.annaeherung)]] as [string, string[]]] : []),
      ...(c.pruefen.length ? [["Prüfen", c.pruefen.map((p) => `- ${txt(p)}`)] as [string, string[]]] : []),
    ];
    const wrapped = body.map(([k, ls]) => [k, ls.flatMap((l) => doc.splitTextToSize(l, W - 2 * M - 34) as string[])] as const);
    const titleLines = doc.splitTextToSize(txt(c.titel), W - 2 * M - 64) as string[];
    const h = titleLines.length * 4.4 + wrapped.reduce((s, [, ls]) => s + ls.length * LH + 1, 0) + 4;
    need(h);
    const top = y - 3.6;
    if (c.einordnung !== COA_LABEL.weitere) { doc.setFillColor(253, 232, 235); doc.rect(M, top, W - 2 * M, titleLines.length * 4.4 + 1.6, "F"); }
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(150, 30, 35);
    doc.text(c.einordnung.toUpperCase(), M + 1.5, y);
    doc.setTextColor(0); doc.setFontSize(10);
    doc.text(titleLines, M + 34, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    if (c.zeitraum) doc.text(`ca. ${c.zeitraum}`, W - M - 1.5, y, { align: "right" });
    y += titleLines.length * 4.4 + 1.2;
    for (const [k, ls] of wrapped) {
      doc.setTextColor(90); doc.setFontSize(7.5); doc.text(k.toUpperCase(), M + 1.5, y);
      doc.setTextColor(0); doc.setFontSize(8.5); doc.text(ls, M + 34, y);
      y += ls.length * LH + 1;
    }
    doc.setDrawColor(210); doc.line(M, y - 2.2, W - M, y - 2.2);
    y += 3;
  }
  y += 2;
  section("Kräfte Rot");
  const cols = lage.spec ? [{ h: "", w: 40 }, { h: "erkannt", w: 62 }, { h: "erwartet", w: 34 }, { h: "Stand", w: 50 }] : [{ h: "", w: 40 }, { h: "erkannt", w: 146 }];
  doc.setFontSize(7.5); doc.setTextColor(90);
  let x = M + 1.5;
  for (const c of cols) { doc.text(c.h.toUpperCase(), x, y); x += c.w; }
  doc.setTextColor(0); doc.setFontSize(8.5);
  y += 5;
  for (const k of r.kraefte) {
    const cells = lage.spec ? [k.art, k.erkannt, k.erwartet, k.stand] : [k.art, k.erkannt];
    const lines = cells.map((s, i) => doc.splitTextToSize(txt(s), cols[i]!.w - 2) as string[]);
    const h = Math.max(...lines.map((l) => l.length)) * LH + 1.6;
    need(h);
    if (k.stand === STATE_LABEL.unerwartet || k.stand.startsWith(STATE_LABEL.mehr)) { doc.setFillColor(253, 232, 235); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    x = M + 1.5;
    lines.forEach((l, i) => { doc.setFont("helvetica", i === 0 ? "bold" : "normal"); doc.text(l, x, y); x += cols[i]!.w; });
    doc.setDrawColor(210); doc.line(M, y - 3.2 + h, W - M, y - 3.2 + h);
    y += h;
  }
  doc.setFont("helvetica", "normal");
  const tail: string[] = [];
  if (r.weg.length) tail.push(`Nicht mehr gesehen: ${r.weg.join(" · ")}`);
  tail.push(`Feindannahme: ${ex.feindannahme?.trim() || "keine eingetragen (nur erkannt)"}`);
  if (lage.from) tail.push(`Zeitfenster ab ${dayT(lage.from, ex.days)} – nur Meldungen im Fenster gezählt`);
  y += 2;
  for (const s of tail) {
    const l = doc.splitTextToSize(txt(s), W - 2 * M - 3) as string[];
    need(l.length * LH + 1);
    doc.text(l, M + 1.5, y);
    y += l.length * LH + 1;
  }
  return page;
}
