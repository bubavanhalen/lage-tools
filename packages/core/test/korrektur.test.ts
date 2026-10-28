import { describe, expect, it } from "vitest";
import { correctEvent, demoExercise, mergeEvents, reviseEvent, type LageEvent } from "../src";

// fiktiv: Beispiel Bern, Meldung «T2 0720 H03: 1 Fz in NAI 2 Rtg N»
const ex = demoExercise();
const orig = ex.events!.find((e) => e.text.includes("NAI 2") && e.t.endsWith("07:20"))!;
const t1 = new Date("2030-05-15T05:34:00Z");
const t2 = new Date("2030-05-15T05:40:00Z");

describe("correctEvent – Korrektur mit Historie (Kap. 3.3)", () => {
  it("zählt die Revision hoch, legt die alte Fassung in history, Zeit und Eingang bleiben", () => {
    const c = correctEvent(orig, { text: "1 Fz in AK9 Rtg N", nai: undefined, where: "AK9", cells: ["AK9"] }, "dev-b", t1);
    expect(c.id).toBe(orig.id);
    expect(c.rev).toBe(orig.rev + 1);
    expect(c.t).toBe(orig.t);
    expect(c.tReported).toBe(orig.tReported);
    expect(c.createdAt).toBe(orig.createdAt);
    expect(c.device).toBe("dev-b");
    expect(c.where).toBe("AK9");
    expect(c.history).toHaveLength(1);
    expect(c.history![0]).toMatchObject({ rev: orig.rev, text: orig.text, nai: "NAI 2", t: orig.t, device: orig.device, at: orig.updatedAt });
    // Original unverändert
    expect(orig.history).toBeUndefined();
  });
  it("lässt sich Revision, ID und Eingang nicht überschreiben; t nur ausdrücklich", () => {
    const c = correctEvent(orig, { id: "x", rev: 99, tReported: "1999-01-01T00:00", history: [] } as Partial<LageEvent>, "dev-b", t1);
    expect(c.id).toBe(orig.id);
    expect(c.rev).toBe(orig.rev + 1);
    expect(c.tReported).toBe(orig.tReported);
    expect(c.history).toHaveLength(1);
    const d = correctEvent(orig, { t: "2030-05-15T07:15" }, "dev-b", t1);
    expect(d.t).toBe("2030-05-15T07:15");
  });
  it("Historie wächst, älteste zuerst", () => {
    const c1 = correctEvent(orig, { text: "a" }, "dev-b", t1);
    const c2 = correctEvent(c1, { text: "b" }, "dev-b", t2);
    expect(c2.history!.map((h) => h.text)).toEqual([orig.text, "a"]);
    expect(c2.history!.map((h) => h.rev)).toEqual([orig.rev, orig.rev + 1]);
  });
});

describe("mergeEvents – höhere Revision gewinnt samt Historie", () => {
  it("übernimmt die Korrektur mit Historie, egal in welcher Reihenfolge", () => {
    const c = correctEvent(orig, { text: "korrigiert" }, "dev-b", t1);
    for (const m of [mergeEvents([orig], [c]), mergeEvents([c], [orig])]) {
      expect(m).toHaveLength(1);
      expect(m[0]!.text).toBe("korrigiert");
      expect(m[0]!.history).toHaveLength(1);
    }
  });
  it("ergänzt ältere Fassungen, die der Gewinnerin fehlen", () => {
    const c = correctEvent(orig, { text: "korrigiert" }, "dev-b", t1);
    // anderes Gerät ohne Historie ändert danach (z. B. Ziehen auf der Karte)
    const moved = { ...reviseEvent(c, { where: "Karte" }, "dev-c", t2), history: undefined };
    const m = mergeEvents([c], [moved]);
    expect(m[0]!.where).toBe("Karte");
    expect(m[0]!.history!.map((h) => h.rev)).toEqual([orig.rev]);
  });
});
