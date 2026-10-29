/**
 * Laufende Nummer (Spez. MVP 3, Kap. 3.3; Entscheid 1): eine gemeinsame Folge, Nummer ändert nie, Doppelte aus
 * parallelem Erfassen offline werden deterministisch «12a/12b» gekennzeichnet.
 */
import { describe, expect, it } from "vitest";
import { demoExercise, doppeltText, findByNr, mergeExercise, mergeReportText, maxNr, nextNr, nrDoppelte, nrLabel, type Exercise, type LageEvent } from "../src";

let k = 0;
const ev = (nr: number | undefined, createdAt: string, id = `e${++k}`): LageEvent => ({
  id, rev: 1, device: "d", updatedAt: createdAt, createdAt, t: "2030-05-15T07:00", side: "rot", unit: "", text: `Meldung ${id}`, sym: "fz", aff: "H", confirmed: true,
  ...(nr !== undefined ? { nr, von: "d" } : {}),
});
const exOf = (events: LageEvent[]): Exercise => ({ ...demoExercise(), events });

describe("Nummern", () => {
  it("alte Einträge ohne nr: abgeleitet nach Eingang, nichts geschrieben", () => {
    const ex = demoExercise();
    const before = JSON.stringify(ex);
    const sorted = [...ex.events!].sort((a, b) => (a.createdAt! < b.createdAt! ? -1 : a.createdAt! > b.createdAt! ? 1 : a.id < b.id ? -1 : 1));
    expect(sorted.map((e) => nrLabel(e, ex))).toEqual(sorted.map((_, i) => String(i + 1)));
    expect(JSON.stringify(ex)).toBe(before);
    expect(maxNr(ex)).toBe(ex.events!.length);
    expect(nextNr(ex, 0)).toBe(ex.events!.length + 1);
  });
  it("nächste Nummer: über Gerätezähler und höchster bekannter Nummer", () => {
    const ex = exOf([ev(1, "2030-05-15T05:00:00Z"), ev(2, "2030-05-15T05:01:00Z")]);
    expect(nextNr(ex, 0)).toBe(3);
    expect(nextNr(ex, 7)).toBe(8);
    expect(nextNr(exOf([]), 0)).toBe(1);
  });
  it("findByNr", () => {
    const a = ev(41, "2030-05-15T05:00:00Z"), b = ev(42, "2030-05-15T05:01:00Z");
    const ex = exOf([a, b]);
    expect(findByNr(ex, "42")?.id).toBe(b.id);
    expect(findByNr(ex, "Nr 41")?.id).toBe(a.id);
    expect(findByNr(ex, "99")).toBeUndefined();
  });
  it("zwei Geräte offline, gleiche Nummer: bleibt, Anzeige 12a/12b nach Eingang – auf beiden gleich", () => {
    const base = [ev(11, "2030-05-15T05:00:00Z", "basis")];
    const a = { ...exOf([...base, ev(12, "2030-05-15T05:10:00Z", "zzz-a")]) };
    const b = { ...exOf([...base, ev(12, "2030-05-15T05:05:00Z", "aaa-b")]) };
    const ab = mergeExercise(a, b), ba = mergeExercise(b, a);
    for (const m of [ab, ba]) {
      const ex = m.ex;
      expect(ex.events!.map((e) => e.nr).sort()).toEqual([11, 12, 12]);
      const byId = (id: string) => ex.events!.find((e) => e.id === id)!;
      expect(nrLabel(byId("aaa-b"), ex)).toBe("12a");
      expect(nrLabel(byId("zzz-a"), ex)).toBe("12b");
      expect(nrLabel(byId("basis"), ex)).toBe("11");
      expect(findByNr(ex, "12b")?.id).toBe("zzz-a");
      expect(findByNr(ex, "12")?.id).toBe("aaa-b");
      expect(m.report.doppelt).toEqual([{ nr: 12, ids: ["aaa-b", "zzz-a"], labels: ["12a", "12b"] }]);
      expect(doppeltText(m.report.doppelt!)).toBe("2 Nummern doppelt – als 12a/12b gekennzeichnet");
      expect(mergeReportText(m.report)).toContain("2 Nummern doppelt – als 12a/12b gekennzeichnet");
      // weiter zählen ab der höchsten bekannten Nummer
      expect(nextNr(ex, 12)).toBe(13);
    }
  });
  it("wiederholtes Zusammenführen meldet die Doppelten nicht nochmals", () => {
    const a = exOf([ev(5, "2030-05-15T05:10:00Z", "x1")]);
    const b = exOf([ev(5, "2030-05-15T05:05:00Z", "x2")]);
    const once = mergeExercise(a, b).ex;
    expect(mergeExercise(once, b).report.doppelt).toBeUndefined();
    expect(nrDoppelte(once)).toHaveLength(1);
  });
  it("ohne Doppelte kein Text", () => {
    expect(doppeltText([])).toBe("");
  });
});
