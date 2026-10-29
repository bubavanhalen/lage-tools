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
