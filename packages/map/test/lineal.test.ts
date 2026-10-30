// Raster-Lineal (Spez. MVP 3.5, B3): wann, welche Beschriftung, Ausdünnung, Blattwahl – fiktives Blatt BERN AA–AU × 1–15
import { describe, expect, it } from "vitest";
import { linealBild, linealBlattWahl, linealSchritt, type LinealBlatt } from "../src/lineal";

const COLS = "AA AB AC AD AE AF AG AH AI AJ AK AL AM AN AO AP AQ AR AS AT AU".split(" ");
const ROWS = Array.from({ length: 15 }, (_, i) => String(i + 1));
const blatt = (x0: number, y0: number, c: number): LinealBlatt => ({ cols: COLS, rows: ROWS, x0, y0, cw: c, ch: c });

describe("linealBild", () => {
  it("Blattrand im Bild (Einpassen): kein Lineal", () => {
    const b = linealBild(blatt(60, 60, 35), 1000, 800);
    expect(b.oben).toBeNull();
    expect(b.links).toBeNull();
  });
  it("hineingezoomt auf AK9 (Ränder ausserhalb): oben «AK» über der Spalte AK, links «9» neben der Zeile 9", () => {
    // Feld 100 px; AK = Spalte 10, Zeile 9 = Index 8; AK9 in der Bildmitte (500/400)
    const x0 = 500 - 10.5 * 100, y0 = 400 - 8.5 * 100;
    const b = linealBild(blatt(x0, y0, 100), 1000, 800);
    const ak = b.oben!.eintraege.find((e) => e.text === "AK")!;
    expect(ak.pos).toBeCloseTo(500, 5);
    const neun = b.links!.eintraege.find((e) => e.text === "9")!;
    expect(neun.pos).toBeCloseTo(400, 5);
    // keine Beschriftung unter dem linken Band
    expect(b.oben!.eintraege.every((e) => e.pos >= 22)).toBe(true);
  });
  it("nur der obere Rand fehlt: nur das obere Band", () => {
    const b = linealBild(blatt(80, -200, 60), 1400, 900);
    expect(b.oben).not.toBeNull();
    expect(b.links).toBeNull();
    expect(b.oben!.von).toBe(80);
  });
  it("Ausdünnung: < 18 px jede 2., < 9 px jede 5. Beschriftung", () => {
    expect([30, 17.9, 9, 8.9].map(linealSchritt)).toEqual([1, 2, 2, 5]);
    const b = linealBild(blatt(-100, -100, 12), 600, 400);
    const t = b.oben!.eintraege.map((e) => e.text);
    expect(t.includes("AA")).toBe(false); // AA liegt unter dem linken Band bzw. ausserhalb
    expect(t.every((x) => COLS.indexOf(x) % 2 === 0)).toBe(true);
  });
  it("Blatt nicht im Bild: nichts", () => {
    const b = linealBild(blatt(2000, 2000, 50), 1000, 800);
    expect(b.oben).toBeNull();
    expect(b.links).toBeNull();
  });
});

describe("linealBlattWahl", () => {
  it("Blatt unter der Bildmitte, sonst grösste sichtbare Fläche", () => {
    const a = blatt(-3000, -3000, 100), b = blatt(-600, -600, 100);
    expect(linealBlattWahl([a, b], 1000, 800)).toBe(1);
    expect(linealBlattWahl([blatt(900, 700, 50), blatt(-2000, 500, 100)], 1000, 800)).toBe(1);
    expect(linealBlattWahl([], 1000, 800)).toBe(-1);
  });
});
