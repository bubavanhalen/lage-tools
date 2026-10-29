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

// Paket A: Übergabe-Fragen F1–F3 aus Einträgen, wie das Meldungsfeld sie erzeugt (Kap. 8.3)
import { eventFromDraft, parseMeldung, type Exercise } from "../src";

describe("Lage Blau und Zahlen nach Einträgen aus 8.1 (#5, #6, #12, #4)", () => {
  const ex: Exercise = demoExercise();
  let s = 0;
  for (const text of ["H04 Rückfrage: Standort Det 2?", "Auftrag an H01: Beo NAI 1 bis 1200", "H02 Vbk i.O.", "Kontakt! H02, Feuer aus AK9, 2 Schützen, wir halten"]) {
    const now = new Date(2030, 4, 15, 7, 30, s++);
    const d = parseMeldung(text, { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, events: ex.events, ex });
    ex.events = [...ex.events!, eventFromDraft(d, "dev-a", now, { nr: 100 + s, kuerzel: "BSP" })];
  }
  const z = lageBlau(ex, "2030-05-15T07:30");
  const zeile = (u: string) => z.find((x) => x.trupp === u)!;
  it("F1 Ort/seit, F2 letzte Vbk, F3 offener Auftrag; Rückfrage bei H04", () => {
    expect(zeile("H03")).toMatchObject({ ort: "AP4 D", seit: "2030-05-14T18:45" });
    expect(zeile("H02").letzteVbk).toEqual({ t: "2030-05-15T07:30", ergebnis: "gut" });
    expect(zeile("H02").ort).toBe("AL9 A");
    expect(zeile("H01").offen).toEqual([expect.objectContaining({ art: "auftrag", text: "an H01: Beo NAI 1 – bis 12:00", frist: "2030-05-15T12:00", ueberfaellig: false })]);
    expect(zeile("H04").offen.map((o) => o.art)).toEqual(["rueckfrage"]);
    expect(zeile("H04").letzteMeldung?.text).toBe("Rückfrage Standort Det 2?");
  });
  it("Zahlen: Aufträge/Rückfragen offen, Dringend aus «Kontakt!», Nicht-Meldungen nicht als «gesehen»", () => {
    const r = rapportZahlen(ex, null, "2030-05-15T07:30");
    expect(r.auftraege).toEqual({ total: 1, offen: 1 });
    expect(r.rueckfragen).toEqual({ total: 1, offen: 1 });
    expect(r.dringend).toEqual({ total: 1, offen: 1 });
    expect(r.gesehen.feind + r.gesehen.unklar + r.gesehen.eigen).toBe(ex.events!.length - 3);
    expect(zaehleMeldungen(ex)).toBe(ex.events!.length - 3);
  });
});
