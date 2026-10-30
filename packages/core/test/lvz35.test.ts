/**
 * LVZ-Lücken MVP 3.5 (Spez. MVP 3.5, Kap. 3.4 D2/D3): Bezug auflösen (doppelte Nummer, Abschluss aus «erledigt»,
 * «Antwort an Bat»), Wirkung der neuen Arten (Ausgang, Rückfrage von oben, Begehren, Übergabe-Eintrag) auf Vermerke,
 * Offen, Lebenszeichen und Lage. Nur fiktive Daten (Beispiel Bern).
 */
process.env.TZ = "Europe/Zurich";
import { describe, expect, it } from "vitest";
import {
  BEZUG_KEINER, bezugAufloesen, demoExercise, entryState, eventFromDraft, lastPosition, lebenszeichen, lvzIndex, nextNr, nrLabel, offenePunkte,
  parseMeldung, readArt, situationAt, uebergabeEintrag, vermerkeOf, type Draft, type EntryState, type Exercise, type JournalContext, type LageEvent,
} from "../src";

const at = (hhmm: string) => new Date(`2030-05-15T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00+02:00`);
function ctxOf(ex: Exercise, now: Date, o: Partial<JournalContext> = {}): JournalContext {
  return { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, s) => lastPosition(ex.events!, s, u), events: ex.events, ex, zone: "Europe/Zurich", ...o };
}
function lies(ex: Exercise, s: string, hhmm: string, o: Partial<JournalContext> = {}): { d: Draft; st: EntryState } {
  const now = at(hhmm);
  const d = parseMeldung(s, ctxOf(ex, now, o));
  return { d, st: entryState(d, { hasRaster: true, online: false, placePending: false, manualPos: false, now, sheets: ex.sheets, areas: ex.areas, knownUnits: ex.units.blau, unitsPrepared: true, days: ex.days }) };
}
function trage(ex: Exercise, s: string, hhmm: string, o: { nr?: number; device?: string } & Partial<JournalContext> = {}): LageEvent {
  const { d } = lies(ex, s, hhmm, o);
  const e = eventFromDraft(d, o.device ?? "dev-a", at(hhmm), { nr: o.nr ?? nextNr(ex, 0), kuerzel: "BSP" });
  ex.events = [...(ex.events ?? []), e];
  return e;
}
const T = "2030-05-15T08:00";

describe("D2 Bezug auflösen", () => {
  it("«H03 erledigt» bei genau einem offenen Auftrag: Bezug «ausgeführt», Abschluss mit Nummer und Text", () => {
    const ex = demoExercise();
    const a = trage(ex, "Auftrag an H03: Beo NAI 2 bis 0900", "0730");
    const { d, st } = lies(ex, "H03 erledigt", "0735");
    expect(st.level).toBe("bereit");
    expect(d).toMatchObject({ art: "meldung", bezug: a.id, bezugArt: "ausgefuehrt", abschluss: { id: a.id, nr: nrLabel(a, ex), text: "an H03: Beo NAI 2 – bis 09:00" } });
    const e = eventFromDraft(d, "dev-a", at("0735"), { nr: nextNr(ex, 0) });
    ex.events = [...ex.events!, e];
    expect(vermerkeOf(a, lvzIndex(ex.events)).status).toBe("erledigt");
  });
  it("«nicht abschliessen» (ctx.abschlussAus): kein Bezug, `abschluss: null`", () => {
    const ex = demoExercise();
    trage(ex, "Auftrag an H03: Beo NAI 2 bis 0900", "0730");
    const { d } = lies(ex, "H03 erledigt", "0735", { abschlussAus: true });
    expect(d.bezug).toBeUndefined();
    expect(d.abschluss).toBeNull();
    expect(d.abschlussAus).toBe(true);
  });
  it("zwei offene Aufträge: gelb `auftrag-wahl` mit Knöpfen und «keiner»; Wahl setzt den Bezug", () => {
    const ex = demoExercise();
    const a = trage(ex, "Auftrag an H03: Beo NAI 2 bis 0900", "0730");
    const b = trage(ex, "Auftrag an H03: Vbk alle 30 min", "0731");
    const { d, st } = lies(ex, "H03 erledigt", "0735");
    expect(st.level).toBe("pruefen");
    const r = st.reasons.find((x) => x.code === "auftrag-wahl")!;
    expect(r.text).toBe("Welcher Auftrag ist erledigt?");
    expect(r.choices!.map((c) => c.label)).toEqual([`Nr ${nrLabel(b, ex)} Vbk alle 30 min`, `Nr ${nrLabel(a, ex)} Beo NAI 2`, "keiner"]);
    expect(d.bezugKandidaten).toEqual([b.id, a.id]);
    expect(d.bezug).toBeUndefined();
    expect(lies(ex, "H03 erledigt", "0735", { bezugWahl: a.id }).d).toMatchObject({ bezug: a.id, bezugArt: "ausgefuehrt" });
    const k = lies(ex, "H03 erledigt", "0735", { bezugWahl: BEZUG_KEINER });
    expect(k.d.bezug).toBeUndefined();
    expect(k.st.level).not.toBe("geht-nicht");
  });
  it("kein offener Auftrag: nichts (gewöhnliche Meldung)", () => {
    const ex = demoExercise();
    const { d } = lies(ex, "H03 erledigt", "0735");
    expect(d.bezug).toBeUndefined();
    expect(d.abschluss).toBeUndefined();
  });
  it("«Antwort zu 64» bei 64a/64b: gelb `bezug-wahl` mit beiden Knöpfen, Wahl → Bezug", () => {
    const ex = demoExercise();
    const a = trage(ex, "H02 3 Fz AK9", "0737", { nr: 64, device: "dev-a" });
    const b = trage(ex, "H04 1 Pers AF11", "0738", { nr: 64, device: "dev-b" });
    const { d, st } = lies(ex, "Antwort zu 64", "0740");
    expect(st.level).toBe("pruefen");
    const r = st.reasons.find((x) => x.code === "bezug-wahl")!;
    expect(r.text).toBe("Nr 64 gibt es zweimal – welche?");
    expect(r.choices!.map((c) => c.label)).toEqual(["64a 07:37 H02 3 Fz AK9", "64b 07:38 H04 1 Pers AF11"]);
    expect(d.bezug).toBeUndefined();
    expect(lies(ex, "Antwort zu 64", "0740", { bezugWahl: b.id }).d.bezug).toBe(b.id);
    // «64a» ist eindeutig
    expect(lies(ex, "Antwort zu 64a", "0740").d.bezug).toBe(a.id);
  });
  it("«Antwort an Bat» ohne Nummer → jüngste offene Rückfrage von Bat; beantwortet sie", () => {
    const ex = demoExercise();
    trage(ex, "Bat fragt: Standort H02?", "0738");
    const r2 = trage(ex, "Rückfrage Bat: wie viele Fz in AK9?", "0739");
    const { d, st } = lies(ex, "Antwort an Bat: 2 Kpz", "0740");
    expect(st.level).toBe("bereit");
    expect(d).toMatchObject({ art: "ausgang", an: "Bat", bezug: r2.id, bezugArt: "antwort" });
    ex.events = [...ex.events!, eventFromDraft(d, "dev-a", at("0740"), { nr: nextNr(ex, 0) })];
    const offen = offenePunkte(ex, T).filter((o) => o.art === "rueckfrage-oben");
    expect(offen.map((o) => o.text)).toEqual(["Bat fragt: Standort H02?"]);
  });
  it("Weitermeldung auf eine Rückfrage ist ihre Antwort", () => {
    const ex = demoExercise();
    const r = trage(ex, "Bat fragt: Standort H02?", "0738");
    const { d } = lies(ex, `Meldung an Bat zu ${nrLabel(r, ex)}: H02 in AL9`, "0740");
    expect(d).toMatchObject({ art: "ausgang", bezug: r.id, bezugArt: "antwort" });
  });
  it("Stub-Vertrag: leeres Ergebnis ohne Bezug", () => {
    const ex = demoExercise();
    expect(bezugAufloesen(readArt("H02 2 Fz AK9", { blau: ex.units.blau }), { events: ex.events!, t: T })).toEqual({});
  });
});

describe("D3 Wirkung der neuen Arten", () => {
  it("Ausgang: kein Zeichen, kein Lebenszeichen, nie offen; «weitergemeldet Bat 07:37 (Nr …)» an der Meldung", () => {
    const ex = demoExercise();
    const m = trage(ex, "H05 2 Kpz AJ9 Rtg W", "0735");
    const vor = situationAt(ex.events!, T);
    const w = trage(ex, `Weitergemeldet an Bat: Nr ${nrLabel(m, ex)}`, "0737");
    expect(w).toMatchObject({ art: "ausgang", an: "Bat", notiz: true, bezug: m.id, bezugArt: "weiter" });
    expect(w.pos).toBeUndefined();
    expect(lebenszeichen(w)).toBeNull();
    const nach = situationAt(ex.events!, T);
    expect(nach.units.length + nach.loose.length).toBe(vor.units.length + vor.loose.length);
    const v = vermerkeOf(m, lvzIndex(ex.events!));
    expect(v.weiter).toEqual({ an: "Bat", um: "2030-05-15T07:37" });
    expect(v.weiterVon).toEqual({ id: w.id, nr: nrLabel(w, ex) });
    expect(offenePunkte(ex, T).some((o) => o.eventId === w.id)).toBe(false);
  });
  it("Rückfrage von oben: Gruppe «rueckfrage-oben» (prio 28) vor den Aufträgen, kein Melder-Lebenszeichen", () => {
    const ex = demoExercise();
    trage(ex, "Auftrag an H03: Beo NAI 2 bis 0900", "0730");
    const r = trage(ex, "Bat fragt: Standort H02?", "0738");
    expect(r).toMatchObject({ art: "rueckfrage", quelle: "Bat" });
    const o = offenePunkte(ex, T);
    const i = o.findIndex((x) => x.art === "rueckfrage-oben");
    expect(o[i]).toMatchObject({ prio: 28, text: "Bat fragt: Standort H02?", eventId: r.id });
    expect(i).toBeLessThan(o.findIndex((x) => x.art === "auftrag"));
  });
  it("Begehren: offen bis erledigt (Gruppe «begehren», prio 45), kein Ort fehlt", () => {
    const ex = demoExercise();
    const e: LageEvent = { ...trage(ex, "H05 Mun Nachschub benötigt", "0735"), begehren: { was: "Mun-Nachschub" } };
    ex.events = ex.events!.map((x) => (x.id === e.id ? e : x));
    expect(vermerkeOf(e, lvzIndex(ex.events)).status).toBe("offen");
    const o = offenePunkte(ex, T).filter((x) => x.eventId === e.id);
    expect(o.map((x) => [x.art, x.prio, x.text])).toEqual([["begehren", 45, "H05: Mun-Nachschub"]]);
    const erl = { ...e, lvz: { status: { v: "erledigt" as const, at: "2030-05-15T05:50:00.000Z", device: "dev-a" } } };
    ex.events = ex.events.map((x) => (x.id === e.id ? erl : x));
    expect(offenePunkte(ex, T).some((x) => x.eventId === e.id)).toBe(false);
    expect(lebenszeichen(erl)).toBe("H05");
  });
  it("Übergabe-Eintrag: nie offen, kein Lebenszeichen, kein Zeichen", () => {
    const ex = demoExercise();
    const u = uebergabeEintrag({ id: "w1", art: "uebergabe", at: "2030-05-15T05:31:00.000Z", t: "2030-05-15T07:31", an: "MU", von: "BSP", device: "dev-a", stand: { offen: 4, neu: 18 } }, { nr: nextNr(ex, 0), device: "dev-a", tOffset: "+02:00" });
    ex.events = [...ex.events!, u];
    expect(u).toMatchObject({ art: "notiz", notiz: true, system: "uebergabe", schichtId: "w1", text: "Übergabe BSP → MU · 4 offen · 18 neu", erfasstVon: "BSP", tOffset: "+02:00" });
    expect(lebenszeichen(u)).toBeNull();
    expect(offenePunkte(ex, T).some((x) => x.eventId === u.id)).toBe(false);
    expect(situationAt(ex.events, T).loose.some((x) => x.id === u.id)).toBe(false);
  });
});
