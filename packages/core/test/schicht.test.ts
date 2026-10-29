/** Schichten, Lage Blau, Zahlen für den Rapport (Spez. MVP 3, Kap. 3.6, 3.8) – Phase 0 */
import { describe, expect, it } from "vitest";
import { aktuelleSchicht, demoExercise, demoLang, lageBlau, mergeExercise, rapportZahlen, schichtenIm, zaehleMeldungen, type SchichtWechsel } from "../src";

const w = (id: string, t: string, device: string, an: string, art: SchichtWechsel["art"] = "uebergabe"): SchichtWechsel => ({ id, art, at: `${t}:00.000Z`, t, an, device });

describe("Schichten", () => {
  it("aktuelle Schicht je Gerät, Wechsel im Zeitraum", () => {
    const ex = { schichten: [w("1", "2030-05-15T04:00", "a", "BSP", "beginn"), w("2", "2030-05-15T06:00", "a", "MU"), w("3", "2030-05-15T05:00", "b", "ZZ", "beginn")] };
    expect(aktuelleSchicht(ex, "a")?.an).toBe("MU");
    expect(aktuelleSchicht(ex, "b")?.an).toBe("ZZ");
    expect(aktuelleSchicht(ex, "c")).toBeNull();
    expect(schichtenIm(ex, "2030-05-15T04:30", "2030-05-15T07:00").map((s) => s.id)).toEqual(["3", "2"]);
  });
  it("Zusammenführen: Vereinigung nach ID", () => {
    const a = { ...demoExercise(), schichten: [w("1", "2030-05-15T04:00", "a", "BSP", "beginn")] };
    const b = { ...demoExercise(), schichten: [w("1", "2030-05-15T04:00", "a", "BSP", "beginn"), w("2", "2030-05-15T05:00", "b", "MU")] };
    expect(mergeExercise(a, b).ex.schichten?.map((s) => s.id)).toEqual(["1", "2"]);
    expect(mergeExercise(b, a).ex.schichten?.map((s) => s.id)).toEqual(["1", "2"]);
  });
});

describe("Lage Blau (Übergabe Abschnitt 1)", () => {
  it("Beispiel Bern T2 07:30: Standorte der Trupps", () => {
    const z = lageBlau(demoExercise(), "2030-05-15T07:30");
    expect(z.map((x) => [x.trupp, x.ort])).toEqual([["H01", "AC6 B"], ["H02", "AL9 A"], ["H03", "AP4 D"], ["H04", "AF12 A"], ["H05", "AQ11 C"]]);
    const h03 = z.find((x) => x.trupp === "H03")!;
    expect(h03.seit).toBe("2030-05-14T18:45");
    expect(h03.letzteMeldung?.t).toBe("2030-05-15T07:20");
    expect(h03.stillMin).toBe(10);
  });
});

describe("Zahlen für den Rapport", () => {
  it("Beispiel Bern: ganze Übung", () => {
    const ex = demoExercise();
    const z = rapportZahlen(ex, null, "2030-05-15T07:30");
    expect(z.eintraege).toBe(ex.events!.length);
    expect(z.gesehen.feind + z.gesehen.unklar + z.gesehen.eigen).toBe(ex.events!.length);
    expect(z.auftraege.total).toBe(0);
    expect(z.gestrichen).toBe(0);
    expect(zaehleMeldungen(ex)).toBe(ex.events!.length);
  });
  it("lange Übung: Schicht ⊂ ganze Übung, Hinweise offen/erledigt", () => {
    const ex = demoLang();
    const seit = ex.schichten![ex.schichten!.length - 1]!.at;
    const s = rapportZahlen(ex, seit, "2030-05-18T07:30", [{ id: "h1", rule: "C1", level: "mittel", title: "x", text: "", events: [], t: "2030-05-18T07:00" }]);
    const g = rapportZahlen(ex, null, "2030-05-18T07:30");
    expect(s.eintraege).toBeGreaterThan(0);
    expect(s.eintraege).toBeLessThan(g.eintraege);
    expect(g.auftraege.total).toBeGreaterThan(0);
    expect(g.gestrichen).toBeGreaterThan(0);
    expect(g.korrigiert).toBeGreaterThan(0);
    expect(s.hinweise).toEqual({ offen: 1, erledigt: 0 });
    expect(zaehleMeldungen(ex)).toBeGreaterThanOrEqual(200);
  });
});
