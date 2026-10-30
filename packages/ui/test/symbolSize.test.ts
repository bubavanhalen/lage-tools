// Zeichengrösse V4 (Spez. MVP 3.5, K3, Kap. 3.2.1 und 8.2) – Tabelle, Stufen, Präsentation, Klassenwechsel
import { describe, expect, it } from "vitest";
import { ZEICHEN } from "@lage/core";
import { beschriftungPx, mPerPxOf, symbolGrundmass, symbolKlasse, ZEICHEN_STRICH } from "../src/map/symbolSize";

const G = (stufe: "S" | "M" | "L", praesentation = false) => ({ stufe, praesentation });
const MASSSTAB = [20, 12, 7, 3];

describe("symbolGrundmass – Tabelle 3.2.1", () => {
  it("Stufe M: 24 / 26 / 28 / 32", () => {
    expect(MASSSTAB.map((m) => symbolGrundmass(m, G("M")))).toEqual([24, 26, 28, 32]);
  });
  it("Stufe S −4, L +8", () => {
    expect(MASSSTAB.map((m) => symbolGrundmass(m, G("S")))).toEqual([20, 22, 24, 28]);
    expect(MASSSTAB.map((m) => symbolGrundmass(m, G("L")))).toEqual([32, 34, 36, 40]);
  });
  it("Präsentation +14 statt der Stufe (38/40/42/46), gleich für S, M, L", () => {
    for (const s of ["S", "M", "L"] as const) expect(MASSSTAB.map((m) => symbolGrundmass(m, G(s, true)))).toEqual([38, 40, 42, 46]);
  });
  it("Akzeptanz Symbolstudie: Einpassen (≈ 14 m/px) ≥ 26, 5 m/px ≥ 32, herausgezoomt nie < 24, Präsentation ≥ 40 bei 10 m/px", () => {
    expect(symbolGrundmass(14, G("M"))).toBeGreaterThanOrEqual(26);
    expect(symbolGrundmass(4.99, G("M"))).toBeGreaterThanOrEqual(32);
    for (const m of [16, 50, 250, 1000]) expect(symbolGrundmass(m, G("M"))).toBeGreaterThanOrEqual(24);
    expect(symbolGrundmass(10, G("M", true))).toBeGreaterThanOrEqual(40);
  });
  it("gewählt +6 (Aufrufer), Linie/Halo 7/8 → bei 26 px 1.8 / 2.1 px", () => {
    expect(ZEICHEN.gewaehlt).toBe(6);
    expect(ZEICHEN_STRICH).toEqual({ strokeWidth: 7, outlineWidth: 8 });
    expect((ZEICHEN_STRICH.strokeWidth * 26) / 100).toBeCloseTo(1.82, 2);
    expect((ZEICHEN_STRICH.outlineWidth * 26) / 100).toBeGreaterThanOrEqual(2);
  });
});

describe("symbolKlasse – wechselt genau an 15 / 10 / 5 m/px", () => {
  it("Grenzen", () => {
    expect([15.01, 15, 10.01, 10, 5.01, 5, 4.99, 0.1].map(symbolKlasse)).toEqual([0, 1, 1, 2, 2, 3, 3, 3]);
  });
  it("innerhalb einer Klasse gleiche Grösse (kein Neuaufbau)", () => {
    expect(symbolGrundmass(14.9, G("M"))).toBe(symbolGrundmass(10.1, G("M")));
    expect(symbolKlasse(14.9)).toBe(symbolKlasse(10.1));
  });
});

describe("Beschriftung und Massstab", () => {
  it("12 px, Präsentation 16 px", () => {
    expect(beschriftungPx(G("M"))).toBe(12);
    expect(beschriftungPx(G("L"))).toBe(12);
    expect(beschriftungPx(G("M", true))).toBe(16);
    expect(beschriftungPx(undefined)).toBe(12);
  });
  it("m/px aus dem Massstab der Karte (1 / scale)", () => {
    expect(mPerPxOf({ getZoom: () => 20, options: { crs: { scale: () => 0.1 } } })).toBe(10);
  });
});
