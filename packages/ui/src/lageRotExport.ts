/**
 * Lage Rot exportieren: Abschnitt in der CSV «Hinweise» und Anhang im Journal-PDF (vor den Hinweisen).
 * Möglichkeiten mit Indikatoren, Annäherung und Prüfen; Kräfte erkannt ↔ erwartet; nicht mehr gesehen; Feindannahme.
 */
import type { jsPDF } from "jspdf";
import { indicatorSummary, type Exercise } from "@lage/core";
import { COA_KICKER, coaLine, indicatorGroups, indicatorLine } from "./red/redText";
import { safePdf, winAnsi } from "./pdfSafe";
import {
  COA_LABEL, countLabel, durLabel, expectedLabel, foundLabel, indSign, inWindowLabel, rowName, shownIndicators, STATE_LABEL, windowLabel,
  type LageRotState,
} from "./lageRot";

const csvCell = (v: string) => (/[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const dayT = (t: string, days: string[]) => { const i = days.indexOf(t.slice(0, 10)); return `${i >= 0 ? `T${i + 1}` : t.slice(0, 10)} ${t.slice(11, 16)}`; };
/** «T2 (15.05.2030) 07:25» – Übungstag mit Datum (PDF: der Ausdruck muss ohne App lesbar sein) */
export const dayDateT = (t: string, days: string[]) => {
  const i = days.indexOf(t.slice(0, 10));
  const d = t.slice(0, 10).split("-").reverse().join(".");
  return `${i >= 0 ? `T${i + 1} (${d})` : d} ${t.slice(11, 16)}`;
};
/**
 * Fusszeile «Seite 2 von 5» auf jeder Seite (am Schluss, wenn die Seitenzahl feststeht); mit `classification` zudem
 * die Klassifizierung links unten (Spez. MVP 3, Kap. 3.9). Passt sich der Seitengrösse an (A4 hoch/quer, A3).
 */
export function pdfPageNumbers(doc: jsPDF, classification?: string): void {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(0);
    doc.text(`Seite ${i} von ${n}`, pw - 12, ph - 5, { align: "right" });
    if (classification) { doc.setFont("helvetica", "bold"); doc.text(classification, 12, ph - 5); doc.setFont("helvetica", "normal"); }
  }
}
/**
 * Text für die PDF-Standardschrift (Helvetica, WinAnsi): Zeichen ohne Glyphe ersetzen, sonst stehen dort kaputte
 * Zeichen («4 von 5 ' erfüllt»). Codes in Klammern («(D1)», «(C6)») entfernen – im Ausdruck nur Klartext.
 * Pfeile und Zeichen als Text («→» = «nach», «↔» = «–»): `winAnsi` (pdfSafe.ts).
 */
export function pdfText(s: string): string {
  return winAnsi(s.replace(/\s*\((?:[A-E][1-9]|[A-E][1-9]\/[A-E][1-9])\)/g, ""));
}

/** Zeilen für Export (CSV/PDF) */
export function lageRotRows(ex: Exercise, lage: LageRotState, t: string) {
  const coas = lage.coas.map((c) => {
    const range = c.window ? `${dayT(c.window.from, ex.days)}–${c.window.to.slice(0, 10) === c.window.from.slice(0, 10) ? c.window.to.slice(11, 16) : dayT(c.window.to, ex.days)}` : "";
    const w = windowLabel(c, ex.days, t);
    // Zeitraum nach Zustand: «jetzt (ca. …)», «ca. …», «seit 08:35 überfällig», «offen»
    const zeitraum = !w ? "" : w.state === "jetzt" ? (range ? `jetzt (ca. ${range})` : "jetzt") : w.state === "erwartet" ? `ca. ${range}` : w.state === "ueberfaellig" ? `${w.text} (ca. ${range})` : w.text;
    return {
      einordnung: COA_LABEL[c.label],
      titel: c.title,
      zeitraum,
      /** kurz für das PDF (neben dem Titel) */
      zeitraumKurz: w ? (w.state === "erwartet" ? `ca. ${range}` : w.text) : "",
      indikatoren: countLabel(c),
      liste: shownIndicators(c).map((i) => `${indSign(i)} ${i.text}`),
      annaeherung: c.approachText ?? "",
      pruefen: c.check,
    };
  });
  const both = (f: { main: string; sub?: string }) => (f.sub ? `${f.main} (${f.sub})` : f.main);
  const kraefte = lage.compare.filter((c) => c.found || c.expected !== undefined).map((c) => {
    const pct = c.state === "teilweise" && c.ratio !== undefined ? ` (~${Math.round(Math.min(1, c.ratio) * 100)} %)` : "";
    return {
      art: rowName(c), erkannt: both(foundLabel(c.found)), fenster: lage.from ? both(inWindowLabel(c.found)) : "",
      erwartet: lage.spec ? expectedLabel(c) : "", stand: lage.spec ? STATE_LABEL[c.state] + pct : "",
    };
  });
  const weg = lage.force.notSeen.map((g) => `${g.unit} seit ${dayT(g.since, ex.days)} (${durLabel(g.minutes)})`);
  return { coas, kraefte, weg };
}

/** Abschnitt «Lage Rot» für die CSV (nach den Hinweisen, durch Leerzeile getrennt; ohne BOM) */
export function lageRotCsv(ex: Exercise, lage: LageRotState, t: string): string {
  const r = lageRotRows(ex, lage, t);
  const out: string[][] = [[], ["Lage Rot", `Stand ${dayT(t, ex.days)}`], ["Einordnung", "Mögliche Aktion Rot", "Zeitraum", "Indikatoren", "Indikatoren (✓ erfüllt, ○ offen, ✗ spricht dagegen)", "Annäherung", "Prüfen"]];
  for (const c of r.coas) out.push([c.einordnung, c.titel, c.zeitraum, c.indikatoren, c.liste.join(" | "), c.annaeherung, c.pruefen.join(" | ")]);
  if (!r.coas.length) out.push(["–", "keine Möglichkeit erkennbar"]);
  const win = !!lage.from;
  out.push([], win ? ["Kräfte Rot", "erkannt (ganzes Journal)", "im Fenster", "erwartet", "Stand"] : ["Kräfte Rot", "erkannt", "erwartet", "Stand"]);
  for (const k of r.kraefte) out.push(win ? [k.art, k.erkannt, k.fenster, k.erwartet, k.stand] : [k.art, k.erkannt, k.erwartet, k.stand]);
  if (r.weg.length) out.push(["Nicht mehr gesehen", r.weg.join(" | ")]);
  out.push(["Feindannahme", ex.feindannahme?.trim() || "keine"]);
  if (lage.from) out.push(["Zeitfenster", `ab ${dayT(lage.from, ex.days)} (nur Spalte «im Fenster»)`]);
  return "\r\n" + out.map((row) => row.map(csvCell).join(";")).join("\r\n");
}

/**
 * Anhang «Lage Rot» (neue Seite A4 hoch); gibt die neue Seitenzahl zurück. `kompakt` (Journal-PDF, Spez. MVP 3,
 * Kap. 3.9): kleinere Schrift, je Möglichkeit nur zutreffende Indikatoren und höchstens zwei Prüfpunkte, **höchstens
 * eine Seite** – was nicht passt, fällt weg und die Seite sagt es («gekürzt»).
 */
export function appendLageRotPdf(doc: jsPDF, ex: Exercise, lage: LageRotState, t: string, classification: string, page: number, o: { kompakt?: boolean } = {}): number {
  safePdf(doc);
  const r = lageRotRows(ex, lage, t);
  if (!r.coas.length && !r.kraefte.length && !r.weg.length) return page;
  const k = !!o.kompakt;
  const W = 210, M = 12, LH = k ? 3.3 : 3.8, FS = k ? 7.5 : 8.5, TS = k ? 9 : 10;
  /** kompakt: Seite voll – Rest weglassen */
  let voll = false;
  let y = 0;
  const header = () => {
    if (k && page > 0 && y > 0) { voll = true; return; }
    doc.addPage(); page++;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(0);
    doc.text(`Anhang: Lage Rot – ${ex.name}`, M, 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(classification, W - M, 10, { align: "right" });
    doc.text(`Stand ${dayDateT(t, ex.days)} · Vermutungen, keine Fakten – Entscheid durch Zfhr`, M, 19);
    y = 26;
  };
  /** Platz für `h` mm? Sonst neue Seite (kompakt: nichts mehr, `false`) */
  const need = (h: number): boolean => { if (y + h > 285) header(); return !voll; };
  const section = (s: string) => {
    if (!need(12)) return;
    doc.setFillColor(29, 29, 29); doc.rect(M, y - 4, W - 2 * M, 6, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
    doc.text(s.toUpperCase(), M + 1.5, y);
    doc.setTextColor(0); doc.setFont("helvetica", "normal");
    y += 6;
  };
  header();
  section("Was Rot vorhaben könnte");
  doc.setFontSize(FS);
  if (!r.coas.length) { doc.text("Keine Vermutung möglich (mindestens zwei Anzeichen aus verschiedenen Meldungen nötig).", M + 1.5, y); y += 6; }
  const txt = pdfText;
  r.coas.forEach((c, k) => {
    const coa = lage.coas[k]!;
    const g = indicatorGroups(coa);
    const pro = k ? g.pro.slice(0, 4) : g.pro;
    const body: Array<[string, string[]]> = [
      ["Anzeichen", [indicatorSummary(coa), ...pro.map((i) => `+ ${indicatorLine(i)}`), ...(k ? [] : g.open.map((i) => `o ${indicatorLine(i)} (offen)`)), ...g.contra.map((i) => `x ${indicatorLine(i)} (spricht dagegen)`)].map(txt)],
      ...(c.annaeherung ? [["Annäherung", [txt(c.annaeherung)]] as [string, string[]]] : []),
      ...(c.pruefen.length ? [["Prüfen", (k ? c.pruefen.slice(0, 2) : c.pruefen).map((p) => `- ${txt(p)}`)] as [string, string[]]] : []),
    ];
    const wrapped = body.map(([key, ls]) => [key, ls.flatMap((l) => doc.splitTextToSize(l, W - 2 * M - 34) as string[])] as const);
    const titleLines = doc.splitTextToSize(txt(coaLine(coa)), W - 2 * M - 70) as string[];
    const h = titleLines.length * 4.4 + wrapped.reduce((sum, [, ls]) => sum + ls.length * LH + 1, 0) + 4;
    if (!need(h)) return;
    const top = y - 3.6;
    if (coa.label !== "weitere") { doc.setFillColor(253, 232, 235); doc.rect(M, top, W - 2 * M, titleLines.length * 4.4 + 1.6, "F"); }
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(150, 30, 35);
    doc.text(doc.splitTextToSize(COA_KICKER[coa.label], 30) as string[], M + 1.5, y);
    doc.setTextColor(0); doc.setFontSize(TS);
    doc.text(titleLines, M + 34, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(FS);
    if (c.zeitraumKurz) doc.text(txt(c.zeitraumKurz), W - M - 1.5, y, { align: "right" });
    y += titleLines.length * 4.4 + 1.2;
    for (const [key, ls] of wrapped) {
      doc.setTextColor(90); doc.setFontSize(7.5); doc.text(key.toUpperCase(), M + 1.5, y);
      doc.setTextColor(0); doc.setFontSize(FS); doc.text(ls, M + 34, y);
      y += ls.length * LH + 1;
    }
    doc.setDrawColor(210); doc.line(M, y - 2.2, W - M, y - 2.2);
    y += 3;
  });
  y += 2;
  section("Kräfte Rot");
  const win = !!lage.from;
  const cols = lage.spec
    ? (win ? [{ h: "", w: 36 }, { h: "erkannt", w: 48 }, { h: "im Fenster", w: 38 }, { h: "erwartet", w: 26 }, { h: "Stand", w: 38 }] : [{ h: "", w: 40 }, { h: "erkannt", w: 62 }, { h: "erwartet", w: 34 }, { h: "Stand", w: 50 }])
    : (win ? [{ h: "", w: 40 }, { h: "erkannt", w: 73 }, { h: "im Fenster", w: 73 }] : [{ h: "", w: 40 }, { h: "erkannt", w: 146 }]);
  doc.setFontSize(7.5); doc.setTextColor(90);
  let x = M + 1.5;
  if (!voll) for (const c of cols) { doc.text(c.h.toUpperCase(), x, y); x += c.w; }
  doc.setTextColor(0); doc.setFontSize(FS);
  y += 5;
  for (const kr of r.kraefte) {
    const cells = [kr.art, kr.erkannt, ...(win ? [kr.fenster] : []), ...(lage.spec ? [kr.erwartet, kr.stand] : [])];
    const lines = cells.map((s, i) => doc.splitTextToSize(txt(s), cols[i]!.w - 2) as string[]);
    const h = Math.max(...lines.map((l) => l.length)) * LH + 1.6;
    if (!need(h)) break;
    if (kr.stand === STATE_LABEL.unerwartet || kr.stand.startsWith(STATE_LABEL.mehr)) { doc.setFillColor(253, 232, 235); doc.rect(M, y - 3.2, W - 2 * M, h, "F"); }
    x = M + 1.5;
    lines.forEach((l, i) => { doc.setFont("helvetica", i === 0 ? "bold" : "normal"); doc.text(l, x, y); x += cols[i]!.w; });
    doc.setDrawColor(210); doc.line(M, y - 3.2 + h, W - M, y - 3.2 + h);
    y += h;
  }
  doc.setFont("helvetica", "normal");
  const tail: string[] = [];
  if (r.weg.length) tail.push(`Nicht mehr gesehen: ${r.weg.join(" · ")}`);
  tail.push(`Feindannahme: ${ex.feindannahme?.trim() || "keine eingetragen (nur erkannt)"}`);
  if (lage.from) tail.push(`Kräfte über das ganze Journal bis ${dayDateT(t, ex.days)}; Spalte «im Fenster» nur Meldungen ab ${dayDateT(lage.from, ex.days)}`);
  y += 2;
  for (const s of tail) {
    const l = doc.splitTextToSize(txt(s), W - 2 * M - 3) as string[];
    if (!need(l.length * LH + 1)) break;
    doc.text(l, M + 1.5, y);
    y += l.length * LH + 1;
  }
  if (voll) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(7.5); doc.setTextColor(80);
    doc.text("gekürzt auf eine Seite – vollständig in der App unter «Was Rot vorhaben könnte»", M, 287);
    doc.setFont("helvetica", "normal"); doc.setTextColor(0);
  }
  return page;
}
