import { describe, expect, it } from "vitest";
import { axisSteps, axisTicks, buildLanes, clusterX, demoExercise, dotKind, liveTime, stackOffsets, timeBounds, type LageEvent } from "../src";

// Fiktive Meldungen (Raum Bern, keine Übungsdaten)
let n = 0;
const ev = (p: Partial<LageEvent>): LageEvent => ({
  id: `e${++n}`, rev: 1, device: "dev-test", updatedAt: "2030-05-15T08:00", t: "2030-05-14T18:30",
  side: "blau", unit: "", text: "", sym: "einheit", aff: "F", confirmed: true, ...p,
});
const units = { rot: ["Det 1", "Det 2"], blau: ["H01", "H02"], ul: [] };

describe("Spuren (Schwimmbahnen)", () => {
  it("Feind oben, Sammelspur Sichtungen zuletzt, dann Eigene; Melder bekommt Ring-Spur", () => {
    const { lanes, items } = buildLanes([
      ev({ t: "2030-05-14T18:30", unit: "H01", melder: "H01", pos: { e: 2600000, n: 1200000 } }),
      ev({ t: "2030-05-14T19:00", side: "rot", aff: "H", unit: "Det 2", melder: "H02", cells: ["AJ8"] }),
      ev({ t: "2030-05-14T19:10", side: "rot", aff: "U", unit: "", melder: "H07" }),
      ev({ t: "2030-05-14T19:20", side: "rot", aff: "H", unit: "Det 9", melder: "h 01" }),
      ev({ t: "2030-05-14T19:30", deleted: true, unit: "H05" }),
    ], units);
    expect(lanes.map((l) => l.label)).toEqual(["Det 1", "Det 2", "Det 9", "Sichtungen", "H01", "H02", "H07"]);
    expect(lanes.map((l) => l.group)).toEqual(["feind", "feind", "feind", "feind", "eigen", "eigen", "eigen"]);
    expect(lanes.find((l) => l.label === "Sichtungen")!.sammel).toBe(true);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ lane: "eigen:h1", kind: "eigen", located: true });
    expect(items[0]!.melderLane).toBeUndefined();
    expect(items[1]).toMatchObject({ lane: "feind:det2", kind: "feind", located: true, melderLane: "eigen:h2" });
    expect(items[2]).toMatchObject({ lane: "feind:*", kind: "unklar", located: false, melderLane: "eigen:h7" });
    expect(items[3]).toMatchObject({ lane: "feind:det9", melderLane: "eigen:h1" });
    expect(lanes.find((l) => l.key === "feind:det1")!.count).toBe(0);
  });

  it("Beispielübung: jede Meldung hat eine Spur, Sichtungen zeigen auf ihren Melder", () => {
    const ex = demoExercise();
    const { lanes, items } = buildLanes(ex.events!, ex.units);
    const keys = new Set(lanes.map((l) => l.key));
    expect(items).toHaveLength(ex.events!.length);
    for (const it of items) {
      expect(keys.has(it.lane)).toBe(true);
      if (it.melderLane) expect(keys.has(it.melderLane)).toBe(true);
    }
    expect(lanes[0]!.label).toBe("Det 1");
    expect(items.filter((i) => i.kind !== "eigen" && i.melderLane).length).toBeGreaterThan(5);
  });

  it("Art des Punkts", () => {
    expect(dotKind({ side: "blau", aff: "F" })).toBe("eigen");
    expect(dotKind({ side: "rot", aff: "H" })).toBe("feind");
    expect(dotKind({ side: "rot", aff: "U" })).toBe("unklar");
    expect(dotKind({ side: "ul", aff: "N" })).toBe("ul");
  });
});

describe("Zeitbereich und Achse", () => {
  const at = (d: number, h: number, m = 0) => new Date(2030, 4, d, h, m).getTime();

  it("Live: jetzt während der Übung, sonst letzte Meldung", () => {
    expect(liveTime(undefined, at(15, 8))).toBe(at(15, 8));
    expect(liveTime(at(15, 6, 50), at(15, 8))).toBe(at(15, 8));
    expect(liveTime(at(15, 6, 50), at(16, 8))).toBe(at(15, 6, 50));
    expect(liveTime(at(15, 6, 50), at(15, 6))).toBe(at(15, 6, 50)); // Uhr nachgehend
  });

  it("Bereich auf volle Stunden", () => {
    expect(timeBounds(at(14, 18, 30), at(15, 6, 50), at(15, 6, 50))).toEqual({ t0: at(14, 18), t1: at(15, 7) });
    expect(timeBounds(at(14, 18, 30), at(15, 6, 59), at(15, 6, 59))).toEqual({ t0: at(14, 18), t1: at(15, 7) });
    expect(timeBounds(at(14, 18, 30), at(15, 7), at(15, 7))).toEqual({ t0: at(14, 18), t1: at(15, 8) });
    expect(timeBounds(undefined, undefined, at(15, 8, 10))).toEqual({ t0: at(15, 7), t1: at(15, 9) });
  });

  it("Schrittweiten passen zur Dichte", () => {
    expect(axisSteps(2)).toEqual({ major: 60, minor: 10 });
    expect(axisSteps(1)).toEqual({ major: 120, minor: 15 });
    expect(axisSteps(0.3).major).toBe(360);
    expect(axisSteps(0.05).major).toBe(2880);
  });

  it("Linien auf lokale Uhrzeit ausgerichtet, Mitternacht ist Hauptlinie", () => {
    const { major, minor, steps } = axisTicks(at(14, 18), at(15, 7), 1);
    expect(steps).toEqual({ major: 120, minor: 15 });
    expect(major).toContain(at(15, 0));
    expect(major).toContain(at(14, 18));
    expect(major).not.toContain(at(14, 19));
    expect(minor).toContain(at(14, 19));
    expect(minor).toContain(at(14, 18, 15));
    expect(Math.max(...major, ...minor)).toBeLessThanOrEqual(at(15, 7));
    expect(Math.min(...major, ...minor)).toBeGreaterThanOrEqual(at(14, 18));
  });
});

describe("Stapeln gleichzeitiger Meldungen", () => {
  it("Gruppen nach Abstand zum ersten Punkt", () => {
    expect(clusterX([0, 5, 11, 13, 40], 12).map((c) => [c.group, c.index, c.size])).toEqual([[0, 0, 3], [0, 1, 3], [0, 2, 3], [1, 0, 1], [2, 0, 1]]);
  });

  it("einzeln mittig, mehrere gleichmässig übereinander, viele in Spalten, Rest als «+n»", () => {
    expect(stackOffsets(1, 34, 6)).toEqual({ offs: [{ dx: 0, dy: 0 }], overflow: 0 });
    const two = stackOffsets(2, 34, 6).offs;
    expect(two[0]!.dy).toBeCloseTo(-two[1]!.dy);
    expect(two.every((o) => o.dx === 0)).toBe(true);
    const six = stackOffsets(6, 34, 6);
    expect(six.offs).toHaveLength(6);
    expect(new Set(six.offs.map((o) => `${o.dx}|${o.dy}`)).size).toBe(6);
    const many = stackOffsets(20, 34, 6);
    expect(many.offs.length + many.overflow).toBe(20);
    expect(many.badge).toBeDefined();
    for (const o of many.offs) expect(Math.abs(o.dy)).toBeLessThanOrEqual(17);
  });
});
