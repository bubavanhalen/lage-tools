/**
 * Paket B (Spez. MVP 1, Kap. 3.2–3.4): Filter der einen Suche, Trupp-Chip als Text, Korrektur-Änderung, Vorschlagstexte.
 * Fiktive Daten: Beispiel Bern.
 */
import { describe, expect, it } from "vitest";
import { demoExercise, parseMeldung, type LageEvent } from "@lage/core";
import { buildEvent, correctionPatch, journalCtx } from "../src/commit";
import { filterJournal, matchesQuery, takeKeyword } from "../src/journal/filter";
import { deletedLabel } from "../src/journal/actions";
import { truppOrder, withTrupp } from "../src/entry/trupp";
import { hitText } from "../src/journal/hitText";
import { reparseEdit } from "../src/editReparseCore";

const ex = demoExercise();
const evs = ex.events!;
const e0720 = evs.find((e) => e.t.endsWith("07:20") && e.text.includes("NAI 2"))!;

describe("Suche: Stichwörter und Text (Kap. 3.4)", () => {
  it("Stichwörter werden zum Filter «Art»", () => {
    expect(takeKeyword("feind AK7")).toEqual({ q: "AK7", art: "feind" });
    expect(takeKeyword("nur 1 Trupp")).toEqual({ q: "", art: "einzeln" });
    expect(takeKeyword("eigene")).toEqual({ q: "", art: "eigen" });
    expect(takeKeyword("Unklar")).toEqual({ q: "", art: "unklar" });
    // am Ende ohne Leerzeichen noch offen (Benutzer tippt vielleicht «feindl…»)
    expect(takeKeyword("feind", false)).toEqual({ q: "feind", art: null });
    expect(takeKeyword("feindlich")).toEqual({ q: "feindlich", art: null });
  });
  it("Text: Trupp, Planquadrat genau, NAI mit Nummer", () => {
    expect(matchesQuery(e0720, "H03")).toBe(true);
    expect(matchesQuery(e0720, "nai 2")).toBe(true);
    expect(matchesQuery(e0720, "NAI 3")).toBe(false);
    const ak9 = evs.find((e) => e.cells?.includes("AK9"))!;
    expect(matchesQuery(ak9, "AK9")).toBe(true);
    expect(matchesQuery(ak9, "AK")).toBe(true); // beim Tippen schon passend
    expect(matchesQuery(ak9, "AK1")).toBe(false); // Planquadrat genau
  });
  it("filterJournal: ohne Gelöschte, Lagezeit, Art, neueste zuerst", () => {
    const list = filterJournal([...evs, { ...e0720, id: "weg", deleted: true }], { to: "2030-05-15T07:15" });
    expect(list.some((e) => e.id === "weg")).toBe(false);
    expect(list.every((e) => e.t <= "2030-05-15T07:15")).toBe(true);
    expect(list[0]!.t >= list[list.length - 1]!.t).toBe(true);
    const own = filterJournal(evs, { art: "eigen" });
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((e) => e.side === "blau")).toBe(true);
    expect(filterJournal(evs, { q: "H07" })).toHaveLength(0);
  });
  it("Leiste beim Löschen", () => {
    expect(deletedLabel(e0720)).toBe("Meldung 07:20 H03 gelöscht");
  });
  it("Vorschlag Trupp ohne Hover lesbar: «H03 – zuletzt 07:20 gemeldet · Standort …»", () => {
    const h = { kind: "element" as const, label: "H03", badge: "Eigene", detail: "zuletzt T1 18:45 · AP4 D", side: "blau" as const };
    expect(hitText(h, "T2", { t: "2030-05-15T07:20", day: "T2" })).toBe("H03 – zuletzt 07:20 gemeldet · Standort AP4 D (T1 18:45)");
    expect(hitText({ kind: "pq", label: "AK7", badge: "PQ", detail: "Blatt BERN" }, "T2")).toBe("AK7 – Planquadrat · Blatt BERN");
    expect(hitText(h, "T2")).toBe("H03 – zuletzt T1 18:45 · AP4 D");
  });
});

describe("Meldungsfeld: Trupp-Chip setzt Text (Kap. 3.2)", () => {
  it("an den Anfang, ersetzt einen erkannten Trupp, nach führender Zeit", () => {
    expect(withTrupp("", "H04")).toBe("H04 ");
    expect(withTrupp("3 Pers bei AJ7", "H02")).toBe("H02 3 Pers bei AJ7");
    expect(withTrupp("H01 3 Pers bei AJ7", "H02", "H01")).toBe("H02 3 Pers bei AJ7");
    expect(withTrupp("1015 3 Pers AJ7", "H02")).toBe("1015 H02 3 Pers AJ7");
  });
  it("Reihenfolge: zuletzt meldend zuerst", () => {
    const o = truppOrder(ex);
    expect(o[0]).toBe("H05"); // 07:25
    expect(o).toHaveLength(5);
  });
});

describe("Korrektur: nur echte Änderungen (Kap. 3.3)", () => {
  const cand = (text: string): LageEvent => {
    const d = reparseEdit(e0720, text, ex)!;
    return buildEvent(d, "dev-b", ex);
  };
  it("neuer Ort aus dem Text: NAI weg, AK9 neu; Zeit bleibt", () => {
    const p = correctionPatch(e0720, cand("H03 1 Fz in AK9 Rtg N"), { keepPlace: false, keepSymbol: false, keepTime: true });
    expect(p.where).toBe("AK9");
    expect(p.cells).toEqual(["AK9"]);
    expect("nai" in p && p.nai === undefined).toBe(true);
    expect(p.t).toBeUndefined();
    expect(p.text).toBe("H03 1 Fz in AK9 Rtg N");
  });
  it("Ort bleibt, wenn der Text keinen nennt (keepPlace)", () => {
    const p = correctionPatch(e0720, cand("H03 2 Fz Rtg N"), { keepPlace: true, keepSymbol: false, keepTime: true });
    expect(p.where).toBeUndefined();
    expect(p.pos).toBeUndefined();
    expect(p.count).toBe(2);
  });
  it("gleicher Text: keine Änderung", () => {
    expect(correctionPatch(e0720, cand(e0720.text), { keepPlace: true, keepSymbol: true, keepTime: true })).toEqual({});
  });
  it("Zeit im Text: neue Zeit (Tag der Meldung)", () => {
    const p = correctionPatch(e0720, cand("0715 H03 1 Fz in NAI 2 Rtg N"), { keepPlace: false, keepSymbol: false, keepTime: false });
    expect(p.t).toBe("2030-05-15T07:15");
  });
  it("Korrekturtext mit ungültiger Zeit hat ein Problem (sperrt)", () => {
    expect(reparseEdit(e0720, "1370 H03 1 Fz in NAI 2", ex)!.problems?.some((x) => x.kind === "zeit")).toBe(true);
  });
  it("journalCtx bleibt nutzbar", () => {
    expect(parseMeldung("H04 2 Fz in AK7", journalCtx(ex, "2030-05-15")).cells).toEqual(["AK7"]);
  });
});
