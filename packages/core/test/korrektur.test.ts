import { describe, expect, it } from "vitest";
import { correctEvent, correctionSummary, demoExercise, historyText, journalStatus, journalToCsv, mergeEvents, placeLabel, reviseEvent, undoCorrection, type LageEvent } from "../src";

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

describe("Korrektur – Rückgängig, Zusammenfassung, Status (Kap. 3.3)", () => {
  it("correctEvent setzt correctedAt; undoCorrection stellt die alte Fassung mit höherer Revision her", () => {
    const c = correctEvent(orig, { text: "H03: 1 Fz in AK9 Rtg N", nai: undefined, where: "AK9", cells: ["AK9"] }, "dev-b", t1);
    expect(c.correctedAt).toBe(t1.toISOString());
    const u = undoCorrection(c, orig, "dev-b", t2);
    expect(u.text).toBe(orig.text);
    expect(u.where).toBe(orig.where);
    expect(u.rev).toBe(c.rev + 1);
    expect(u.history).toBeUndefined();
    expect(u.correctedAt).toBeUndefined();
    // gewinnt beim Zusammenführen gegen die Korrektur
    expect(mergeEvents([c], [u])[0]!.text).toBe(orig.text);
  });
  it("Zusammenfassung «NAI 2 → AK9»", () => {
    const c = correctEvent(orig, { text: "x", nai: undefined, where: "AK9", cells: ["AK9"] }, "dev-b", t1);
    expect(correctionSummary(orig, c)).toBe("NAI 2 → AK9");
    expect(correctionSummary(orig, correctEvent(orig, { aff: "U" }, "dev-b", t1))).toBe("Feind → Unklar");
    expect(correctionSummary(orig, correctEvent(orig, { text: orig.text + " (Lw)" }, "dev-b", t1))).toBe("Text geändert");
    expect(placeLabel({ where: "Karte", cells: ["AK9"] })).toBe("Karte (AK9)");
  });
  it("Status und Fassungen für Liste und Export: korrigiert / gestrichen", () => {
    const c = correctEvent(orig, { text: "1 Fz in AK9 Rtg N", where: "AK9" }, "dev-b", new Date(2030, 4, 15, 7, 34));
    expect(journalStatus(c)).toBe("korrigiert 07:34");
    expect(journalStatus({ ...orig, deleted: true })).toBe("gestrichen");
    expect(journalStatus(orig)).toBe("");
    expect(historyText(c)).toBe(`vorher: 07:20 ${orig.text} (NAI 2)`);
    const csv = journalToCsv([c, { ...orig, id: "weg", deleted: true }], ex.days).split("\r\n");
    expect(csv[0]).toContain(";Status;Fassungen;Form");
    expect(csv.some((r) => r.includes(";korrigiert 07:34;vorher: 07:20"))).toBe(true);
    expect(csv.some((r) => r.includes(";gestrichen;"))).toBe(true);
    expect(journalToCsv([{ ...orig, deleted: true }], ex.days, { gestrichen: false }).split("\r\n")).toHaveLength(1);
  });
  it("mergeEvents: gelöschte Korrektur behält die Historie", () => {
    const c = correctEvent(orig, { text: "korrigiert" }, "dev-b", t1);
    const del = reviseEvent(c, { deleted: true }, "dev-c", t2);
    const m = mergeEvents([orig], [del])[0]!;
    expect(m.deleted).toBe(true);
    expect(m.history).toHaveLength(1);
    expect(journalStatus(m)).toBe("gestrichen");
  });
});

