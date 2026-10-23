import { describe, expect, it } from "vitest";
import { demoExercise, parseStrength, type Hint, type RedCoa } from "@lage/core";
import {
  coaEventIds, coaHintIds, coaPlaces, countLabel, durLabel, expectedLabel, foundLabel, indCounts, inWindowLabel, qtyLabel,
  shownIndicators, specChip, windowLabel, type LageRotState,
} from "../src/lageRot";
import { lageRotCsv } from "../src/lageRotExport";
import { journalPdf } from "../src/journalpdf";

/** fiktive Lage Rot zur Beispielübung (Raum Bern) – unabhängig von den Regeln im Kern */
function fixture() {
  const ex = demoExercise();
  ex.feindannahme = "2 Det, 14 Pers, 5 Fz, 1 Drohne";
  const ev = (ex.events ?? []).filter((e) => e.side === "rot");
  const hint: Hint = { id: "t-D1-H05", rule: "D1", level: "hoch", title: "Stao H05 möglicherweise aufgeklärt", text: "Drohne", events: [ev[0]!.id], t: ev[0]!.t };
  const coa: RedCoa = {
    id: "ueberfall:H05", kind: "ueberfall", label: "wahrscheinlichste", title: "Überfall auf Stao H05 (AQ11)",
    target: { pos: { e: 2602000, n: 1197500 }, unit: "H05", cell: "AQ11" }, approach: [{ e: 2601500, n: 1197800 }, { e: 2602000, n: 1197500 }],
    approachText: "aus AP10", window: { from: "2030-05-15T07:40", to: "2030-05-15T08:30" },
    indicators: [
      { text: "Drohne über H05 (D1)", met: true, hintId: hint.id },
      { text: "Linie AK10 (C6)", met: true, events: [ev[1]!.id] },
      { text: "Annäherung noch nicht gemeldet", met: false },
      { text: "Rot entfernt sich von H05", met: true, against: true, events: [ev[4]!.id] },
      { text: "Rot zieht ab (nicht zutreffend)", met: false, against: true },
    ],
    score: 0.7, danger: 0.8, check: ["Stellungswechsel H05", "Reserve bereit"], events: [ev[2]!.id],
  };
  const lage: LageRotState = {
    coas: [coa],
    more: [],
    force: {
      rows: [
        { key: "elemente:det", name: "Elemente", abbr: "Det", min: 2, max: 2, names: ["Det 1", "Det 2"], events: [] },
        { key: "pers", name: "Personen", abbr: "Pers", min: 11, max: 17, events: [], inWindow: { min: 4, max: 6 } },
      ],
      notSeen: [{ unit: "Det 2", since: "2030-05-15T03:10", minutes: 255, event: ev[3]!.id }],
    },
    spec: { rows: [{ key: "elemente:det", name: "Elemente", abbr: "Det", count: 2 }, { key: "pers", name: "Personen", abbr: "Pers", count: 14 }], unknown: [] },
    compare: [],
    from: null,
    hints: [hint],
  };
  lage.compare = [
    { row: lage.force.rows[0]!, found: lage.force.rows[0], expected: 2, state: "vollstaendig", ratio: 1 },
    { row: lage.force.rows[1]!, found: lage.force.rows[1], expected: 14, state: "teilweise", ratio: 11 / 14 },
  ];
  return { ex, hint, coa, lage, ev };
}

describe("Lage Rot: Beschriftungen", () => {
  it("erkannt, erwartet, Dauer, Zeitraum", () => {
    const { ex, lage, coa } = fixture();
    expect(foundLabel(lage.force.rows[1])).toEqual({ main: "mind. 11", sub: "bis 17", range: true });
    expect(foundLabel(lage.force.rows[0])).toEqual({ main: "Det 1, Det 2", range: false });
    expect(inWindowLabel(lage.force.rows[1])).toEqual({ main: "mind. 4", sub: "bis 6", range: true });
    expect(inWindowLabel(lage.force.rows[0]).main).toBe("–");
    expect(foundLabel(undefined).main).toBe("–");
    expect(expectedLabel(lage.compare[0]!)).toBe("2 Det");
    expect(expectedLabel(lage.compare[1]!)).toBe("14");
    expect(durLabel(255)).toBe("4 h 15′");
    expect(durLabel(45)).toBe("45′");
    // ohne windowState aus dem Zeitraum abgeleitet; nie nachgezogen
    expect(windowLabel(coa, ex.days, "2030-05-15T07:25")).toMatchObject({ text: "ca. 07:40–08:30", short: "07:40–08:30", state: "erwartet" });
    expect(windowLabel(coa, ex.days, "2030-05-15T07:50")?.state).toBe("jetzt");
    expect(windowLabel(coa, ex.days, "2030-05-15T08:45")).toMatchObject({ text: "seit 08:30 überfällig", state: "ueberfaellig" });
    // Kern setzt den Zustand
    expect(windowLabel({ ...coa, windowState: "jetzt" }, ex.days, "2030-05-15T07:25")?.text).toBe("jetzt");
    expect(windowLabel({ ...coa, window: undefined, windowState: "offen" }, ex.days, "2030-05-15T07:25")?.text).toBe("offen");
    expect(windowLabel({ ...coa, window: undefined }, ex.days, "2030-05-15T07:25")).toBeNull();
  });
  it("Gegenindikatoren: Zähler «2 von 3 ✓ · 1 ✗», nicht zutreffende nicht gezeigt", () => {
    const { coa } = fixture();
    expect(indCounts(coa)).toEqual({ met: 2, of: 3, against: 1 });
    expect(countLabel(coa)).toBe("2 von 3 ✓ · 1 ✗");
    expect(shownIndicators(coa).map((i) => i.text)).not.toContain("Rot zieht ab (nicht zutreffend)");
    expect(countLabel({ ...coa, indicators: coa.indicators.filter((i) => !i.against) })).toBe("2 von 3 ✓");
  });
  it("Feindannahme-Vorschau: Kürzel und Einzahl/Mehrzahl", () => {
    const chips = (s: string) => parseStrength(s).rows.map(specChip);
    expect(chips("2 Det, 14 Pers, 5 Fz, 1 Drohne")).toEqual(["2 Det", "14 Pers", "5 Fz", "1 Drohne"]);
    expect(chips("2 Gr à 8")).toEqual(["2 Gr", "16 Pers"]);
    expect(chips("5 Fz (2 Kpz)")).toEqual(["5 Fz", "davon 2 Kpz"]);
    expect(chips("Det Nord, Det Süd")).toEqual(["Det Nord, Det Süd"]);
    expect(qtyLabel(3, { abbr: "Drohnen", name: "Drohnen" })).toBe("3 Drohnen");
    expect(qtyLabel(1, { abbr: "Elemente", name: "Elemente" })).toBe("1 Element");
    expect(qtyLabel(3, { abbr: "Motorrad", name: "davon Motorrad", parent: "fz" })).toBe("3 Motorräder");
  });
  it("«Auf Karte»: Ziel, Annäherung und nahe Indikator-Orte", () => {
    const { ex, coa, hint } = fixture();
    const evs = ex.events!;
    // Indikator-Meldungen nahe ans Ziel legen, eine weit weg
    for (const [k, id] of [[0, hint.events[0]], [1, coa.indicators[1]!.events![0]], [2, coa.events[0]]] as const) {
      const e = evs.find((x) => x.id === id)!;
      e.pos = k === 2 ? { e: 2620000, n: 1197500 } : { e: 2601000 - k * 300, n: 1197000 };
    }
    const pts = coaPlaces(coa, ex, [hint]);
    expect(pts).toContainEqual({ e: 2601000, n: 1197000 });
    expect(pts).toContainEqual({ e: 2600700, n: 1197000 });
    expect(pts).not.toContainEqual({ e: 2620000, n: 1197500 });
    expect(pts).toContainEqual(coa.target!.pos);
  });
  it("Hervorhebung: Auslöser, Indikator-Meldungen und Auslöser der Indikator-Hinweise", () => {
    const { coa, hint, ev } = fixture();
    const ids = coaEventIds(coa, [hint]);
    // auch zutreffende Gegenindikatoren (spricht dagegen) werden hervorgehoben
    expect([...ids].sort()).toEqual([ev[0]!.id, ev[1]!.id, ev[2]!.id, ev[4]!.id].sort());
    expect(coaHintIds(coa)).toEqual([hint.id]);
  });
});

describe("Lage Rot: Export", () => {
  it("CSV-Abschnitt mit Möglichkeiten, Kräften, nicht mehr gesehen und Feindannahme", () => {
    const { ex, lage } = fixture();
    const csv = lageRotCsv(ex, lage, "2030-05-15T07:25");
    expect(csv.startsWith("\r\n")).toBe(true);
    expect(csv).toContain("Lage Rot;Stand T2 07:25");
    expect(csv).toContain("Wahrscheinlichste;Überfall auf Stao H05 (AQ11);ca. T2 07:40–08:30;2 von 3 ✓ · 1 ✗;✓ Drohne über H05 (D1) | ✓ Linie AK10 (C6) | ○ Annäherung noch nicht gemeldet | ✗ Rot entfernt sich von H05;aus AP10;Stellungswechsel H05 | Reserve bereit");
    expect(lageRotCsv(ex, lage, "2030-05-15T08:45")).toContain(";seit 08:30 überfällig (ca. T2 07:40–08:30);");
    expect(csv).toContain("Elemente;Det 1, Det 2;2 Det;vollständig");
    expect(csv).toContain("Personen;mind. 11 (bis 17);14;teilweise (~79 %)");
    expect(csv).toContain("Nicht mehr gesehen;Det 2 seit T2 03:10 (4 h 15′)");
    expect(csv).toContain("Feindannahme;2 Det, 14 Pers, 5 Fz, 1 Drohne");
    // Zeitfenster: Kräfte über das ganze Journal, Zusatzspalte «im Fenster»
    const win = lageRotCsv(ex, { ...lage, from: "2030-05-15T05:25" }, "2030-05-15T07:25");
    expect(win).toContain("Kräfte Rot;erkannt (ganzes Journal);im Fenster;erwartet;Stand");
    expect(win).toContain("Personen;mind. 11 (bis 17);mind. 4 (bis 6);14;teilweise (~79 %)");
  });
  it("Journal-PDF mit Anhang Lage Rot (vor den Hinweisen)", async () => {
    const { ex, lage, hint } = fixture();
    const without = journalPdf(ex, "INTERN", [hint]);
    const withLr = journalPdf(ex, "INTERN", [hint], { lage, t: "2030-05-15T07:25" });
    const txt = await withLr.text();
    expect(txt).toContain("Anhang: Lage Rot");
    expect(txt.indexOf("Anhang: Lage Rot")).toBeLessThan(txt.indexOf("Anhang: Hinweise zu Rot"));
    expect(withLr.size).toBeGreaterThan(without.size);
  });
});
