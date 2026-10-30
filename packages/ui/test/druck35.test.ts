/**
 * Druck MVP 3.5 (Spez. MVP 3.5, Kap. 2.9, 3.4 D8, 8.7) ohne Browser: Journal-PDF «Tag» mit Anhang Lage Rot und
 * Hinweisen (Beispiel Bern, fiktiv) – keine überlappenden Textboxen, Vektorzeichen statt «+ »/«o »/«! »/«- », Farbe nur
 * in der Spalte «Art», «Erf.» immer gefüllt, Ort nie doppelt, Visum nie allein; Übergabe-PDF mit «Nr 56» und Zeichen.
 */
import { describe, expect, it, vi } from "vitest";
import { analyzeJournal, analyzeRedCoas, compareStrength, demoExercise, demoLang, estimateRedForce, parseStrength, type Exercise, type Hint } from "@lage/core";
import type { LageRotState } from "../src/lageRot";
import type { LtPdfInfo } from "../src/shell/contracts";

// Testhaken `window.__ltPdfInfo` ohne Browser: das zuletzt gemeldete PDF hier festhalten
let letztes: LtPdfInfo | null = null;
vi.mock("../src/perf", async (orig) => {
  const m = await orig<typeof import("../src/perf")>();
  return { ...m, pdfInfo: (...a: Parameters<typeof m.pdfInfo>) => (letztes = m.pdfInfo(...a)) };
});
const { journalPdf, journalPdfRows } = await import("../src/journalpdf");
const { glyphBreite, safePdf, pdfMeldungen } = await import("../src/pdfSafe");
const { jsPDF } = await import("jspdf");

const T = "2030-05-15T07:30";
function lageVon(ex: Exercise, t: string, hints: Hint[]): LageRotState {
  const force = estimateRedForce(ex, t, {});
  const spec = ex.feindannahme ? parseStrength(ex.feindannahme) : null;
  const r = analyzeRedCoas(ex, { t, hints });
  const ids = new Set(r.picked.map((c) => c.id));
  return { coas: r.picked, more: r.all.filter((c) => !ids.has(c.id)), force, spec, compare: compareStrength(force, spec), from: null, hints };
}
type Box = NonNullable<LtPdfInfo["boxes"]>[number];
function ueberlappungen(b: Box[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
    const p = b[i]!, q = b[j]!;
    if (p.seite !== q.seite) continue;
    if (p.x + 0.2 < q.x + q.w && q.x + 0.2 < p.x + p.w && p.y + 0.2 < q.y + q.h && q.y + 0.2 < p.y + p.h) out.push(`S${p.seite}: «${p.text.slice(0, 30)}» / «${q.text.slice(0, 30)}»`);
  }
  return out;
}
const ERSATZ = /^(\+|o|!|-) /;
const info = (): LtPdfInfo => letztes!;

describe("Journal-PDF Tag mit Anhang Lage Rot (Kap. 8.7)", () => {
  const ex = demoExercise();
  const hints = analyzeJournal(ex, { t: T }).hints;
  journalPdf(ex, {
    umfang: { art: "tag", from: "2030-05-15T00:00", to: T }, anhang: { lageRot: true, hinweise: true, ohneGestrichene: false }, klassifizierung: "INTERN", kuerzel: "BSP",
  }, { hints, lageRot: { lage: lageVon(ex, T, hints), t: T } });
  const pdf = info();

  it("keine überlappenden Textboxen (Toleranz 0.2 mm), «Wahrscheinlichste»", () => {
    expect(pdf.boxes!.length).toBeGreaterThan(50);
    expect(ueberlappungen(pdf.boxes!)).toEqual([]);
    expect(pdf.zeilen.some((l) => /Am wahrscheinlichsten|Wahrscheinlichste/.test(l))).toBe(true);
  });
  it("keine Ersatz-Aufzählung, Vektorzeichen gezeichnet", () => {
    expect(pdf.zeilen.filter((l) => ERSATZ.test(l.trim()))).toEqual([]);
    const g = pdf.glyphen!;
    expect(g.punkt + g.haken + g.warn).toBeGreaterThan(0);
  });
  it("Farbe nur in der Spalte «Art»", () => {
    const art = pdf.boxes!.find((b) => /^Art$/.test(b.text.trim()))!;
    expect(art).toBeTruthy();
    expect(pdf.fills!.length).toBeGreaterThan(0);
    expect(pdf.fills!.filter((f) => f.x + 0.5 < art.x || f.x + f.w > art.x + art.w + 25)).toEqual([]);
  });
  it("«Erf.» immer gefüllt, Ort nie doppelt", () => {
    expect(pdf.boxes!.some((b) => /^Erf\.$/.test(b.text.trim()))).toBe(true);
    const rows = journalPdfRows(ex, { from: "2030-05-15T00:00", to: T }).filter((r) => r.kind === "eintrag");
    for (const r of rows) if (r.kind === "eintrag") {
      expect(r.cells[7], r.cells[5]).not.toBe("");
      const pq = r.cells[6].match(/\b[A-Z]{2}\d{1,2}\b/g) ?? [];
      expect(new Set(pq).size, r.cells[6]).toBe(pq.length);
    }
  });
});

describe("Journal-PDF ganze Übung «lang»: Visum nie allein", () => {
  it("letzte Journalseite hat ≥ 1 Tabellenzeile vor «Geführt von»", () => {
    const lang = demoLang();
    journalPdf(lang, { umfang: { art: "alles", from: null, to: "2030-05-18T07:30" }, anhang: { lageRot: false, hinweise: false, ohneGestrichene: false }, klassifizierung: "INTERN", kuerzel: "BSP" });
    const pdf = info();
    const letzte = pdf.boxes!.filter((b) => b.seite === pdf.seiten);
    const visum = letzte.find((b) => /Geführt von/.test(b.text))!;
    expect(visum).toBeTruthy();
    expect(letzte.filter((b) => /^\d+[a-z]?$/.test(b.text.trim()) && b.y < visum.y).length).toBeGreaterThanOrEqual(3);
  });
});

describe("safePdf: Vektorzeichen, Boxen, Füllflächen", () => {
  it("«• », «✓ », «⚠ » am Zeilenanfang werden gezeichnet, Text rückt ein", () => {
    const doc = safePdf(new jsPDF({ unit: "mm", format: "a4" }));
    doc.setFontSize(10);
    doc.text("• Punkt", 20, 20);
    doc.text(["✓ erfüllt", "zweite Zeile"], 20, 30);
    doc.text("⚠ Achtung", 20, 40);
    doc.text("✗ dagegen", 20, 50);
    doc.setFillColor(253, 232, 235); doc.rect(10, 10, 5, 5, "F");
    doc.setFillColor(255); doc.rect(10, 20, 5, 5, "F");
    const m = pdfMeldungen(doc);
    expect(m.glyphen).toEqual({ punkt: 1, haken: 1, warn: 1, kreuz: 1 });
    expect(m.boxes.map((b) => b.text)).toEqual(["Punkt", "erfüllt zweite Zeile", "Achtung", "dagegen"]);
    expect(m.boxes[0]!.x).toBeCloseTo(20 + glyphBreite(doc), 1);
    expect(m.fills).toHaveLength(1);
    expect(m.fills[0]).toMatchObject({ seite: 1, x: 10, y: 10, w: 5, h: 5 });
    expect(m.fills[0]!.farbe).not.toBe("#ffffff");
  });
});
