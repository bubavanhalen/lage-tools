// Treffen auf der Karte (Spez. MVP 3.5, S12, B4) – Radius, verdeckte Zeichen, Stapel, Reihenfolge (fiktive Punkte)
import { describe, expect, it } from "vitest";
import { pickAktion, pickAt, trefferRadius, type PickZiel } from "../src/map/pick";

const z = (id: string, x: number, y: number, o: Partial<PickZiel> = {}): PickZiel => ({ id, x, y, stapel: -1, oben: true, ...o });

describe("Trefferradius", () => {
  it("Finger 24 px (48 px Fläche), Maus 16 px", () => {
    expect(trefferRadius(true)).toBe(24);
    expect(trefferRadius(false)).toBe(16);
  });
});

describe("pickAt", () => {
  it("20 px neben einem Zeichen trifft mit dem Finger, nicht mit der Maus", () => {
    const ziele = [z("a", 100, 100)];
    expect(pickAt({ x: 120, y: 100 }, trefferRadius(true), ziele).map((h) => h.id)).toEqual(["a"]);
    expect(pickAt({ x: 120, y: 100 }, trefferRadius(false), ziele)).toEqual([]);
  });
  it("nach Abstand sortiert, mit Abstand", () => {
    const h = pickAt({ x: 100, y: 100 }, 24, [z("fern", 120, 100), z("nah", 95, 100)]);
    expect(h.map((x) => x.id)).toEqual(["nah", "fern"]);
    expect(h[0]!.dist).toBe(5);
  });
  it("verdeckte und nicht oberste Zeichen zählen nicht; geschlossener Stapel zählt einmal", () => {
    const ziele = [
      z("oben", 100, 100, { stapel: 0, oben: true }),
      z("unten", 104, 96, { stapel: 0, oben: false }),
      z("weg", 101, 101, { verdeckt: true }),
      z("nachbar", 118, 104),
    ];
    expect(pickAt({ x: 108, y: 102 }, 24, ziele).map((h) => h.id)).toEqual(["oben", "nachbar"]);
  });
  it("leer, wählen, Liste", () => {
    expect(pickAktion(0)).toBe("leer");
    expect(pickAktion(1)).toBe("waehlen");
    expect(pickAktion(2)).toBe("liste");
  });
});
