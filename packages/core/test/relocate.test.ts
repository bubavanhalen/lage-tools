import { describe, expect, it } from "vitest";
import {
  areaFromRing, demoFeldSheet, eventFromDraft, eventShape, parseMeldung, relocatePatch, shapeCenter,
  type JournalContext, type LageEvent, type ShapeContext,
} from "../src";

// Fiktive Übung im Raum Bern (keine Übungsdaten)
const sheet = demoFeldSheet();
const nai3 = areaFromRing("NAI 3", [
  { e: 2600000, n: 1200000 }, { e: 2601000, n: 1200000 }, { e: 2601000, n: 1199000 }, { e: 2600000, n: 1199000 },
]);
const sctx: ShapeContext = { sheets: [sheet], areas: [nai3] };
const jctx = (): JournalContext => ({
  sheets: [sheet], areas: [nai3], units: { rot: ["Det 1"], blau: ["H04"], ul: [] },
  days: ["2030-05-14", "2030-05-15"], day: "2030-05-15", now: new Date(2030, 4, 15, 14, 7),
});
const ev = (text: string): LageEvent => eventFromDraft(parseMeldung(text, jctx()), "dev-test", new Date(2030, 4, 15, 14, 7));
const round = (p: { e: number; n: number }) => ({ e: Math.round(p.e), n: Math.round(p.n) });
const moveBy = (e: LageEvent, de: number, dn: number): LageEvent => ({ ...e, ...relocatePatch(e, { e: e.pos!.e + de, n: e.pos!.n + dn }, [sheet], [nai3]) });

describe("Ort korrigieren: automatische Form bleibt erhalten (kein Kreis)", () => {
  it("Fläche aus Planquadrat: Rechteck wird mitverschoben, bleibt automatisch", () => {
    const e = ev("0730 H04 Minenfeld K12");
    expect(e.shape).toBeUndefined(); // gespeichert ohne Form – die automatische wird bei der Darstellung berechnet
    const before = eventShape(e, sctx)!;
    expect(before.pts).toHaveLength(4);
    const m = moveBy(e, 300, -200);
    expect(m.where).toBe("Karte");
    expect(m.shape?.auto).toBe(true);
    const after = eventShape(m, sctx)!;
    expect(after.pts).toHaveLength(4); // nicht 24 (Kreis)
    expect(round(after.pts[0]!)).toEqual(round({ e: before.pts[0]!.e + 300, n: before.pts[0]!.n - 200 }));
  });
  it("Mehrfeld-Achse bleibt Linie durch die (verschobenen) Feldmitten", () => {
    const e = ev("0731 H03 Det 1 Achse K12 M14 O16");
    expect(e.sym).toBe("achse");
    const before = eventShape(e, sctx)!;
    expect(before).toMatchObject({ kind: "linie" });
    expect(before.pts).toHaveLength(3);
    const m = moveBy(e, -500, 500);
    const after = eventShape(m, sctx)!;
    expect(after.kind).toBe("linie");
    expect(after.pts).toHaveLength(3);
    expect(round(shapeCenter(after))).toEqual(round({ e: shapeCenter(before).e - 500, n: shapeCenter(before).n + 500 }));
  });
  it("NAI-Fläche wird mitverschoben (NAI-Umriss statt Kreis)", () => {
    const e = ev("0732 H04 Beobachtungsraum NAI 3");
    const m = moveBy(e, 2000, 0);
    expect(m.nai).toBeUndefined(); // liegt nicht mehr im NAI
    expect(eventShape(m, sctx)!.pts).toHaveLength(4);
    expect(m.shape?.auto).toBe(true);
  });
  it("von Hand gezeichnete Form bleibt von Hand; Punktzeichen ohne Form bleibt ohne", () => {
    const hand = { ...ev("0733 H04 Minenfeld K12"), shape: { kind: "flaeche" as const, pts: [{ e: 2597000, n: 1200000 }, { e: 2597100, n: 1200000 }, { e: 2597100, n: 1199900 }] } };
    const m = moveBy(hand, 10, 10);
    expect(m.shape?.auto).toBeUndefined();
    expect(m.shape?.pts[0]).toEqual({ e: 2597010, n: 1200010 });
    expect(moveBy(ev("0734 H04 2 Fz K12"), 10, 10).shape).toBeUndefined();
  });
});
