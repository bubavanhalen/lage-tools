/**
 * Verträge MVP 3.5 «Feinschliff» (Spez. MVP 3.5, Kap. 5.1–5.6), Phase 0: was «fertig» ist, ist hier geprüft (Nummer in
 * Worten, alle Einträge zu einer Nummer, eine Zählfunktion für offene Hinweise, Entscheide); die übrigen Verträge sind
 * Stubs mit Standardwerten – geprüft wird nur, dass sie nichts ändern. Nur fiktive Daten (Beispiel Bern).
 */
import { describe, expect, it } from "vitest";
import {
  ART_LABEL, DATEI_SICHERN_NACH_MIN, ENTRY_ARTEN, KACHELN_SIND_ONLINE_DIENST, LIVE_TOLERANZ_MIN, OFFEN_PRIO, ONLINE_STANDARD, PQ_FLAECHE,
  SCHUTZ_WARNT_IM_KOPF, SW_KACHEL_TIMEOUT_MS, SW_NETZ_TIMEOUT_MS, TAGESKARTE_FILTER, TREFFER_PX, VON_OBEN_MAX, ZEICHEN, artText, artZeichen,
  bestaetigtVon, bezugAufloesen, demoExercise, findAllByNr, findByNr, lastPosition, nrLabel, nrText, offeneHinweise, parseMeldung, rapportZahlen,
  readArt, revisionOf, vonOben, type Hint, type JournalContext, type LageEvent,
} from "../src";

const ev = (id: string, nr: number | undefined, createdAt: string, extra: Partial<LageEvent> = {}): LageEvent => ({
  id, rev: 1, device: "dev-a", updatedAt: createdAt, createdAt, t: "2030-05-15T07:30", side: "rot", unit: "", text: "2 Fz AK9", sym: "fz", aff: "H",
  confirmed: true, ...(nr !== undefined ? { nr } : {}), ...extra,
});

describe("Entscheide (entscheide.ts, Kap. 5.6 und offene Fragen Kap. 9)", () => {
  it("Werte wie Spezifikation", () => {
    expect(ONLINE_STANDARD).toBe(false);
    expect([SW_NETZ_TIMEOUT_MS, SW_KACHEL_TIMEOUT_MS]).toEqual([3000, 8000]);
    expect(LIVE_TOLERANZ_MIN).toBe(10);
    expect(ZEICHEN.grundmass.map((g) => g.px)).toEqual([24, 26, 28, 32]);
    expect(ZEICHEN.stufe).toEqual({ S: -4, M: 0, L: 8 });
    expect([ZEICHEN.gewaehlt, ZEICHEN.praesentation, ZEICHEN.strokeWidth, ZEICHEN.outlineWidth]).toEqual([6, 14, 7, 8]);
    expect(TAGESKARTE_FILTER).toBe("grayscale(1) contrast(.62) brightness(1.22)");
    expect(PQ_FLAECHE).toEqual({ feindFuellung: 0.22, rahmen: 0.4 });
    expect(TREFFER_PX).toEqual({ coarse: 48, fine: 32 });
    expect([DATEI_SICHERN_NACH_MIN, VON_OBEN_MAX]).toEqual([120, 8]);
  });
  it("offene Kundenfragen: Vorschlag der Spezifikation", () => {
    expect(KACHELN_SIND_ONLINE_DIENST).toBe(false); // 9.1
    expect(SCHUTZ_WARNT_IM_KOPF).toBe(false); // 9.2
    expect(LIVE_TOLERANZ_MIN).toBe(10); // 9.3
  });
});

describe("Arten: Ausgang (Kap. 5.1, 5.3)", () => {
  it("neue Art, Name, Zeichen, Text", () => {
    expect(ENTRY_ARTEN).toContain("ausgang");
    expect(ART_LABEL.ausgang).toBe("Ausgang");
    expect(ENTRY_ARTEN.map(artZeichen)).toEqual(["", "✎", "✎", "✎", "⇄", "✎", "↗"]);
    expect(artText(ev("x", 1, "2030-05-15T05:30:00Z", { art: "ausgang", an: "Bat", notiz: true }))).toBe("Ausgang an Bat");
  });
  it("Offen: neue Arten mit Rang", () => {
    expect(OFFEN_PRIO["rueckfrage-oben"]).toBe(28);
    expect(OFFEN_PRIO.begehren).toBe(45);
    expect(OFFEN_PRIO.dringend < OFFEN_PRIO["rueckfrage-oben"] && OFFEN_PRIO["rueckfrage-oben"] < OFFEN_PRIO.auftrag).toBe(true);
  });
  it("revisionOf übernimmt begehren und tOffset", () => {
    const r = revisionOf(ev("x", 1, "2030-05-15T05:30:00Z", { side: "blau", begehren: { was: "Sanität" }, tOffset: "+02:00" }));
    expect(r.begehren).toEqual({ was: "Sanität" });
    expect(r.tOffset).toBe("+02:00");
  });
  it("Rapport-Zahlen: Ausgang und Begehren", () => {
    const ex = demoExercise();
    ex.events = [...ex.events!, ev("a1", 900, "2030-05-15T05:31:00Z", { art: "ausgang", an: "Bat", notiz: true, side: "blau", aff: "F", sym: "einheit" }),
      ev("b1", 901, "2030-05-15T05:32:00Z", { side: "blau", aff: "F", sym: "einheit", melder: "H05", begehren: { was: "Munition" } })];
    const z = rapportZahlen(ex, null, "2030-05-15T08:00");
    expect(z.ausgang).toEqual({ bat: 1, kp: 0, andere: 0 });
    expect(z.begehren).toEqual({ total: 1, offen: 1 });
  });
});

describe("Nummer in Worten und alle Einträge zu einer Nummer (nummer.ts, Phase 0 fertig)", () => {
  const ex = {
    events: [
      ev("a", 64, "2030-05-15T05:37:00Z"), ev("b", 64, "2030-05-15T05:38:00Z"), ev("c", 65, "2030-05-15T05:39:00Z"),
      ev("alt", undefined, "2030-05-15T04:00:00Z"),
    ],
  };
  it("nrText «Nr 56», doppelt «Nr 64a»", () => {
    expect(nrText(ex.events[2]!, ex)).toBe("Nr 65");
    expect(nrText(ex.events[0]!, ex)).toBe("Nr 64a");
    expect(nrText(ex.events[1]!, ex)).toBe("Nr 64b");
    expect(nrText(ex.events[3]!, ex)).toBe(`Nr ${nrLabel(ex.events[3]!, ex)}`);
    expect(nrText(ev("fremd", undefined, "2030-05-15T04:00:00Z"), { events: [] })).toBe("");
  });
  it("findAllByNr: «64» → 64a, 64b; «64b» → genau einer; unbekannt → []", () => {
    expect(findAllByNr(ex, "64").map((e) => e.id)).toEqual(["a", "b"]);
    expect(findAllByNr(ex, "Nr 64").map((e) => e.id)).toEqual(["a", "b"]);
    expect(findAllByNr(ex, "64b").map((e) => e.id)).toEqual(["b"]);
    expect(findAllByNr(ex, "65").map((e) => e.id)).toEqual(["c"]);
    expect(findAllByNr(ex, "99")).toEqual([]);
    expect(findAllByNr(ex, "64c")).toEqual([]);
    // findByNr bleibt: «64» → der zuerst erfasste
    expect(findByNr(ex, "64")?.id).toBe("a");
  });
});

describe("offeneHinweise: eine Zahl (zaehlen.ts, Phase 0 fertig)", () => {
  const h = (id: string, level: Hint["level"], extra: Partial<Hint> = {}): Hint => ({ id, rule: id.split(":")[0]!, level, title: id, text: "", events: [`e-${id}`], t: "2030-05-15T07:00", ...extra });
  const hints = [
    h("C1:a", "hoch"), h("C2:b", "mittel"), h("D1:c", "info"), h("C5:d", "mittel", { bundled: 4 }), h("C3:e", "mittel", { until: "2030-05-15T07:10" }),
    h("C6:f", "hoch"),
  ];
  it("ohne info, ohne entschiedene, gebündelte = 1", () => {
    const r = offeneHinweise(hints, { "C6:f": { state: "verworfen", at: "2030-05-15T07:20" } });
    expect(r).toEqual({ offen: 4, erledigt: 1, ids: ["C1:a", "C2:b", "C5:d", "C3:e"] });
  });
  it("mit Lagezeit: beendete zählen als erledigt", () => {
    const r = offeneHinweise(hints, { "C6:f": { state: "bestaetigt", at: "2030-05-15T07:20" } }, "2030-05-15T07:30");
    expect(r.offen).toBe(3);
    expect(r.erledigt).toBe(2);
  });
  it("Entscheid haftet nach ID-Wechsel (decisionFor)", () => {
    const r = offeneHinweise([h("C1:neu", "hoch", { events: ["x", "y"] })], { "C1:alt": { state: "verworfen", at: "2030-05-15T07:20", rule: "C1", events: ["x", "y"] } });
    expect(r.offen).toBe(0);
  });
});

describe("Stubs ändern nichts (Phase 0)", () => {
  const ex = demoExercise();
  const ctx: JournalContext = {
    sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now: new Date("2030-05-15T07:31:00+02:00"),
    lastPos: (u, s) => lastPosition(ex.events!, s, u), events: ex.events, ex,
  };
  it("bezugAufloesen liefert nichts", () => {
    expect(bezugAufloesen(readArt("H03 erledigt", { blau: ex.units.blau }), { events: ex.events!, t: "2030-05-15T07:31" })).toEqual({});
  });
  it("parseMeldung: neue Draft-Felder fehlen", () => {
    const d = parseMeldung("H04 2 Fz in AK7 Rtg N", ctx);
    for (const k of ["tOffset", "begehren", "teile", "bezugKandidaten", "abschluss", "ersatz", "truppNeu"] as const) expect(d[k], k).toBeUndefined();
  });
  it("vonOben: Zeilen tragen die Art", () => {
    expect(vonOben(ex, "2030-05-15T07:30").every((z) => z.art === "orientierung")).toBe(true);
  });
  it("bestaetigtVon: verschiedene Melder, die Meldung selbst zuerst", () => {
    const evs = ex.events!;
    for (const e of evs.filter((x) => x.side === "rot")) {
      const l = bestaetigtVon(e, evs);
      expect(new Set(l).size).toBe(l.length);
      if (l.length) { expect(l[0]).toBe(e.melder); expect(l.length).toBeGreaterThan(1); }
    }
  });
});
