/**
 * Eintragsarten (Spez. MVP 3, Kap. 3.1) – Phase 0: Verträge und erste Erkennung. Paket A ergänzt alle Fälle aus Kap. 8.1
 * (über `parseMeldung`, sobald `readArt` verdrahtet ist).
 */
import { describe, expect, it } from "vitest";
import { ART_LABEL, ENTRY_ARTEN, artOf, artText, isLage, istDringend, lebenszeichen, readArt, type LageEvent } from "../src";

const blau = ["H01", "H02", "H03", "H04", "H05"];
const ev = (p: Partial<LageEvent>): LageEvent => ({ id: "x", rev: 1, device: "d", updatedAt: "2030-05-15T05:00:00.000Z", t: "2030-05-15T07:00", side: "blau", unit: "", text: "", sym: "einheit", aff: "F", confirmed: true, ...p });

describe("artOf / isLage / lebenszeichen", () => {
  it("alte Einträge: notiz → Notiz, sonst Meldung", () => {
    expect(artOf({})).toBe("meldung");
    expect(artOf({ notiz: true })).toBe("notiz");
    expect(artOf({ art: "auftrag", notiz: true })).toBe("auftrag");
  });
  it("isLage nur für nicht gestrichene Meldungen ohne Aufhebung", () => {
    expect(isLage({})).toBe(true);
    expect(isLage({ deleted: true })).toBe(false);
    expect(isLage({ hebtAuf: "a" })).toBe(false);
    expect(isLage({ art: "rueckfrage", notiz: true })).toBe(false);
  });
  it("Lebenszeichen: Meldung, Rückfrage, Quittung, Vbk ausser «keine»", () => {
    expect(lebenszeichen(ev({ melder: "H02" }))).toBe("H02");
    expect(lebenszeichen(ev({ art: "vbk", melder: "H02", vbk: "gut" }))).toBe("H02");
    expect(lebenszeichen(ev({ art: "vbk", melder: "H03", vbk: "keine" }))).toBeNull();
    expect(lebenszeichen(ev({ art: "notiz", melder: "H02", bezugArt: "quittung" }))).toBe("H02");
    expect(lebenszeichen(ev({ art: "notiz", melder: "H02" }))).toBeNull();
    expect(lebenszeichen(ev({ art: "auftrag", an: "H01" }))).toBeNull();
    expect(lebenszeichen(ev({ melder: "H02", deleted: true }))).toBeNull();
  });
  it("Texte", () => {
    expect(ENTRY_ARTEN.map((a) => ART_LABEL[a])).toEqual(["Meldung", "Auftrag", "Orientierung", "Rückfrage", "Verbindungskontrolle", "Notiz"]);
    expect(artText(ev({ art: "auftrag", an: "H01" }))).toBe("Auftrag an H01");
    expect(artText(ev({ art: "orientierung", quelle: "Bat" }))).toBe("Orientierung Bat");
    expect(artText(ev({ art: "rueckfrage", melder: "H04" }))).toBe("Rückfrage von H04");
    expect(artText(ev({ art: "rueckfrage", an: "H03" }))).toBe("Rückfrage an H03");
    expect(artText(ev({ art: "vbk", melder: "H02", vbk: "gut" }))).toBe("Verbindung H02 gut");
    expect(artText(ev({ art: "notiz" }))).toBe("Notiz");
    expect(artText(ev({ side: "rot", aff: "H" }))).toBe("Feind");
    expect(artText(ev({ side: "rot", aff: "U" }))).toBe("Unklar");
    expect(artText(ev({ notiz: true }))).toBe("Notiz");
  });
});

describe("readArt (Kap. 3.1, Fälle aus 8.1)", () => {
  const r = (t: string) => readArt(t, { blau });
  it("Auftrag stark mit Empfänger und Frist", () => {
    expect(r("Auftrag an H01: Beo NAI 1 bis 1200")).toMatchObject({ art: "auftrag", stark: true, an: "H01", frist: "1200", rest: "Beo NAI 1 bis 1200" });
    expect(r("Befehl für H3: Stellungswechsel AE7")).toMatchObject({ art: "auftrag", stark: true, an: "H03" });
    expect(r("H02 erhält Auftrag: Beo AK9")).toMatchObject({ art: "auftrag", stark: true, an: "H02" });
  });
  it("Auftrag schwach («befohlen erhalten»)", () => {
    expect(r("H05 hat Stellungswechsel nach AQ12 befohlen erhalten")).toMatchObject({ art: "auftrag", stark: false, an: "H05" });
  });
  it("«Auftrag ausgeführt» bleibt Meldung", () => {
    expect(r("H02 Auftrag ausgeführt, Beo Stao AJ9")).toMatchObject({ art: "meldung", bezugArt: "ausgefuehrt" });
  });
  it("Rückfrage stark und schwach", () => {
    expect(r("H04 Rückfrage: Standort Det 2?")).toMatchObject({ art: "rueckfrage", stark: true, rest: "Standort Det 2?" });
    expect(r("Rückfrage an H03: wo steht ihr")).toMatchObject({ art: "rueckfrage", stark: true, an: "H03" });
    expect(r("H02 ist das Det 2?")).toMatchObject({ art: "rueckfrage", stark: false });
  });
  it("Orientierung von oben (Zeiten sind Inhalt)", () => {
    expect(r("Bat: Feind Kp-Stärke erwartet aus Rtg Belp ab 2200")).toMatchObject({ art: "orientierung", stark: true, quelle: "Bat" });
    expect(r("Orientierung von Kp: Ablösung 1400")).toMatchObject({ art: "orientierung", quelle: "Kp" });
  });
  it("Verbindungskontrolle", () => {
    expect(r("H02 Vbk i.O.")).toMatchObject({ art: "vbk", vbk: "gut" });
    expect(r("H04 Vbk schlecht")).toMatchObject({ art: "vbk", vbk: "schlecht" });
    expect(r("H03 keine Verbindung")).toMatchObject({ art: "vbk", vbk: "keine" });
    expect(r("Verbindung gut mit H01")).toMatchObject({ art: "vbk", vbk: "gut" });
  });
  it("Notiz und Quittung (Entscheid 5: Notiz mit Bezug)", () => {
    expect(r("Notiz: Akku gewechselt")).toMatchObject({ art: "notiz", stark: true, rest: "Akku gewechselt" });
    expect(r("Quittung H02 Auftrag erhalten")).toMatchObject({ art: "notiz", bezugArt: "quittung" });
    expect(r("Quittung 42")).toMatchObject({ art: "notiz", bezugArt: "quittung", bezugNr: "42" });
  });
  it("Antwort mit Bezug ist Notiz (Entscheid MVP 3 Nachbesserung; auch doppelte Nummer «12a»)", () => {
    expect(r("Antwort zu 57: Det 2 in AJ8")).toMatchObject({ art: "notiz", bezugNr: "57", bezugArt: "antwort" });
    expect(r("Antwort auf 12a: Det 1 AN6")).toMatchObject({ bezugNr: "12a" });
  });
  it("Trupp vorne (Trupp-Knopf): «H04 Auftrag an H01 …», «H04 Bat: …», «H02 Notiz: …» bleiben erkannt", () => {
    expect(r("H04 Auftrag an H01: Beo NAI 1 bis 1200")).toMatchObject({ art: "auftrag", stark: true, an: "H01", frist: "1200", rest: "Beo NAI 1 bis 1200" });
    expect(r("H04 Bat: Feind erwartet ab 2200")).toMatchObject({ art: "orientierung", quelle: "Bat" });
    expect(r("H02 Notiz: Akku gewechselt")).toMatchObject({ art: "notiz", rest: "Akku gewechselt" });
    expect(r("0725 H02 Vbk i.O.")).toMatchObject({ art: "vbk", vbk: "gut" });
    expect(r("T2 0725 Auftrag an H03: Beo NAI 2")).toMatchObject({ art: "auftrag", an: "H03" });
  });
  it("gewöhnliche Meldungen bleiben Meldungen", () => {
    for (const t of ["H03: 1 Fz in NAI 2 Rtg N", "Kontakt! H02, Feuer aus AK9, 2 Schützen, wir halten", "H05 1 Verwundeter, Sanität angefordert", "H03 wir weichen aus nach AG9", "T2 0705 H04: gn Sperre in AG13"]) {
      expect(r(t).art, t).toBe("meldung");
    }
  });
});

describe("istDringend (Vorschlag)", () => {
  it("Schlüsselwörter", () => {
    expect(istDringend("Kontakt! H02, Feuer aus AK9", { eigenerMelder: true })).toBe(true);
    expect(istDringend("dringend: 2 Kpz AK9", { eigenerMelder: false })).toBe(true);
    expect(istDringend("H05 1 Verwundeter, Sanität angefordert", { eigenerMelder: true })).toBe(true);
    expect(istDringend("H05 1 Verwundeter", { eigenerMelder: true })).toBe(true);
    expect(istDringend("1 Verwundeter bei Rot gesehen", { eigenerMelder: false })).toBe(false);
    expect(istDringend("H03: 1 Fz in NAI 2 Rtg N", { eigenerMelder: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Einsatz-Szenario des Prüfers (Spez. MVP 3, Kap. 8.1) ohne Browser: tippen → Entwurf/Zustand → eintragen → Lage.
// Beispiel Bern (fiktiv), Uhr T2 07:30, Kürzel BSP. Budget: 0 falsche Zeichen, 0 verschobene Trupps ausser bei eigener Lage.
import {
  analyzeJournal, demoExercise, entryState, eventFromDraft, lageBlau, lastPosition, nrLabel, offenePunkte, parseMeldung, situationAt,
  vermerkeOf, lvzIndex, type Draft, type EntryLevel, type Exercise,
} from "../src";

describe("Einsatz-Szenario des Prüfers (Kap. 8.1)", () => {
  const now = new Date(2030, 4, 15, 7, 30);
  const T = "2030-05-15T07:30";
  const STANDORTE: Record<string, string> = { H01: "AC6 B", H02: "AL9 A", H03: "AP4 D", H04: "AF12 A", H05: "AQ11 C" };
  interface Fall { text: string | ((m: Record<string, string>) => string); art: string; zustand: EntryLevel[]; zeichen: number | null; bleibt?: string[]; pruef?: (d: Draft, ex: Exercise, m: Record<string, string>, id: string) => void }
  const FAELLE: Record<string, Fall> = {
    "1": { text: "Wann: 0720 Wer: H03 Was: 3 Pers bewaffnet Wo: AF8", art: "meldung", zustand: ["bereit"], zeichen: 1,
      pruef: (d) => { expect(d.t.slice(11)).toBe("07:20"); expect(d.felder?.schema).toBe("formular"); expect(d.cells).toEqual(["AF8"]); expect(d.kind).toBe("feind"); } },
    "2": { text: "H03 A: 0721 E: 3 Pers bewaffnet I: Rtg W O: AF8 C U: beobachten weiter", art: "meldung", zustand: ["bereit"], zeichen: 1, bleibt: ["H03"],
      pruef: (d) => { expect(d.felder?.schema).toBe("aeiou"); expect(d.melder).toBe("H03"); expect(d.cells).toEqual(["AF8 C"]); expect(d.dir).toBe(270); expect(d.sym).not.toBe("beo_stao"); expect(d.text).toContain("U: beobachten weiter"); } },
    "2b": { text: "A: 0722 E: H03 I: 3 Pers bewaffnet Rtg W O: AF8 C U: beobachten weiter", art: "meldung", zustand: ["pruefen"], zeichen: null,
      pruef: (d) => { expect(d.melder).toBe(""); expect(d.felder?.was).toBe("H03"); } },
    "3": { text: "H03 meldet: um 0723 3 Pers bewaffnet in AF8", art: "meldung", zustand: ["bereit"], zeichen: 1, pruef: (d) => expect(d.t.slice(11)).toBe("07:23") },
    "4": { text: "Kontakt! H02, Feuer aus AK9, 2 Schützen, wir halten", art: "meldung", zustand: ["bereit"], zeichen: 1, bleibt: ["H02"], pruef: (d) => expect(d.dringend).toBe(true) },
    "5": { text: "H04 Rückfrage: Standort Det 2?", art: "rueckfrage", zustand: ["bereit"], zeichen: 0,
      pruef: (d, ex, m, id) => { m.rueckfrage = nrLabel(ex.events!.find((e) => e.id === id)!, ex); expect(offenePunkte(ex, T).some((o) => o.art === "rueckfrage" && o.text.startsWith("von H04"))).toBe(true); } },
    "6": { text: "Auftrag an H01: Beo NAI 1 bis 1200", art: "auftrag", zustand: ["bereit"], zeichen: 0, bleibt: ["H01"],
      pruef: (d, ex) => { expect(d.t).toBe(T); expect(d).toMatchObject({ an: "H01", frist: "2030-05-15T12:00", orte: ["NAI 1"] }); expect(offenePunkte(ex, T).find((o) => o.art === "auftrag")?.text).toBe("an H01: Beo NAI 1 – bis 12:00"); } },
    "7": { text: "H05 hat Stellungswechsel nach AQ12 befohlen erhalten", art: "auftrag", zustand: ["pruefen"], zeichen: 0, bleibt: ["H05"], pruef: (d) => expect(d.an).toBe("H05") },
    "8": { text: "Quittung H02 Auftrag erhalten", art: "notiz", zustand: ["bereit"], zeichen: 0, pruef: (d) => { expect(d.bezugArt).toBe("quittung"); expect(d.melder).toBe("H02"); } },
    "9": { text: "Bat: Feind Kp-Stärke erwartet aus Rtg Belp ab 2200", art: "orientierung", zustand: ["bereit"], zeichen: 0, pruef: (d) => { expect(d.quelle).toBe("Bat"); expect(d.t).toBe(T); expect(d.desc).toBeUndefined(); } },
    "10": { text: "H05 1 Verwundeter, Sanität angefordert", art: "meldung", zustand: ["bereit"], zeichen: null, bleibt: ["H05"], pruef: (d) => { expect(d.kind).toBe("eigen"); expect(d.dringend).toBe(true); } },
    "11": { text: "H03 wir weichen aus nach AG9", art: "meldung", zustand: ["bereit", "pruefen"], zeichen: null, pruef: (d) => expect(d.kind).not.toBe("feind") },
    "12": { text: "H02 Vbk i.O.", art: "vbk", zustand: ["bereit"], zeichen: 0, bleibt: ["H02"], pruef: (d, ex, _m, id) => { expect(d.vbk).toBe("gut"); expect(artText(ex.events!.find((e) => e.id === id)!)).toBe("Verbindung H02 gut"); } },
    "13": { text: "H03 keine Verbindung", art: "vbk", zustand: ["bereit"], zeichen: 0, pruef: (_d, ex) => expect(offenePunkte(ex, T).some((o) => o.text.startsWith("H03: keine Verbindung"))).toBe(true) },
    // Entscheid MVP 3 Nachbesserung: Antwort = Notiz mit Bezug (kein Zeichen), übernimmt den Trupp der Rückfrage
    "14": { text: (m) => `Antwort zu ${m.rueckfrage}: Det 2 in AJ8`, art: "notiz", zustand: ["bereit"], zeichen: 0,
      pruef: (d, ex) => {
        expect(d.bezugArt).toBe("antwort");
        expect(d.melder).toBe("H04");
        expect(offenePunkte(ex, T).some((o) => o.art === "rueckfrage")).toBe(false);
        const rf = ex.events!.find((e) => e.id === d.bezug)!;
        expect(vermerkeOf(rf, lvzIndex(ex.events!)).beantwortet).toBeTruthy();
      } },
    "15": { text: "H04 Sperre AG13 aufgehoben", art: "meldung", zustand: ["bereit"], zeichen: -1,
      pruef: (d, ex) => {
        const ziel = ex.events!.find((e) => e.id === d.hebtAuf)!;
        expect(ziel.text).toContain("Sperre in AG13");
        expect(d.pos).toBeUndefined();
        // Rückblick vor der Aufhebung zeigt die Sperre
        expect(situationAt(ex.events!, "2030-05-15T07:10").loose.some((e) => e.id === ziel.id)).toBe(true);
        expect(situationAt(ex.events!, T).loose.some((e) => e.id === ziel.id)).toBe(false);
      } },
  };
  const placeOf = (ex: Exercise, u: string) => lageBlau(ex, T).find((z) => z.trupp === u)?.ort;
  const ex = demoExercise();
  const merk: Record<string, string> = {};
  let nr = 0;
  // Reihenfolge wie in der Spez. («2b» nach «2»; Object.entries sortiert Zahl-Schlüssel vor)
  const ORDER = ["1", "2", "2b", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"];
  for (const k of ORDER) {
    const f = FAELLE[k]!;
    it(`#${k} ${typeof f.text === "string" ? f.text : "Antwort zu …"}`, () => {
      const text = typeof f.text === "string" ? f.text : f.text(merk);
      const events = ex.events!;
      const d = parseMeldung(text, { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, s) => lastPosition(events, s, u), events, ex });
      const st = entryState(d, { hasRaster: true, online: false, placePending: false, manualPos: false, now, sheets: ex.sheets, areas: ex.areas, knownUnits: ex.units.blau, unitsPrepared: true, days: ex.days });
      expect(d.art, "Art").toBe(f.art);
      expect(f.zustand, `Zustand ${st.level}: ${st.reasons.map((r) => r.text).join(" | ")}`).toContain(st.level);
      if (f.art !== "meldung") { expect(d.pos).toBeUndefined(); expect(d.unit).toBe(""); expect(d.cells).toBeUndefined(); expect(d.nai).toBeUndefined(); }
      const vorher = situationAt(events, T);
      // Eingang je Fall eine Sekunde später (wie beim echten Tippen; gleiche Minute, Reihenfolge eindeutig)
      const e = eventFromDraft(d, "dev-pruef", new Date(now.getTime() + ORDER.indexOf(k) * 1000), { nr: ++nr + 1000, kuerzel: "BSP" });
      expect(e.erfasstVon).toBe("BSP");
      ex.events = [...events, e];
      const nachher = situationAt(ex.events, T);
      const marker = (s: typeof vorher) => s.loose.length + s.units.length;
      if (f.zeichen !== null) expect(marker(nachher) - marker(vorher), "Zeichen").toBe(f.zeichen === 1 && nachher.units.length === vorher.units.length && d.unit ? 0 : f.zeichen);
      // keine Feind-/Unklar-Zeichen aus Nicht-Meldungen; Trupps bleiben (ausser eigene Lage)
      if (f.art !== "meldung") expect(nachher.loose.some((x) => x.id === e.id) || nachher.units.some((u) => u.event.id === e.id)).toBe(false);
      // #11 ist eigene Lage (H03 weicht aus nach AG9) – danach steht H03 dort
      if (k === "11") STANDORTE.H03 = "AG9";
      for (const u of [...(f.bleibt ?? []), ...(d.kind === "eigen" && d.unit ? [] : Object.keys(STANDORTE))]) {
        expect(placeOf(ex, u), `${u} verschoben`).toBe(STANDORTE[u]);
      }
      f.pruef?.(d, ex, merk, e.id);
    });
  }
  it("Lebenszeichen: Quittung und Vbk zählen für «still», Vbk «keine» nicht", () => {
    const blau = lageBlau(ex, T);
    expect(blau.find((z) => z.trupp === "H02")?.letzteVbk).toMatchObject({ ergebnis: "gut" });
    expect(blau.find((z) => z.trupp === "H03")?.letzteVbk).toMatchObject({ ergebnis: "keine" });
    expect(analyzeJournal(ex, { t: T }).hints.length).toBeGreaterThan(0);
  });
});
