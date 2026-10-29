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

// ---------------------------------------------------------------------------------------------------------------
// Paket A: Verdrahtung in parseMeldung, Hinweise, CSV (nur fiktive Daten, Beispiel Bern)
import { analyzeJournal, aufhebDraft, aufhebEvent, entryState, eventFromDraft, journalToCsv, kurzText, nrLabel, parseMeldung, type JournalContext } from "../src";

const bernCtx = (ex: Exercise, hhmm: string, o: Partial<JournalContext> = {}): JournalContext => ({
  sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now: new Date(2030, 4, 15, +hhmm.slice(0, 2), +hhmm.slice(2)),
  events: ex.events, ex, ...o,
});
const add = (ex: Exercise, text: string, hhmm: string, o: Partial<JournalContext> = {}) => {
  const d = parseMeldung(text, bernCtx(ex, hhmm, o));
  const e = eventFromDraft(d, "dev-a", new Date(2030, 4, 15, +hhmm.slice(0, 2), +hhmm.slice(2), (ex.events?.length ?? 0) % 60), { nr: (ex.events?.length ?? 0) + 1, kuerzel: "BSP" });
  ex.events = [...(ex.events ?? []), e];
  return { d, e };
};

describe("Hinweise: nur Lage, Lebenszeichen, Nachlauf bei Aufhebung", () => {
  const d3 = (ex: Exercise, t: string) => analyzeJournal(ex, { t }).hints.find((h) => h.rule === "D3" && h.nai === "NAI 1");
  it("D3: «H01 Vbk i.O.» ist ein Lebenszeichen und beendet «NAI 1 nicht überwacht»", () => {
    const ex = demoExercise();
    expect(d3(ex, "2030-05-15T04:00")?.until).toBeUndefined();
    add(ex, "T2 0150 H01 Vbk i.O.", "0150");
    expect(d3(ex, "2030-05-15T04:00")?.until).toBe("2030-05-15T01:50");
  });
  it("D3: «H01 keine Verbindung» ist kein Lebenszeichen", () => {
    const ex = demoExercise();
    add(ex, "T2 0150 H01 keine Verbindung", "0150");
    expect(d3(ex, "2030-05-15T04:00")?.until).toBeUndefined();
  });
  it("Nicht-Meldungen ändern die Hinweise nicht (Auftrag, Orientierung, Rückfrage, Notiz)", () => {
    const ex = demoExercise();
    const sig = (x: Exercise) => analyzeJournal(x, { t: "2030-05-15T07:30" }).hints.map((h) => `${h.id}|${h.until ?? ""}|${h.events.length}`).sort().join("\n");
    const vorher = sig(ex);
    for (const t of ["Auftrag an H03: Sperre in NAI 3 beobachten bis 0800", "Bat: 2 Kpz erwartet in NAI 2 ab 0800", "H04 Rückfrage: 2 Fz in AK9?", "Notiz: Checkpoint AK7 geplant"]) add(ex, t, "0728");
    expect(sig(ex)).toBe(vorher);
  });
  it("C5: Sperre in NAI 3 aufgehoben → «Hinterhalt-Gefahr in NAI 3» vorbei (Nachlauf), Rückblick davor offen", () => {
    const ex = demoExercise();
    const c5 = (x: Exercise, t: string) => analyzeJournal(x, { t }).hints.find((h) => h.rule === "C5" && h.nai === "NAI 3");
    expect(c5(ex, "2030-05-15T07:30")?.until).toBeUndefined();
    const { d } = add(ex, "H05 Sperre in NAI 3 aufgehoben", "0728");
    expect(d.hebtAuf).toBeTruthy();
    expect(entryState(d, { hasRaster: true, online: false, placePending: false, manualPos: false, now: new Date(2030, 4, 15, 7, 28) }).level).toBe("bereit");
    expect(c5(ex, "2030-05-15T07:30")?.until).toBe("2030-05-15T07:28");
    expect(c5(ex, "2030-05-15T07:20")?.until).toBeUndefined();
  });
});

describe("Aufheben über parseMeldung und Knopf", () => {
  it("keine aktive Sperre am Ort → gelb «Keine aktive Sperre in AA1 gefunden …», normale Meldung", () => {
    const ex = demoExercise();
    const d = parseMeldung("H04 Sperre AA1 aufgehoben", bernCtx(ex, "0730"));
    expect(d.hebtAuf).toBeUndefined();
    expect(d.hebtAufKandidaten).toEqual([]);
    const st = entryState(d, { hasRaster: true, online: false, placePending: false, manualPos: false, now: new Date(2030, 4, 15, 7, 30) });
    expect(st.reasons.find((r) => r.code === "aufheben")?.text).toBe("Keine aktive Sperre in AA1 gefunden – als normale Meldung eintragen?");
  });
  it("zwei Sperren am Ort → gelb «Zwei Sperren in AG13 – welche?»; Wahl mit aufhebDraft", () => {
    const ex = demoExercise();
    add(ex, "T2 0715 H04: 2. Sperre in AG13", "0715");
    const d = parseMeldung("H04 Sperre AG13 aufgehoben", bernCtx(ex, "0730"));
    expect(d.hebtAufKandidaten).toHaveLength(2);
    const st = entryState(d, { hasRaster: true, online: false, placePending: false, manualPos: false, now: new Date(2030, 4, 15, 7, 30) });
    expect(st.reasons.find((r) => r.code === "aufheben")?.text).toBe("Zwei Sperren in AG13 – welche?");
    const ziel = ex.events!.find((e) => e.id === d.hebtAufKandidaten![1])!;
    const w = aufhebDraft(d, ziel);
    expect(w).toMatchObject({ hebtAuf: ziel.id, unit: "", sym: "einheit", desc: "Sperre aufgehoben" });
    expect(w.pos).toBeUndefined();
    expect(entryState(w, { hasRaster: true, online: false, placePending: false, manualPos: false, now: new Date(2030, 4, 15, 7, 30) }).reasons.some((r) => r.code === "aufheben")).toBe(false);
  });
  it("Knopf «Aufgehoben (jetzt)»: Meldung «Sperre AG13 aufgehoben», Zeichen weg, Streichen bringt es zurück", () => {
    const ex = demoExercise();
    const ziel = ex.events!.find((e) => e.sym === "sperre" && e.cells?.includes("AG13"))!;
    const lift = aufhebEvent(ziel, "dev-a", new Date(2030, 4, 15, 7, 40), { t: "2030-05-15T07:40", nr: 99, kuerzel: "BSP" });
    expect(lift).toMatchObject({ text: "Sperre AG13 aufgehoben", hebtAuf: ziel.id, art: "meldung", unit: "", sym: "einheit", erfasstVon: "BSP", nr: 99, orte: ["AG13"] });
    expect(lift.pos).toBeUndefined();
    const evs = [...ex.events!, lift];
    expect(situationAt(evs, "2030-05-15T07:45").loose.some((e) => e.id === ziel.id)).toBe(false);
    expect(situationAt(evs, "2030-05-15T07:39").loose.some((e) => e.id === ziel.id)).toBe(true);
    expect(vermerkeOf(ziel, lvzIndex(evs)).aufgehoben).toEqual({ t: "2030-05-15T07:40", id: lift.id });
    const zurueck = [...ex.events!, { ...lift, deleted: true }];
    expect(situationAt(zurueck, "2030-05-15T07:45").loose.some((e) => e.id === ziel.id)).toBe(true);
  });
});

describe("Bezüge über die Nummer", () => {
  it("«Antwort zu 99» ohne Nr 99 → gelb «Nr 99 gibt es nicht – ohne Bezug eintragen?»", () => {
    const ex = demoExercise();
    const d = parseMeldung("Antwort zu 99: Det 2 in AJ8", bernCtx(ex, "0730"));
    expect(d).toMatchObject({ bezugNr: "99", bezugFehlt: true, art: "meldung" });
    expect(d.text).toBe("Antwort zu 99: Det 2 in AJ8");
    const st = entryState(d, { hasRaster: true, online: false, placePending: false, manualPos: false, now: new Date(2030, 4, 15, 7, 30) });
    expect(st.reasons.find((r) => r.code === "bezug")?.text).toBe("Nr 99 gibt es nicht – ohne Bezug eintragen?");
  });
  it("«Quittung» → jüngster offener Auftrag an den Trupp (quittiert, nicht erledigt); «ausgeführt» erledigt ihn", () => {
    const ex = demoExercise();
    const { e: a } = add(ex, "Auftrag an H02: Beo AK9 bis 0900", "0720");
    const { d: q } = add(ex, "Quittung H02 Auftrag erhalten", "0722");
    expect(q).toMatchObject({ art: "notiz", bezug: a.id, bezugArt: "quittung", bezugNr: nrLabel(a, ex) });
    expect(vermerkeOf(a, lvzIndex(ex.events!))).toMatchObject({ status: "offen", quittiert: { t: "2030-05-15T07:22" } });
    const { d: x } = add(ex, "H02 Auftrag ausgeführt, Beo Stao AK9", "0740");
    expect(x).toMatchObject({ art: "meldung", bezug: a.id, bezugArt: "ausgefuehrt" });
    expect(vermerkeOf(a, lvzIndex(ex.events!)).status).toBe("erledigt");
  });
  it("«zu 2 Häusern» ist kein Bezug (nur am Anfang bzw. mit Doppelpunkt)", () => {
    const ex = demoExercise();
    expect(parseMeldung("H03: 1 Fz fährt zu 2 Häusern in AN6", bernCtx(ex, "0730")).bezugNr).toBeUndefined();
    expect(parseMeldung("H03 zu 12: Fz wieder weg", bernCtx(ex, "0730")).bezugNr).toBe("12");
  });
});

describe("Zeitregel und Tag fremd", () => {
  it("Nicht-Meldung: Zeit nur am Anfang («T2 0715 Auftrag …»), «ab 2200»/«bis 1200» sind Inhalt", () => {
    const ex = demoExercise();
    expect(parseMeldung("T2 0715 Auftrag an H01: Beo NAI 1 bis 1200", bernCtx(ex, "0730")).t).toBe("2030-05-15T07:15");
    const o = parseMeldung("Kp: Lagerapport um 1800 im KP", bernCtx(ex, "0730"));
    expect(o).toMatchObject({ art: "orientierung", quelle: "Kp", t: "2030-05-15T07:30", timeFromText: false });
    expect(o.problems).toBeUndefined();
  });
  it("E17: heute kein Tag der Übung → gelb «Heute (29.10.) ist kein Tag dieser Übung …» mit Vorschlag «T2 0726»", () => {
    const ex = demoExercise();
    const now = new Date(2026, 9, 29, 9, 15);
    const d = parseMeldung("H04 2 Fz AK7", { ...bernCtx(ex, "0915"), now });
    const st = entryState(d, { hasRaster: true, online: false, placePending: false, manualPos: false, now, days: ex.days, follow: false, lastReport: "2030-05-15T07:25" });
    const r = st.reasons.find((x) => x.code === "tag-fremd")!;
    expect(r.text).toBe("Heute (29.10.) ist kein Tag dieser Übung (T1 14.05.–T2 15.05.2030).");
    expect(r.suggest).toBe("T2 0726");
    expect(st.level).toBe("pruefen");
    // mit Tagesangabe: kein Hinweis
    const d2 = parseMeldung("T2 0726 H04 2 Fz AK7", { ...bernCtx(ex, "0915"), now });
    expect(entryState(d2, { hasRaster: true, online: false, placePending: false, manualPos: false, now, days: ex.days, follow: false }).reasons.some((x) => x.code === "tag-fremd")).toBe(false);
  });
});

describe("Offen-Texte und CSV", () => {
  it("Kurztexte «Feind … (Melder)» und «– weitergemeldet Bat 07:15»", () => {
    const ex = demoExercise();
    const i = ex.events!.findIndex((e) => e.text.includes("2 Kpz AJ9"));
    let e = setVermerk(ex.events![i]!, "dringend", true, { device: "a", now: at(5) });
    e = setVermerk(e, "weiter", { an: "Bat", um: "2030-05-15T07:15" }, { device: "a", now: at(6) });
    ex.events = ex.events!.map((x, j) => (j === i ? e : x));
    expect(kurzText(e, ex.units.blau)).toBe("Feind 2 Kpz AJ9 Rtg W (H05)");
    expect(offenePunkte(ex, "2030-05-15T07:30")[0]!.text).toBe("Feind 2 Kpz AJ9 Rtg W (H05) – weitergemeldet Bat 07:15");
  });
  it("CSV: neue Spalten hinten, Art in Worten, Nummer, Bezug, Stand", () => {
    const ex = demoExercise();
    const { e: rf } = add(ex, "H04 Rückfrage: Standort Det 2?", "0725");
    add(ex, `Antwort zu ${nrLabel(rf, ex)}: Det 2 in AJ8`, "0728");
    const rows = journalToCsv(ex.events!, ex.days).replace(/^﻿/, "").split("\r\n").map((r) => r.split(";"));
    const head = rows[0]!;
    expect(head.slice(0, 15).join(";")).toBe("Tag;Zeit;Art;Element;Melder;Meldung;Zeichen;Ort;Planquadrat;NAI;E;N;Status;Fassungen;Form");
    expect(head.slice(15)).toEqual(["Nr", "Eingang", "An/Quelle", "Erfasst von", "Dringend", "Stand", "Massnahme", "Weitergemeldet", "Bezug", "Hebt auf"]);
    const col = (r: string[], n: string) => r[head.indexOf(n)];
    const rfRow = rows.find((r) => col(r, "Meldung") === "H04 Rückfrage: Standort Det 2?")!;
    expect(col(rfRow, "Art")).toBe("Rückfrage von H04");
    expect(col(rfRow, "Erfasst von")).toBe("BSP");
    expect(col(rfRow, "Stand")).toMatch(/^erledigt .* beantwortet 07:28 \(Nr \d+\)$/);
    const an = rows.find((r) => col(r, "Meldung")?.startsWith("Antwort zu"))!;
    expect(col(an, "Bezug")).toBe(nrLabel(rf, ex));
  });
});
