import { describe, expect, it } from "vitest";
import {
  areaFromRing,
  autoShape,
  CATALOG,
  catalogEntry,
  demoFeldSheet,
  eventFromDraft,
  eventShape,
  geometryOf,
  lineLength,
  parseMeldung,
  relocatePatch,
  situationAt,
  shapeCenter,
  shapeShortName,
  translateShape,
  withAutoShape,
  type JournalContext,
  type LageEvent,
  type ShapeContext,
} from "../src";

// Fiktive Übung im Raum Bern (keine Übungsdaten)
const sheet = demoFeldSheet(); // Zeilen A–X, Spalten 1–30, 500 m, ab 2'592'000 / 1'206'000
const nai3 = areaFromRing("NAI 3", [
  { e: 2600000, n: 1200000 }, { e: 2601000, n: 1200000 }, { e: 2601000, n: 1199000 }, { e: 2600000, n: 1199000 },
]);
const sctx: ShapeContext = { sheets: [sheet], areas: [nai3] };
const jctx = (over: Partial<JournalContext> = {}): JournalContext => ({
  sheets: [sheet], areas: [nai3], units: { rot: ["Det 2"], blau: ["H04"], ul: [] },
  days: ["2030-05-14", "2030-05-15"], day: "2030-05-15", now: new Date(2030, 4, 15, 14, 7), ...over,
});
const ev = (text: string): LageEvent => eventFromDraft(parseMeldung(text, jctx()), "dev-test", new Date(2030, 4, 15, 14, 7));
const round = (p: { e: number; n: number }) => ({ e: Math.round(p.e), n: Math.round(p.n) });

describe("Katalog: Flächen- und Linienzeichen", () => {
  it("Geometrie und Darstellung gesetzt, Namen deutsch, Punktzeichen bleibt gültig", () => {
    const areas = CATALOG.filter((e) => e.geometry === "flaeche").map((e) => e.key);
    const lines = CATALOG.filter((e) => e.geometry === "linie").map((e) => e.key);
    for (const k of ["minensperre", "sammelraum", "sperrgebiet", "abc_gebiet", "beob_raum", "zielraum", "landezone", "evak_raum", "feuerraum"]) expect(areas, k).toContain(k);
    for (const k of ["stacheldraht", "sperrlinie", "panzergraben", "kontaktlinie", "phasenlinie", "grenze", "achse"]) expect(lines, k).toContain(k);
    expect(geometryOf("inf")).toBe("punkt");
    expect(geometryOf("gibtsnicht")).toBe("punkt");
    expect(catalogEntry("minensperre")!.style).toBe("minen");
    expect(catalogEntry("stacheldraht")!.style).toBe("draht");
    expect(catalogEntry("achse")!.style).toBe("achse");
    expect(shapeShortName("minensperre")).toBe("Minensperre");
    expect(shapeShortName("kontaktlinie")).toBe("Kontaktlinie");
  });
  it("Erkennung: Panzergraben, Landezone, Phasenlinie, Sperrgebiet", () => {
    expect(parseMeldung("H04 Panzergraben K12", jctx()).sym).toBe("panzergraben");
    expect(parseMeldung("H04 Panzersperre K12", jctx()).sym).toBe("panzersperre");
    expect(parseMeldung("H04 Landezone K12", jctx()).sym).toBe("landezone");
    expect(parseMeldung("H04 erreicht Phasenlinie K12", jctx()).sym).toBe("phasenlinie");
    expect(parseMeldung("Sperrgebiet K12", jctx()).sym).toBe("sperrgebiet");
    expect(parseMeldung("gn Kp Pz in Bereitstellung K12", jctx()).sym).toBe("pz");
  });
});

describe("Automatische Form", () => {
  it("Fläche im Planquadrat: Feld 4 % eingerückt, Punktzeichen im Schwerpunkt", () => {
    const e = ev("H04 Minenfeld K12");
    expect(e.sym).toBe("minensperre");
    const s = autoShape(e, sctx)!;
    expect(s.kind).toBe("flaeche");
    expect(s.auto).toBe(true);
    // K12: Zeile K (11.), Spalte 12 → 2'597'500–2'598'000 / 1'201'000–1'200'500; 4 % von 500 m = 20 m
    expect(s.pts.map(round)).toEqual([
      { e: 2597520, n: 1200980 }, { e: 2597980, n: 1200980 }, { e: 2597980, n: 1200520 }, { e: 2597520, n: 1200520 },
    ]);
    expect(round(shapeCenter(s))).toEqual({ e: 2597750, n: 1200750 });
    expect(round(shapeCenter(s))).toEqual(round(e.pos!));
  });
  it("Fläche im Unterquadranten und über mehrere Felder (Hülle)", () => {
    const q = autoShape(ev("Sperrgebiet K12 C"), sctx)!;
    // Quadrant C = unten rechts, 250 m, Einzug 10 m
    expect(q.pts.map(round)).toEqual([
      { e: 2597760, n: 1200740 }, { e: 2597990, n: 1200740 }, { e: 2597990, n: 1200510 }, { e: 2597760, n: 1200510 },
    ]);
    const two = autoShape(ev("Sperrgebiet K12 K13"), sctx)!;
    expect(two.kind).toBe("flaeche");
    expect(two.pts).toHaveLength(4);
    const es = two.pts.map((p) => p.e);
    expect(Math.min(...es)).toBeCloseTo(2597520);
    expect(Math.max(...es)).toBeCloseTo(2598480);
  });
  it("Fläche im NAI = NAI-Umriss; Koordinate = Kreis r 150 m", () => {
    const n = autoShape(ev("H04 Beobachtungsraum NAI 3"), sctx)!;
    expect(n.pts).toEqual(nai3.ring);
    const c = autoShape(ev("Landezone 2'598'000 / 1'201'000"), sctx)!;
    expect(c.kind).toBe("flaeche");
    expect(c.pts.length).toBeGreaterThanOrEqual(16);
    for (const p of c.pts) expect(Math.hypot(p.e - 2598000, p.n - 1201000)).toBeCloseTo(150);
  });
  it("Linie quer zur Strasse (60 m, Winkel aus der Strassenrichtung)", () => {
    const e = { ...ev("gn Stacheldraht K12"), pos: { e: 2597700, n: 1200700 }, angle: 0, where: "K12 · auf Seftigenstrasse" };
    const s = autoShape(e, sctx)!;
    expect(s.kind).toBe("linie");
    expect(lineLength(s.pts)).toBeCloseTo(60);
    // Strasse Nord–Süd → Linie West–Ost durch den Ort
    expect(s.pts.map(round)).toEqual([{ e: 2597670, n: 1200700 }, { e: 2597730, n: 1200700 }]);
    const diag = autoShape({ ...e, angle: 45 }, sctx)!;
    const [a, b] = diag.pts;
    expect(Math.round(Math.atan2(b!.e - a!.e, b!.n - a!.n) * 180 / Math.PI)).toBe(135);
  });
  it("Linie ohne Strasse: waagrecht über das Feld; mehrere Felder = durch die Feldmitten; mit Richtung", () => {
    const s = autoShape(ev("H04 Phasenlinie K12"), sctx)!;
    expect(s.pts.map(round)).toEqual([{ e: 2597520, n: 1200750 }, { e: 2597980, n: 1200750 }]);
    const ax = autoShape(ev("gn Achse K12 K14"), sctx)!;
    expect(ax.pts.map(round)).toEqual([{ e: 2597750, n: 1200750 }, { e: 2598750, n: 1200750 }]);
    const dir = autoShape(ev("gn Achse K12 Rtg N"), sctx)!;
    expect(dir.pts.map(round)).toEqual([{ e: 2597750, n: 1200520 }, { e: 2597750, n: 1200980 }]);
  });
  it("Punktzeichen und Meldungen ohne Ort: keine Form", () => {
    expect(autoShape(ev("1 gn Hz Inf K12"), sctx)).toBeUndefined();
    expect(autoShape({ sym: "minensperre" }, sctx)).toBeUndefined();
  });
});

describe("Gespeicherte Form, Rückwärtskompatibilität", () => {
  it("alte Meldung ohne `shape` bekommt die Form aus dem Ort; alte Punktmeldung bleibt Punkt", () => {
    const old: LageEvent = { id: "x1", rev: 1, device: "d", updatedAt: "2030-05-15T10:00:00Z", t: "2030-05-15T10:00", side: "rot", unit: "", text: "Minensperre K12",
      sym: "minensperre", aff: "H", pos: { e: 2597750, n: 1200750 }, cells: ["K12"], where: "K12", confirmed: true };
    expect(eventShape(old, sctx)?.kind).toBe("flaeche");
    expect(eventShape({ ...old, sym: "sperre" }, sctx)).toBeUndefined();
    // Felder des alten Rasters fehlen: Kreis um den Ort
    expect(eventShape(old, { sheets: [], areas: [] })?.pts.length).toBe(24);
  });
  it("von Hand gezeichnete Form wird nie überschrieben, automatische neu berechnet", () => {
    const manual = { kind: "flaeche" as const, pts: [{ e: 1, n: 1 }, { e: 2, n: 1 }, { e: 2, n: 2 }], auto: false };
    const e = { ...ev("H04 Minenfeld K12"), shape: manual };
    expect(eventShape(e, sctx)).toBe(manual);
    expect(withAutoShape(e, sctx).shape).toBe(manual);
    // automatische Form folgt dem Ort (z. B. nach Verschieben auf der Karte)
    const auto = withAutoShape(ev("H04 Minenfeld K12"), sctx);
    expect(auto.shape?.auto).toBe(true);
    const relocated = { ...auto, pos: { e: 2599000, n: 1199000 }, where: "N15", cells: ["N15"] };
    expect(round(shapeCenter(eventShape(relocated, sctx)!))).toEqual({ e: 2599250, n: 1199250 });
    // auf der Karte verschoben: ohne gespeicherte Form Kreis um den neuen Ort, sonst die mitverschobene Form
    const moved = { ...auto, shape: undefined, pos: { e: 2599000, n: 1199000 }, where: "Karte", cells: ["N15"] };
    const s = eventShape(moved, sctx)!;
    expect(s.pts.length).toBe(24);
    expect(round(shapeCenter(s))).toEqual({ e: 2599000, n: 1199000 });
    const dragged = { ...moved, ...relocatePatch(auto, { e: 2599000, n: 1199000 }, [sheet]) };
    expect(eventShape(dragged, sctx)!.pts).toHaveLength(4);
    expect(round(shapeCenter(eventShape(dragged, sctx)!))).toEqual({ e: 2599000, n: 1199000 });
    // Punktzeichen ohne Form bleibt ohne Form
    expect(withAutoShape(ev("1 gn Hz Inf K12"), sctx).shape).toBeUndefined();
  });
  it("Form verschieben, Mitte einer Linie", () => {
    const s = translateShape({ kind: "linie", pts: [{ e: 0, n: 0 }, { e: 100, n: 0 }, { e: 100, n: 100 }] }, { e: 0, n: 0 }, { e: 10, n: 5 });
    expect(s.pts[0]).toEqual({ e: 10, n: 5 });
    expect(shapeCenter(s)).toEqual({ e: 110, n: 5 });
  });
  it("Raum/Linie eines eigenen Melders verschiebt den Melder nicht", () => {
    const a = ev("1000 H04 Beo Stao K12");
    const b = { ...ev("1010 H04 Beobachtungsraum NAI 3"), id: "b" };
    const st = situationAt([a, b], "2030-05-15T11:00");
    expect(st.units.find((u) => u.unit === "H04")!.pos).toEqual(a.pos);
    expect(st.loose.some((l) => l.id === "b")).toBe(true);
  });
});

import { journalToCsv } from "../src";
describe("Export", () => {
  it("CSV: Spalte «Form» – gezeichnet mit Eckpunkten, sonst aus Ort", () => {
    const a = ev("H04 Minenfeld K12");
    const b = { ...ev("gn Stacheldraht K13"), id: "b", shape: { kind: "linie" as const, pts: [{ e: 2598000.4, n: 1200700 }, { e: 2598100, n: 1200700 }], auto: false } };
    const c = { ...ev("1 gn Hz Inf K14"), id: "c" };
    const rows = journalToCsv([a, b, c], ["2030-05-14", "2030-05-15"]).split("\r\n");
    expect(rows[0]!.endsWith(";Form")).toBe(true);
    expect(rows.some((r) => r.endsWith(";Fläche (aus Ort)"))).toBe(true);
    expect(rows.some((r) => r.endsWith(";Linie: 2598000 1200700, 2598100 1200700"))).toBe(true);
    expect(rows.some((r) => r.includes("Inf") && r.endsWith(";"))).toBe(true);
  });
});

describe("Ort des Punktzeichens", () => {
  it("Linie/Fläche über mehrere Felder: Punktzeichen in der Mitte der Form", () => {
    const d = parseMeldung("gn Achse K12 K14", jctx());
    expect(d.pos).toEqual({ e: 2598250, n: 1200750 });
    expect(d.where?.label).toBe("K12");
    const one = parseMeldung("gn Achse K12", jctx());
    expect(one.pos).toEqual({ e: 2597750, n: 1200750 });
    // Punktzeichen bleiben im ersten Feld
    expect(parseMeldung("1 gn Hz Inf K12 K14", jctx()).pos).toEqual({ e: 2597750, n: 1200750 });
  });
});
