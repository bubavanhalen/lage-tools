import { describe, expect, it } from "vitest";
import { areaFromRing, demoExercise, demoFeldSheet, matchScore, searchAll, searchKey, wantsPlaceLookup, type SearchContext } from "../src";

// Fiktive Beispielübung im Raum Bern (keine Übungsdaten)
const ex = demoExercise();
const ctx: SearchContext = { sheets: ex.sheets, areas: ex.areas, events: ex.events, units: ex.units, places: [{ name: "Wabern Bahnhof", pos: { e: 2600500, n: 1197500 } }], days: ex.days };
const feld = demoFeldSheet(); // Zeilen A–X, Spalten 1–30, 500 m, ab 2'592'000 / 1'206'000

describe("searchKey / matchScore", () => {
  it("vergleicht ohne Leerzeichen, Gross/Klein und führende Nullen", () => {
    expect(searchKey("H04")).toBe("h4");
    expect(searchKey("NAI 03")).toBe("nai3");
    expect(searchKey("Det. 2")).toBe("det2");
    expect(matchScore("h4", "H04")).toBe(100);
    expect(matchScore("nai", "NAI 2")).toBe(80);
    expect(matchScore("bahn", "Wabern Bahnhof")).toBe(70);
    expect(matchScore("x", "NAI 2")).toBe(0);
    expect(matchScore("H0", "H04")).toBe(80);
    expect(matchScore("h00", "H04")).toBe(0);
  });
});

describe("searchAll – Planquadrat", () => {
  it.each(["AK7 C", "ak7c", "AK 7 C", "ak7 (c)", "AK7 Charlie", "7AK C"])("«%s» → AK7 C (Unterquadrant)", (q) => {
    const h = searchAll(q, ctx)[0]!;
    expect(h.kind).toBe("pq");
    expect(h.label).toBe("AK7 C");
    expect(h.quadrant).toBe(true);
    const b = h.bounds!;
    expect(b.maxE - b.minE).toBe(250);
    expect(b.maxN - b.minN).toBe(250);
  });
  it("Feld ohne Unterquadrant füllt 500 m", () => {
    const h = searchAll("AK7", ctx)[0]!;
    expect(h.label).toBe("AK7");
    expect(h.quadrant).toBe(false);
    expect(h.bounds!.maxE - h.bounds!.minE).toBe(500);
    expect(h.detail).toContain("BERN");
  });
  it("Feld-Raster mit Zeile+Spalte und Buchstabiertafel", () => {
    const c: SearchContext = { sheets: [feld], areas: [] };
    const h = searchAll("G 19 Delta", c)[0]!;
    expect(h.label).toBe("G19 D");
    // G = 7. Zeile (Index 6), Spalte 19 (Index 18), D = unten links
    expect(h.bounds).toEqual({ minE: 2592000 + 18 * 500, maxE: 2592000 + 18 * 500 + 250, minN: 1206000 - 7 * 500, maxN: 1206000 - 7 * 500 + 250 });
    expect(searchAll("w18", c)[0]!.label).toBe("W18");
  });
  it("ungültiges Planquadrat ergibt keinen PQ-Treffer", () => {
    expect(searchAll("AZ7", ctx).some((h) => h.kind === "pq")).toBe(false);
    expect(searchAll("AK99", ctx).some((h) => h.kind === "pq")).toBe(false);
  });
});

describe("searchAll – Flächen, Elemente, Orte, Blatt", () => {
  it("NAI nach Name, auch kompakt", () => {
    const h = searchAll("nai2", ctx)[0]!;
    expect(h.kind).toBe("flaeche");
    expect(h.label).toBe("NAI 2");
    expect(h.badge).toBe("NAI");
    expect(h.ring).toHaveLength(4);
    expect(searchAll("NAI", ctx).filter((x) => x.kind === "flaeche").map((x) => x.label)).toEqual(["NAI 1", "NAI 2", "NAI 3"]);
    expect(searchAll("aare", ctx)[0]!.badge).toBe("AO");
  });
  it("eigenes Element: letzter Standort und letzte Meldung", () => {
    const h = searchAll("h1", ctx)[0]!;
    expect(h.kind).toBe("element");
    expect(h.label).toBe("H01");
    expect(h.badge).toBe("Eigene");
    const last = ex.events!.filter((e) => e.unit === "H01").at(-1)!;
    expect(h.eventId).toBe(last.id);
    expect(h.pos).toBeDefined();
    expect(h.detail).toMatch(/^zuletzt T2 \d\d:\d\d/);
  });
  it("Feindelement", () => {
    const h = searchAll("Det 2", ctx)[0]!;
    expect(h.kind).toBe("element");
    expect(h.badge).toBe("Feind");
    expect(h.side).toBe("rot");
    expect(searchAll("det", ctx).filter((x) => x.kind === "element").map((x) => x.label)).toEqual(["Det 1", "Det 2"]);
  });
  it("Element ohne Meldung wird gefunden, aber ohne Ort", () => {
    const h = searchAll("H09", { ...ctx, units: { ...ex.units, blau: [...ex.units.blau, "H09"] } })[0]!;
    expect(h.label).toBe("H09");
    expect(h.pos).toBeUndefined();
    expect(h.detail).toBe("noch keine Meldung");
  });
  it("bekannter Ort und Blatt", () => {
    const o = searchAll("wabern", ctx)[0]!;
    expect(o.kind).toBe("ort");
    expect(o.detail).toMatch(/^in A/);
    const b = searchAll("bern", ctx).find((x) => x.kind === "blatt")!;
    expect(b.label).toBe("BERN");
    expect(b.bounds!.maxE - b.bounds!.minE).toBe(21 * 500);
  });
});

describe("searchAll – Koordinaten", () => {
  it.each([
    ["2600000 1200000", 2600000, 1200000],
    ["2'600'000 / 1'200'000", 2600000, 1200000],
    ["600000 200000", 2600000, 1200000],
    ["600'000 / 200'000", 2600000, 1200000],
  ])("«%s»", (q, e, n) => {
    const h = searchAll(q as string, ctx)[0]!;
    expect(h.kind).toBe("koordinate");
    expect(h.pos).toEqual({ e, n });
    expect(h.detail).toContain("in A");
  });
  it("WGS84 und Link", () => {
    const w = searchAll("46.95108, 7.43864", ctx)[0]!;
    expect(w.kind).toBe("koordinate");
    expect(Math.abs(w.pos!.e - 2600000)).toBeLessThan(100);
    const l = searchAll("https://map.geo.admin.ch/?lang=de&E=2601000&N=1199000&zoom=8", ctx)[0]!;
    expect(l.pos).toEqual({ e: 2601000, n: 1199000 });
  });
  it("ausserhalb der Schweiz: kein Treffer", () => {
    expect(searchAll("3600000 1200000", ctx).some((h) => h.kind === "koordinate")).toBe(false);
  });
});

describe("Reihenfolge und Online-Suche", () => {
  it("exaktes Element vor gleichnamigem Planquadrat (Feld-Raster «H10»)", () => {
    const c: SearchContext = { sheets: [feld], areas: [], units: { blau: ["H10"], rot: [], ul: [] } };
    const r = searchAll("H10", c);
    expect(r[0]!.kind).toBe("element");
    expect(r[1]!.kind).toBe("pq");
  });
  it("leere Eingabe", () => {
    expect(searchAll("  ", ctx)).toEqual([]);
  });
  it("Ortsnamen online nachschlagen, PQ/Koordinate nicht", () => {
    expect(wantsPlaceLookup("Wabern", searchAll("Wabern", ctx))).toBe(true);
    expect(wantsPlaceLookup("AK7 C", searchAll("AK7 C", ctx))).toBe(false);
    expect(wantsPlaceLookup("2600000 1200000", searchAll("2600000 1200000", ctx))).toBe(false);
    expect(wantsPlaceLookup("H01", searchAll("H01", ctx))).toBe(false);
  });
  it("Flächen aus areaFromRing", () => {
    const a = areaFromRing("Stao Rot Nord", [{ e: 1, n: 1 }, { e: 2, n: 1 }, { e: 2, n: 2 }], "stao");
    expect(searchAll("stao", { sheets: [], areas: [a] })[0]!.badge).toBe("Stao");
  });
});
