/** AEIOU und Meldezettel (Spez. MVP 3, Kap. 3.2; Entscheid 2: AEIOU-E ist immer das Gesehene) */
import { describe, expect, it } from "vitest";
import { AEIOU_E_REGEL, felderZuText, readMeldeFelder } from "../src";

const blau = ["H01", "H02", "H03", "H04", "H05"];
const f = (t: string) => readMeldeFelder(t, { blau });

describe("readMeldeFelder", () => {
  it("Kurzmeldungen sind keine Felder", () => {
    expect(f("H03: 1 Fz in NAI 2 Rtg N")).toBeNull();
    expect(f("A: 1020 3 Pers")).toBeNull();
    expect(f("Wann: 1020 3 Pers AF8")).toBeNull();
  });
  it("AEIOU feldweise, U nie ausgewertet", () => {
    expect(f("H03 A: 1020 E: 3 Pers bewaffnet I: Rtg W O: AF8 C U: beobachten weiter")).toEqual({
      schema: "aeiou", melder: "H03", wann: "1020", was: "3 Pers bewaffnet", wie: "Rtg W", wo: "AF8 C", umwelt: "beobachten weiter",
    });
  });
  it("Entscheid 2: E ist das Gesehene, nie der Melder", () => {
    expect(AEIOU_E_REGEL).toBe("gesehenes");
    const x = f("A: 1020 E: H03 I: 3 Pers bewaffnet Rtg W O: AF8 C U: beobachten weiter")!;
    expect(x.melder).toBeUndefined();
    expect(x.was).toBe("H03");
    expect(felderZuText(x)).toBe("1020 H03 3 Pers bewaffnet Rtg W AF8 C");
  });
  it("Melder aus «Melder:»/«Von:» oder vor dem ersten Feld", () => {
    expect(f("A: 1020 E: 3 Pers O: AF8 Melder: h3")!.melder).toBe("H03");
    expect(f("H04 meldet A: 1020 E: 2 Fz O: AK7")!.melder).toBe("H04");
  });
  it("Meldezettel: «Wer: H03» (eigener Trupp allein) ist der Melder", () => {
    const x = f("Wann: 1020 Wer: H03 Was: 3 Pers bewaffnet Wo: AF8")!;
    expect(x).toMatchObject({ schema: "formular", melder: "H03", wann: "1020", was: "3 Pers bewaffnet", wo: "AF8" });
    expect(x.wer).toBeUndefined();
    expect(felderZuText(x)).toBe("1020 H03: 3 Pers bewaffnet AF8");
  });
  it("Meldezettel: Richtung an «wie», Bemerkung nicht im gelesenen Text", () => {
    const x = f("Zeit: 0715 Was: 2 Fz Ort: AK9 Rtg: W Bem: fahren langsam")!;
    expect(x).toMatchObject({ wann: "0715", was: "2 Fz", wo: "AK9", wie: "Rtg W", umwelt: "fahren langsam" });
    expect(felderZuText(x)).not.toContain("langsam");
  });
});

// parseMeldung liest Felder (Paket A): Zeit nur aus A/Wann, Ort nur aus O/Wo, U/Bem nie, E nie Melder
import { demoExercise, entryState, lastPosition, parseMeldung, splitMeldungen } from "../src";

describe("parseMeldung mit Feldern", () => {
  const ex = demoExercise();
  const now = new Date(2030, 4, 15, 7, 30);
  const p = (t: string) => parseMeldung(t, { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, s) => lastPosition(ex.events!, s, u) });
  const st = (t: string) => entryState(p(t), { hasRaster: true, online: false, placePending: false, manualPos: false, now, sheets: ex.sheets, areas: ex.areas });
  it("Originaltext bleibt, gelesener Text in `normalized`, Felder in `felder`", () => {
    const d = p("H03 A: 0721 E: 3 Pers bewaffnet I: Rtg W O: AF8 C U: beobachten weiter");
    expect(d.text).toBe("H03 A: 0721 E: 3 Pers bewaffnet I: Rtg W O: AF8 C U: beobachten weiter");
    expect(d.normalized).toBe("0721 H03: 3 Pers bewaffnet Rtg W AF8 C");
    expect(d.felder?.umwelt).toBe("beobachten weiter");
    expect(d).toMatchObject({ kind: "feind", melder: "H03", unit: "", t: "2030-05-15T07:21", cells: ["AF8 C"] });
  });
  it("U wird nie ausgewertet: «U: Beo Stao bezogen» verschiebt den Melder nicht", () => {
    const d = p("H03 A: 0721 E: 2 Fz I: Rtg N O: AN6 U: Beo Stao bezogen AP5");
    expect(d.kind).toBe("feind");
    expect(d.cells).toEqual(["AN6"]);
  });
  it("Ort nur aus O/Wo: Planquadrat im Gesehenen zählt nicht; ohne Wo → «Ort fehlt»", () => {
    expect(p("Wann: 0720 Wer: H03 Was: 2 Fz von AK7 kommend Wo: AN6").cells).toEqual(["AN6"]);
    const d = p("Wann: 0720 Wer: H03 Was: 2 Fz von AK7 kommend Rtg: N");
    expect(d.pos).toBeUndefined();
    expect(st("Wann: 0720 Wer: H03 Was: 2 Fz von AK7 kommend Rtg: N").reasons.map((r) => r.code)).toContain("ort");
  });
  it("Ortsproblem in Wo sperrt wie sonst («AK77»)", () => {
    expect(st("Wann: 0720 Wer: H03 Was: 2 Fz Wo: AK77").level).toBe("geht-nicht");
  });
  it("Kurzmeldung mit «Bem:» am Ende: Bemerkung bleibt im Text, wird nicht gelesen", () => {
    const d = p("H03: 2 Fz AN6 Bem: Beo Stao bezogen AP5");
    expect(d.text).toBe("H03: 2 Fz AN6 Bem: Beo Stao bezogen AP5");
    expect(d.kind).toBe("feind");
    expect(d.cells).toEqual(["AN6"]);
  });
  it("Meldezettel aus Foto/Sprache: Bemerkung als «Bem: …» am Ende (nie ausgewertet)", () => {
    const [m] = splitMeldungen("Zeit: 0715\nMelder: H04\nWas: 2 Fz\nWo: AG13\nBemerkung: fahren langsam");
    expect(m).toBe("0715 H04: 2 Fz AG13 Bem: fahren langsam");
    expect(p(m!).cells).toEqual(["AG13"]);
  });
});
