import { describe, expect, it } from "vitest";
import { declutter, mirrorBox, type Box, type DeclutterItem } from "../src";

// Zeichen 20 × 20 px, Anker in der Mitte; Beschriftung rechts 44 px, Zeitlabel oben 14 px
const CORE: Box = [-10, -10, 10, 10];
const BOX: Box = [-12, -26, 56, 12];
const item = (x: number, y: number, over: Partial<DeclutterItem> = {}): DeclutterItem => ({ x, y, core: CORE, box: BOX, ...over });

const rect = (x: number, y: number, b: Box) => [x + b[0], y + b[1], x + b[2], y + b[3]] as const;
const overlaps = (a: readonly number[], b: readonly number[]) => a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;

describe("Kollisionsauflösung (Zeichen auffächern)", () => {
  it("lässt einzelne und weit entfernte Zeichen am Ort", () => {
    const r = declutter([item(0, 0), item(300, 0), item(0, 300)]);
    expect(r.every((p) => !p.moved && p.group === -1)).toBe(true);
    expect(r.map((p) => [p.x, p.y])).toEqual([[0, 0], [300, 0], [0, 300]]);
  });

  it("fächert Zeichen am selben Ort links und rechts in Spalten auf, Kern bleibt", () => {
    const r = declutter([item(100, 100), item(100, 100), item(100, 100), item(100, 100), item(100, 100)]);
    const still = r.filter((p) => !p.moved);
    expect(still).toHaveLength(1);
    expect(still[0]).toMatchObject({ x: 100, y: 100 });
    const left = r.filter((p) => p.moved && p.side === -1);
    const right = r.filter((p) => p.moved && p.side === 1);
    expect(left.length).toBe(2);
    expect(right.length).toBe(2);
    // alle in einer Ballung
    expect(new Set(r.map((p) => p.group)).size).toBe(1);
    // links stehende Zeichen liegen links vom Kern, rechts stehende rechts
    left.forEach((p) => expect(p.x).toBeLessThan(100));
    right.forEach((p) => expect(p.x).toBeGreaterThan(100));
    // Spalten sind sauber übereinander (gleiche x) und überlappen sich nicht
    expect(new Set(left.map((p) => p.x)).size).toBe(1);
    const boxes = r.map((p, i) => rect(p.x, p.y, p.side < 0 ? mirrorBox(BOX, CORE) : BOX)).map((b, i) => ({ b, i }));
    for (const a of boxes) for (const b of boxes) if (a.i < b.i) expect(overlaps(a.b, b.b)).toBe(false);
  });

  it("gewählte Meldung (pinned) bleibt in der Ballung am Ort", () => {
    const r = declutter([item(50, 50), item(50, 50), item(50, 50, { pinned: true })]);
    expect(r[2]).toMatchObject({ x: 50, y: 50, moved: false });
    expect(r[0]!.moved && r[1]!.moved).toBe(true);
  });

  it("schwache Überdeckung ergibt keine Ballung", () => {
    // 20 × 20 Zeichen um 15 px versetzt → Überdeckung 5 × 20 = 25 % < 40 %
    const r = declutter([item(0, 0), item(15, 0)]);
    expect(r.every((p) => !p.moved)).toBe(true);
  });

  it("Spalten zweier benachbarter Ballungen überlappen sich nicht", () => {
    const items = [item(0, 0), item(0, 0), item(0, 0), item(140, 0), item(140, 0), item(140, 0)];
    const r = declutter(items);
    const rects = r.map((p) => rect(p.x, p.y, p.side < 0 ? mirrorBox(BOX, CORE) : BOX));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i]!, rects[j]!), `${i}/${j}`).toBe(false);
  });

  it("Beschriftung wechselt nach links, wenn rechts ein Nachbar steht", () => {
    const r = declutter([item(0, 0), item(40, 0)]);
    expect(r[0]!.side).toBe(-1);
    expect(r[0]!.moved).toBe(false);
  });

  it("verträgt leere und einzelne Listen", () => {
    expect(declutter([])).toEqual([]);
    expect(declutter([item(1, 2)])).toEqual([{ x: 1, y: 2, moved: false, side: 1, group: -1 }]);
  });

  it("ist schnell genug für 300 Zeichen", () => {
    const many = Array.from({ length: 300 }, (_, i) => item((i % 20) * 30, Math.floor(i / 20) * 30));
    const t0 = performance.now();
    const r = declutter(many);
    expect(r).toHaveLength(300);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
