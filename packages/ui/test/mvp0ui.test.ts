import { describe, expect, it } from "vitest";
import { demoExercise, type Exercise, type LageEvent } from "@lage/core";
import { commitTexts } from "../src/commit";
import { initialRows } from "../src/batchRows";
import { blockText, openProblems } from "../src/DraftProblems";
import { placeFromText, reparseEdit, reparseExtras } from "../src/editReparseCore";
import { shortText } from "../src/MapTipSheet";

// Alle Daten fiktiv (Beispielübung Raum Bern)

describe("Probleme sperren (DraftProblems)", () => {
  it("Ort auf Karte löst nur das Ort-Problem", () => {
    const d = { problems: [{ kind: "ort" as const, text: "«AK77» gibt es nicht" }, { kind: "zeit" as const, text: "«13:70» ist keine gültige Uhrzeit" }] };
    expect(openProblems(d)).toHaveLength(2);
    expect(openProblems(d, { manualPos: true }).map((p) => p.kind)).toEqual(["zeit"]);
    expect(openProblems(null)).toEqual([]);
  });
  it("Klartext", () => {
    expect(blockText([{ kind: "ort", text: "«AK77» gibt es nicht" }])).toBe("Eintragen gesperrt: «AK77» gibt es nicht. Text korrigieren oder «Ort auf Karte» setzen.");
    expect(blockText([])).toBe("");
    expect(blockText([{ kind: "melder", text: "«H13» gibt es in der Übung nicht (bekannt: H01, H02)", token: "H13" }]))
      .toBe("Eintragen gesperrt: «H13» gibt es in der Übung nicht (bekannt: H01, H02). Trupp im Text korrigieren oder als neuen Trupp aufnehmen.");
    expect(blockText([{ kind: "orte", text: "zwei Orte (AK7, AL8) – bitte als zwei Meldungen eintragen" }, { kind: "zeit", text: "«kurz nach acht»: ungefähre Zeit" }]))
      .toBe("Eintragen gesperrt: zwei Orte (AK7, AL8) – bitte als zwei Meldungen eintragen · «kurz nach acht»: ungefähre Zeit. Zeit im Text korrigieren; eine Meldung pro Ort eintragen.");
  });
  it("Ort auf Karte löst weder unbekannten Trupp noch zwei Orte", () => {
    const d = { problems: [{ kind: "melder" as const, text: "«H13» …", token: "H13" }, { kind: "orte" as const, text: "zwei Orte" }] };
    expect(openProblems(d, { manualPos: true })).toHaveLength(2);
  });
  it("unbekannter Trupp wird nicht eingetragen (mehrere Meldungen)", () => {
    let ex: Exercise = demoExercise();
    let skipped: string[] = [];
    const evs = commitTexts(["0715 H13 2 Fz AK7", "0716 H01 3 Pers AK7 und 2 Fz AL8", "0717 H04 2 Fz AK7"], { ex, device: "d", update: (f) => { ex = f(structuredClone(ex)); }, day: ex.days[1], onSkipped: (t) => { skipped = t; } });
    expect(evs.map((e) => e.melder)).toEqual(["H04"]);
    expect(skipped).toHaveLength(2);
  });
});

describe("Mehrere Meldungen: Zeilen mit Problem", () => {
  it("nicht vorab angehakt", () => {
    const rows = initialRows([{ text: "0715 H04 2 Fz AG13" }, { text: "0716 H04 2 Fz AK77" }], (t) => /AK77/.test(t));
    expect(rows.map((r) => r.on)).toEqual([true, false]);
  });
  it("commitTexts trägt sie nie ein und meldet sie", () => {
    let ex: Exercise = demoExercise();
    const before = ex.events!.length;
    const skipped: string[] = [];
    const evs = commitTexts(["0715 H04 2 Fz AG13", "0716 H04 2 Fz in AK77", "0717 H04 1 Pers in NAI 9"], {
      ex, device: "d", update: (f) => { ex = f(structuredClone(ex)); }, day: ex.days[1], onSkipped: (t) => skipped.push(...t),
    });
    expect(evs).toHaveLength(1);
    expect(ex.events!.length).toBe(before + 1);
    expect(skipped).toEqual(["0716 H04 2 Fz in AK77", "0717 H04 1 Pers in NAI 9"]);
  });
});

describe("Korrektur liest den Text neu (editReparse)", () => {
  const ex = demoExercise();
  const e: LageEvent = { ...ex.events!.find((x) => x.cells?.length && x.melder)!, t: `${ex.days[1]}T07:00` };
  it("Ort, Zeit, Anzahl, Richtung aus dem neuen Text", () => {
    const d = reparseEdit(e, "0712 H04 3 Fz in AK9 Rtg S", ex)!;
    expect(d.t).toBe(`${ex.days[1]}T07:12`);
    expect(d.cells).toEqual(["AK9"]);
    expect(d.count).toBe(3);
    expect(d.dir).toBe(180);
    expect(placeFromText(d)).toBe(true);
  });
  it("ohne Zeit: Tag und Zeit des Eintrags", () => {
    const d = reparseEdit(e, "H04 3 Fz in AK9", ex)!;
    expect(d.timeFromText).toBe(false);
    expect(d.t).toBe(e.t);
  });
  it("ohne Ort im Text: Ort bleibt (kein Ort aus dem Text)", () => {
    const d = reparseEdit(e, "H04 3 Fz Rtg W", ex)!;
    expect(placeFromText(d)).toBe(false);
  });
  it("unbekannter Ort: Problem, kein Ersatzort", () => {
    const d = reparseEdit(e, "H04 3 Fz in AK77", ex)!;
    expect(openProblems(d)).toHaveLength(1);
    expect(placeFromText(d)).toBe(false);
  });
  it("Extras: Richtung und erkannter SIDC solange Zeichen wie erkannt", () => {
    const d = reparseEdit(e, "H04 3 Fz in NAI 3 Rtg N", ex)!;
    const x = reparseExtras(d, { key: d.sym, aff: d.aff, echelon: d.echelon, status: d.status, sidc: "x" }, d.count, true);
    expect(x.dir).toBe(0);
    expect(x.sidc).toBe(d.sidc);
    expect(x.nai).toBe("NAI 3");
    const y = reparseExtras(d, { key: "einheit", aff: d.aff, sidc: "x" }, d.count, false);
    expect(y.sidc).toBeUndefined();
    expect("nai" in y).toBe(false);
  });
});

describe("Kartenblatt (Handy)", () => {
  it("Begründung kurz: erster Satz bzw. gekürzt", () => {
    expect(shortText("Zwei Pendelfahrten in AK9 innert 40 Minuten. Danach Ruhe.")).toBe("Zwei Pendelfahrten in AK9 innert 40 Minuten.");
    expect(shortText("x ".repeat(200))!.length).toBeLessThanOrEqual(160);
    expect(shortText(undefined)).toBeUndefined();
  });
});
