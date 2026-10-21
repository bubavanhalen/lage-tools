import { describe, expect, it } from "vitest";
import {
  buildStacks, fanLayout, inWindow, mirrorBox, parseWindow, peekOffset, positionSource, relocatePatch, relocateSnapshot,
  windowLabel, windowStart, demoFeldSheet, type Box, type LageEvent, type StackItem,
} from "../src";

// Zeichen 20 × 20 px, Anker in der Mitte; Beschriftung rechts 44 px, Zeitlabel oben 14 px
const CORE: Box = [-10, -10, 10, 10];
const BOX: Box = [-12, -26, 56, 12];
const item = (x: number, y: number, prio = 0, over: Partial<StackItem> = {}): StackItem => ({ x, y, core: CORE, box: BOX, prio, ...over });
type R = readonly [number, number, number, number];
const rect = (x: number, y: number, b: Box): R => [x + b[0], y + b[1], x + b[2], y + b[3]];
const overlaps = (a: R, b: R) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

describe("Stapel (Zeichen übereinander)", () => {
  it("lässt getrennte Zeichen einzeln", () => {
    const s = buildStacks([item(0, 0), item(300, 0), item(0, 300)]);
    expect(s).toHaveLength(3);
    expect(s.every((x) => x.members.length === 1)).toBe(true);
  });

  it("stapelt Zeichen am selben Ort, oberstes = wichtigstes, Ort = Ort des obersten", () => {
    const s = buildStacks([item(100, 100, 1), item(102, 101, 5), item(99, 100, 3), item(101, 99, 0)]);
    expect(s).toHaveLength(1);
    expect(s[0]!.members).toEqual([1, 2, 0, 3]);
    expect([s[0]!.x, s[0]!.y]).toEqual([102, 101]);
  });

  it("knappe Berührung (≤ 3 px) bildet keinen Stapel", () => {
    expect(buildStacks([item(0, 0), item(18, 0)])).toHaveLength(2);
    expect(buildStacks([item(0, 0), item(14, 0)])).toHaveLength(1);
  });

  it("keine Kettenbildung über weite Strecken: jedes Zeichen bleibt nahe am obersten", () => {
    const items = Array.from({ length: 12 }, (_, i) => item(i * 12, 0, i === 0 ? 10 : 0));
    const s = buildStacks(items);
    for (const st of s) for (const m of st.members) expect(Math.abs(items[m]!.x - st.x)).toBeLessThanOrEqual(30);
    // angezeigte Stapel überlappen sich nicht mehr
    const shown = s.map((st) => rect(st.x, st.y, CORE));
    shown.forEach((a, i) => shown.forEach((b, j) => { if (j > i) expect(overlaps([a[0] + 2, a[1] + 2, a[2] - 2, a[3] - 2], b)).toBe(false); }));
  });

  it("Versatz: bis 3 Zeichen sichtbar nach rechts oben, weitere verdeckt", () => {
    expect(peekOffset(0)).toEqual([0, -0]);
    expect(peekOffset(2)).toEqual([8, -8]);
    expect(peekOffset(3)).toBeNull();
  });

  it("Beschriftung links, wenn rechts ein anderer Stapel liegt", () => {
    const s = buildStacks([item(0, 0, 1), item(40, 0)]);
    const left = s.find((x) => x.members[0] === 0)!;
    expect(left.side).toBe(-1);
    expect(buildStacks([item(0, 0)])[0]!.side).toBe(1);
  });

  it("leere Eingabe", () => {
    expect(buildStacks([])).toEqual([]);
  });
});

describe("Auffächern", () => {
  const check = (n: number) => {
    const boxes = Array.from({ length: n }, () => BOX);
    const f = fanLayout(boxes, boxes.map(() => CORE));
    const rs = f.map((p) => rect(p.dx, p.dy, p.side > 0 ? BOX : mirrorBox(BOX, CORE)));
    rs.forEach((a, i) => rs.forEach((b, j) => { if (j > i) expect(overlaps(a, b), `${n}: ${i}/${j}`).toBe(false); }));
    // Ort (Punkt) bleibt frei
    for (const r of rs) expect(overlaps(r, [-6, -6, 6, 6])).toBe(false);
    return f;
  };
  it("ohne Überdeckung für 2 bis 30 Zeichen", () => {
    for (const n of [2, 3, 5, 8, 9, 14, 30]) check(n);
  });
  it("erstes Zeichen oben, linke Hälfte links beschriftet", () => {
    const f = check(6);
    expect(f[0]!.dx).toBe(0);
    expect(f[0]!.dy).toBeLessThan(0);
    expect(f.some((p) => p.side < 0 && p.dx < 0)).toBe(true);
    expect(f.filter((p) => p.dx > 0).every((p) => p.side > 0)).toBe(true);
  });
  it("zweiter Ring bei vielen Zeichen", () => {
    const f = check(12);
    const r = f.map((p) => Math.hypot(p.dx, p.dy));
    expect(Math.max(...r.slice(8))).toBeGreaterThan(Math.max(...r.slice(0, 8)));
  });
  it("Radius mindestens so gross, dass das Zeichen den Punkt nicht verdeckt", () => {
    const f = fanLayout([CORE, CORE], [CORE, CORE]);
    expect(Math.hypot(f[0]!.dx, f[0]!.dy)).toBeGreaterThanOrEqual(20);
  });
});

describe("Zeitfenster", () => {
  it("Anfang je nach Art", () => {
    expect(windowStart({ mode: "alles" }, "2026-05-15T07:40")).toBeNull();
    expect(windowStart({ mode: "dauer", min: 30 }, "2026-05-15T07:40")).toBe("2026-05-15T07:10");
    expect(windowStart({ mode: "dauer", min: 120 }, "2026-05-15T01:00")).toBe("2026-05-14T23:00");
    expect(windowStart({ mode: "ab", t: "2026-05-15T06:00" }, "2026-05-15T07:40")).toBe("2026-05-15T06:00");
    // Anfang nach der Lagezeit → Fenster bis zur Lagezeit zurück, nie leer
    expect(windowStart({ mode: "ab", t: "2026-05-15T09:00" }, "2026-05-15T07:40")).toBe("2026-05-15T07:40");
  });
  it("inWindow und Beschriftung", () => {
    expect(inWindow("2026-05-15T07:10", "2026-05-15T07:10", "2026-05-15T07:40")).toBe(true);
    expect(inWindow("2026-05-15T07:09", "2026-05-15T07:10", "2026-05-15T07:40")).toBe(false);
    expect(inWindow("2026-05-15T07:41", null, "2026-05-15T07:40")).toBe(false);
    expect(windowLabel({ mode: "dauer", min: 30 })).toBe("30′");
    expect(windowLabel({ mode: "dauer", min: 120 })).toBe("2 h");
    expect(windowLabel({ mode: "ab", t: "2026-05-15T06:05" })).toBe("ab 06:05");
  });
  it("gespeicherten Wert prüfen", () => {
    expect(parseWindow(null)).toEqual({ mode: "alles" });
    expect(parseWindow({ mode: "dauer", min: 60 })).toEqual({ mode: "dauer", min: 60 });
    expect(parseWindow({ mode: "dauer", min: -5 })).toEqual({ mode: "alles" });
    expect(parseWindow({ mode: "ab", t: "2026-05-15T06:05:00" })).toEqual({ mode: "ab", t: "2026-05-15T06:05" });
    expect(parseWindow("unsinn")).toEqual({ mode: "alles" });
  });
});

describe("Ort korrigieren (Zeichen verschieben)", () => {
  const sh = demoFeldSheet();
  const ev = (over: Partial<LageEvent>): LageEvent => ({
    id: "a", rev: 1, device: "d", updatedAt: "2026-05-15T07:00:00Z", t: "2026-05-15T07:00", side: "rot", unit: "", text: "Sperre", sym: "sperre", aff: "H", confirmed: true, ...over,
  });
  it("setzt Ort, Herkunft Karte, Planquadrat neu und entfernt die Strassenlage", () => {
    const e = ev({ pos: { e: sh.origin.e + 10, n: sh.origin.n - 10 }, cells: ["X"], where: "AA1 · auf Hauptstrasse", angle: 30, road: "Hauptstrasse" });
    const p = relocatePatch(e, { e: sh.origin.e + sh.cellW * 2.75, n: sh.origin.n - sh.cellH * 1.25 }, [sh]);
    expect(p.where).toBe("Karte");
    expect(p.cells?.[0]).toMatch(/\S+ B$/);
    expect("angle" in p && p.angle === undefined).toBe(true);
    expect("road" in p && p.road === undefined).toBe(true);
    expect(p.pos).toEqual({ e: Math.round(sh.origin.e + sh.cellW * 2.75), n: Math.round(sh.origin.n - sh.cellH * 1.25) });
  });
  it("ausserhalb des Rasters ohne Planquadrat; NAI nur, wenn der Ort noch darin liegt", () => {
    const ring = [{ e: 0, n: 0 }, { e: 100, n: 0 }, { e: 100, n: 100 }, { e: 0, n: 100 }];
    const area = { id: "n", name: "NAI 1", kind: "nai" as const, ring };
    const e = ev({ pos: { e: 50, n: 50 }, nai: "NAI 1" });
    expect("nai" in relocatePatch(e, { e: 60, n: 60 }, [sh], [area])).toBe(false); // bleibt
    const out = relocatePatch(e, { e: 500, n: 60 }, [sh], [area]);
    expect("nai" in out && out.nai === undefined).toBe(true);
    expect(out.cells).toBeUndefined();
  });
  it("Form wird mitverschoben (automatisch und von Hand gezeichnet)", () => {
    const pts = [{ e: 0, n: 0 }, { e: 10, n: 0 }, { e: 10, n: 10 }];
    const a = relocatePatch(ev({ pos: { e: 5, n: 5 }, shape: { kind: "flaeche", pts, auto: true } }), { e: 105, n: 25 }, []);
    expect(a.shape?.pts[1]).toEqual({ e: 110, n: 20 });
    const m = relocatePatch(ev({ pos: { e: 5, n: 5 }, shape: { kind: "flaeche", pts } }), { e: 105, n: 25 }, []);
    expect(m.shape?.pts[2]).toEqual({ e: 110, n: 30 });
    expect(m.shape?.auto).toBeUndefined();
  });
  it("Rückgängig-Schnappschuss enthält alle verschobenen Felder", () => {
    const s = relocateSnapshot(ev({ pos: { e: 1, n: 2 }, where: "AA1", angle: 5 }));
    expect(s).toMatchObject({ pos: { e: 1, n: 2 }, where: "AA1", angle: 5 });
    expect(Object.keys(s)).toEqual(expect.arrayContaining(["pos", "where", "cells", "nai", "angle", "road", "shape"]));
  });
  it("Element: verschoben wird die Meldung, die den angezeigten Ort liefert", () => {
    const evs = [
      ev({ id: "1", t: "2026-05-15T06:00", side: "blau", unit: "H04", pos: { e: 1, n: 1 } }),
      ev({ id: "2", t: "2026-05-15T06:30", side: "blau", unit: "H04", pos: { e: 2, n: 2 } }),
      ev({ id: "3", t: "2026-05-15T06:45", side: "blau", unit: "H04" }),
      ev({ id: "4", t: "2026-05-15T07:30", side: "blau", unit: "H04", pos: { e: 3, n: 3 } }),
    ];
    expect(positionSource(evs, "blau", "h04", "2026-05-15T07:00", { e: 2, n: 2 })?.id).toBe("2");
    expect(positionSource(evs, "blau", "H04", "2026-05-15T08:00", { e: 3, n: 3 })?.id).toBe("4");
    expect(positionSource(evs, "blau", "H04", "2026-05-15T07:00")?.id).toBe("2");
  });
});
