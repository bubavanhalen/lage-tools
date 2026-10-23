import { describe, expect, it } from "vitest";
import { demoExercise, lastPosition, normalizeSpoken, parseMeldung, splitMeldungen, type JournalContext } from "../src";

// Prüfer-Tabelle Etappe 4b (Funksprache, wie Whisper sie schreibt) – normalizeSpoken → splitMeldungen → parseMeldung.
// Nur fiktive Daten (Beispiel Bern, Raster BERN AA–AU × 1–15, NAI 1–3).

const ex = demoExercise();
const ctx = (): JournalContext => ({
  sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now: new Date(2030, 4, 15, 8, 0),
  lastPos: (u, s) => lastPosition(ex.events!, s, u),
});
type S = { n?: number; time?: string; melder?: string; unit?: string; kind?: string; sym?: string; wo?: string; count?: number; dir?: number; from?: number; road?: string };
const C: Array<[string, S]> = [
  ["Hotel 04, zwei Fahrzeuge, Alpha Golf 13, Richtung Nord.", { melder: "H04", kind: "feind", sym: "fz", wo: "AG13", count: 2, dir: 0 }],
  ["Hotel 04 2 Fahrzeuge Alpha Golf 1 3 Richtung Nord", { melder: "H04", sym: "fz", wo: "AG13", count: 2, dir: 0 }],
  ["Hotel null vier, äh, zwo Fahrzeuge, Alpha Golf eins drei, Richtung Norden, kommen.", { melder: "H04", sym: "fz", wo: "AG13", count: 2, dir: 0 }],
  ["LVZ von Hotel 02, drei Personen gegnerisch bei Alpha Charlie 5, verschieben nach Westen, kommen.", { melder: "H02", kind: "feind", sym: "inf_trp", wo: "AC5", count: 3, dir: 270 }],
  ["Hier Hotel 06, Detachement zwo, vier Fahrzeuge, Planquadrat Alpha Delta 9, Richtung Nordost. Kommen.", { melder: "H06", unit: "Det 2", sym: "fz", wo: "AD9", count: 4, dir: 45 }],
  ["Hotel 05 Beobachtungsposten bezogen Alpha Foxtrot 12 Delta.", { melder: "H05", kind: "eigen", wo: "AF12 D" }],
  ["07:20 Hotel 03 ein Schützenpanzer in November Alpha India 3 Richtung Süd", { time: "07:20", melder: "H03", sym: "spz", wo: "NAI 3", count: 1, dir: 180 }],
  ["Null acht fünfzehn, Hotel eins, Checkpoint bezogen in Alpha Kilo sieben Charlie.", { time: "08:15", melder: "H01", kind: "eigen", wo: "AK7 C" }],
  ["Hotel 04, zwei Fahrzeuge, Korrektur, drei Fahrzeuge, Alpha Golf 13.", { melder: "H04", count: 3, wo: "AG13" }],
  ["Hotel 04, Alpha Golf 13, ich korrigiere, Alpha Golf 14, ein Lastwagen.", { melder: "H04", wo: "AG14", count: 1 }],
  ["Hotel 02, ich wiederhole, Hotel 02, Kontakt mit Gegner in Alpha Kilo 9.", { melder: "H02", sym: "kontakt", wo: "AK9" }],
  ["Hotel 03 meldet zwei zivile Fahrzeuge in Alpha November 6.", { melder: "H03", kind: "unklar", sym: "ziv_fz", wo: "AN6", count: 2 }],
  ["Hotel 01, vier Personen, Alpha Delta 7, Zugehörigkeit unklar.", { melder: "H01", kind: "unklar", wo: "AD7", count: 4 }],
  ["Hotel 05, Drohne über Alpha Romeo 10.", { melder: "H05", sym: "drohne", wo: "AR10" }],
  ["Hotel 04, Schüsse aus Richtung Osten.", { melder: "H04", sym: "kontakt", from: 90 }],
  ["Tag zwei, null eins eins fünf, Hotel 02, Detachement 2, zwei Personen, Alpha Echo 8, nach Westen.", { time: "01:15", melder: "H02", unit: "Det 2", wo: "AE8", count: 2, dir: 270 }],
  ["Hotel 02, Koordinate zwei sechs null null eins null null, eins eins neun neun null null null, drei Fahrzeuge.", { melder: "H02", wo: "koordinate", count: 3 }],
  ["Sieben Uhr zwanzig, Hotel 03, ein Fahrzeug, Nai 2, nordwärts.", { time: "07:20", melder: "H03", wo: "NAI 2", count: 1, dir: 0 }],
  ["Grüessech, Hotel 05, drü Fahrzüg in Kolonne, Alpha Papa zäh, Richtig West.", { melder: "H05", sym: "kolonne", wo: "AP10", count: 3, dir: 270 }],
  ["Hotel 04 gegnerische Sperre in Alpha Golf 13.", { melder: "H04", sym: "sperre", wo: "AG13" }],
  ["Hotel 05, mögliche IED in Alpha Foxtrot 13, kommen.", { melder: "H05", sym: "ied", wo: "AF13" }],
  ["Hotel 02, zwei Kampfpanzer, Alpha Kilo 9, Richtung Westen.", { melder: "H02", sym: "kpz", wo: "AK9", count: 2, dir: 270 }],
  ["Hotel 04, ein gegnerischer Halbzug Infanterie, Alpha Hotel 12, Richtung Nord.", { melder: "H04", sym: "inf", wo: "AH12", dir: 0 }],
  ["Alpha Golf 13, Hotel 04, zwei Fahrzeuge.", { melder: "H04", wo: "AG13", count: 2 }],
  // «Alpha Golf 1/3», «Hote 04», «Nordhorst»: Hörfehler, korrigiert vorher `fixHearing` (UI) → hier in dieser Form
  ["Hotel 04, 2 Fahrzeuge, Alpha Golf 1 3, Richtung Nord.", { melder: "H04", wo: "AG13", count: 2, dir: 0 }],
  ["Hotel 04, zwei Fahrzeuge, Alpha Golf 13.", { melder: "H04", wo: "AG13", count: 2 }],
  ["Hotel 03, ein weisser Lieferwagen, Alpha Lima 4, fährt Richtung Bern.", { melder: "H03", wo: "AL4", count: 1 }],
  ["Hotel null eins, Standort Alpha Echo fünf Charlie, keine Feindsicht.", { melder: "H01", kind: "eigen", wo: "AE5 C" }],
  ["Hotel 06, zwanzig nach sieben, eine Patrouille, drei Mann, Alpha India 11.", { time: "07:20", melder: "H06", wo: "AI11" }],
  ["Hotel 02, um halb acht, zwei Personen steigen aus Fahrzeug, Alpha Juliett 8.", { time: "07:30", melder: "H02", wo: "AJ8", count: 2 }],
  ["Hotel 04, äh, ähm, Alpha, äh, Golf 13, zwei Fahrzeuge.", { melder: "H04", wo: "AG13", count: 2 }],
  ["Hotel 04. Zwei Fahrzeuge. Alpha Golf. 13. Richtung Nord.", { melder: "H04", wo: "AG13", count: 2, dir: 0 }],
  ["Hotel Null Vier, Zwo Fahrzeuge, Alpha-Golf-13, Richtung Nord.", { melder: "H04", wo: "AG13", count: 2, dir: 0 }],
  ["Hotel 04, zwei Fahrzeuge auf der Hauptstrasse Richtung Bern, Alpha Golf 13.", { melder: "H04", wo: "AG13", count: 2, road: "haupt" }],
  ["Hotel 03, Detachement 1, Checkpoint in Beobachtungsraum 2.", { melder: "H03", unit: "Det 1", sym: "kontrollposten", wo: "NAI 2" }],
  ["Hotel 05, Kontakt, Feuerkampf mit vier Gegnern, Alpha Sierra 13.", { melder: "H05", sym: "kontakt", wo: "AS13" }],
  ["Hotel 04, Gegner zieht sich zurück Richtung Süden, Alpha Golf 14.", { melder: "H04", kind: "feind", wo: "AG14", dir: 180 }],
  ["Hotel 02, eine Drohne, Höhe ca. hundert Meter, Alpha Kilo 8 Bravo.", { melder: "H02", sym: "drohne", wo: "AK8 B" }],
  ["Hotel 01 verschiebt nach Alpha Echo 6.", { melder: "H01", kind: "eigen", wo: "AE6" }],
  ["Hotel 04, zwo Fahrzeuge, ich wiederhole, zwo Fahrzeuge, Alpha Golf 13.", { melder: "H04", wo: "AG13", count: 2 }],
  ["Hotel 04 zwei Fahrzeuge Alpha Golf 13 Ende Hotel 05 Sperre Alpha Kilo 7 Ende", { n: 2 }],
  ["Null sieben eins fünf Hotel 04 zwei Fahrzeuge Alpha Golf 13. Null sieben zwanzig Hotel 05 Sperre in Nai 3.", { n: 2 }],
  ["Hotel 04 Planquadrat Alpha Golf eins drei Charlie, zwo Fahrzeuge stehen.", { melder: "H04", wo: "AG13 C", count: 2 }],
  ["Hotel 04, zwei Fahrzeuge, Alpha Golf 13, Richtung Nord Ost.", { melder: "H04", wo: "AG13", dir: 45 }],
  ["Hotel 04, 2 Fahrzeuge, Alpha Golf 13, Richtung Nordost.", { melder: "H04", wo: "AG13", dir: 45 }],
  ["Hotel 04, zwei Fahrzeuge, Alpha Golf dreizehn.", { melder: "H04", wo: "AG13", count: 2 }],
  ["Hotel 04, zwei Fahrzeuge, AG 13.", { melder: "H04", wo: "AG13", count: 2 }],
  ["Hotel 4, zwei Fahrzeuge, Alpha Golf 13.", { melder: "H04", wo: "AG13", count: 2 }],
  ["Hotel 04, zwei Fahrzeuge, Alpha Golf 13 Charlie, stehen, Motor läuft.", { melder: "H04", wo: "AG13 C", count: 2 }],
  ["Hotel 03, zwei bewaffnete Personen, Zugehörigkeit unklar, Alpha Mike 5.", { melder: "H03", kind: "unklar", wo: "AM5", count: 2 }],
  ["Hotel 04 zwei Fahrzeuge Alpha Golf 13 Richtung Nord Hotel 05 eine Sperre Alpha Kilo 7", { n: 2 }],
  ["Hotel null fünf, null sieben vier fünf, Sperre Alpha Kilo sieben.", { time: "07:45", melder: "H05", sym: "sperre", wo: "AK7" }],
  ["Hotel 04, zwei Fahrzeuge, Alpha Golf 13 Richtung Nord. Ende der Meldung.", { n: 1, melder: "H04", wo: "AG13" }],
  ["Hotel 02, ein Fahrzeug fährt mit hoher Geschwindigkeit Richtung Westen, Alpha Echo 7.", { melder: "H02", wo: "AE7", count: 1, dir: 270 }],
];

describe("Prüfer-Tabelle Funksprache (normalizeSpoken → splitMeldungen → parseMeldung)", () => {
  it.each(C)("%s", (raw, s) => {
    const parts = splitMeldungen(normalizeSpoken(raw).text);
    expect(parts.length, parts.join(" ‖ ")).toBe(s.n ?? 1);
    const d = parseMeldung(parts[0] ?? "", ctx());
    if (s.time) expect(d.t.slice(11, 16), "Zeit").toBe(s.time);
    if (s.melder) expect(d.melder, "Melder").toBe(s.melder);
    if (s.unit) expect(d.unit, "Element").toBe(s.unit);
    if (s.kind) expect(d.kind, "Art").toBe(s.kind);
    if (s.sym) expect(d.sym, "Zeichen").toBe(s.sym);
    if (s.wo) expect(s.wo === "koordinate" ? d.where?.kind : d.where?.label, "Ort").toBe(s.wo);
    if (s.count !== undefined) expect(d.count, "Anzahl").toBe(s.count);
    if (s.dir !== undefined) expect(d.dir, "Rtg").toBe(s.dir);
    if (s.from !== undefined) expect(d.from, "aus").toBe(s.from);
    if (s.road) expect(d.roadHint, "Strasse").toBe(s.road);
  });
});

// Uhrzeiten aus zwei gesprochenen Zahlen und Trennen ohne «Ende»
const Z: Array<[string, string[]]> = [
  ["Null acht fünfzehn Hotel 04 Sperre", ["0815 H04 Sperre"]],
  ["Sechzehn dreissig Hotel 04 Sperre", ["1630 H04 Sperre"]],
  ["Null sieben dreissig, Hotel 02", ["0730 H02"]],
  ["Zwanzig zwei zwei, Hotel 03, Kontakt", ["2022 H03 Kontakt"]],
  ["Acht fünfzehn, Hotel null vier, Sperre", ["0815 H04 Sperre"]],
  ["Grüessech, acht fünfzehn Hotel 04 Sperre", ["0815 H04 Sperre"]],
  ["Tag zwei, acht fünfzehn, Hotel 04, Sperre", ["T2 0815 H04 Sperre"]],
  ["Hotel 04, um acht fünfzehn, zwei Fahrzeuge", ["H04 um 0815 2 Fz"]],
  ["Hotel null fünf, null acht fünfzehn, Sperre Alpha Kilo sieben", ["0815 H05 Sperre AK7"]],
  ["Um acht Uhr fünfzehn Hotel 04", ["0815 H04"]],
  ["Zeit null acht zwo fünf Hotel 04", ["0825 H04"]],
  ["0815 Hotel 04 Sperre", ["0815 H04 Sperre"]],
  ["8.15 Uhr Hotel 04", ["0815 H04"]],
  ["Hotel 04 um 08:15 zwei Fahrzeuge", ["H04 um 08:15 2 Fz"]],
  ["Hotel null vier null sieben eins fünf zwei Fahrzeuge", ["0715 H04 2 Fz"]],
  // keine Zeit mitten in Mengen bzw. am Element
  ["Hotel 04, zwölf zwanzig Personen", ["H04 12 20 Pers"]],
  ["Hotel 04 zwei Fahrzeuge, acht fünfzehn Personen", ["H04 2 Fz 8 15 Pers"]],
  ["Hotel null acht fünfzehn Personen", ["H08 15 Pers"]],
  ["Hotel 03, dreizehn Personen, Alpha Golf dreizehn", ["H03 13 Pers AG13"]],
  ["Detachement zwo zwanzig Personen", ["Det 2 20 Pers"]],
  // Trennen ohne «Ende»
  ["Hotel 04 zwei Fahrzeuge, Alpha Golf 13. Hotel 05, Sperre, Alpha Kilo 7.", ["H04 2 Fz AG13", "H05 Sperre AK7"]],
  ["Erste Meldung Hotel 04 Sperre Alpha Kilo 7. Zweite Meldung Hotel 05 zwei Fahrzeuge Alpha Golf 13.", ["H04 Sperre AK7", "H05 2 Fz AG13"]],
  ["Hotel 04 zwei Fahrzeuge Alpha Golf 13, over. Hotel 05 Sperre Alpha Kilo 7, over.", ["H04 2 Fz AG13", "H05 Sperre AK7"]],
  ["Hotel 04 zwei Fahrzeuge Alpha Golf 13 Richtung Nord Hotel 05 eine Sperre Alpha Kilo 7", ["H04 2 Fz AG13 Rtg N", "H05 eine Sperre AK7"]],
  ["Hotel 04 Sperre Alpha Kilo 7. Detachement zwo, vier Fahrzeuge, Alpha Golf 13.", ["H04 Sperre AK7", "Det 2 4 Fz AG13"]],
  ["Hotel 04, Sperre in AK7. Null sieben zwanzig, Hotel 05 Drohne", ["H04 Sperre in AK7", "0720 H05 Drohne"]],
  ["Hotel 04, Hotel 04 von LVZ, verstanden, Ende.", ["H04"]],
  // bleibt eine Meldung
  ["Hotel 06. Detachement zwo, vier Fahrzeuge, Alpha Delta 9.", ["H06 Det 2 4 Fz AD9"]],
  ["Hotel 02, Kontakt mit Hotel 05 in Alpha Kilo 9", ["H02 Kontakt mit H05 in AK9"]],
  ["Hotel 03 Sperre bei Hotel 05", ["H03 Sperre bei H05"]],
  ["Hotel 01 übergibt an Hotel 02", ["H01 übergibt an H02"]],
  ["Hotel 04 zwei Fahrzeuge Richtung Hotel 05", ["H04 2 Fz Rtg H05"]],
  // kleine Lücken
  ["Hotel 04, äh, ähm, Alpha, äh, Golf 13, zwei Fahrzeuge.", ["H04 AG13 2 Fz"]],
  ["Alpha, äh, Golf, äh, eins drei", ["AG13"]],
  ["Hotel 04, Zwo-Fahrzeuge, Alpha Golf 13", ["H04 2 Fz AG13"]],
  ["Hotel 04, drei-Personen", ["H04 3 Pers"]],
  ["H05 Sperre AK7, Charlie", ["H05 Sperre AK7 C"]],
  ["Hotel 05 Sperre Alpha Kilo 7, Charlie.", ["H05 Sperre AK7 C"]],
  ["H05 Sperre AK7 Charlie", ["H05 Sperre AK7 C"]],
  ["Alpha Kilo 7, Charlie Delta 5", ["AK7 CD5"]],
];

describe("Uhrzeiten, Trennen ohne «Ende», kleine Lücken", () => {
  it.each(Z)("%s", (raw, expected) => {
    expect(splitMeldungen(normalizeSpoken(raw).text)).toEqual(expected);
  });
  it("Zeit aus zwei Zahlen wird in parseMeldung zur Meldezeit", () => {
    const d = parseMeldung(splitMeldungen(normalizeSpoken("Null acht fünfzehn, Hotel eins, Checkpoint bezogen in Alpha Kilo sieben Charlie.").text)[0]!, ctx());
    expect(d.t.slice(11, 16)).toBe("08:15");
    expect(d.melder).toBe("H01");
  });
});
