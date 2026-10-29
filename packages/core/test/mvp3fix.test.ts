/**
 * MVP 3 Nachbesserung (Prüfberichte review3: Einsatz, Übergabe, Feld/Leistung) – Tabellentest mit allen Sätzen der drei
 * Berichte. Budget: 0 falsche Zeichen, kein Trupp verschoben ausser bei eigener Lage, «letzter Standort» nie als Ort.
 * Entscheide des Koordinators: Antwort = Notiz mit Bezug · Aufheben zeichnet nie · Orientierung von oben («Bat …» auch ohne
 * Doppelpunkt) · Zeit bei Nicht-Meldungen nur am Anfang · Standort bleibt · schwache Rückfrage ohne «?».
 * Nur fiktive Daten (Beispiel Bern, `demoExercise`).
 */
import { describe, expect, it } from "vitest";
import {
  analyzeJournal, artText, aufhebDraft, computeRedCoas, correctionSummary, demoExercise, entryState, eventFromDraft, journalToCsv, kindLabel,
  lageBlau, lastPosition, lebenszeichen, letzteRotAktivitaet, lvzIndex, nrLabel, offenePunkte, parseMeldung, rapportZahlen, situationAt,
  vermerkeOf, vonOben, type Draft, type EntryArt, type EntryLevel, type EntryState, type Exercise, type Kind, type LageEvent,
} from "../src";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const at = (hhmm: string, day = 15) => new Date(2030, 4, day, +hhmm.slice(0, 2), +hhmm.slice(2));

/** Meldungsfeld wie in der App: Kontext mit Ereignissen, Zustand, Eintragen */
function lies(ex: Exercise, text: string, now: Date, o: { art?: EntryArt; kind?: Kind; events?: LageEvent[] } = {}): { d: Draft; st: EntryState } {
  const events = o.events ?? ex.events ?? [];
  const d = parseMeldung(text, {
    sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, s) => lastPosition(events, s, u),
    events, ex: { events: ex.events ?? [] }, ...(o.art ? { art: o.art } : {}), ...(o.kind ? { kind: o.kind } : {}),
  });
  const st = entryState(d, { hasRaster: true, online: false, placePending: false, manualPos: false, now, sheets: ex.sheets, areas: ex.areas, knownUnits: ex.units.blau, unitsPrepared: true, days: ex.days });
  return { d, st };
}
let seq = 0;
function trage(ex: Exercise, d: Draft, now: Date): LageEvent {
  const e = eventFromDraft(d, "dev-pruef", new Date(now.getTime() + (++seq % 50) * 1000), { nr: 900 + seq, kuerzel: "BSP" });
  ex.events = [...(ex.events ?? []), e];
  return e;
}
/** Zeichen dieses Eintrags auf der Karte (loses Zeichen oder Element-Lage) */
const zeichnet = (ex: Exercise, id: string, t: string) => {
  const s = situationAt(ex.events!, t);
  return s.loose.some((e) => e.id === id) || s.units.some((u) => u.event.id === id);
};
const ort = (ex: Exercise, u: string, t: string) => lageBlau(ex, t).find((z) => z.trupp === u)?.ort;

// ---------------------------------------------------------------------------------------------------------------------
// 1 Hauptszenario «Einsatz» (Prüfskript s02): 66 Einträge ab T2 07:30, Reihenfolge und Zeiten wie im Bericht
// ---------------------------------------------------------------------------------------------------------------------

type Zeichen = "ja" | "nein" | "aufhebung" | "–";
interface Schritt {
  text: string | ((nr: Record<string, string>, hhmm: (min: number) => string) => string);
  art: EntryArt;
  zustand: EntryLevel[];
  zeichen: Zeichen;
  /** Trupp-Knopf */
  chip?: string;
  /** Uhr vorstellen (Minuten, vor dem Eintrag) */
  ff?: number;
  /** mehrere Ziele: das erste wählen */
  pick?: boolean;
  /** Nummer merken unter diesem Schlüssel */
  merk?: string;
  /** eigene Lage: Trupp steht danach hier */
  neu?: [string, string];
  pruef?: (d: Draft, ex: Exercise, e: LageEvent | null, t: string) => void;
}

const S: Schritt[] = [
  { text: "H02 2 Pers zu Fuss AK10 Rtg N", art: "meldung", zustand: ["bereit"], zeichen: "ja" },
  { text: "h3 3 pers bewaffnet bei ak 8 richtung westen", art: "meldung", zustand: ["bereit"], zeichen: "ja" },
  { text: (_n, h) => `H01 A: ${h(-1)} E: 2 Fz gn Rtg O I: langsam O: AD7 B U: beobachten weiter`, art: "meldung", zustand: ["bereit"], zeichen: "ja", pruef: (d) => expect(d.cells).toEqual(["AD7 B"]) },
  { text: (_n, h) => `A: ${h(-1)} E: 1 Drohne I: kreist O: AH9 U: wolkig`, art: "meldung", zustand: ["pruefen"], zeichen: "ja", pruef: (d) => expect(d.cells).toEqual(["AH9"]) },
  // N: «4 gegnerische Personen mit Personen»
  { text: (_n, h) => `A: ${h(-1)} E: 4 Pers mit Funkgerät I: zu Fuss Rtg S O: AF11 C U: Regen`, chip: "H04", art: "meldung", zustand: ["bereit"], zeichen: "ja",
    pruef: (d) => { expect(d.desc).toBe("4 gegnerische Personen"); expect(d.cells).toEqual(["AF11 C"]); } },
  { text: (_n, h) => `H05 A: ${h(-2)} E: 2 gn Trp O: AQ10`, art: "meldung", zustand: ["bereit"], zeichen: "ja" },
  // M2: AEIOU ohne O → «Ort fehlt», kein Zeichen «bei H03»
  { text: (_n, h) => `H03 A: ${h(-1)} E: 2 Pers bewaffnet I: Rtg N U: Nebel`, art: "meldung", zustand: ["pruefen"], zeichen: "nein",
    pruef: (d, ex, e, t) => {
      expect(d.pos).toBeUndefined();
      expect(d.where).toBeUndefined();
      expect(offenePunkte(ex, t).some((o) => o.art === "ohne-ort" && o.eventId === e!.id)).toBe(true);
    } },
  { text: (_n, h) => `H02 A ${h(-1)} E 3 Fz I Rtg W O AK9`, art: "meldung", zustand: ["bereit"], zeichen: "ja" },
  { text: (_n, h) => `A: ${h(-1)} E: H03 I: 3 Pers bewaffnet O: AN7`, art: "meldung", zustand: ["pruefen"], zeichen: "ja", pruef: (d) => expect(d.melder).toBe("") },
  { text: (_n, h) => `Auftrag an H03: Beo NAI 2 bis ${h(40)}`, art: "auftrag", zustand: ["bereit"], zeichen: "nein", ff: 2 },
  { text: (_n, h) => `Auftrag an H05: Stellungsbezug AQ12 bis ${h(25)}`, art: "auftrag", zustand: ["bereit"], zeichen: "nein" },
  { text: "H03 Quittung", art: "notiz", zustand: ["bereit"], zeichen: "nein", pruef: (d) => expect(d.bezugArt).toBe("quittung") },
  { text: "H05 Auftrag ausgeführt, Stao AQ12 bezogen", art: "meldung", zustand: ["bereit"], zeichen: "ja", ff: 3, neu: ["H05", "AQ12"] },
  { text: (_n, h) => `Bat: ab ${h(80)} Feind Det mit 2 Fz aus Rtg Belp erwartet`, art: "orientierung", zustand: ["bereit"], zeichen: "nein", pruef: (d) => expect(d.timeFromText).toBe(false) },
  { text: "Kp: Verpflegung um 1200 im KP", art: "orientierung", zustand: ["bereit"], zeichen: "nein", pruef: (d) => expect(d.quelle).toBe("Kp") },
  { text: "H04 Rückfrage: Sperre AG13 noch besetzt?", art: "rueckfrage", zustand: ["bereit"], zeichen: "nein", merk: "rf-ag13" },
  { text: "Rückfrage an H02: Anzahl Fz bestätigen", art: "rueckfrage", zustand: ["bereit"], zeichen: "nein", merk: "rf-h02" },
  { text: "H01 Vbk gut", art: "vbk", zustand: ["bereit"], zeichen: "nein", ff: 2 },
  { text: "H04 Vbk schlecht", art: "vbk", zustand: ["bereit"], zeichen: "nein" },
  { text: "H03 keine Verbindung", art: "vbk", zustand: ["bereit"], zeichen: "nein" },
  { text: "Vbk H05 laut und klar", art: "vbk", zustand: ["bereit"], zeichen: "nein" },
  { text: "Funkcheck", art: "vbk", zustand: ["pruefen"], zeichen: "nein" },
  // H1/M4: Antwort = Notiz mit Bezug, übernimmt den Trupp der Rückfrage
  // Fix 3: «2 Pers» an der Sperre = Sichtung in der Antwort → gelb «als Meldung eintragen?»; 2. Enter = Antwort ohne Zeichen.
  // Die Rückfrage kam von H04 → Antwort an H04 (kein Melder, kein Lebenszeichen)
  { text: (n) => `Antwort zu ${n["rf-ag13"]}: Sperre AG13 noch besetzt, 2 Pers`, art: "notiz", zustand: ["pruefen"], zeichen: "nein", ff: 2,
    pruef: (d) => { expect(d).toMatchObject({ bezugArt: "antwort", melder: "", an: "H04", sichtung: true }); expect(d.bezug).toBeTruthy(); } },
  { text: "H02 Antwort: 3 Fz bestätigt", art: "notiz", zustand: ["bereit"], zeichen: "nein",
    pruef: (d, ex, e) => { expect(d.bezugArt).toBe("antwort"); expect(nrLabel(ex.events!.find((x) => x.id === d.bezug)!, ex)).toBeTruthy(); expect(artText(e!)).toBe("Antwort von H02"); } },
  // N: Ort nur AR11 (nicht «AR11 · AR1»)
  { text: "Kontakt! H05 unter Feuer aus AR11, 1 Verwundeter, San angefordert", art: "meldung", zustand: ["bereit"], zeichen: "ja",
    pruef: (d) => { expect(d.cells).toEqual(["AR11"]); expect(d.dringend).toBe(true); } },
  { text: "H02 sollen wir weiter beobachten?", art: "rueckfrage", zustand: ["pruefen"], zeichen: "nein" },
  { text: "H01 hat Rückzug nach AC5 befohlen erhalten", art: "auftrag", zustand: ["pruefen"], zeichen: "nein" },
  { text: "H04 neue Sperre AH13", art: "meldung", zustand: ["bereit"], zeichen: "ja", ff: 2 },
  { text: "H04 Sperre AH13 aufgehoben", art: "meldung", zustand: ["bereit"], zeichen: "aufhebung" },
  { text: "H02 Strassensperre AL10", art: "meldung", zustand: ["bereit"], zeichen: "ja" },
  { text: "H05 Sperre AL10", art: "meldung", zustand: ["bereit"], zeichen: "ja" },
  // H2: zwei Ziele → rot bis gewählt, nie eine dritte Sperre
  { text: "H02 Sperre AL10 aufgehoben", art: "meldung", zustand: ["geht-nicht"], zeichen: "aufhebung", pick: true,
    pruef: (d) => expect(d.hebtAufKandidaten).toHaveLength(2) },
  // H2: kein Ziel → gelb «Kein Ziel gefunden – als Notiz eintragen?» → Notiz
  { text: "H01 Sperre AA1 aufgehoben", art: "notiz", zustand: ["pruefen"], zeichen: "nein",
    pruef: (d, _ex, e) => { expect(d.notizGrund).toBe("kein-ziel"); expect(e!.notiz).toBe(true); expect(e!.pos).toBeUndefined(); } },
  { text: "H05 IED AF13 geräumt", art: "meldung", zustand: ["bereit"], zeichen: "aufhebung" },
  { text: "Notiz: Fahrer Wechsel um 0800", art: "notiz", zustand: ["bereit"], zeichen: "nein", ff: 2, pruef: (d) => expect(d.timeFromText).toBe(false) },
  { text: "Notiz: H02 sieht 2 Fz AK8", art: "notiz", zustand: ["bereit"], zeichen: "nein", merk: "notiz-ak8" },
  // H5: Rückfrage ohne «?»
  { text: "H03 Standort Det 2 bekannt", art: "rueckfrage", zustand: ["pruefen"], zeichen: "nein", merk: "rf-det2" },
  { text: "T2 0715 H02 1 Fz AK7", art: "meldung", zustand: ["bereit"], zeichen: "ja", pruef: (d) => expect(d.t.slice(11)).toBe("07:15") },
  { text: (_n, h) => `H01 ${h(30)} 2 Pers AC7`, art: "meldung", zustand: ["geht-nicht"], zeichen: "–" },
  { text: "Antwort zu 999: alles ruhig", art: "notiz", zustand: ["pruefen"], zeichen: "nein", pruef: (d) => expect(d.bezugFehlt).toBe(true) },
  { text: "H06 2 Pers AK5", art: "meldung", zustand: ["pruefen"], zeichen: "ja" },
  { text: "H01 2 Pers AC 77", art: "meldung", zustand: ["geht-nicht"], zeichen: "–" },
  { text: "hier h zwo, zwei fahrzeuge, äh, eins davon schützenpanzer, bei AL elf, fahren rtg nord", art: "meldung", zustand: ["bereit", "pruefen"], zeichen: "ja", ff: 3 },
  { text: "H03 ähm 2 oder 3 Pers, Rtg unklar, ungefähr AN 7", art: "meldung", zustand: ["bereit", "pruefen"], zeichen: "ja" },
  // H4: Standort bleibt
  { text: "H04 nichts Neues", art: "meldung", zustand: ["bereit"], zeichen: "ja",
    pruef: (d, ex, e, t) => { expect(d.where?.label).toBe("AF12 A"); expect(e!.where).toBe("AF12 A"); expect(ort(ex, "H04", t)).toBe("AF12 A"); } },
  { text: "H05 Stao AQ12 bezogen, alles ruhig", art: "meldung", zustand: ["bereit"], zeichen: "ja", neu: ["H05", "AQ12"] },
  { text: "H01 Beo Stao AC6 B unverändert", art: "meldung", zustand: ["bereit"], zeichen: "ja", neu: ["H01", "AC6 B"] },
  { text: "H02 1 Pw schwarz AL9 Rtg Bern", art: "meldung", zustand: ["bereit"], zeichen: "ja" },
  { text: "H03 Drohne über NAI 2", art: "meldung", zustand: ["bereit"], zeichen: "ja", ff: 2 },
  { text: "Bat: Lagerapport 1000 im KP Bat", art: "orientierung", zustand: ["bereit"], zeichen: "nein" },
  { text: "Auftrag an H01: Vbk alle 30 min", art: "auftrag", zustand: ["bereit"], zeichen: "nein" },
  // N: «Genannt: AL»
  { text: "Auftrag: Beo Strasse AK nach AL", art: "auftrag", zustand: ["pruefen"], zeichen: "nein", pruef: (d) => expect(d.orte ?? []).not.toContain("AL") },
  { text: "H04 Befehl erhalten, verschieben nach AF10", art: "auftrag", zustand: ["pruefen"], zeichen: "nein" },
  { text: "H02 2 Kpz AK9 Rtg W, dringend", art: "meldung", zustand: ["bereit"], zeichen: "ja" },
  { text: "Frage an H05: Munition genug?", art: "rueckfrage", zustand: ["bereit"], zeichen: "nein" },
  // H1: kein Unklar-Zeichen «Munitionslager» bei H05
  { text: "H05 Antwort: Mun genug", art: "notiz", zustand: ["bereit"], zeichen: "nein", pruef: (d) => { expect(d.bezugArt).toBe("antwort"); expect(d.bezug).toBeTruthy(); expect(d.sym).toBe("einheit"); } },
  { text: "Quittung H01", art: "notiz", zustand: ["bereit"], zeichen: "nein" },
  { text: "H03 Vbk i.O.", art: "vbk", zustand: ["bereit"], zeichen: "nein", ff: 2 },
  { text: "H04 3 Pers bauen Sperre AG12", art: "meldung", zustand: ["bereit"], zeichen: "ja" },
  { text: "H04 Sperre AG13 geräumt", art: "meldung", zustand: ["bereit"], zeichen: "aufhebung" },
  { text: "H05 1 Verletzter eigene Trp, San benötigt", art: "meldung", zustand: ["bereit"], zeichen: "ja",
    pruef: (d, ex, _e, t) => { expect(d.where?.label).toBe("AQ12"); expect(ort(ex, "H05", t)).toBe("AQ12"); } },
  { text: "NB: Batterien Funk H02 schwach", art: "notiz", zustand: ["bereit"], zeichen: "nein" },
  { text: "H01 2 Pers AD8 C Rtg SW", art: "meldung", zustand: ["bereit"], zeichen: "ja", ff: 1 },
  // H5: «weg» ohne Gesehenes → gelb «Kein Zeichen?» → Notiz
  { text: "H02 Feind weg aus AK9", art: "notiz", zustand: ["pruefen"], zeichen: "nein", pruef: (d) => expect(d.notizGrund).toBe("weg") },
  { text: "Orientierung von Bat: Nachbar Kp 61/2 links", art: "orientierung", zustand: ["bereit"], zeichen: "nein" },
  { text: "H03 4 Pers zu Fuss AO5 Rtg S", art: "meldung", zustand: ["bereit"], zeichen: "ja" },
];

describe("Hauptszenario Einsatz (66 Einträge, Prüfskript s02)", () => {
  const ex = demoExercise();
  const STAO: Record<string, string> = { H01: "AC6 B", H02: "AL9 A", H03: "AP4 D", H04: "AF12 A", H05: "AQ11 C" };
  const nr: Record<string, string> = {};
  let clock = at("0730").getTime();
  const falsch: string[] = [];
  S.forEach((s, i) => {
    const label = typeof s.text === "string" ? s.text : s.text({}, () => "hhmm").replace(/hhmm/g, "…");
    it(`#${i + 1} ${label}`, () => {
      clock += (s.ff ?? 0) * 60000;
      const now = new Date(clock);
      const hh = (min: number) => { const d = new Date(clock + min * 60000); return `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`; };
      const text0 = typeof s.text === "string" ? s.text : s.text(nr, hh);
      const text = s.chip ? `${s.chip} ${text0}` : text0;
      let { d, st } = lies(ex, text, now);
      const d0 = d;
      expect(d.art, "Art").toBe(s.art);
      expect(s.zustand, `Zustand ${st.level}: ${st.reasons.map((r) => r.text).join(" | ")}`).toContain(st.level);
      const t = iso(now);
      const vorher = situationAt(ex.events!, t);
      const zielSichtbar = (id: string) => vorher.loose.some((x) => x.id === id);
      let e: LageEvent | null = null;
      if (s.pick) {
        const ziel = ex.events!.find((x) => x.id === d.hebtAufKandidaten![0])!;
        d = aufhebDraft(d, ziel);
        st = lies(ex, text, now).st;
      }
      if (st.level !== "geht-nicht" || s.pick) e = trage(ex, d, now);
      if (s.merk && e) nr[s.merk] = nrLabel(e, ex);
      // Zeichen
      if (s.zeichen === "–") expect(e).toBeNull();
      else {
        const z = zeichnet(ex, e!.id, t);
        const soll = s.zeichen === "ja";
        if (z !== soll) falsch.push(`${text}: ${z ? "zeichnet" : "kein Zeichen"}`);
        expect(z, "Zeichen").toBe(soll);
        if (s.zeichen === "aufhebung") {
          expect(e!.hebtAuf).toBeTruthy();
          expect(zielSichtbar(e!.hebtAuf!)).toBe(true);
          expect(situationAt(ex.events!, t).loose.some((x) => x.id === e!.hebtAuf)).toBe(false);
          expect(kindLabel(e!)).toBe("Aufhebung");
        }
        if (e!.art && e!.art !== "meldung") { expect(e!.pos).toBeUndefined(); expect(e!.unit).toBe(""); expect(e!.cells).toBeUndefined(); }
      }
      // Trupps: nur eigene Lage verschiebt; nie «letzter Standort», nie «Kp»/«Bat» als Trupp
      if (s.neu) STAO[s.neu[0]] = s.neu[1];
      for (const [u, o] of Object.entries(STAO)) expect(ort(ex, u, t), `${u} verschoben`).toBe(o);
      expect(lageBlau(ex, t).some((z) => z.ort === "letzter Standort")).toBe(false);
      expect(ex.units.blau.some((u) => /^(kp|bat|kdt)$/i.test(u))).toBe(false);
      s.pruef?.(d0, ex, e, t);
    });
  });
  it("0 falsche Zeichen; Antworten zählen nicht als Gesehenes; Rückfragen beantwortet", () => {
    expect(falsch).toEqual([]);
    const t = iso(new Date(clock));
    const idx = lvzIndex(ex.events!);
    for (const k of ["rf-ag13", "rf-h02"]) {
      const rf = ex.events!.find((e) => nrLabel(e, ex) === nr[k])!;
      expect(vermerkeOf(rf, idx).status, k).toBe("erledigt");
    }
    const antworten = ex.events!.filter((e) => e.bezugArt === "antwort");
    expect(antworten.length).toBe(4);
    expect(antworten.every((e) => e.notiz && !e.pos)).toBe(true);
    // keine Antwort in «Ohne Ort», kein Feind aus Antworten in den Rapportzahlen
    expect(offenePunkte(ex, t).some((o) => antworten.some((a) => a.id === o.eventId))).toBe(false);
    const z = rapportZahlen(ex, null, t);
    const ohneAntw = rapportZahlen({ ...ex, events: ex.events!.filter((e) => e.bezugArt !== "antwort") }, null, t);
    expect(z.gesehen).toEqual(ohneAntw.gesehen);
    // CSV/PDF-Daten: Aufhebung heisst «Aufhebung», nicht «Feind»
    const csv = journalToCsv(ex.events!, ex.days).split("\r\n");
    const lifts = csv.slice(1).filter((r) => r.split(";")[24]);
    expect(lifts.length).toBeGreaterThanOrEqual(3);
    for (const r of lifts) expect(r.split(";")[2]).toBe("Aufhebung");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 2 Einzelne Funde aus den drei Berichten
// ---------------------------------------------------------------------------------------------------------------------

describe("Antwort (Einsatz H1/M4, Übergabe M2)", () => {
  it("«Antwort zu 82: ja, weiter beobachten» – Notiz mit Bezug, Trupp der Rückfrage, nie «Ohne Ort», auch mit Vorbelegung Notiz", () => {
    for (const art of [undefined, "notiz"] as const) {
      const ex = demoExercise();
      const rf = trage(ex, lies(ex, "H04 Rückfrage: Standort Det 2?", at("0720")).d, at("0720"));
      const n = nrLabel(rf, ex);
      const { d, st } = lies(ex, `Antwort zu ${n}: ja, weiter beobachten bis 1000`, at("0730"), art ? { art } : {});
      expect(st.level).toBe("bereit");
      expect(d).toMatchObject({ art: "notiz", bezug: rf.id, bezugArt: "antwort", melder: "", an: "H04", t: "2030-05-15T07:30" });
      const e = trage(ex, d, at("0730"));
      expect(artText(e)).toBe("Antwort an H04");
      expect(zeichnet(ex, e.id, "2030-05-15T07:30")).toBe(false);
      expect(offenePunkte(ex, "2030-05-15T07:30").some((o) => o.eventId === e.id || o.eventId === rf.id)).toBe(false);
      // Fix 3: Antwort **an** den Trupp (er hat gefragt) ist kein Lebenszeichen
      expect(lebenszeichen(e)).toBeNull();
    }
  });
  it("«Antwort zu 802: Det 1 zuletzt AP10 um 0607» – Zeit im Inhalt, kein Feind-Zeichen; «Antwort zu 13: hinfällig» nicht in Offen", () => {
    const ex = demoExercise();
    const rf = trage(ex, lies(ex, "Rückfrage an H03: Det 1 wo?", at("0608")).d, at("0608"));
    const { d, st } = lies(ex, `Antwort zu ${nrLabel(rf, ex)}: Det 1 zuletzt AP10 um 0607`, at("0612"));
    expect(st.level).toBe("bereit");
    expect(d).toMatchObject({ art: "notiz", t: "2030-05-15T06:12", melder: "H03" });
    expect(d.pos).toBeUndefined();
    const e = trage(ex, d, at("0612"));
    expect(zeichnet(ex, e.id, "2030-05-15T06:12")).toBe(false);
    const { d: d2 } = lies(ex, `Antwort zu ${nrLabel(rf, ex)}: hinfällig`, at("0613"));
    const e2 = trage(ex, d2, at("0613"));
    expect(offenePunkte(ex, "2030-05-15T06:13").some((o) => o.eventId === e2.id)).toBe(false);
  });
  it("«H05 Antwort: Mun genug» / «H02 Antwort: 3 Fz bestätigt» – kein Zeichen, keine Feind-Zählung", () => {
    const ex = demoExercise();
    trage(ex, lies(ex, "Frage an H05: Munition genug?", at("0730")).d, at("0730"));
    trage(ex, lies(ex, "Rückfrage an H02: 3 Fz bestätigen", at("0730")).d, at("0730"));
    const vor = rapportZahlen(ex, null, "2030-05-15T07:40").gesehen;
    for (const s of ["H05 Antwort: Mun genug", "H02 Antwort: 3 Fz bestätigt"]) {
      const { d, st } = lies(ex, s, at("0735"));
      expect(st.level, s).toBe("bereit");
      expect(d.art).toBe("notiz");
      expect(d.bezug).toBeTruthy();
      const e = trage(ex, d, at("0735"));
      expect(zeichnet(ex, e.id, "2030-05-15T07:40")).toBe(false);
    }
    expect(rapportZahlen(ex, null, "2030-05-15T07:40").gesehen).toEqual(vor);
  });
  it("«Antwort an H02: …» ohne Rückfrage: Notiz «Antwort an H02», H02 ist Empfänger", () => {
    const ex = demoExercise();
    const { d } = lies(ex, "Antwort an H02: Rückzug bewilligt", at("0730"));
    expect(d).toMatchObject({ art: "notiz", an: "H02", melder: "" });
    expect(artText(trage(ex, d, at("0730")))).toBe("Antwort an H02");
  });
  it("Meldung wird sie nur mit gewählter Einordnung – dann mit Bezug und Trupp der Rückfrage (M4)", () => {
    const ex = demoExercise();
    const rf = trage(ex, lies(ex, "Rückfrage an H02: Det 2 wo?", at("0720")).d, at("0720"));
    const { d } = lies(ex, `Antwort zu ${nrLabel(rf, ex)}: Det 2 in AJ8`, at("0730"), { art: "meldung", kind: "feind" });
    expect(d).toMatchObject({ art: "meldung", kind: "feind", bezug: rf.id, bezugArt: "antwort", melder: "H02", unit: "Det 2", cells: ["AJ8"] });
    expect(vermerkeOf(rf, lvzIndex([...ex.events!, trage(ex, d, at("0730"))])).status).toBe("erledigt");
  });
});

describe("Aufheben zeichnet nie (Einsatz H2, H5)", () => {
  it("«H04 Sperre AG13 geräumt» mit zwei Zielen: rot bis gewählt; nach der Wahl Aufhebung ohne Zeichen", () => {
    const ex = demoExercise();
    trage(ex, lies(ex, "H03 Sperre in AG13", at("0715")).d, at("0715"));
    const { d, st } = lies(ex, "H04 Sperre AG13 geräumt", at("0730"));
    expect(st.level).toBe("geht-nicht");
    expect(st.reasons[0]).toMatchObject({ code: "aufheben", text: "Zwei Sperren in AG13 – welche aufheben?" });
    const w = aufhebDraft(d, ex.events!.find((e) => e.id === d.hebtAufKandidaten![0])!);
    expect(entryState(w, { hasRaster: true, online: false, placePending: false, manualPos: false, now: at("0730") }).level).toBe("bereit");
    const e = trage(ex, w, at("0730"));
    expect(e.pos).toBeUndefined();
    expect(artText(e)).toBe("Aufhebung");
  });
  it("kein Ziel: gelb → Notiz; mit von Hand gewählter Einordnung rot (nie eine neue Sperre)", () => {
    const ex = demoExercise();
    const { d, st } = lies(ex, "H01 Sperre AA1 aufgehoben", at("0730"));
    expect(st).toMatchObject({ level: "pruefen", reasons: [{ code: "aufheben", text: "Kein Ziel gefunden – als Notiz eintragen?" }] });
    expect(trage(ex, d, at("0730"))).toMatchObject({ art: "notiz", notiz: true, sym: "einheit" });
    const v = lies(ex, "H01 Sperre AA1 aufgehoben", at("0731"), { art: "meldung", kind: "feind" });
    expect(v.st.level).toBe("geht-nicht");
    expect(v.d.hebtAufKandidaten).toEqual([]);
  });
  it("«Feind weg aus AK9» → gelb «Kein Zeichen?»; mit Gesehenem bleibt es Meldung; «Weg» als Nomen ist kein Aufheben", () => {
    const ex = demoExercise();
    const a = lies(ex, "H02 Feind weg aus AK9", at("0730"));
    expect(a.d).toMatchObject({ art: "notiz", notizGrund: "weg" });
    expect(a.st.reasons[0]).toMatchObject({ code: "aufheben", text: "Kein Zeichen? – als Notiz eintragen?" });
    expect(lies(ex, "H03 Det 1 abgezogen Rtg S", at("0730")).d).toMatchObject({ art: "meldung", unit: "Det 1" });
    expect(lies(ex, "H02 2 Fz weg Rtg N AK9", at("0730")).d).toMatchObject({ art: "meldung", count: 2 });
    const w = lies(ex, "H04 Sperre auf dem Weg AG13", at("0730")).d;
    expect(w).toMatchObject({ art: "meldung", sym: "sperre" });
    expect(w.hebtAufKandidaten).toBeUndefined();
    expect(lies(ex, "H04: Weg versperrt AG13", at("0730")).d.hebtAufKandidaten).toBeUndefined();
  });
  it("«Checkpoint … frei» / «abgezogen» heben ein Ziel auf", () => {
    const ex = demoExercise();
    trage(ex, lies(ex, "H05 Checkpoint AK7", at("0700")).d, at("0700"));
    for (const s of ["H05 Checkpoint AK7 frei", "H05 Checkpoint AK7 abgezogen"]) expect(lies(ex, s, at("0730")).d.hebtAuf, s).toBeTruthy();
  });
});

describe("Korrektur einer Nicht-Meldung zur Meldung (Einsatz H3)", () => {
  const korr = (ex: Exercise, base: LageEvent, kind: Kind) =>
    lies(ex, base.text, new Date(`${base.t}:00`), { art: "meldung", kind, events: ex.events!.filter((x) => x.id !== base.id) });
  it("«Notiz: H02 sieht 2 Fz AK8» → Feind: Ort AK8, Melder H02, Zeichen", () => {
    const ex = demoExercise();
    const base = trage(ex, lies(ex, "Notiz: H02 sieht 2 Fz AK8", at("0730")).d, at("0730"));
    const { d, st } = korr(ex, base, "feind");
    expect(st.level).toBe("bereit");
    expect(d).toMatchObject({ art: "meldung", kind: "feind", melder: "H02", cells: ["AK8"], count: 2 });
    expect(d.pos).toBeTruthy();
    const { notiz: _n, ...ohneNotiz } = base;
    expect(correctionSummary(base, { ...ohneNotiz, ...eventFromDraft(d, "x"), art: "meldung" })).toContain("Notiz → Feind");
  });
  it("«Kp: 2 Fz in AK8 gesehen» → Feind: Quelle Kp wird kein Trupp", () => {
    const ex = demoExercise();
    const base = trage(ex, lies(ex, "Kp: 2 Fz in AK8 gesehen", at("0730")).d, at("0730"));
    expect(base.art).toBe("orientierung");
    const { d, st } = korr(ex, base, "feind");
    expect(d.melder).toBe("");
    expect(d.cells).toEqual(["AK8"]);
    expect(st.reasons.some((r) => r.code === "trupp-neu")).toBe(false);
  });
  it("Rückgängig-Text nennt die Art: «Feind → Rückfrage»", () => {
    const ex = demoExercise();
    const feind = trage(ex, lies(ex, "H03 Standort Det 2 AK9", at("0730")).d, at("0730"));
    const rf = { ...feind, art: "rueckfrage" as const, notiz: true, pos: undefined, unit: "" };
    expect(correctionSummary(feind, rf)).toContain("Feind → Rückfrage");
  });
});

describe("Standort bleibt (Einsatz H4)", () => {
  it("«H04 nichts Neues», «H05 1 Verletzter, Sanität angefordert»: Ort bleibt, nie «letzter Standort»", () => {
    const ex = demoExercise();
    const T = "2030-05-15T07:30";
    const seit = lageBlau(ex, T).find((z) => z.trupp === "H04")!.seit;
    for (const [s, u, o] of [["H04 nichts Neues", "H04", "AF12 A"], ["H05 1 Verletzter, Sanität angefordert", "H05", "AQ11 C"]] as const) {
      const e = trage(ex, lies(ex, s, at("0730")).d, at("0730"));
      expect(e.where).toBe(o);
      expect(ort(ex, u, T)).toBe(o);
    }
    expect(lageBlau(ex, T).find((z) => z.trupp === "H04")!.seit).toBe(seit);
    expect(offenePunkte(ex, T).every((p) => !p.text.includes("letzter Standort"))).toBe(true);
  });
  it("alte Daten mit «letzter Standort» zeigen den bisherigen Ort", () => {
    const ex = demoExercise();
    const e = trage(ex, lies(ex, "H04 nichts Neues", at("0730")).d, at("0730"));
    ex.events = ex.events!.map((x) => (x.id === e.id ? { ...x, where: "letzter Standort" } : x));
    expect(ort(ex, "H04", "2030-05-15T07:30")).toBe("AF12 A");
  });
});

describe("Orientierung, Zeit bei Nicht-Meldungen, schwache Rückfrage (Einsatz M1/H5, Übergabe H1/M6)", () => {
  const ex = demoExercise();
  const F: Array<[string, string, Partial<Draft>, EntryLevel, { art?: EntryArt }?]> = [
    ["1534 Bat: Lagerapport 1700", "1540", { art: "orientierung", quelle: "Bat", t: "2030-05-15T15:34" }, "bereit"],
    ["Bat Lagerapport 1800", "0612", { art: "orientierung", quelle: "Bat", t: "2030-05-15T06:12", melder: "" }, "bereit"],
    ["1534 Bat Lagerapport 1700", "1540", { art: "orientierung", quelle: "Bat", t: "2030-05-15T15:34" }, "bereit"],
    ["Kp Verpflegung 1200 im KP", "0730", { art: "orientierung", quelle: "Kp", t: "2030-05-15T07:30" }, "bereit"],
    ["Kp 1200 Verpflegung", "0730", { art: "orientierung", quelle: "Kp", t: "2030-05-15T07:30", text: "Kp 1200 Verpflegung" }, "bereit"],
    ["Kdt: Rapport 1800 im KP", "0730", { art: "orientierung", quelle: "Kdt" }, "bereit"],
    ["Rgt Feind Kp-Stärke ab 2200", "0730", { art: "orientierung", quelle: "Rgt" }, "bereit"],
    ["Br: Lage ruhig", "0730", { art: "orientierung", quelle: "Br" }, "bereit"],
    ["Lagerapport neu 0800 im KP", "0730", { art: "orientierung", t: "2030-05-15T07:30" }, "bereit", { art: "orientierung" }],
    ["Auftrag an H02: Beo AK9 von 1600 bis 1700", "0730", { art: "auftrag", an: "H02", t: "2030-05-15T07:30", frist: "2030-05-15T17:00" }, "bereit"],
    ["Notiz: Fahrer Wechsel um 0800", "0730", { art: "notiz", t: "2030-05-15T07:30" }, "bereit"],
    ["H03 Standort Det 2 bekannt", "0730", { art: "rueckfrage", artStark: false }, "pruefen"],
    ["Rückfrage an H02 Anzahl Fz bestätigen", "0730", { art: "rueckfrage" }, "bereit"],
    ["H01 Anzahl Fz bestätigen", "0730", { art: "rueckfrage", artStark: false }, "pruefen"],
    ["H04 wo ist Det 2", "0730", { art: "rueckfrage", artStark: false }, "pruefen"],
    ["Auftrag H02 Beo NAI 1", "0730", { art: "auftrag", an: "H02", melder: "" }, "bereit"],
    ["Verbindung H03 keine", "0730", { art: "vbk", vbk: "keine", melder: "H03" }, "bereit"],
    // keine Orientierung: Stufe vor einem Zeichenbegriff
    ["H04 Kp Gfs AG11", "0730", { art: "meldung", sym: "kdo_po", melder: "H04" }, "bereit"],
  ];
  for (const [s, hh, soll, lvl, o] of F) {
    it(s, () => {
      const { d, st } = lies(ex, s, at(hh), o);
      expect(d).toMatchObject(soll);
      expect(st.level, st.reasons.map((r) => r.text).join(" | ")).toBe(lvl);
      if (d.art !== "meldung") expect(d.pos).toBeUndefined();
    });
  }
  it("«H04 quittiert Auftrag 783» = Quittung mit Bezug; «Auftrag H02 Beo NAI 1» verschiebt H02 nicht", () => {
    const x = demoExercise();
    const a = trage(x, lies(x, "Auftrag H02 Beo NAI 1", at("0720")).d, at("0720"));
    const b = trage(x, lies(x, "Auftrag an H04: Beo NAI 3", at("0721")).d, at("0721"));
    expect(ort(x, "H02", "2030-05-15T07:30")).toBe("AL9 A");
    const { d, st } = lies(x, `H04 quittiert Auftrag ${nrLabel(b, x)}`, at("0725"));
    expect(st.level).toBe("bereit");
    expect(d).toMatchObject({ art: "notiz", bezugArt: "quittung", bezug: b.id, melder: "H04" });
    expect(lies(x, "H02 quittiert", at("0725")).d).toMatchObject({ art: "notiz", bezugArt: "quittung", bezug: a.id });
  });
});

describe("Übergabe-Daten (Übergabe H2, Frage 2)", () => {
  it("«Von oben (gültig)»: letzte 3 Orientierungen, jüngste zuerst, unabhängig von der Schicht", () => {
    const ex = demoExercise();
    for (const [s, hh] of [["Bat: Lagerapport 1800 im KP", "0309"], ["Bat: Feind Kp-Stärke ab 2200", "0315"], ["Kp Verpflegung 1200", "0500"], ["Bat Lagerapport neu 0800", "0603"]] as const) {
      trage(ex, lies(ex, s, at(hh)).d, at(hh));
    }
    const g = trage(ex, lies(ex, "Kdt: Ruhe ab 2300", at("0604")).d, at("0604"));
    ex.events = ex.events!.map((e) => (e.id === g.id ? { ...e, deleted: true } : e));
    const v = vonOben(ex, "2030-05-15T06:10");
    expect(v.map((z) => [z.quelle, z.text])).toEqual([["Bat", "Lagerapport neu 0800"], ["Kp", "Verpflegung 1200"], ["Bat", "Feind Kp-Stärke ab 2200"]]);
    expect(v[0]!.nr).toBeTruthy();
    expect(vonOben(ex, "2030-05-15T03:10")).toHaveLength(1);
  });
  it("letzte Rot-Aktivität: auch ohne Element (Drohne), keine Aufhebung, keine Antwort", () => {
    const ex = demoExercise();
    const vor = letzteRotAktivitaet(ex, "2030-05-15T07:30")!;
    expect(vor.side).toBe("rot");
    expect(ex.events!.filter((e) => e.side === "rot" && !e.notiz && !e.hebtAuf && e.t <= "2030-05-15T07:30").every((e) => e.t <= vor.t)).toBe(true);
    const dr = trage(ex, lies(ex, "H02 Drohne über AK9", at("0729")).d, at("0729"));
    trage(ex, lies(ex, "H05 IED AF13 geräumt", at("0730")).d, at("0730"));
    expect(letzteRotAktivitaet(ex, "2030-05-15T07:30")?.id).toBe(dr.id);
    expect(letzteRotAktivitaet({ events: [] }, "2030-05-15T07:30")).toBeNull();
  });
});

describe("keine Regression im Beispiel Bern", () => {
  it("Beispiel Bern: Hinweise und 3 Möglichkeiten unverändert", () => {
    const ex = demoExercise();
    const t = "2030-05-15T07:30";
    const { hints } = analyzeJournal(ex, { t });
    expect(hints.length).toBe(22);
    expect(computeRedCoas(ex, { t, hints })).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 3 MVP 3 Fix 3 – Satz-Läufer der Nachprüfung (review4/eigen: 34 eigene Sätze in Varianten + Übergabe-Sätze), in der
// Reihenfolge des Läufers (je Satz +1 min ab T2 07:30, gelb = 2. Enter, mehrere Ziele = erstes gewählt). Budget: 0 still
// falsch – kein neues Zeichen, kein Trupp verschoben, unscharfe Wörter nie grün.
// ---------------------------------------------------------------------------------------------------------------------

type Satz = [text: string, art: EntryArt, level: EntryLevel, aufheben: boolean, pruef?: (d: Draft, st: EntryState, e: LageEvent | null, nr: (e?: string) => string) => void];
const unscharf = (wort: string, token: string) => (d: Draft, st: EntryState) => {
  expect(d.unscharf).toEqual({ wort, token });
  expect(st.reasons[0]).toMatchObject({ code: "unscharf", text: `${wort} gemeint? «${token}»` });
};
const bezug = (n: string, o: Partial<Draft> = {}) => (d: Draft, _st: EntryState, e: LageEvent | null, nr: (e?: string) => string) => {
  expect(d.bezugArt).toBe("antwort");
  expect(nr(d.bezug)).toBe(n);
  expect(d).toMatchObject(o);
  if (e) expect(lebenszeichen(e)).toBe(o.melder || null);
};

const EIGEN: Satz[] = [
  ["H04 Rückfrage: Sperre AG13 noch besetzt?", "rueckfrage", "bereit", false],
  ["Rückfrage an H02: Anzahl Fz bestätigen", "rueckfrage", "bereit", false],
  ["Antwort zu 58 2 Fz bestätigt", "notiz", "bereit", false, bezug("58", { melder: "H02" })],
  ["antwrt zu 57: ja noch besetzt", "notiz", "pruefen", false, (d, st, e, nr) => { unscharf("Antwort", "antwrt")(d, st); bezug("57", { melder: "", an: "H04" })(d, st, e, nr); }],
  ["H03 Antwort 3 Pers AN7", "notiz", "pruefen", false, (d, st) => { expect(d.sichtung).toBe(true); expect(st.reasons[0]).toMatchObject({ code: "sichtung", text: "Sichtung in der Antwort – als Meldung eintragen?" }); }],
  ["Antwort an H02: weiter beobachten", "notiz", "bereit", false, (d, _st, e) => { expect(d).toMatchObject({ an: "H02", melder: "" }); expect(lebenszeichen(e!)).toBeNull(); }],
  ["0731 Antwort zu 57: Sperre noch besetzt", "notiz", "bereit", false, (d) => expect(d.t).toBe("2030-05-15T07:31")],
  ["Antwort zu 57: Sperre noch besetzt seit 0700", "notiz", "bereit", false, (d) => expect(d.t).toBe("2030-05-15T07:38")],
  ["H04 Sperre AG13 aufgehobn", "meldung", "pruefen", true, unscharf("Aufheben", "aufgehobn")],
  // Sperre 51 ist schon aufgehoben → kein Ziel → Notiz (nie ein neues Zeichen)
  ["Sperre AG13 frei", "notiz", "pruefen", false, (d) => expect(d.notizGrund).toBe("kein-ziel")],
  ["H05 IED AF13 weg", "meldung", "bereit", true],
  ["H04 Checkpoint AG14 abgezogen", "notiz", "pruefen", false],
  ["H02 Feind abgezogen aus AK9", "notiz", "pruefen", false, (d) => expect(d.notizGrund).toBe("weg")],
  ["Bat Feind erwartet ab 0900 aus Rtg Belp", "orientierung", "bereit", false, (d) => expect(d.quelle).toBe("Bat")],
  ["0740 Kp: Verpflegung 1200", "orientierung", "bereit", false, (d) => expect(d.t).toBe("2030-05-15T07:40")],
  ["Kp Verpflegung verschoben auf 1300", "orientierung", "bereit", false],
  ["Bat: H02 verschiebt nach AL9", "orientierung", "bereit", false],
  ["Rgt Lage unverändert, 0900 Rapport", "orientierung", "bereit", false, (d) => expect(d.quelle).toBe("Rgt")],
  ["Auftrag an H01 Beo NAI 3 bis 0830", "auftrag", "bereit", false, (d) => expect(d.frist).toBe("2030-05-15T08:30")],
  ["Auftrag an H05: um 0800 Stao AQ12 beziehen", "auftrag", "bereit", false],
  ["Auftarg an H03: Beo NAI 2", "auftrag", "pruefen", false, (d, st) => { unscharf("Auftrag", "Auftarg")(d, st); expect(d.an).toBe("H03"); }],
  ["0745 Auftrag an H04: Sperre AG13 beobachten", "auftrag", "bereit", false, (d) => expect(d.t).toBe("2030-05-15T07:45")],
  ["Auftrag an H02: Beo AK9, Meldung um 0815", "auftrag", "bereit", false],
  ["H02 Rückfrage wo ist H03", "rueckfrage", "bereit", false],
  ["Rückfrage an H04 Sperre AG13 noch besetzt", "rueckfrage", "bereit", false],
  ["Bat orientiert: Nachbar rechts Kp 61/3 in AT5", "orientierung", "bereit", false],
];
const EIGEN2: Satz[] = [
  ["H04 Rückfrage: Sperre AG13 noch besetzt?", "rueckfrage", "bereit", false],
  // «geraeumt» = «geräumt» (Umlaut ausgeschrieben, genau)
  ["H04 Sperre AG13 geraeumt", "meldung", "bereit", true],
  ["H05 IED AF13 aufgehben", "meldung", "pruefen", true, unscharf("Aufheben", "aufgehben")],
  ["Antw zu 57: ja", "notiz", "pruefen", false, (d, st, e, nr) => { unscharf("Antwort", "Antw")(d, st); bezug("57", { melder: "", an: "H04" })(d, st, e, nr); }],
  ["Antwort 57: ja besetzt", "notiz", "bereit", false, bezug("57", { melder: "", an: "H04" })],
  // Rückfrage 57 ist beantwortet: Antwort ohne Bezug, aber nie ein zweites Zeichen
  ["H04 antwortet: Sperre AG13 besetzt", "notiz", "bereit", false, (d, _st, e) => { expect(d).toMatchObject({ bezugArt: "antwort", melder: "H04" }); expect(lebenszeichen(e!)).toBe("H04"); }],
  ["zu 57: ja noch besetzt", "notiz", "bereit", false, bezug("57", { melder: "", an: "H04" })],
  ["Auftrag an H02 verschieben nach AL11", "auftrag", "bereit", false],
  ["Auftr an H01: Beo NAI 1", "auftrag", "pruefen", false, (d, st) => { unscharf("Auftrag", "Auftr")(d, st); expect(d.an).toBe("H01"); }],
  ["Batt: Lagerapport 1800", "orientierung", "pruefen", false, (d, st) => { unscharf("Orientierung von Bat", "Batt")(d, st); expect(d.t).toBe("2030-05-15T07:40"); }],
  ["bat lagerapport 1800", "orientierung", "bereit", false],
];
const UEB: Satz[] = [
  ["H04 Rückfrage: Sperre AG13 noch besetzt?", "rueckfrage", "bereit", false],
  ["Rückfrage an H02: Anzahl Fz bestätigen", "rueckfrage", "bereit", false],
  ["Auftrag an H04: Beo NAI 3 bis 0900", "auftrag", "bereit", false],
  ["Bat Lagerapport 1800", "orientierung", "bereit", false],
  ["0725 Bat: Lagerapport 1700", "orientierung", "bereit", false, (d) => expect(d.t).toBe("2030-05-15T07:25")],
  ["0726 Bat Lagerapport neu 0800 im KP", "orientierung", "bereit", false],
  // ohne Quelle: rot «08:00 liegt in der Zukunft» (Ausweg «Was ist es?» → Orientierung) – nie still falsch
  ["Lagerapport neu 0800 im KP", "meldung", "geht-nicht", false],
  ["Antwort zu 57: Det 1 zuletzt AP10 um 0607", "notiz", "bereit", false, bezug("57", { melder: "", an: "H04" })],
  ["Antwort zu 57: hinfällig", "notiz", "bereit", false],
  ["H04 quittiert Auftrag 59", "notiz", "bereit", false, (d) => expect(d.bezugArt).toBe("quittung")],
  ["Auftrag H02 Beo NAI 1", "auftrag", "bereit", false, (d) => expect(d.an).toBe("H02")],
  // nicht dringend: «ab sofort» ist kein Notfall
  ["Kdt: ab sofort Funkstille bis 0800", "orientierung", "bereit", false, (d) => { expect(d.quelle).toBe("Kdt"); expect(d.dringend).toBeUndefined(); }],
];

describe("Satz-Läufer der Nachprüfung (review4, MVP 3 Fix 3): 0 still falsch", () => {
  for (const [name, saetze] of [["eigen", EIGEN], ["eigen2", EIGEN2], ["ueb", UEB]] as const) {
    describe(name, () => {
      const ex = demoExercise();
      const STAO: Record<string, string> = { H01: "AC6 B", H02: "AL9 A", H03: "AP4 D", H04: "AF12 A", H05: "AQ11 C" };
      let clock = at("0730").getTime();
      let n = 57;
      const nr = (id?: string) => { const z = id ? ex.events!.find((x) => x.id === id) : undefined; return z ? nrLabel(z, ex) : ""; };
      for (const [text, art, level, aufheben, pruef] of saetze) {
        it(text, () => {
          clock += 60000;
          const now = new Date(clock);
          const t = iso(now);
          let { d, st } = lies(ex, text, now);
          const d0 = d, st0 = st;
          expect(d.art, "Art").toBe(art);
          expect(st.level, st.reasons.map((r) => r.text).join(" | ")).toBe(level);
          // unscharf erkannt ist nie grün
          if (d.unscharf) expect(st.level).not.toBe("bereit");
          if (st.level === "geht-nicht" && d.hebtAufKandidaten?.length) d = aufhebDraft(d, ex.events!.find((x) => x.id === d.hebtAufKandidaten![0])!);
          let e: LageEvent | null = null;
          const vorher = situationAt(ex.events!, t).loose.length;
          if (st.level !== "geht-nicht" || d !== d0) {
            e = eventFromDraft(d, "dev-pruef", now, { nr: n++, kuerzel: "BSP" });
            ex.events = [...ex.events!, e];
            expect(zeichnet(ex, e.id, t), "neues Zeichen").toBe(false);
            expect(!!e.hebtAuf, "Aufhebung").toBe(aufheben);
            if (aufheben) expect(situationAt(ex.events!, t).loose.length).toBe(vorher - 1);
          }
          for (const [u, o] of Object.entries(STAO)) expect(ort(ex, u, t), `${u} verschoben`).toBe(o);
          pruef?.(d0, st0, e, nr);
        });
      }
    });
  }
  it("Lebenszeichen: Antwort an den Trupp setzt «still» nicht zurück, Antwort vom Trupp schon", () => {
    const ex = demoExercise();
    const rf1 = trage(ex, lies(ex, "H01 Rückfrage: Ablösung wann?", at("0600")).d, at("0600"));
    const rf3 = trage(ex, lies(ex, "Rückfrage an H03: Det 1 wo?", at("0601")).d, at("0601"));
    const still = (u: string) => lageBlau(ex, "2030-05-15T07:30").find((z) => z.trupp === u)!.stillMin;
    const vor1 = still("H01");
    const a1 = trage(ex, lies(ex, `Antwort zu ${nrLabel(rf1, ex)}: um 1200`, at("0725")).d, at("0725"));
    expect(a1).toMatchObject({ bezug: rf1.id, an: "H01" });
    expect(still("H01")).toBe(vor1);
    trage(ex, lies(ex, "Antwort an H01: Ablösung 1300", at("0726")).d, at("0726"));
    expect(still("H01")).toBe(vor1);
    const a3 = trage(ex, lies(ex, `Antwort zu ${nrLabel(rf3, ex)}: Det 1 in AP10`, at("0727")).d, at("0727"));
    expect(a3).toMatchObject({ bezug: rf3.id, melder: "H03" });
    expect(still("H03")).toBe(3);
  });
  it("unscharf nie grün, genau bleibt grün; echte Wörter («aufgebaut», «abgebogen», «entfernen sich») sind nie unscharf", () => {
    const ex = demoExercise();
    const G: Array<[string, Partial<Draft>, EntryLevel]> = [
      ["H04 Sperre AG13 aufgeh.", { hebtAuf: ex.events!.find((e) => e.sym === "sperre" && e.cells?.includes("AG13"))!.id, unscharf: { wort: "Aufheben", token: "aufgeh." } }, "pruefen"],
      ["H05 IED AF13 gerämt", { unscharf: { wort: "Aufheben", token: "gerämt" } }, "pruefen"],
      ["Aufrag an H01: Beo NAI 1", { art: "auftrag", an: "H01", unscharf: { wort: "Auftrag", token: "Aufrag" } }, "pruefen"],
      ["Auftrg H02 Beo NAI 1", { art: "auftrag", an: "H02" }, "pruefen"],
      ["Auftr. an H05: Stao AQ12 beziehen", { art: "auftrag", an: "H05" }, "pruefen"],
      ["H02 antwortet: 3 Fz", { art: "notiz", bezugArt: "antwort", melder: "H02" }, "bereit"],
      ["Btl: Lagerapport 1800", { art: "orientierung", quelle: "Bat" }, "bereit"],
      ["Kdo Funkstille bis 0800", { art: "orientierung", quelle: "Kdo" }, "bereit"],
      ["Kdo Po AG11", { art: "meldung", sym: "kdo_po" }, "pruefen"],
      ["H02 2 Fz abgebogen Rtg N AK9", { art: "meldung", count: 2 }, "bereit"],
      ["H04 3 Pers haben Sperre aufgebaut AG12", { art: "meldung" }, "bereit"],
      ["H03 2 Pers entfernen sich Rtg S AN7", { art: "meldung", count: 2 }, "bereit"],
      // «frei» ohne Gesehenes verschiebt den Trupp nicht: Notiz (gelb «Kein Zeichen?»)
      ["H01 Strasse AC6 frei", { art: "notiz", notizGrund: "weg" }, "pruefen"],
      ["Auftrag an H02: bei Kontakt sofort melden", { art: "auftrag" }, "bereit"],
    ];
    for (const [s, soll, lvl] of G) {
      const { d, st } = lies(ex, s, at("0730"));
      expect(d, s).toMatchObject(soll);
      expect(st.level, `${s}: ${st.reasons.map((r) => r.text).join(" | ")}`).toBe(lvl);
      if (lvl === "bereit") expect(d.unscharf, s).toBeUndefined();
    }
    expect(lies(ex, "Auftrag an H02: bei Kontakt sofort melden", at("0730")).d.dringend).toBeUndefined();
    expect(lies(ex, "Auftrag an H02: sofort verschieben nach AL11", at("0730")).d.dringend).toBe(true);
    expect(lies(ex, "Kontakt! H03 sofort San AN7", at("0730")).d.dringend).toBe(true);
    // Ausweg: «H03 Antwort 3 Pers AN7» als Feind → Meldung mit Ort und Melder
    const f = lies(ex, "H03 Antwort 3 Pers AN7", at("0730"), { art: "meldung", kind: "feind" }).d;
    expect(f).toMatchObject({ art: "meldung", melder: "H03", cells: ["AN7"], count: 3 });
    expect(f.sichtung).toBeUndefined();
  });
  it("Übergabe-Daten: «Von oben» kennzeichnet Abgelaufenes (Lagerapport 1000 um 10:10)", () => {
    const ex = demoExercise();
    trage(ex, lies(ex, "Bat: Lagerapport 1000 im KP Bat", at("0830")).d, at("0830"));
    trage(ex, lies(ex, "Bat: Nachbar Kp 61/2 links", at("0847")).d, at("0847"));
    trage(ex, lies(ex, "Bat: Feind 40 Pers erwartet ab 0900", at("0851")).d, at("0851"));
    trage(ex, lies(ex, "Kdt: ab sofort Funkstille bis 1100", at("0900")).d, at("0900"));
    const v = vonOben(ex, "2030-05-15T10:10");
    expect(v.map((z) => [z.text, z.vorbei ?? false])).toEqual([["ab sofort Funkstille bis 1100", false], ["Feind 40 Pers erwartet ab 0900", false], ["Nachbar Kp 61/2 links", false]]);
    const v4 = vonOben(ex, "2030-05-15T10:10", 4);
    expect(v4[3]).toMatchObject({ text: "Lagerapport 1000 im KP Bat", termin: "2030-05-15T10:00", vorbei: true });
    expect(vonOben(ex, "2030-05-15T09:30", 4).every((z) => !z.vorbei)).toBe(true);
  });
});
