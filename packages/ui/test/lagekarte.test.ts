/**
 * Lagekarte drucken (Spez. MVP 3, Kap. 2.9/3.10, 3.5): Blatt A4/A3, Ausschnitt nie beschnitten, aufgehobene Zeichen
 * ab der Aufhebung weg (Rückblick davor zeigt sie), Kachel-Abdeckung ohne Cache = 0. Fiktive Daten Raum Bern.
 */
import { describe, expect, it, vi } from "vitest";
import { demoExercise, type LageEvent } from "@lage/core";

// @lage/map lädt Leaflet (braucht `window`) – für die Kachelrechnung genügen die Auflösungen
vi.mock("@lage/map", () => ({
  RESOLUTIONS: [4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250, 1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1],
}));
const { blattLayout, fitAspect, rasterBounds } = await import("../src/print/blatt");
const { ohneAufgehobene } = await import("../src/aufgehoben");
const { tileCoverage } = await import("../src/offline");

describe("Blatt der Lagekarte", () => {
  it("A4 quer: Legende als Band unten, A3 quer: Spalte rechts 60 mm", () => {
    const a4 = blattLayout("A4"), a3 = blattLayout("A3");
    expect([a4.pw, a4.ph]).toEqual([297, 210]);
    expect(a4.legend.band).toBe(true);
    expect(a4.legend.y).toBeGreaterThan(a4.field.y + a4.field.h);
    expect(a4.field.w).toBeGreaterThan(270);
    expect([a3.pw, a3.ph]).toEqual([420, 297]);
    expect(a3.legend.band).toBe(false);
    expect(a3.legend.w).toBe(60);
    expect(a3.legend.x).toBeGreaterThan(a3.field.x + a3.field.w);
  });
  it("Ausschnitt auf Papierverhältnis erweitert, nie beschnitten, Mitte bleibt", () => {
    const b = { minE: 2600000, maxE: 2601000, minN: 1200000, maxN: 1202000 };
    const f = fitAspect(b, 277 / 165);
    expect(f.minE).toBeLessThanOrEqual(b.minE);
    expect(f.maxE).toBeGreaterThanOrEqual(b.maxE);
    expect(f.minN).toBeLessThanOrEqual(b.minN);
    expect(f.maxN).toBeGreaterThanOrEqual(b.maxN);
    expect((f.maxE - f.minE) / (f.maxN - f.minN)).toBeCloseTo(277 / 165, 6);
    expect((f.minE + f.maxE) / 2).toBeCloseTo(2600500, 6);
  });
  it("ganzes Raster des Beispiels", () => {
    const ex = demoExercise();
    const r = rasterBounds(ex)!;
    expect(r.maxE - r.minE).toBe(ex.sheets[0]!.colLabels.length * ex.sheets[0]!.cellW);
  });
});

describe("Aufgehobene Zeichen (liftMap)", () => {
  const ex = demoExercise();
  const sperre = ex.events!.find((e) => /Sperre in AG13/.test(e.text))!;
  const lift: LageEvent = { ...sperre, id: "lift-1", t: "2030-05-15T07:40", text: "H04 Sperre AG13 aufgehoben", hebtAuf: sperre.id, pos: undefined, cells: undefined, sym: "einheit", unit: "" };
  const events = [...ex.events!, lift];
  it("ab der Aufhebung weg, im Rückblick davor noch da", () => {
    expect(ohneAufgehobene(events, "2030-05-15T07:45").some((e) => e.id === sperre.id)).toBe(false);
    expect(ohneAufgehobene(events, "2030-05-15T07:10").some((e) => e.id === sperre.id)).toBe(true);
  });
  it("gestrichene Aufhebung zählt nicht; ohne Aufhebung dieselbe Liste (Identität)", () => {
    const del = [...ex.events!, { ...lift, deleted: true }];
    expect(ohneAufgehobene(del, "2030-05-15T07:45").some((e) => e.id === sperre.id)).toBe(true);
    expect(ohneAufgehobene(ex.events!, "2030-05-15T07:45")).toBe(ex.events);
  });
});

describe("Abdeckung des Kachel-Caches", () => {
  it("ohne Cache-API: nichts vorhanden (nie still voll)", async () => {
    const c = await tileCoverage({ minE: 2598000, maxE: 2602000, minN: 1198000, maxN: 1201000 }, 20);
    expect(c.total).toBeGreaterThan(0);
    expect(c.cached).toBe(0);
    expect(c.share).toBe(0);
  });
});
