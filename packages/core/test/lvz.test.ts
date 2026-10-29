/** LVZ-Vermerke, Bezüge, Aufheben, Offen (Spez. MVP 3, Kap. 3.3, 3.5, 3.7) – Phase 0 */
import { describe, expect, it } from "vitest";
import { STILL_MIN, aufhebZiele, correctEvent, demoExercise, istAufhebbar, liftMap, lvzIndex, mergeEventPair, mergeEvents, mergeLvz, offenePunkte, setVermerk, situationAt, vermerkeOf, type Exercise, type LageEvent } from "../src";

const T0 = new Date("2030-05-15T05:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60000);
let k = 0;
const ev = (p: Partial<LageEvent>): LageEvent => ({
  id: `l${++k}`, rev: 1, device: "dev-a", updatedAt: T0.toISOString(), createdAt: T0.toISOString(), t: "2030-05-15T07:00", side: "blau", unit: "", text: "", sym: "einheit", aff: "F", confirmed: true, ...p,
});

describe("Vermerke (E7)", () => {
  it("setVermerk ändert rev nicht, nur lvz und updatedAt", () => {
    const e = ev({ side: "rot", aff: "H", text: "2 Kpz AJ9" });
    const d = setVermerk(e, "dringend", true, { device: "dev-a", kuerzel: "BSP", now: at(1) });
    expect(d.rev).toBe(1);
    expect(d.lvz?.dringend).toEqual({ v: true, at: at(1).toISOString(), device: "dev-a", von: "BSP" });
    expect(d.updatedAt).toBe(at(1).toISOString());
  });
  it("mergeLvz pro Feld: späterer Stempel gilt, kommutativ, idempotent", () => {
    const a = { dringend: { v: true, at: at(1).toISOString(), device: "a" }, massnahme: { v: "x", at: at(5).toISOString(), device: "a" } };
    const b = { dringend: { v: false, at: at(3).toISOString(), device: "b" }, status: { v: "erledigt" as const, at: at(2).toISOString(), device: "b" } };
    const m = mergeLvz(a, b)!;
    expect(m).toEqual({ dringend: b.dringend, status: b.status, massnahme: a.massnahme });
    expect(mergeLvz(b, a)).toEqual(m);
    expect(mergeLvz(m, a)).toBe(m);
    expect(mergeLvz(a, undefined)).toBe(a);
  });
  it("A dringend + B korrigiert dieselbe Meldung → kein Konflikt, beides da", () => {
    const e = ev({ side: "rot", aff: "H", text: "2 Kpz AJ9", cells: ["AJ9"] });
    const a = setVermerk(e, "dringend", true, { device: "dev-a", now: at(2) });
    const b = correctEvent(e, { text: "2 Kpz AJ10", cells: ["AJ10"] }, "dev-b", at(3));
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const r = mergeEventPair(x, y);
      expect(r.conflict).toBe(false);
      expect(r.ev.text).toBe("2 Kpz AJ10");
      expect(r.ev.lvz?.dringend?.v).toBe(true);
    }
  });
  it("A erledigt + B Massnahme (gleiche Revision) → kein Konflikt, beide Vermerke", () => {
    const e = ev({ side: "rot", aff: "H", text: "x" });
    const a = setVermerk(e, "status", "erledigt", { device: "dev-a", now: at(2) });
    const b = setVermerk(e, "massnahme", "Zfhr orientiert", { device: "dev-b", now: at(3) });
    const m = mergeEvents([a], [b]);
    expect(m).toHaveLength(1);
    expect(m[0]!.history).toBeUndefined();
    expect(m[0]!.lvz?.status?.v).toBe("erledigt");
    expect(m[0]!.lvz?.massnahme?.v).toBe("Zfhr orientiert");
  });
});

describe("Status abgeleitet (vermerkeOf)", () => {
  it("Auftrag offen bis «ausgeführt», Quittung nur quittiert (Entscheid 5)", () => {
    const a = ev({ art: "auftrag", notiz: true, an: "H01", text: "Auftrag an H01: Beo NAI 1" });
    const q = ev({ art: "notiz", notiz: true, melder: "H01", bezug: a.id, bezugArt: "quittung", t: "2030-05-15T07:05" });
    let evs = [a, q];
    let v = vermerkeOf(a, lvzIndex(evs));
    expect(v.status).toBe("offen");
    expect(v.quittiert).toEqual({ t: "2030-05-15T07:05", id: q.id });
    const done = ev({ melder: "H01", bezug: a.id, bezugArt: "ausgefuehrt", t: "2030-05-15T07:40" });
    evs = [a, q, done];
    v = vermerkeOf(a, lvzIndex(evs));
    expect(v.status).toBe("erledigt");
  });
  it("Rückfrage beantwortet; dringende Meldung offen bis erledigt", () => {
    const r = ev({ art: "rueckfrage", notiz: true, melder: "H04", text: "H04 Rückfrage: Standort Det 2?" });
    const ans = ev({ side: "rot", aff: "H", bezug: r.id, bezugArt: "antwort", t: "2030-05-15T07:10" });
    expect(vermerkeOf(r, lvzIndex([r, ans]))).toMatchObject({ status: "erledigt", beantwortet: { id: ans.id } });
    const d = setVermerk(ev({ side: "rot", aff: "H" }), "dringend", true, { device: "a", now: at(1) });
    expect(vermerkeOf(d, lvzIndex([d])).status).toBe("offen");
    const e = setVermerk(d, "status", "erledigt", { device: "a", now: at(2) });
    expect(vermerkeOf(e, lvzIndex([e]))).toMatchObject({ status: "erledigt", erledigtUm: at(2).toISOString() });
  });
});

describe("Aufheben (E8)", () => {
  it("liftMap: früheste nicht gestrichene Aufhebung", () => {
    const s = ev({ side: "rot", aff: "H", sym: "sperre", cells: ["AG13"] });
    const l1 = ev({ hebtAuf: s.id, t: "2030-05-15T07:40" });
    const l0 = ev({ hebtAuf: s.id, t: "2030-05-15T07:20", deleted: true });
    expect(liftMap([s, l1, l0]).get(s.id)).toEqual({ t: "2030-05-15T07:40", by: l1.id });
  });
  it("istAufhebbar: Tätigkeiten, Flächen, Linien – nicht Fahrzeuge", () => {
    expect(istAufhebbar({ sym: "sperre" })).toBe(true);
    expect(istAufhebbar({ sym: "minensperre" })).toBe(true);
    expect(istAufhebbar({ sym: "fz" })).toBe(false);
  });
  it("aufhebZiele: gleiches Zeichen/Oberbegriff und Ort, aktiv, jüngste zuerst", () => {
    const ex = demoExercise();
    const sperreAG13 = ex.events!.find((e) => e.sym === "sperre" && e.cells?.includes("AG13"))!;
    expect(sperreAG13).toBeTruthy();
    const ziele = aufhebZiele(ex.events!, { sym: "sperre", cells: ["AG13"], t: "2030-05-15T07:40" }, lvzIndex(ex.events!));
    expect(ziele.map((e) => e.id)).toEqual([sperreAG13.id]);
    expect(aufhebZiele(ex.events!, { sym: "sperre", cells: ["AA1"], t: "2030-05-15T07:40" }, lvzIndex(ex.events!))).toEqual([]);
    // nach der Aufhebung kein Ziel mehr
    const lift = ev({ hebtAuf: sperreAG13.id, t: "2030-05-15T07:40" });
    const evs = [...ex.events!, lift];
    expect(aufhebZiele(evs, { sym: "sperre", cells: ["AG13"], t: "2030-05-15T07:45" }, lvzIndex(evs))).toEqual([]);
  });
});

describe("Offen (E9)", () => {
  const blauEx = (events: LageEvent[]): Exercise => ({ ...demoExercise(), events });
  it("Beispiel Bern: nichts Dringendes, keine Aufträge – nur stille Trupps oder Meldungen ohne Ort", () => {
    const ex = demoExercise();
    const o = offenePunkte(ex, "2030-05-15T07:30");
    expect(o.every((x) => x.art === "still" || x.art === "ohne-ort")).toBe(true);
  });
  it("dringend, Auftrag (Frist vorbei zuerst), Rückfrage, Vbk keine, still, Konflikt – nach Rang", () => {
    const evs = [
      ev({ melder: "H01", side: "blau", unit: "H01", pos: { e: 2600000, n: 1199000 }, t: "2030-05-15T06:00" }),
      ev({ art: "auftrag", notiz: true, an: "H03", text: "Auftrag an H03: Beo NAI 2 bis 0800", frist: "2030-05-15T08:00", t: "2030-05-15T07:20" }),
      ev({ art: "auftrag", notiz: true, an: "H01", text: "Auftrag an H01: Stellungswechsel bis 0700", frist: "2030-05-15T07:00", t: "2030-05-15T06:10" }),
      ev({ art: "rueckfrage", notiz: true, melder: "H04", text: "H04 Rückfrage: Standort Det 2?", t: "2030-05-15T07:25" }),
      ev({ art: "vbk", notiz: true, melder: "H02", vbk: "keine", text: "H02 keine Verbindung", t: "2030-05-15T07:10" }),
      setVermerk(ev({ side: "rot", aff: "H", melder: "H05", text: "2 Kpz AJ9", pos: { e: 2600500, n: 1199500 }, t: "2030-05-15T07:12" }), "dringend", true, { device: "a", now: at(1) }),
      ev({ side: "rot", aff: "H", melder: "H02", text: "1 Fz Rtg N", t: "2030-05-15T06:52" }),
    ];
    const o = offenePunkte(blauEx(evs), "2030-05-15T07:30", { conflictIds: [evs[0]!.id] });
    expect(o.map((x) => x.art)).toEqual(["dringend", "konflikt", "auftrag", "auftrag", "rueckfrage", "verbindung", "still", "ohne-ort"]);
    expect(o[2]).toMatchObject({ ueberfaellig: true, prio: 25, text: "an H01: Stellungswechsel – bis 07:00" });
    expect(o[3]!.text).toBe("an H03: Beo NAI 2 – bis 08:00");
    expect(o[4]!.text).toBe("von H04: Standort Det 2?");
    expect(o[5]!.text).toBe("H02: keine Verbindung seit 07:10");
    expect(o[6]).toMatchObject({ unit: "H01", seitMin: 90 });
    expect(STILL_MIN).toBe(60);
  });
  it("Vbk «keine» endet mit dem nächsten Lebenszeichen", () => {
    const evs = [
      ev({ art: "vbk", notiz: true, melder: "H02", vbk: "keine", t: "2030-05-15T07:10" }),
      ev({ art: "vbk", notiz: true, melder: "H02", vbk: "gut", t: "2030-05-15T07:20" }),
    ];
    expect(offenePunkte(blauEx(evs), "2030-05-15T07:30").some((x) => x.art === "verbindung")).toBe(false);
  });
});

describe("Nicht-Meldungen zeichnen nie (Invariante E3)", () => {
  it("situationAt ignoriert Nicht-Meldungen ohne Ort", () => {
    const evs = [ev({ art: "auftrag", notiz: true, an: "H01", text: "Auftrag an H01: Beo NAI 1" })];
    const s = situationAt(evs, "2030-05-15T08:00");
    expect(s.units).toEqual([]);
    expect(s.loose).toEqual([]);
  });
});
