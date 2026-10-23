import { describe, expect, it } from "vitest";
import { cleanOcr, demoExercise, lastPosition, normalizeSpoken, parseMeldung, spokenNumber, splitMeldungen, type JournalContext, type WhereKind } from "../src";

// Tabellentests Funksprache / Texterkennung – nur fiktive Daten (Beispiel Bern, Raster BERN AA–AU × 1–15, NAI 1–3).

const N: Array<[string, string]> = [
  // ---- Beispiel aus dem Auftrag
  ["Hotel null vier, zwo Fahrzeuge, Alpha Golf eins drei, Richtung Nord", "H04 2 Fz AG13 Rtg N"],
  // ---- Buchstabieralphabet und Varianten der Spracherkennung
  ["Alfa Golf eins drei", "AG13"],
  ["Charly Delta fünf", "CD5"],
  ["Charlie Delta fünf", "CD5"],
  ["X-Ray Yankee Zulu", "XYZ"],
  ["Xray eins", "X1"],
  ["Viktor zwei", "V2"],
  ["Victor zwei", "V2"],
  ["Whisky drei", "W3"],
  ["Juliet Kilo vier", "JK4"],
  ["Juliett Lima eins", "JL1"],
  ["Oskar Papa zwei", "OP2"],
  ["Quebec Romeo eins", "QR1"],
  ["Sierra Tango Uniform", "STU"],
  ["Lima Victor Zulu", "LVZ"],
  ["Kilo Papa", "KP"],
  // einzelne Wörter ohne Ziffern bleiben (Golf, Hotel, Kilo als Wort)
  ["Juliet", "Juliet"],
  ["Hotel Bellevue in Bern", "Hotel Bellevue in Bern"],
  ["ein schwarzer Golf Richtung Bern", "ein schwarzer Golf Rtg Bern"],
  ["zwei Kilo Sprengstoff", "2 Kilo Sprengstoff"],
  // ---- Zahlen
  ["null", "0"],
  ["zwo", "2"],
  ["zwöi", "2"],
  ["drü Personen", "3 Pers"],
  ["foif Personen", "5 Pers"],
  ["sächs Fahrzüg", "6 Fz"],
  ["sibe", "7"],
  ["nüün", "9"],
  ["zäh Personen", "10 Pers"],
  ["zwölf Personen", "12 Pers"],
  ["neunzehn", "19"],
  ["einundzwanzig Personen", "21 Pers"],
  ["zweiundvierzig", "42"],
  ["neunundneunzig", "99"],
  ["dreissig", "30"],
  ["dreißig", "30"],
  ["hundertfünfzig Meter", "150 m"],
  ["zweihundert Meter", "200 m"],
  ["eins drei", "13"],
  ["null sieben zwo null", "0720"],
  ["0 7 2 0", "0720"],
  ["ein Fahrzeug", "1 Fz"],
  ["eine Person", "1 Pers"],
  ["ein weisser Lieferwagen", "1 weisser Lieferwagen"],
  ["ein gegnerisches Maschinengewehr", "1 gn Mg"],
  ["eine Sperre", "eine Sperre"],
  // ---- Elemente
  ["Hotel null vier", "H04"],
  ["Hotel 04", "H04"],
  ["Hotel 0 4", "H04"],
  ["Detachement zwo", "Det 2"],
  ["Detachement eins zwei Fahrzeuge", "Det 1 2 Fz"],
  ["Detachement zwo zwei Personen Alpha Juliett acht", "Det 2 2 Pers AJ8"],
  ["Zug eins", "Zug 1"],
  ["Gruppe drei verschiebt", "Gr 3 verschiebt"],
  ["Trupp zwei", "Trp 2"],
  ["Patrouille eins", "Pat 1"],
  ["Hotel null vier zwei Fahrzeuge", "H04 2 Fz"],
  ["Hotel null fünf Drohne", "H05 Drohne"],
  ["Hotel null fünf drei Drohnen", "H05 3 Drohnen"],
  // ---- Planquadrate und NAI
  ["Alpha Golf eins drei Charlie", "AG13 C"],
  ["Alpha Golf eins drei (Charlie)", "AG13 C"],
  ["Planquadrat Alpha Golf eins drei", "AG13"],
  ["PQ Alpha Golf eins drei", "AG13"],
  ["im Planquadrat Alpha Golf eins drei Delta", "AG13 D"],
  ["Alpha Foxtrot eins zwo Alpha", "AF12 A"],
  ["Alpha Golf eins drei zwei Fahrzeuge", "AG13 2 Fz"],
  ["Alpha Golf 13, Richtung Nord.", "AG13 Rtg N"],
  ["November Alpha India drei", "NAI 3"],
  ["NAI drei", "NAI 3"],
  ["Beobachtungsraum drei", "NAI 3"],
  // ---- Uhrzeiten und Tage
  ["sieben Uhr zwanzig", "0720"],
  ["neunzehn Uhr dreissig", "1930"],
  ["sieben Uhr", "0700"],
  ["um sieben Uhr", "0700"],
  ["zwei Fahrzeuge um null sieben zwo null Richtung Nord", "2 Fz um 0720 Rtg N"],
  ["null sieben zwo null Uhr", "0720"],
  ["Um 7.20 Uhr Hotel 04", "0720 H04"],
  ["07:20 H04 2 Fz", "07:20 H04 2 Fz"],
  ["zwanzig nach sieben", "0720"],
  ["viertel nach sieben", "0715"],
  ["viertel vor acht", "0745"],
  ["zehn vor acht", "0750"],
  ["halb acht", "0730"],
  ["fünf vor halb acht", "0725"],
  ["Tag zwei null sieben eins fünf Hotel null vier", "T2 0715 H04"],
  ["Tango zwei null sieben eins fünf", "T2 0715"],
  // ---- Richtungen
  ["Richtung Nord", "Rtg N"],
  ["Richtung Nordost", "Rtg NO"],
  ["in Richtung Nordosten", "Rtg NO"],
  ["Richtung Süden", "Rtg S"],
  ["Richtung Südwest", "Rtg SW"],
  ["Richtung Nord-West", "Rtg NW"],
  ["nach Westen", "Rtg W"],
  ["nach Osten", "Rtg O"],
  ["nordwärts", "Rtg N"],
  ["von Osten", "aus Rtg O"],
  ["aus Richtung Süden Schüsse", "aus Rtg S Schüsse"],
  ["Richtung Bern", "Rtg Bern"],
  ["Richtig Nord", "Rtg N"],
  // ---- Begriffe
  ["drei gegnerische Schützenpanzer", "3 gn Spz"],
  ["zwei Kampfpanzer", "2 Kpz"],
  ["Personenwagen", "Pw"],
  ["zwo Personen mit Sturmgewehr", "2 Pers mit Stgw"],
  ["zivile Fahrzeuge", "ziv Fz"],
  ["eigene Patrouille Alpha November zehn", "eig Patrouille AN10"],
  ["Beobachtungsstandort bezogen", "Beo Stao bezogen"],
  ["ein gegnerischer Halbzug Infanterie", "1 gn Hz Inf"],
  // ---- Funkfloskeln, Grüsse, Wiederholung, Buchstabieren
  ["LVZ hier Hotel null drei, kommen", "H03"],
  ["Hier Hotel null eins, Meldung: drei Personen bei NAI eins", "H01 3 Pers bei NAI 1"],
  ["Meldung von Hotel null drei", "H03"],
  ["Hotel null vier an LVZ", "H04"],
  ["LVZ von Hotel null fünf", "H05"],
  ["Grüessech, Hotel null vier, Merci", "H04"],
  ["Grüezi, hier Hotel null zwei, verstanden", "H02"],
  ["äh zwei Fahrzeuge ähm", "2 Fz"],
  ["Hotel null äh vier", "H04"],
  ["verstanden Ende", ""],
  ["zwei Fahrzeuge ich wiederhole zwei Fahrzeuge", "2 Fz"],
  ["zwo Fahrzeuge, ich wiederhole, zwo Fahrzeuge, Planquadrat Alpha Golf eins drei. Ende", "2 Fz AG13"],
  ["angekommen in Wabern ich buchstabiere Whiskey Alpha Bravo Echo Romeo November", "angekommen in Wabern"],
  ["angekommen in ich buchstabiere Whiskey Alpha Bravo Echo Romeo November", "angekommen in Wabern"],
  ["am Ende der Strasse", "am Ende der Strasse"],
  // ---- Koordinaten
  ["Koordinate zwei sechs null null eins null null Strich eins eins neun neun null null null", "Koordinate 2'600'100 / 1'199'000"],
  ["2 6 0 0 1 0 0 / 1 1 9 9 0 0 0", "2'600'100 / 1'199'000"],
  ["sechs null null eins null null Strich eins neun neun null null null", "600'100 / 199'000"],
  // ---- mehrere Meldungen
  ["Hotel null vier. Null sieben zwo null Hotel null drei", "H04\n0720 H03"],
  [
    "Hotel null fünf. Gegnerische Sperre in Alpha Golf eins drei. Ende. Hotel null zwei, zwei Kampfpanzer, Alpha Kilo neun, nach Westen. Ende",
    "H05 gn Sperre in AG13\nH02 2 Kpz AK9 Rtg W",
  ],
  // ---- Schreibweisen der Spracherkennung, Zeit an der richtigen Stelle, Korrekturen
  ["Hotel-Null-Vier, Alpha-Golf-13", "H04 AG13"],
  ["X-Ray eins", "X1"],
  ["Hotel Null Vier, Zwei Fahrzeuge", "H04 2 Fz"],
  ["Hotel null vier, Zeit null sieben eins fünf, zwei Fahrzeuge", "0715 H04 2 Fz"],
  ["Hotel null vier null sieben eins fünf zwei Fahrzeuge", "0715 H04 2 Fz"],
  ["Zeit null sieben eins fünf Hotel null vier", "0715 H04"],
  ["Tag zwei, Hotel null vier, Zeit null sieben eins fünf, Sperre", "T2 0715 H04 Sperre"],
  ["Null sieben eins fünf Hotel null vier zwei Fahrzeuge Alpha Golf eins drei, null sieben zwo null Hotel null fünf Sperre", "0715 H04 2 Fz AG13\n0720 H05 Sperre"],
  ["zwei Fahrzeuge Korrektur drei Fahrzeuge Alpha Golf eins drei", "3 Fz AG13"],
  ["Alpha Golf eins drei, ich korrigiere, Alpha Golf eins vier", "AG14"],
  ["Richtung Nord, Korrektur, Richtung Süd", "Rtg S"],
  ["LVZ Hotel null vier zwei Fahrzeuge", "H04 2 Fz"],
  ["von Hotel null vier: Sperre", "H04: Sperre"],
  ["Richtig Norde", "Rtg N"],
  ["Hotel null vier, zwöi Fahrzüg, Alpha Golf eis drü, Richtig Norde", "H04 2 Fz AG13 Rtg N"],
  ["Hotel null drei, dreizehn Personen, Alpha Golf dreizehn", "H03 13 Pers AG13"],
  // ---- schon kurz geschrieben: bleibt
  ["0715 H04 2 Fz AG13 Rtg N", "0715 H04 2 Fz AG13 Rtg N"],
  ["H03: 1 Fz in NAI 2 Rtg S", "H03: 1 Fz in NAI 2 Rtg S"],
  ["T2 0705 H04: gn Sperre in AG13", "T2 0705 H04: gn Sperre in AG13"],
];

describe("normalizeSpoken (Funksprache → Kurzmeldung)", () => {
  it.each(N)("%s", (input, expected) => {
    expect(normalizeSpoken(input).text).toBe(expected);
  });

  it("meldet die Ersetzungen zur Anzeige", () => {
    const r = normalizeSpoken("Hotel null vier, zwo Fahrzeuge, Alpha Golf eins drei, Richtung Nord, kommen");
    expect(r.changes).toEqual(expect.arrayContaining([
      { from: "Hotel null vier", to: "H04" },
      { from: "Alpha Golf eins drei", to: "AG13" },
      { from: "Richtung Nord", to: "Rtg N" },
      { from: "Fahrzeuge", to: "Fz" },
      { from: "kommen", to: "" },
    ]));
  });

  it("unveränderter Text hat keine Ersetzungen", () => {
    expect(normalizeSpoken("0715 H04 2 Fz AG13").changes).toEqual([]);
  });

  it("leerer Text", () => {
    expect(normalizeSpoken("   ")).toEqual({ text: "", changes: [] });
  });
});

describe("spokenNumber", () => {
  it.each([
    ["zwo", 2], ["zwöi", 2], ["drü", 3], ["einundzwanzig", 21], ["zwöiezwänzg", 22], ["dreiunddreissig", 33],
    ["neunundneunzig", 99], ["hundert", 100], ["zweihundertfünfzig", 250], ["Strasse", undefined], ["Golf", undefined],
  ] as Array<[string, number | undefined]>)("%s → %s", (w, n) => {
    expect(spokenNumber(w)).toBe(n);
  });
});

// ---------------------------------------------------------------------------------------------------------------

const S: Array<[string, string, string[]]> = [
  ["eine Meldung", "H04 2 Fz AG13 Rtg N", ["H04 2 Fz AG13 Rtg N"]],
  ["leer", "  \n \n", []],
  [
    "Journalseite mit Kopf und Tabelle",
    "Lagejournal Beispiel Bern\nDatum: 15.05.2030\nZeit | Melder | Meldung\n0715 | H04 | 2 Fz AG13 Rtg N\n0720 | H03 | 1 Fz in NAI 2\nRtg S\n07:25 H02 Det 2 3 Pers AB6",
    ["0715 H04 2 Fz AG13 Rtg N", "0720 H03 1 Fz in NAI 2 Rtg S", "07:25 H02 Det 2 3 Pers AB6"],
  ],
  ["Ende trennt", "H04 2 Fz AG13 Ende H03 1 Fz NAI 2 Ende", ["H04 2 Fz AG13", "H03 1 Fz NAI 2"]],
  ["Schluss trennt", "H01 Beo Stao AE5 C. Schluss. H02 Beo Stao AK9 B", ["H01 Beo Stao AE5 C", "H02 Beo Stao AK9 B"]],
  ["am Ende der Strasse trennt nicht", "H02 Sperre am Ende der Strasse AM5", ["H02 Sperre am Ende der Strasse AM5"]],
  ["Nummerierung", "1. H04 Beo Stao AF12 A\n2. H05 Drohne über AR10\n3) H02 Sperre AM5", ["H04 Beo Stao AF12 A", "H05 Drohne über AR10", "H02 Sperre AM5"]],
  ["Aufzählungszeichen", "- H04 Kontakt mit Gegner\n• H05 Drohne über AR10", ["H04 Kontakt mit Gegner", "H05 Drohne über AR10"]],
  ["Satzende vor Zeit", "0715 H04 2 Fz AG13. 0720 H03 1 Fz NAI 2.", ["0715 H04 2 Fz AG13", "0720 H03 1 Fz NAI 2"]],
  ["Folgezeile klein", "H04 2 Fz AG13\nRtg N\nH03 Sperre AM5", ["H04 2 Fz AG13 Rtg N", "H03 Sperre AM5"]],
  ["Zeilen ohne Zeit einzeln", "H04 2 Fz AG13\nH03 Sperre AM5\nH05 Drohne über AR10", ["H04 2 Fz AG13", "H03 Sperre AM5", "H05 Drohne über AR10"]],
  ["Leerzeile trennt", "0715 H04 2 Fz\n\nH03 Sperre AM5", ["0715 H04 2 Fz", "H03 Sperre AM5"]],
  ["Tage T1/T2", "T2 0715 H04 2 Fz\nT2 0720 H03 Sperre AM5", ["T2 0715 H04 2 Fz", "T2 0720 H03 Sperre AM5"]],
  ["Zeit mit Punkt", "07.15 H04 2 Fz\n07.20 H03 Sperre AM5", ["07.15 H04 2 Fz", "07.20 H03 Sperre AM5"]],
  ["Folgezeilen hängen an (Journal)", "0715 H04 3 Fz AH11\nstehen mit laufendem Motor\n0720 H05 Drohne", ["0715 H04 3 Fz AH11 stehen mit laufendem Motor", "0720 H05 Drohne"]],
  ["Koordinate ist keine Zeit", "0715 H02 3 Fz\n2'600'100 / 1'199'000", ["0715 H02 3 Fz 2'600'100 / 1'199'000"]],
  ["Meldezettel mit Feldern", "Zeit: 0715\nMelder: H04\nWas: 2 Fz\nWo: AG13\nWohin: N", ["0715 H04: 2 Fz AG13 Rtg N"]],
  ["zwei Meldezettel", "Zeit: 0715\nMelder: H04\nWas: 2 Fz\n\nZeit: 0720\nMelder: H03\nWas: Sperre\nWo: AM5", ["0715 H04: 2 Fz", "0720 H03: Sperre AM5"]],
  ["Kopfzeile allein", "Zeit Melder Meldung", []],
  ["Seitenzahl", "Seite 2 von 3\n0715 H04 2 Fz", ["0715 H04 2 Fz"]],
  ["Tabulator-Spalten", "0715\tH04\t2 Fz AG13", ["0715 H04 2 Fz AG13"]],
  ["Ergebnis von normalizeSpoken", normalizeSpoken("Hotel null fünf, Drohne über Alpha Romeo eins null. Ende. Hotel null zwei Sperre Alpha Mike fünf. Ende").text, ["H05 Drohne über AR10", "H02 Sperre AM5"]],
];

describe("splitMeldungen", () => {
  it.each(S)("%s", (_name, input, expected) => {
    expect(splitMeldungen(input)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------------------------------------------

const O: Array<[string, string]> = [
  ["O7I5 H04 2 Fz AGl3", "0715 H04 2 Fz AG13"],
  ["O7:I5 NAl 2", "07:15 NAI 2"],
  ["O7.l5 H03", "07.15 H03"],
  ["HO4 Beo Stao AFl2 A", "H04 Beo Stao AF12 A"],
  ["H0l verschiebt", "H01 verschiebt"],
  ["AGI3", "AG13"],
  ["AG1O", "AG10"],
  ["2'6OO'1OO / 1'l99'OOO", "2'600'100 / 1'199'000"],
  ["Liefer-\nwagen  in   NAI 3", "Lieferwagen in NAI 3"],
  ["Nord-\nOst", "Nord-Ost"],
  ["„Sperre“ — AM5", '"Sperre" – AM5'],
  ["0715 H04\n\n\n\n0720 H03", "0715 H04\n\n0720 H03"],
  ["  0715 H04   ", "0715 H04"],
  ["0715 l H04 l 2 Fz AG13", "0715 | H04 | 2 Fz AG13"],
  ["0720 ] H03 [ Sperre", "0720 | H03 | Sperre"],
  // Kreis-Zeichen statt O/C, «NA13» = NAI 3
  ["0612 H03 2 Pw ziv AN6 Rtg ©", "0612 H03 2 Pw ziv AN6 Rtg O"],
  ["0618 H05 Det 1 Checkpoint AK7 ©", "0618 H05 Det 1 Checkpoint AK7 C"],
  ["0618 H05 Checkpoint AK7 €, besetzt", "0618 H05 Checkpoint AK7 C, besetzt"],
  ["Rtg ®", "Rtg O"],
  ["0647 H06 2 Kpz in NA13 S", "0647 H06 2 Kpz in NAI 3 S"],
  ["0647 H06 2 Kpz in NAI3 Rtg S", "0647 H06 2 Kpz in NAI 3 Rtg S"],
  ["NAl2", "NAI 2"],
  ["© 2030", "© 2030"],
  // normale Wörter bleiben
  ["Oll Ost Insel Golf", "Oll Ost Insel Golf"],
  ["Hotel Bellevue", "Hotel Bellevue"],
  ["Det 2 Patrouille AH10 Rtg N", "Det 2 Patrouille AH10 Rtg N"],
];

describe("cleanOcr", () => {
  it.each(O)("%s", (input, expected) => {
    expect(cleanOcr(input)).toBe(expected);
  });

  it("«NA13» bleibt, wenn es das Planquadrat NA13 gibt und keine NAI 3", () => {
    expect(cleanOcr("Sperre NA13", { isCell: (c) => c === "NA13", nai: ["NAI 1"] })).toBe("Sperre NA13");
    expect(cleanOcr("Sperre NA13", { isCell: (c) => c === "NA13", nai: ["NAI 3"] })).toBe("Sperre NAI 3");
    expect(cleanOcr("Sperre NA13", { isCell: () => false })).toBe("Sperre NAI 3");
  });

  it("Foto einer Journalseite: cleanOcr → splitMeldungen", () => {
    const ocr = "Lagejournal\nZeit | Melder | Meldung\nO7I5 | HO4 | 2 Fz AGl3 Rtg N\nO72O | HO3 | 1 Fz in NAl 2, weisser Liefer-\nwagen\nO725 | HO5 | Drohne über ARlO";
    expect(splitMeldungen(cleanOcr(ocr))).toEqual(["0715 H04 2 Fz AG13 Rtg N", "0720 H03 1 Fz in NAI 2, weisser Lieferwagen", "0725 H05 Drohne über AR10"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Durchlauf normalizeSpoken → parseMeldung mit dem Demo-Kontext

const ex = demoExercise();
const ctx = (): JournalContext => ({
  sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now: new Date(2030, 4, 15, 8, 0),
  lastPos: (u, s) => lastPosition(ex.events!, s, u),
});

interface P { time?: string; kind: "eigen" | "feind" | "unklar"; melder: string; unit?: string; sym: string; wo: WhereKind | null; label?: string; count?: number; dir?: number; from?: number }

const PIPE: Array<[string, P]> = [
  ["Hotel null vier, zwo Fahrzeuge, Alpha Golf eins drei, Richtung Nord", { kind: "feind", melder: "H04", sym: "fz", wo: "raster", label: "AG13", count: 2, dir: 0 }],
  ["null sieben zwo null Hotel null drei ein Fahrzeug in November Alpha India zwei Richtung Süden", { time: "07:20", kind: "feind", melder: "H03", sym: "fz", wo: "nai", label: "NAI 2", count: 1, dir: 180 }],
  ["Hotel null vier, ein gegnerischer Halbzug Infanterie, Alpha Hotel eins zwei, Richtung Nord", { kind: "feind", melder: "H04", sym: "inf", wo: "raster", label: "AH12", count: 1, dir: 0 }],
  ["Hotel null fünf, mögliche IED in Alpha Foxtrot eins drei, kommen.", { kind: "feind", melder: "H05", sym: "ied", wo: "raster", label: "AF13" }],
  ["Hotel null zwei, zwei Kampfpanzer Alpha Kilo neun Richtung Westen", { kind: "feind", melder: "H02", sym: "kpz", wo: "raster", label: "AK9", count: 2, dir: 270 }],
  ["Hotel null eins Beobachtungsstandort bezogen Alpha Echo fünf Charlie", { kind: "eigen", melder: "H01", unit: "H01", sym: "beob_aufkl", wo: "raster", label: "AE5 C" }],
  ["Tag zwei null eins eins fünf Hotel null zwei Detachement zwo zwei Personen Alpha Echo acht nach Westen", { time: "01:15", kind: "feind", melder: "H02", unit: "Det 2", sym: "inf_trp", wo: "raster", label: "AE8", count: 2, dir: 270 }],
  ["Hotel null drei, Detachement eins, Checkpoint in Beobachtungsraum zwei", { kind: "feind", melder: "H03", unit: "Det 1", sym: "kontrollposten", wo: "nai", label: "NAI 2" }],
  ["Hotel null vier, gegnerische Sperre in Alpha Golf eins drei", { kind: "feind", melder: "H04", sym: "sperre", wo: "raster", label: "AG13" }],
  ["Hotel null fünf Drohne über Alpha Romeo eins null", { kind: "feind", melder: "H05", sym: "drohne", wo: "raster", label: "AR10" }],
  ["Hotel null eins, vier Personen, Alpha Delta sieben, Zugehörigkeit unklar", { kind: "unklar", melder: "H01", sym: "inf_trp", wo: "raster", label: "AD7", count: 4 }],
  ["Hotel null zwei Koordinate zwei sechs null null eins null null Strich eins eins neun neun null null null drei Fahrzeuge", { kind: "feind", melder: "H02", sym: "fz", wo: "koordinate", count: 3 }],
  ["Hotel null vier Schüsse aus Richtung Osten", { kind: "feind", melder: "H04", sym: "kontakt", wo: "melder", from: 90 }],
  ["sieben Uhr zwanzig, Hotel null drei, ein Fahrzeug, November Alpha India zwei, nordwärts", { time: "07:20", kind: "feind", melder: "H03", sym: "fz", wo: "nai", label: "NAI 2", count: 1, dir: 0 }],
  ["Hotel null fünf, drei Fahrzeuge in Kolonne, Alpha Papa eins null, Richtung West", { kind: "feind", melder: "H05", sym: "kolonne", wo: "raster", label: "AP10", count: 3, dir: 270 }],
  ["Detachement zwo, zwei Personen, Alpha Juliett acht", { kind: "feind", melder: "", unit: "Det 2", sym: "inf_trp", wo: "raster", label: "AJ8", count: 2 }],
  ["Hotel null drei zwei zivile Fahrzeuge in Alpha November sechs", { kind: "unklar", melder: "H03", sym: "ziv_fz", wo: "raster", label: "AN6", count: 2 }],
  ["LVZ hier Hotel null vier, Kontakt mit Gegner, kommen", { kind: "feind", melder: "H04", sym: "kontakt", wo: "melder" }],
];

describe("Durchlauf normalizeSpoken → parseMeldung (Demo Bern)", () => {
  it.each(PIPE)("%s", (spoken, p) => {
    const d = parseMeldung(normalizeSpoken(spoken).text, ctx());
    if (p.time) expect(d.t.slice(11)).toBe(p.time);
    expect(d.kind).toBe(p.kind);
    expect(d.melder).toBe(p.melder);
    expect(d.unit).toBe(p.unit ?? "");
    expect(d.sym).toBe(p.sym);
    expect(d.where?.kind ?? null).toBe(p.wo);
    if (p.label) expect(d.where?.label).toBe(p.label);
    expect(d.count).toBe(p.count);
    expect(d.dir).toBe(p.dir);
    expect(d.from).toBe(p.from);
  });

  it("Memo mit zwei Meldungen: normalizeSpoken → splitMeldungen → parseMeldung", () => {
    const memo = "Null sieben eins fünf, Hotel null vier, zwo Fahrzeuge, Alpha Golf eins drei, Richtung Nord. Ende. "
      + "Null sieben zwo null, Hotel null fünf, gegnerische Sperre in November Alpha India drei. Ende.";
    const parts = splitMeldungen(normalizeSpoken(memo).text);
    expect(parts).toEqual(["0715 H04 2 Fz AG13 Rtg N", "0720 H05 gn Sperre in NAI 3"]);
    const [a, b] = parts.map((t) => parseMeldung(t, ctx()));
    expect(a!.t.slice(11)).toBe("07:15");
    expect(a!.cells).toEqual(["AG13"]);
    expect(b!.sym).toBe("sperre");
    expect(b!.nai).toBe("NAI 3");
  });
});

describe("getippte Meldungen bleiben (keine Regression)", () => {
  const lines = ex.events!.map((e) => `${e.t.slice(0, 10) === ex.days[0] ? "T1" : "T2"} ${e.t.slice(11, 16).replace(":", "")} ${e.text}`);
  const key = (t: string) => {
    const d = parseMeldung(t, ctx());
    return [d.t, d.kind, d.melder, d.unit, d.sym, d.sidc, d.count, d.dir, d.from, d.where, d.cells, d.nai, d.desc];
  };
  it("Demo-Meldungen: gleiches Ergebnis in parseMeldung", () => {
    for (const l of lines) expect(key(normalizeSpoken(l).text), l).toEqual(key(l));
  });
  it("Demo-Meldungen: Text fast unverändert (nur Kürzel)", () => {
    const changed = lines.filter((l) => normalizeSpoken(l).text !== l);
    expect(changed).toEqual(["T2 0425 H03: 2 Fz halten AO5, Personen steigen um"]);
  });
  it("splitMeldungen lässt die Demo-Zeilen einzeln", () => {
    expect(splitMeldungen(lines.join("\n"))).toEqual(lines);
  });
});
