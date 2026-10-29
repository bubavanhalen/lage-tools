import { describe, expect, it } from "vitest";
import {
  analyzeJournal, analyzeRedCoas, coaHeadline, computeRedCoas, demoExercise, hintHeadline, hintOrigin, HINT_RULES, indicatorSummary,
  indicatorText, windowText, type RedCoa,
} from "../src";

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
    expect(indicatorText({ text: "Sperre NAI 3 07:05 (C5, 2×)" })).toBe("Sperre NAI 3 07:05 (2×)");
    expect(indicatorText({ text: "Fz weicht Checkpoint aus (NAI 2) (B3)" })).toBe("Fz weicht Checkpoint aus (NAI 2)");
  });
  it("windowText", () => {
    expect(windowText({ windowState: "jetzt" })).toBe("jetzt!");
    expect(windowText({ windowState: "erwartet", window: { from: "2030-05-15T07:45", to: "2030-05-15T08:35" } })).toBe("ca. 07:45–08:35");
    expect(windowText({ windowState: "ueberfaellig" })).toBe("Zeitraum vorbei – nichts gemeldet");
    expect(windowText({})).toBe("Zeit unklar");
  });
});

/** Lagezeiten über die ganze Beispielübung (T1 18:30 – T2 07:30, alle 20 Min) */
function times(): string[] {
  const out: string[] = [];
  for (let ms = Date.parse("2030-05-14T18:30"); ms <= Date.parse("2030-05-15T07:30"); ms += 20 * 60000) {
    const d = new Date(ms), p = (n: number) => String(n).padStart(2, "0");
    out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`);
  }
  return out;
}

describe("Klartext: keine Codes in Titeln und Zusammenfassungen (Kap. 7.1, Aufgabe 8)", () => {
  const all = times().map((tt) => {
    const hs = analyzeJournal(ex, { t: tt }).hints;
    return { t: tt, hints: hs, coas: analyzeRedCoas(ex, { t: tt, hints: hs }).all };
  });
  const hints = all.flatMap((x) => x.hints);
  const coasAll = all.flatMap((x) => x.coas);

  it("jede Regel des Beispiels liefert einen Klartext-Titel", () => {
    const rules = new Set(hints.map((h) => h.rule));
    expect(rules.size).toBeGreaterThan(10);
    for (const h of hints) expect(h.headline, `${h.rule} ${h.title}`).toBeTruthy();
  });
  it("Hinweise: headline und todo ohne Codes, «⚠» genau bei Stufe hoch", () => {
    for (const h of hints) {
      expect(h.headline!, h.title).not.toMatch(CODE_RE);
      if (h.todo) expect(h.todo, h.title).not.toMatch(CODE_RE);
      expect(h.headline!.startsWith("⚠ "), h.headline).toBe(h.level === "hoch");
      expect(hintHeadline(h)).toBe(h.headline);
    }
  });
  it("Möglichkeiten: Titel, Anzeichen, Zeitraum, Weg und «Jetzt prüfen» ohne Codes", () => {
    expect(coasAll.length).toBeGreaterThan(0);
    for (const c of coasAll) {
      expect(c.headline, c.title).toBe(coaHeadline(c));
      for (const s of [coaHeadline(c), indicatorSummary(c), windowText(c), c.approachText ?? "", ...c.check, ...c.indicators.map(indicatorText)]) {
        expect(s, c.title).not.toMatch(CODE_RE);
      }
    }
  });
  it("hintHeadline ohne headline (ältere Daten): Titel, bei hoch mit «⚠»", () => {
    expect(hintHeadline({ title: "Mögliche Übergabe in AK9", level: "hoch" })).toBe("⚠ Mögliche Übergabe in AK9");
    expect(hintHeadline({ title: "Viel Rot in AP10", level: "mittel" })).toBe("Viel Rot in AP10");
  });
  it("«Woher kommt das?» trägt Code, Regel in eigenen Worten und Quelle", () => {
    for (const r of HINT_RULES) {
      const o = hintOrigin({ rule: r.id });
      expect(o).toMatchObject({ code: r.id, name: r.name, rule: r.rule });
    }
    expect(hintOrigin({ rule: "C5" }).source).toMatch(/53\.005\.25 Ziff 62/);
  });
});
