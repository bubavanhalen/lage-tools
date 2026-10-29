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
  it("Antwort mit Bezug bleibt Meldung (auch doppelte Nummer «12a»)", () => {
    expect(r("Antwort zu 57: Det 2 in AJ8")).toMatchObject({ art: "meldung", bezugNr: "57", bezugArt: "antwort" });
    expect(r("Antwort auf 12a: Det 1 AN6")).toMatchObject({ bezugNr: "12a" });
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
