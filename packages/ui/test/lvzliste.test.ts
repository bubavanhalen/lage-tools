/**
 * Paket B, MVP 3 (Spez. MVP 3, Kap. 2.1–2.5, 3.3–3.5): Suche nach Nummer und Arten, Gestrichene, Vermerke in der Zeile,
 * AEIOU-Zeile, Eingang, Aufheben (jetzt), Nummer/Kürzel beim Eintragen, Invariante E3 bei Wahlen von Hand,
 * Korrektur mit Artwechsel, Vermerke mit Rückgängig. Fiktive Daten: Beispiel Bern.
 */
import { afterEach, describe, expect, it } from "vitest";
import { artOf, demoExercise, isLage, lvzIndex, nrLabel, setVermerk, type Draft, type Exercise, type LageEvent } from "@lage/core";
import { buildEvent, correctionPatch, isLageDraft, takeNr } from "../src/commit";
import { countGestrichene, filterJournal, nrQuery, takeKeyword } from "../src/journal/filter";
import { aufhebJetztEvent, aufhebText, jetztT, mapEvent, restoreEvent, setVermerkUndo, vermerkText } from "../src/journal/actions";
import { runUndo, clearUndo } from "../src/journal/journalUndo";
import { eingangText, nichtLageText, felderText, formOf, hm, vermerkTeile, zeitKurz, textMitTag, korrekturText } from "../src/entry/labels";
import { NR_KEY } from "../src/shell/contracts";

const ex0 = demoExercise();
const evs = ex0.events!;
const sperre = evs.find((e) => e.cells?.includes("AG13"))!;
const base = evs[evs.length - 1]!;

/** kleiner Eintrag (fiktiv) mit Art */
function ev(p: Partial<LageEvent>): LageEvent {
  return { ...base, id: `t-${Math.random().toString(36).slice(2)}`, rev: 1, history: undefined, lvz: undefined, ...p };
}

/** `update` auf einer Übung im Test */
function holder(ex: Exercise) {
  const h = { ex };
  return { h, update: (f: (x: Exercise) => Exercise) => { h.ex = f(structuredClone(h.ex)); } };
}

afterEach(() => clearUndo());

describe("Suche (Kap. 1.1, 2.5): Nummer, Arten, Gestrichene", () => {
  it("neue Stichwörter werden zum Chip", () => {
    expect(takeKeyword("gestrichen").art).toBe("gestrichen");
    expect(takeKeyword("dringend H05").art).toBe("dringend");
    expect(takeKeyword("offen").art).toBe("offen");
    expect(takeKeyword("Aufträge").art).toBe("auftrag");
    expect(takeKeyword("rückfrage").art).toBe("rueckfrage");
    expect(takeKeyword("Vbk").art).toBe("vbk");
    expect(takeKeyword("Notiz").art).toBe("notiz");
  });
  it("eine Zahl sucht die laufende Nummer («54», «Nr 54», «12a»)", () => {
    expect(nrQuery("54")).toBe("54");
    expect(nrQuery("Nr 54")).toBe("54");
    expect(nrQuery("nr. 12A")).toBe("12a");
    expect(nrQuery("NAI 2")).toBeNull();
    const e = evs[3]!;
    const n = nrLabel(e, ex0);
    const list = filterJournal(evs, { q: n, ex: ex0 });
    expect(list.map((x) => x.id)).toEqual([e.id]);
  });
  it("Feind/Eigene/Unklar zeigen nur Meldungen, Auftrag nur Aufträge", () => {
    const a = ev({ art: "auftrag", notiz: true, an: "H01", text: "Auftrag an H01: Beo NAI 1", side: "blau", aff: "F", pos: undefined });
    const all = [...evs, a];
    expect(filterJournal(all, { art: "auftrag" }).map((x) => x.id)).toEqual([a.id]);
    expect(filterJournal(all, { art: "eigen" }).some((x) => x.id === a.id)).toBe(false);
  });
  it("Gestrichene: nur mit Schalter an ihrer Zeit, Art «gestrichen» nur diese, Anzahl", () => {
    const del = { ...evs[0]!, deleted: true };
    const all = [del, ...evs.slice(1)];
    expect(filterJournal(all, {}).some((x) => x.id === del.id)).toBe(false);
    expect(filterJournal(all, { gestrichene: true }).some((x) => x.id === del.id)).toBe(true);
    expect(filterJournal(all, { art: "gestrichen" }).map((x) => x.id)).toEqual([del.id]);
    expect(countGestrichene(all)).toBe(1);
    expect(countGestrichene(all, { to: "2000-01-01T00:00" })).toBe(0);
  });
  it("dringend/offen über die Vermerke", () => {
    const d = setVermerk(evs[1]!, "dringend", true, { device: "test", kuerzel: "BSP" });
    const all = [d, ...evs.filter((x) => x.id !== d.id)];
    const ex = { ...ex0, events: all };
    expect(filterJournal(all, { art: "dringend", ex }).map((x) => x.id)).toEqual([d.id]);
    expect(filterJournal(all, { art: "offen", ex }).map((x) => x.id)).toEqual([d.id]);
  });
});

describe("Zeile (Kap. 2.1, 4): Form, Vermerke, Eingang, Text", () => {
  it("Formen je Art", () => {
    expect(formOf({ side: "rot", aff: "H" })).toBe("feind");
    expect(formOf({ side: "blau", aff: "F", art: "auftrag", notiz: true })).toBe("notiz");
    expect(formOf({ side: "blau", aff: "F", art: "vbk", notiz: true })).toBe("vbk");
    expect(formOf({ side: "blau", aff: "F", notiz: true })).toBe("notiz");
    expect(formOf({ side: "blau", aff: "F", art: "meldung", hebtAuf: "x" })).toBe("aufheb");
  });
  it("Vermerke in Klartext: dringend, Massnahme, weitergemeldet, Frist, offen, beantwortet", () => {
    let e = ev({ text: "H05 2 Kpz Rtg W" });
    e = setVermerk(e, "dringend", true, { device: "a" });
    e = setVermerk(e, "massnahme", "Zfhr orientiert", { device: "a" });
    e = setVermerk(e, "weiter", { an: "Bat", um: "2030-05-15T07:15" }, { device: "a" });
    const ex = { ...ex0, events: [...evs, e] };
    const t = vermerkTeile(e, ex, lvzIndex(ex.events)).map((x) => x.t);
    // Meldung: «offen» steht nicht extra (dringend sagt es schon)
    expect(t).toEqual(["dringend", "Massnahme: Zfhr orientiert", "weitergemeldet Bat 07:15"]);

    const rf = ev({ art: "rueckfrage", notiz: true, melder: "H04", text: "H04 Rückfrage: Standort Det 2?", nr: 70 });
    const an = ev({ art: "meldung", melder: "H04", text: "Antwort zu 70: Det 2 in AJ8", bezug: rf.id, bezugArt: "antwort", t: "2030-05-15T07:35", nr: 71 });
    const auf = ev({ art: "auftrag", notiz: true, an: "H01", frist: "2030-05-15T12:00", text: "Auftrag an H01: Beo NAI 1 bis 1200", nr: 72 });
    const ex2 = { ...ex0, events: [...evs, rf, an, auf] };
    const idx = lvzIndex(ex2.events);
    expect(vermerkTeile(rf, ex2, idx).map((x) => x.t)).toEqual(["beantwortet 07:35 (Nr 71)", "erledigt " + hm(an.createdAt)]);
    expect(vermerkTeile(an, ex2, idx).map((x) => x.t)).toEqual(["Antwort auf Nr 70"]);
    expect(vermerkTeile(auf, ex2, idx).map((x) => x.t)).toEqual(["bis 12:00", "offen"]);
  });
  it("Eingang erst ab 5 min Abstand", () => {
    expect(eingangText({ t: "2030-05-15T07:00", tReported: "2030-05-15T07:30" })).toBe("Eingang 07:30");
    expect(eingangText({ t: "2030-05-15T07:27", tReported: "2030-05-15T07:30" })).toBeNull();
    expect(eingangText({ t: "2030-05-15T07:27" })).toBeNull();
  });
  it("Nicht-Meldung ohne doppelten Art-Hinweis; Vbk und Quittung behalten den Text", () => {
    const blau = ex0.units.blau;
    expect(nichtLageText({ text: "Auftrag an H01: Beo NAI 1 bis 1200", art: "auftrag" }, blau)).toBe("Beo NAI 1 bis 1200");
    expect(nichtLageText({ text: "H04 Rückfrage: Standort Det 2?", melder: "H04", art: "rueckfrage" }, blau)).toBe("Standort Det 2?");
    expect(nichtLageText({ text: "H02 Vbk i.O.", melder: "H02", art: "vbk" }, blau)).toBe("");
    expect(nichtLageText({ text: "H03 keine Verbindung", melder: "H03", art: "vbk" }, blau)).toBe("");
    expect(nichtLageText({ text: "H02 Vbk gut, Standort AK7", melder: "H02", art: "vbk" }, blau)).toBe("Vbk gut, Standort AK7");
    expect(nichtLageText({ text: "Quittung H02 Auftrag erhalten", art: "notiz", bezugArt: "quittung" }, blau)).toBe("Quittung H02 Auftrag erhalten");
  });
});

describe("AEIOU / Meldezettel (Kap. 2.2)", () => {
  it("Zeile «gelesen als AEIOU» – U wird nie ausgewertet", () => {
    expect(felderText({ schema: "aeiou", wann: "1020", was: "3 Pers bewaffnet", wie: "Rtg W", wo: "AF8 C", umwelt: "beobachten weiter", melder: "H03" }))
      .toBe("gelesen als AEIOU: A 10:20 · E 3 Pers bewaffnet · I Rtg W · O AF8 C · U nicht ausgewertet · Melder H03");
    expect(felderText({ schema: "formular", wann: "0720", melder: "H03", was: "3 Pers bewaffnet", wo: "AF8" }))
      .toBe("gelesen als Meldezettel: Wann 07:20 · Melder H03 · Was 3 Pers bewaffnet · Wo AF8");
  });
});

describe("Aufheben (jetzt) (Kap. 3.5)", () => {
  it("aufhebende Meldung zeichnet nie: ohne Ort/Element, Ort nur als Text, hebtAuf = Ziel", () => {
    const a = aufhebJetztEvent(sperre, ex0, { device: "test", kuerzel: "BSP", nr: 99, now: new Date("2030-05-15T07:40:00+02:00") });
    expect(a.hebtAuf).toBe(sperre.id);
    expect(a.pos).toBeUndefined();
    expect(a.cells).toBeUndefined();
    expect(a.unit).toBe("");
    expect(a.orte?.[0]).toMatch(/^AG13/);
    expect(a.text).toMatch(/AG13 aufgehoben$/);
    expect(aufhebText(sperre)).toMatch(/AG13 aufgehoben$/);
    expect(a.erfasstVon).toBe("BSP");
    expect(a.nr).toBe(99);
    expect(isLage(a)).toBe(false);
    expect(artOf(a)).toBe("meldung");
  });
  it("Zeit: Geräteuhr am Übungstag, sonst letzte Meldung + 1 min (nie ein erfundener Tag)", () => {
    expect(jetztT(ex0, new Date(2030, 4, 15, 7, 40))).toBe("2030-05-15T07:40");
    const last = [...evs].sort((x, y) => (x.t < y.t ? 1 : -1))[0]!.t;
    const t = jetztT(ex0, new Date("2026-10-29T10:00:00+01:00"));
    expect(t > last).toBe(true);
    expect(t.slice(0, 10)).toBe(last.slice(0, 10));
  });
});

describe("Eintragen (Kap. 3.3, E3): Nummer, Kürzel, Invariante", () => {
  const draftOf = (p: Partial<Draft>): Draft => ({
    minutes: 450, day: "2030-05-15", t: "2030-05-15T07:30", timeFromText: false, kind: "feind", kindFrom: "inhalt", side: "rot", melder: "H04", unit: "",
    sym: "einheit", aff: "H", sidc: base.sidc, status: "present", text: "H04 2 Fz AK7", art: "meldung", artFrom: "standard",
    pos: { e: 2600000, n: 1200000 }, where: { kind: "raster", label: "AK7" }, cells: ["AK7"], ...p,
  });
  it("Nummer und «erfasst von» kommen an den Eintrag", () => {
    const e = buildEvent(draftOf({}), "geraet-a", ex0, { nr: 57, kuerzel: "BSP" });
    expect(e.nr).toBe(57);
    expect(e.von).toBe("geraet-a");
    expect(e.erfasstVon).toBe("BSP");
  });
  it("Nicht-Meldung: Ort/Zeichen von Hand werden nie übernommen", () => {
    const d = draftOf({ art: "auftrag", an: "H01", text: "Auftrag an H01: Beo NAI 1" });
    expect(isLageDraft(d)).toBe(false);
    const e = buildEvent(d, "geraet-a", ex0, { pos: { e: 2601000, n: 1201000 }, where: "Karte", sym: { key: "kpz", aff: "H", sidc: base.sidc } });
    expect(e.pos).toBeUndefined();
    expect(e.cells).toBeUndefined();
    expect(e.notiz).toBe(true);
    expect(e.art).toBe("auftrag");
    expect(e.sym).not.toBe("kpz");
  });
  it("Aufhebung: Ort nur als Text", () => {
    const e = buildEvent(draftOf({ hebtAuf: sperre.id, orte: ["AG13"], text: "H04 Sperre AG13 aufgehoben", cells: ["AG13"], where: { kind: "raster", label: "AG13" } }), "geraet-a", ex0, {});
    expect(e.pos).toBeUndefined();
    expect(e.unit).toBe("");
    expect(e.orte).toEqual(["AG13"]);
  });
  it("takeNr: Gerätezähler geteilt, nie unter der höchsten Nummer der Übung", () => {
    const mem = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown };
    const old = g.localStorage;
    g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    try {
      const max = Math.max(...evs.map((e) => Number(nrLabel(e, ex0)) || 0));
      const a = takeNr(ex0), b = takeNr(ex0);
      expect(a).toBe(max + 1);
      expect(b).toBe(max + 2);
      expect(mem.get(NR_KEY(ex0.id))).toBe(String(max + 2));
    } finally { g.localStorage = old; }
  });
  it("Korrektur mit Artwechsel Meldung → Rückfrage entfernt Ort und Zeichen", () => {
    const m = evs.find((e) => e.pos && e.side === "rot")!;
    const cand = buildEvent(draftOf({ art: "rueckfrage", text: "Rückfrage: Standort Det 2?", melder: "H04", pos: undefined, where: undefined, cells: undefined }), "g", ex0, {});
    const p = correctionPatch(m, cand, { keepPlace: true, keepSymbol: true, keepTime: true });
    expect(p.art).toBe("rueckfrage");
    expect("pos" in p && p.pos === undefined).toBe(true);
    expect(p.notiz).toBe(true);
  });
});

describe("Vermerke und Zurückholen mit Rückgängig (Kap. 2.4, 3.4)", () => {
  it("Dringend setzen ändert die Revision nicht; Rückgängig stellt den vorherigen Stand her", () => {
    const { h, update } = holder(structuredClone(ex0));
    const id = evs[2]!.id;
    const rev = evs[2]!.rev;
    setVermerkUndo(update, h.ex, id, "dringend", true, { device: "a", kuerzel: "BSP" });
    let e = h.ex.events!.find((x) => x.id === id)!;
    expect(e.lvz?.dringend?.v).toBe(true);
    expect(e.lvz?.dringend?.von).toBe("BSP");
    expect(e.rev).toBe(rev);
    expect(runUndo()).toBe(true);
    e = h.ex.events!.find((x) => x.id === id)!;
    // neutraler Wert mit neuem Stempel (gewinnt beim Zusammenführen gegen «dringend»)
    expect(e.lvz?.dringend?.v).toBe(false);
  });
  it("Rückgängig von «erledigt» bei dringender Meldung: wieder offen (abgeleitet, mit Stempel)", () => {
    const { h, update } = holder(structuredClone(ex0));
    const id = evs[2]!.id;
    setVermerkUndo(update, h.ex, id, "dringend", true, { device: "a" });
    setVermerkUndo(update, h.ex, id, "status", "erledigt", { device: "a" });
    runUndo();
    const e = h.ex.events!.find((x) => x.id === id)!;
    expect(e.lvz?.status?.v).toBe("offen");
    expect(e.lvz?.dringend?.v).toBe(true);
  });
  it("Texte der Leiste", () => {
    expect(vermerkText("dringend", true, "54")).toBe("Dringend gesetzt");
    expect(vermerkText("dringend", false, "54")).toBe("Dringend entfernt");
    expect(vermerkText("status", "erledigt", "55")).toBe("Nr 55 erledigt");
    expect(vermerkText("weiter", { an: "Bat", um: "2030-05-15T07:15" }, "54")).toBe("Weitergemeldet an Bat 07:15");
  });
  it("Zurückholen = Revision mit deleted: false, Rückgängig streicht wieder", () => {
    const ex = structuredClone(ex0);
    const id = ex.events![0]!.id;
    ex.events = ex.events!.map((x) => (x.id === id ? { ...x, deleted: true } : x));
    const { h, update } = holder(ex);
    restoreEvent(update, h.ex, id, "a", "BSP");
    expect(h.ex.events!.find((x) => x.id === id)!.deleted).toBe(false);
    expect(h.ex.events!.find((x) => x.id === id)!.geaendertVon).toBe("BSP");
    runUndo();
    expect(h.ex.events!.find((x) => x.id === id)!.deleted).toBe(true);
  });
  it("mapEvent ersetzt genau einen Eintrag (übrige gleiche Objekte)", () => {
    const x = { ...ex0, events: [...evs] };
    const before = x.events;
    mapEvent(x, evs[0]!.id, (e) => ({ ...e, text: "neu" }));
    expect(x.events![0]!.text).toBe("neu");
    expect(x.events![1]).toBe(before[1]);
  });
});


describe("Nachbesserung MVP 3 (UI)", () => {
  const days = ["2030-05-14", "2030-05-15"];
  it("Zeiten anderer Tage mit Tageskürzel (M3)", () => {
    expect(zeitKurz("2030-05-15T07:06", "2030-05-15T08:00", days)).toBe("07:06");
    expect(zeitKurz("2030-05-14T07:06", "2030-05-15T08:00", days)).toBe("T1 07:06");
    expect(zeitKurz("2030-05-13T07:06", "2030-05-15T08:00", days)).toBe("13.05. 07:06");
    expect(textMitTag("H01 seit 900 min ohne Meldung (letzte 17:29 AK7)", "2030-05-14T17:29", "2030-05-15T08:00", days)).toBe("H01 seit 900 min ohne Meldung (letzte T1 17:29 AK7)");
  });
  it("Rückgängig-Text der Korrektur nennt die Art (Feind → Rückfrage)", () => {
    const e = { id: "a", rev: 1, device: "d", updatedAt: "x", t: "2030-05-15T07:00", side: "rot" as const, unit: "", text: "H04 Standort Det 2", sym: "einheit", aff: "H" as const, source: { kind: "text" as const }, confirmed: true, melder: "H04" };
    expect(korrekturText(e, { ...e, art: "rueckfrage", notiz: true, side: "blau", aff: "F" })).toBe("Feind → Rückfrage");
  });
});

describe("Suche: Satzzeichen trennen (Übergabe M4)", () => {
  it("«Standort Det 2» findet «Rückfrage: Standort Det 2?»", () => {
    const ex = demoExercise();
    const e: LageEvent = { id: "rf", rev: 1, device: "d", updatedAt: "2030-05-15T05:00:00.000Z", t: "2030-05-15T07:00", side: "blau", unit: "", text: "H04 Rückfrage: Standort Det 2?", sym: "einheit", aff: "F", source: { kind: "text" }, confirmed: true, art: "rueckfrage", notiz: true, melder: "H04" };
    const r = filterJournal([...(ex.events ?? []), e], { q: "Standort Det 2", ex });
    expect(r.map((x) => x.id)).toContain("rf");
  });
});
