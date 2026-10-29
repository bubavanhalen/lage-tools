// Ruhige Karte: Beschriftungs- und Deckkraftregel (Spez. MVP 1, Kap. 3.7) – reine Funktionen, fiktive Werte
import { describe, expect, it } from "vitest";
import { onlySelectedFilter, quietLook, quietShapeOpacity, QUIET } from "../src/map/quiet";

const basis = { quiet: true, zeiten: true };
const experte = { quiet: false, zeiten: true };

describe("Beschriftungsregel Grundansicht", () => {
  it("Feind/Unklar neu (≤ 30 min): kräftig mit Zeit und Zusatz", () => {
    for (const kind of ["feind", "unklar"] as const) {
      expect(quietLook({ kind, ageMin: 0, selected: false }, basis)).toEqual({ opacity: 1, showTime: true, showUd: true });
      expect(quietLook({ kind, ageMin: 30, selected: false }, basis)).toEqual({ opacity: 1, showTime: true, showUd: true });
    }
  });
  it("Feind/Unklar älter: 40 %, ohne Fähnchen und Zusatz", () => {
    for (const kind of ["feind", "unklar", "neutral", "ul"] as const) {
      expect(quietLook({ kind, ageMin: 31, selected: false }, basis)).toEqual({ opacity: QUIET.altDeckkraft, showTime: false, showUd: false });
    }
    expect(QUIET.altDeckkraft).toBe(0.55);
  });
  it("gewählt: immer kräftig und beschriftet", () => {
    expect(quietLook({ kind: "feind", ageMin: 300, selected: true }, basis)).toEqual({ opacity: 1, showTime: true, showUd: true });
  });
  it("eigene Trupps: Name immer, Zeit nur neu", () => {
    expect(quietLook({ kind: "eigen", ageMin: 200, selected: false }, basis)).toEqual({ opacity: 1, showTime: false, showUd: true });
    expect(quietLook({ kind: "eigen", ageMin: 5, selected: false }, basis)).toEqual({ opacity: 1, showTime: true, showUd: true });
  });
  it("Ebene «Uhrzeit an Zeichen» aus: nie ein Fähnchen", () => {
    expect(quietLook({ kind: "feind", ageMin: 1, selected: true }, { quiet: true, zeiten: false }).showTime).toBe(false);
  });
});

describe("Experte wie bisher", () => {
  it("ältere 45 %, Zusatz bleibt", () => {
    expect(quietLook({ kind: "feind", ageMin: 90, selected: false }, experte)).toEqual({ opacity: 0.45, showTime: false, showUd: true });
  });
  it("Flächen", () => {
    expect(quietShapeOpacity({ kind: "feind", ageMin: 90, selected: false }, { quiet: false })).toBe(0.55);
    expect(quietShapeOpacity({ kind: "feind", ageMin: 90, selected: false }, { quiet: true })).toBe(0.55);
    expect(quietShapeOpacity({ kind: "eigen", ageMin: 90, selected: false }, { quiet: true })).toBe(1);
    expect(quietShapeOpacity({ kind: "unklar", ageMin: 10, selected: false }, { quiet: true })).toBe(1);
  });
});

describe("nur Gewähltes (Hinweise, Möglichkeiten)", () => {
  const list = [{ id: "a" }, { id: "b" }];
  it("Grundansicht: nur das gewählte, ohne Wahl nichts", () => {
    expect(onlySelectedFilter(list, "b", true)).toEqual([{ id: "b" }]);
    expect(onlySelectedFilter(list, null, true)).toEqual([]);
  });
  it("Experte: alle", () => {
    expect(onlySelectedFilter(list, null, false)).toBe(list);
  });
});
