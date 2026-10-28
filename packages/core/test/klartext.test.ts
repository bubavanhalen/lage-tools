import { describe, expect, it } from "vitest";
import { analyzeJournal, coaHeadline, computeRedCoas, demoExercise, indicatorSummary, indicatorText, windowText, type RedCoa } from "../src";

// fiktiv: Beispiel Bern, Lagezeit T2 07:30
const ex = demoExercise();
const t = "2030-05-15T07:30";
const { hints } = analyzeJournal(ex, { t });
const coas = computeRedCoas(ex, { t, hints });
/** Codes, Reglementsziffern und Fachwörter, die in der Grundansicht nicht vorkommen dürfen (Kap. 7.1, Aufgabe 8) */
const CODE_RE = /\b[A-E][1-6]\b|Ziff|TF 17|GS 17|53\.005|Indikator|COA/;

describe("Klartext für «Was Rot vorhaben könnte»", () => {
  it("das Beispiel liefert Möglichkeiten", () => {
    expect(coas.length).toBeGreaterThan(0);
  });
  it("coaHeadline: «Rot …», ohne Codes", () => {
    for (const c of coas) {
      const h = coaHeadline(c);
      expect(h).toMatch(/^Rot /);
      expect(h).not.toMatch(CODE_RE);
    }
  });
  it("coaHeadline nimmt headline, wenn gesetzt", () => {
    expect(coaHeadline({ ...coas[0]!, headline: "Eigener Titel" })).toBe("Eigener Titel");
  });
  it("Vorlagen je Art (Kap. 4.3)", () => {
    const c = (kind: RedCoa["kind"], title: string) => coaHeadline({ ...coas[0]!, headline: undefined, kind, title });
    expect(c("ueberfall", "Überfall auf Stao H05 (AQ11)")).toBe("Rot könnte Stao H05 überfallen (AQ11)");
    expect(c("versorgung", "Versorgung/Übergabe Pendel AK9 ↔ AN6 (nächste ca. 07:40)")).toBe("Rot versorgt sich vermutlich zwischen AK9 und AN6");
    expect(c("infiltration", "Infiltration durch NAI 1")).toBe("Rot könnte unbemerkt durch NAI 1 durchsickern");
    expect(c("absetzen", "Absetzen/Ausweichen von Rot Rtg S")).toBe("Rot zieht sich vermutlich Rtg S zurück");
  });
  it("indicatorSummary und indicatorText ohne Codes", () => {
    for (const c of coas) {
      expect(indicatorSummary(c)).toMatch(/^\d+ Anzeichen dafür/);
      for (const i of c.indicators) expect(indicatorText(i)).not.toMatch(/\([A-E][1-6]\)$/);
    }
    expect(indicatorSummary({ indicators: [{ text: "a", met: true }, { text: "b", met: true }, { text: "c", met: false }, { text: "d", met: true, against: true }] }))
      .toBe("2 Anzeichen dafür · 1 offen · 1 spricht dagegen");
    expect(indicatorText({ text: "Drohne über H05 02:50 (D1)" })).toBe("Drohne über H05 02:50");
  });
  it("windowText", () => {
    expect(windowText({ windowState: "jetzt" })).toBe("jetzt!");
    expect(windowText({ windowState: "erwartet", window: { from: "2030-05-15T07:45", to: "2030-05-15T08:35" } })).toBe("ca. 07:45–08:35");
    expect(windowText({ windowState: "ueberfaellig" })).toBe("Zeitraum vorbei – nichts gemeldet");
    expect(windowText({})).toBe("Zeit unklar");
  });
});
