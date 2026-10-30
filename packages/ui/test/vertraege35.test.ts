/**
 * Verträge MVP 3.5 in der Oberfläche (Spez. MVP 3.5, Kap. 5.7), Phase 0: fertig sind `kuerzelNorm`/`kuerzelHinweis`
 * (eine Regel für Kürzel und Visum) und `betrieb/dateiSichern.ts`; Zeichengrösse nach der Tabelle 3.2.1 (Paket B
 * erweitert in `symbolSize.test.ts`). Nur fiktive Kürzel (BSP, MU, ZZ).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** einfacher localStorage für Node */
function speicher(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } };
}
beforeEach(() => { vi.stubGlobal("localStorage", speicher()); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Kürzel und Visum: eine Regel (S24)", () => {
  it("kuerzelNorm", async () => {
    const { kuerzelNorm } = await import("../src/shell/contracts");
    expect(kuerzelNorm("Wm M")).toBe("WMM");
    expect(kuerzelNorm("Wm K")).toBe("WMK");
    expect(kuerzelNorm("m.u.")).toBe("MU");
    expect(kuerzelNorm("Mü")).toBe("MUE");
    expect(kuerzelNorm("Wm Keller")).toBeNull();
    expect(kuerzelNorm("Z")).toBeNull();
    expect(kuerzelNorm("ZZ")).toBe("ZZ");
    expect(kuerzelNorm("é1")).toBeNull();
  });
  it("kuerzelHinweis: sichtbarer Grund statt still", async () => {
    const { kuerzelHinweis } = await import("../src/shell/contracts");
    expect(kuerzelHinweis("BSP")).toBeNull();
    expect(kuerzelHinweis("Wm Keller")).toBe("2–6 Zeichen: Buchstaben A–Z und Ziffern");
    expect(kuerzelHinweis("")).toBe("2–6 Zeichen: Buchstaben A–Z und Ziffern");
  });
});

describe("Datei sichern (S9, betrieb/dateiSichern.ts)", () => {
  it("merken, lesen, erinnern nach 120 min", async () => {
    const d = await import("../src/betrieb/dateiSichern");
    expect(d.dateiGesichertAm("ex1")).toBeNull();
    expect(d.dateiErinnern("ex1")).toBe(true);
    const at = new Date("2030-05-15T05:31:00Z");
    d.markDateiGesichert("ex1", at);
    expect(d.dateiGesichertAm("ex1")).toBe("2030-05-15T05:31:00.000Z");
    expect(d.dateiGesichertAm("ex2")).toBeNull();
    expect(d.dateiErinnern("ex1", new Date(at.getTime() + 120 * 60000))).toBe(false);
    expect(d.dateiErinnern("ex1", new Date(at.getTime() + 121 * 60000))).toBe(true);
  });
  it("Text fürs Menü", async () => {
    const d = await import("../src/betrieb/dateiSichern");
    expect(d.dateiText(null)).toBe("nie gesichert");
    const am = new Date(2030, 4, 15, 7, 31);
    expect(d.dateiText(am.toISOString(), new Date(2030, 4, 15, 9, 0))).toBe("zuletzt 07:31");
    expect(d.dateiText(am.toISOString(), new Date(2030, 4, 16, 9, 0))).toBe("zuletzt 15.05. 07:31");
  });
});

describe("Zeichengrösse V4 (K3, Tabelle 3.2.1)", () => {
  it("Grundmass je m/px und Stufe, Präsentation statt Stufe, Klassenwechsel an 15/10/5", async () => {
    const { symbolGrundmass, symbolKlasse } = await import("../src/map/symbolSize");
    const M = { stufe: "M", praesentation: false } as const;
    expect([20, 12, 7, 3].map((m) => symbolGrundmass(m, M))).toEqual([24, 26, 28, 32]);
    expect([20, 12, 7, 3].map((m) => symbolGrundmass(m, { stufe: "S", praesentation: false }))).toEqual([20, 22, 24, 28]);
    expect([20, 12, 7, 3].map((m) => symbolGrundmass(m, { stufe: "L", praesentation: false }))).toEqual([32, 34, 36, 40]);
    expect([20, 12, 7, 3].map((m) => symbolGrundmass(m, { stufe: "L", praesentation: true }))).toEqual([38, 40, 42, 46]);
    expect([15.01, 15, 10.01, 10, 5.01, 5].map(symbolKlasse)).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe("Schlüssel (Testhaken, nur lesen)", () => {
  it("pro Gerät bzw. Übung", async () => {
    const c = await import("../src/shell/contracts");
    expect(c.WAKE_KEY).toBe("lage-tools.wachbleiben");
    expect(c.ZEICHEN_KEY).toBe("lage-tools.zeichengroesse");
    expect(c.SCHUTZHINWEIS_KEY("x")).toBe("lage-tools.schutzhinweis.x");
    expect(c.PERF_MARK.zeichen).toBe("lt:zeichen");
  });
});
