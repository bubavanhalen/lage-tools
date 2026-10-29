// Nachbesserung MVP 1, Paket EINGABE: gleiche Prüfregeln in Foto-/Sprach-Übersicht, Klartext-Hilfen, OCR «HO04».
// Alle Daten fiktiv (Beispielübung Raum Bern).
import { describe, expect, it } from "vitest";
import { demoExercise, findCells, parseMeldung, type Exercise } from "@lage/core";
import { initialRows } from "../src/batchRows";
import { commitTexts, journalCtx } from "../src/commit";
import { dayTitle, genericWhat, missLabel, replaceToken } from "../src/entry/labels";
import { entryOptions, stateOf } from "../src/entry/stateOptions";
import { fixOcrTokens, ocrToMeldungen } from "../src/ocr";

const ex0 = demoExercise();
/** Uhr während der Beispielübung: T2 07:30 */
const T2_0730 = new Date(`${ex0.days[1]}T07:30:00`);

describe("Klartext-Hilfen (entry/labels.ts)", () => {
  it("«T2» mit Datum erklärt", () => {
    expect(dayTitle(`${ex0.days[1]}T07:20`, ex0.days)).toMatch(/^T2 = Übungstag 2 · .*2030/);
    expect(dayTitle("2031-01-02T07:20", ex0.days)).not.toMatch(/Übungstag/);
  });
  it("«Wer» heisst «was gesehen»; kein «Einheit (allg.)»", () => {
    expect(missLabel("Wer")).toBe("was gesehen");
    expect(missLabel("Zeit")).toBe("Zeit");
    expect(genericWhat("einheit", "blau", "H03")).toBe("Trupp H03");
    expect(genericWhat("einheit", "rot")).toBe("Gesehen: ?");
    expect(genericWhat("kpz", "rot")).toBeNull();
  });
  it("Vorschlag übernehmen: Zeit mit/ohne Doppelpunkt, Wort ganz", () => {
    expect(replaceToken("1535 H02 2 Pers in AK9", "1535", "0735")).toBe("0735 H02 2 Pers in AK9");
    expect(replaceToken("H02 15:35 2 Pers", "1535", "0735")).toBe("H02 0735 2 Pers");
    expect(replaceToken("H03 2 schützenpnzr AK7", "schützenpnzr", "Schützenpanzer")).toBe("H03 2 Schützenpanzer AK7");
    expect(replaceToken("H03 2 Fz AK7", "1535", "0735")).toBe("H03 2 Fz AK7");
  });
});

describe("Gleiche Regeln wie das Meldungsfeld (entry/stateOptions.ts)", () => {
  const st = (t: string, ex: Exercise = ex0) => stateOf(parseMeldung(t, journalCtx(ex, ex.days[1]!, undefined, T2_0730)), ex, { now: T2_0730 });
  it("Optionen aus der Übung: Raster, bekannte und vorbereitete Trupps, Tage", () => {
    const o = entryOptions(ex0, { now: T2_0730 });
    expect(o.hasRaster).toBe(true);
    expect(o.knownUnits).toEqual(ex0.units.blau);
    expect(o.unitsPrepared).toBe(true);
    expect(o.days).toEqual(ex0.days);
    expect(entryOptions(ex0, { alsoKnown: "H09" }).knownUnits).toContain("H09");
  });
  it("Zettel «1535» um 07:30 ist «geht nicht» mit Vorschlag 07:35", () => {
    const s = st("1535 H02 2 Pers in AK9");
    expect(s.level).toBe("geht-nicht");
    expect(s.reasons[0]?.code).toBe("zukunft");
    expect(s.reasons[0]?.suggest).toBe("0735");
  });
  it("ohne Trupp und unbekannter Trupp sind gelb, vollständige Meldung grün", () => {
    expect(st("0725 3 Pers AK9 Rtg N").level).toBe("pruefen");
    expect(st("0725 H07 2 Fz AK7").reasons.some((r) => r.code === "trupp-neu")).toBe(true);
    expect(st("0727 H04 1 Pers bei NAI 2").level).toBe("bereit");
  });
  it("Übersicht: nur grüne Zeilen vorab angehakt", () => {
    const rows = initialRows([{ text: "0727 H04 1 Pers bei NAI 2" }, { text: "0725 3 Pers AK9" }, { text: "1535 H02 2 Pers AK9" }], (t) => st(t).level !== "bereit");
    expect(rows.map((r) => r.on)).toEqual([true, false, false]);
  });
});

describe("commitTexts trägt «geht nicht» nie ein", () => {
  it("Zeit in der Zukunft ohne Tagesangabe wird übersprungen und gemeldet", () => {
    // Übung, die heute läuft (fiktiv): Tage = gestern/heute nach der Geräteuhr
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let ex: Exercise = { ...demoExercise(), events: [], days: [iso(new Date(now.getTime() - 86400000)), iso(now)] };
    const later = new Date(now.getTime() + 40 * 60000);
    const hhmm = `${String(later.getHours()).padStart(2, "0")}${String(later.getMinutes()).padStart(2, "0")}`;
    let skipped: string[] = [];
    // nur prüfen, wenn «später» noch heute ist (sonst greift die Tagesregel nicht eindeutig)
    if (iso(later) !== iso(now)) return;
    const evs = commitTexts([`${hhmm} H02 2 Pers AK9`], { ex, device: "d", update: (f) => { ex = f(structuredClone(ex)); }, day: iso(now), onSkipped: (t) => { skipped = t; } });
    expect(evs).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });
});

describe("Texterkennung: Trupp mit überzähliger Null (Prüfbericht K2)", () => {
  const isCell = (c: string) => findCells(c, ex0.sheets).length > 0;
  it("«HO04», «H0O4» → H04, nicht H00", () => {
    expect(fixOcrTokens("0727 HO04 1 Pers", isCell)).toBe("0727 H04 1 Pers");
    expect(fixOcrTokens("0727 H0O4 1 Pers", isCell)).toBe("0727 H04 1 Pers");
    expect(fixOcrTokens("0727 HO4 1 Pers", isCell)).toBe("0727 H04 1 Pers");
  });
  it("ganze Kette mit bekannten Trupps", () => {
    expect(ocrToMeldungen("0726 HO3 2 Fz AK7\n0727 HO04 1 Pers bei NAI 2", isCell, ex0.days, ["NAI 1", "NAI 2", "NAI 3"], ex0.units.blau)).toEqual([
      "0726 H03 2 Fz AK7",
      "0727 H04 1 Pers bei NAI 2",
    ]);
  });
});
