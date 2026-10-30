/**
 * Regressionstest aller Sätze MVP 3.5 (Spez. MVP 3.5, Kap. 5.5, 8.3) – Testdaten. **Nur fiktive Sätze** (Prüfungen
 * Review 5 am Beispiel Bern, Raster BERN, Trupps H01–H05); keine Übungsdaten.
 *
 * Quellen (Reihenfolge wie dort): `review5/einfachheit/parse/alt58.txt` (58) und `neu30.txt` (30) – je für sich, Uhr T2 10:30;
 * `review5/einsatz/s02` (66), `s12_varianten` (35), `s16_ausgang` (15) – **Folgen**: alle Sätze einer Quelle werden
 * nacheinander in dasselbe Beispiel Bern eingetragen (wie im Browser), Uhr ab T2 07:31, je Satz +1 min (s02: wie das
 * Skript, mit Trupp-Knopf); `review5/erstbenutzer/bericht.md` (10, je für sich); Spezialfälle der Tabelle Kap. 8.3
 * (`quelle: "spez"`, je für sich, mit `vorher`). Erzeugt mit `<S>/mvp35-p0/gen_saetze.py` (Phase 0).
 *
 * `soll: "schnappschuss"` = Ergebnis des Phase-0-Stands (52d951d mit Online-Standard aus, K2) aus
 * `saetze35.stand.json` – diese Sätze haben die Prüfer als richtig bewertet. Abweichungen nur mit Begründung im
 * Paketbericht; **Erwartungen ändert nur der Koordinator** (Notizdatei). Auswertung: `saetze35.lauf.ts`.
 *
 * Wie `SatzSoll` gelesen wird (Phase 0 festgelegt):
 * - `stufe`, `grund` (muss unter den Gründen sein), `vorschlag` (`reason.suggest` bzw. `Draft.ersatz.wort`): Vorschau.
 * - übrige Inhaltsfelder: Vorschau-Entwurf – ausser das Feld steht in `nachZweitemEnter`: dann gilt es für den
 *   eingetragenen Eintrag (nach dem zweiten Enter).
 * - `zeichenNeu`, `truppNach`, `blauNeu`: immer nach dem letzten Enter; Trupps, die nicht in `truppNach` stehen, dürfen
 *   sich nicht bewegen. `ort`: Ort-Label der Vorschau, Klammer «(AQ11 C)» darf fehlen; `null` = kein Ort.
 */
import type { EntryArt, EntryReasonCode, LageEvent } from "../../src";

export interface SatzFall {
  /** stabil: Quelle und laufende Nummer («s02-41», «spez-50») */
  id: string;
  satz: string;
  quelle: "einfachheit-alt58" | "einfachheit-neu30" | "einsatz-s02" | "einsatz-s12" | "einsatz-s16" | "erstbenutzer" | "spez";
  /** Uhr des Geräts beim Eintragen, z. B. "2030-05-15T10:30:00+02:00" */
  uhr: string;
  /** Trupp-Knopf vor dem Tippen gedrückt (Text wird «H04 …») */
  truppKnopf?: string;
  /** Einträge davor (je 1 min vor `uhr`), z. B. «Auftrag an H03: Beo AN7 bis 0800» */
  vorher?: string[];
  /** (additiv) feste Nummern der `vorher`-Einträge, z. B. [64, 64] = zwei Geräte vergaben dieselbe Nummer */
  vorherNr?: number[];
  /** (additiv) Übungstage statt jener des Beispiels (Sommerzeit-Fälle) */
  tage?: string[];
  /** (additiv) Zeile der Tabelle Kap. 8.3 und zuständiges Paket */
  nr?: number;
  paket?: string;
  soll: "schnappschuss" | SatzSoll;
}

export interface SatzSoll {
  stufe: "bereit" | "pruefen" | "geht-nicht";
  grund?: EntryReasonCode;
  art: EntryArt;
  seite?: "feind" | "eigen" | "unklar";
  /** geprüft gegen «Zeichenschlüssel Beschreibung» (z. B. «fz 2 gegnerische Fahrzeuge») */
  gesehen?: RegExp;
  anzahl?: number;
  /** Ort-Label wie in der Vorschau, null = kein Ort */
  ort?: string | null;
  melder?: string | null;
  /** Trupp → PQ nach Enter (bei gelb nach dem zweiten Enter); nicht genannt = unverändert */
  truppNach?: Record<string, string>;
  /** neue Lage-Zeichen nach (zweitem) Enter, Aufheben = −1 */
  zeichenNeu: number;
  dringend?: boolean;
  begehren?: boolean;
  an?: string;
  quelle?: string;
  /** Frist «09:00» */
  frist?: string;
  bezugArt?: LageEvent["bezugArt"];
  vorschlag?: string;
  /** abweichendes Ergebnis nach dem zweiten Enter */
  nachZweitemEnter?: Partial<SatzSoll>;
  // ---- additiv (Phase 0) ----
  /** Bewegungsrichtung / Herkunft in Grad */
  dir?: number;
  from?: number;
  /** genannte Orte nur als Text (`Draft.orte`) */
  orte?: string[];
  /** C6: Aufteilung vorhanden (`Draft.teile`) */
  teile?: boolean;
  /** D2: Abschluss eines Auftrags vorgeschlagen (`Draft.abschluss`) */
  abschluss?: boolean;
  vbk?: LageEvent["vbk"];
  /** neue eigene Trupps in `units.blau` nach Enter (S16: nie still) */
  blauNeu?: string[];
  /** Sommerzeit: Lagezeit «02:55» und Offset der Meldung */
  zeit?: string;
  tOffset?: string;
}

export const SAETZE35: SatzFall[] = [
  { id: "alt58-01", satz: "H04 meldet: 2 Fahrzeuge fahren Richtung Norden bei NAI 3", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-02", satz: "um 10:15 hat H04 zwei Autos gesehen in AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-03", satz: "zwei Personen mit Waffen beim Waldrand AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-04", satz: "H03 sieht 3 Männer bewaffnet AJ9 C", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-05", satz: "Panzer! AJ9", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-06", satz: "H02 in Stellung bei AK9", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-07", satz: "H05 hat Kontakt, wird beschossen aus Richtung Osten", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 16, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /kontakt/i, ort: "bei H05 (AQ11 C)", from: 90, dringend: true, zeichenNeu: 1 } },
  { id: "alt58-08", satz: "H01 ist jetzt in AF12", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-09", satz: "H01 verschiebt nach AG10", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-10", satz: "H01 Stellungsbezug AG10 abgeschlossen", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-11", satz: "schwarzer Golf fährt langsam vorbei, AN6, H03", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 8, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "unklar", gesehen: /personenwagen/i, anzahl: 1, ort: "AN6", melder: "H03", zeichenNeu: 1 } },
  { id: "alt58-12", satz: "Drohne über H05", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 17, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /drohne/i, ort: "bei H05 (AQ11 C)", zeichenNeu: 1 } },
  { id: "alt58-13", satz: "H04: nichts los, alles ruhig", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-14", satz: "H02 Verbindungskontrolle i.O.", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-15", satz: "Det 1 gesichtet bei der Brücke", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 31, paket: "C", soll: { stufe: "pruefen", art: "meldung", seite: "feind", ort: null, zeichenNeu: 0 } },
  { id: "alt58-16", satz: "H04 zwei feindliche Soldaten zu Fuss Richtung Wald", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-17", satz: "1 LKW AK 7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-18", satz: "zwei fz ak7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-19", satz: "H3 1 Fz NAI2", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-20", satz: "Hotel 4 meldet zwei Fahrzeuge in Alpha Kilo 7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-21", satz: "H04 2 Pw parkiert bei Kreuzung, Insassen steigen aus", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-22", satz: "Sperre auf Strasse AG13 von H04", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-23", satz: "Verletzter bei H02, brauchen Sanität", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 20, paket: "C/D", soll: { stufe: "bereit", art: "meldung", seite: "eigen", ort: "bei H02", dringend: true, begehren: true, zeichenNeu: 0 } },
  { id: "alt58-24", satz: "H05 Mun Nachschub benötigt", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 24, paket: "C/D", soll: { stufe: "bereit", art: "meldung", seite: "eigen", begehren: true, zeichenNeu: 0 } },
  { id: "alt58-25", satz: "H01 hört Schüsse aus Süden", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 32, paket: "C", soll: { stufe: "pruefen", grund: "ort-bei-trupp", art: "meldung", seite: "feind", ort: "bei H01", from: 180, zeichenNeu: 1 } },
  { id: "alt58-26", satz: "Gegner zieht sich zurück Rtg Bern", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-27", satz: "10.15 H04 2 Fz AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-28", satz: "viertel nach zehn H04 2 Fz AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-29", satz: "H04 2 Fz Koordinate 2600100 1200200", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-30", satz: "H04 2 Fz bei 600100/200200", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-31", satz: "H04 meldet um 1015 dass 2 Fz in AK7 stehen", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-32", satz: "Fz in AK7, 2 Stück, H04", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-33", satz: "Feind Patrouille 4 Mann AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-34", satz: "zivilist mit Hund AK7 verdächtig", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-35", satz: "H04 Position unverändert", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-36", satz: "H04 erreicht Checkpoint 2", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 30, paket: "C", soll: { stufe: "pruefen", grund: "ort", art: "meldung", seite: "eigen", zeichenNeu: 0 } },
  { id: "alt58-37", satz: "H02 wurde angegriffen, 1 Verwundeter", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 19, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /kontakt/i, ort: "bei H02 (AL9 A)", dringend: true, zeichenNeu: 1 } },
  { id: "alt58-38", satz: "H04 2 Fz AK 7 C", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-39", satz: "H04 2 Fz Planquadrat AK7 Unterquadrant C", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-40", satz: "H05 Stao bezogen in AQ11", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-41", satz: "IED gefunden AF13", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-42", satz: "H04 kein Feindkontakt", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-43", satz: "2 Fz NAI 3", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-44", satz: "H04 Ablösung erfolgt", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-45", satz: "H4: 2 Fz ak7c", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-46", satz: "Trupp 4 meldet 2 Fz AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-47", satz: "H04 sieht ein Auto, einen Lastwagen und 3 Personen in AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-48", satz: "H04 2 Fz AK7 fahren weg", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-49", satz: "H04 13:70 2 Fz AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-50", satz: "H04 2 Fz AK77", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-51", satz: "H04 2 Fz in NAI 9", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-52", satz: "H02 sieht H04 in AK9", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-53", satz: "Rot: 2 Fz AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-54", satz: "H04 Feind 2 Fz Rtg H05", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-55", satz: "H04 2 Fz ZZ3", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-56", satz: "H04 Drohne gesichtet, fliegt Rtg Süd", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-57", satz: "H04 Helikopter über AK7", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "alt58-58", satz: "H03 Kontakt", quelle: "einfachheit-alt58", uhr: "2030-05-15T10:30:00+02:00", nr: 18, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /kontakt/i, ort: "bei H03 (AP4 D)", zeichenNeu: 1 } },
  { id: "neu30-01", satz: "Hotel drei, zwo Fahrzeuge, Alpha November sechs, Richtung Nord", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-02", satz: "hier H02, sehe drei Typen mit Gewehr bei AK9", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", nr: 5, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /^(?!.*gewehr).*person/i, anzahl: 3, ort: "AK9", melder: "H02", zeichenNeu: 1 } },
  { id: "neu30-03", satz: "H05 Kontakt! werden aus AP10 beschossen", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-04", satz: "H01 alles ruhig, keine Bewegung", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", nr: 15, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "eigen", zeichenNeu: 0 } },
  { id: "neu30-05", satz: "H03 meldet ne Drohne über NAI zwo", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-06", satz: "H02: zwei Pinz fahren Rtg Bern", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", nr: 6, paket: "C", soll: { stufe: "pruefen", grund: "ort-bei-trupp", art: "meldung", seite: "feind", gesehen: /fahrzeug/i, anzahl: 2, ort: "bei H02", zeichenNeu: 1 } },
  { id: "neu30-07", satz: "H04 hat 2 Fz bei der Brücke gesehen Rtg Süd", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-08", satz: "Hotel fünf: Sperre in AG13 ist weg", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-09", satz: "H01 sieht nichts mehr, wechselt nach AC7", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", nr: 7, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "eigen", ort: "AC7", truppNach: { H01: "AC7" }, zeichenNeu: 0 } },
  { id: "neu30-10", satz: "H05 hat Hunger, Verpflegung wann?", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-11", satz: "H04 2 Fzg in AK7 Rtg Nrd", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", nr: 4, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /fahrzeug/i, anzahl: 2, ort: "AK7", dir: 0, zeichenNeu: 1 } },
  { id: "neu30-12", satz: "H03 3 Persohnen in AN6", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", nr: 1, paket: "C", soll: { stufe: "pruefen", grund: "was", art: "meldung", ort: "AN6", vorschlag: "Personen", zeichenNeu: 1, nachZweitemEnter: { seite: "unklar", anzahl: 3 } } },
  { id: "neu30-13", satz: "H01 Lastwagn AE5", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", nr: 2, paket: "C", soll: { stufe: "pruefen", grund: "was", art: "meldung", ort: "AE5", vorschlag: "Lastwagen", zeichenNeu: 1 } },
  { id: "neu30-14", satz: "H05 drohen über AQ11", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", nr: 3, paket: "C", soll: { stufe: "pruefen", grund: "was", art: "meldung", ort: "AQ11", vorschlag: "Drohne", zeichenNeu: 1 } },
  { id: "neu30-15", satz: "H02 2 Panzr AK9 Rtg W", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-16", satz: "h4 2 fz ak 7 rtg n", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-17", satz: "Rückfarge H03: Wo ist Det 2?", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-18", satz: "H05 IED AF13 entfern", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-19", satz: "Auftrag an H02: Beo NAI 3 bis 0900", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-20", satz: "Bat: ab 0800 erhöhte Bereitschaft", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-21", satz: "Kdt an alle: Funkdisziplin einhalten", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-22", satz: "Vbk H01 laut und klar", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-23", satz: "keine Verbindung zu H04", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-24", satz: "H03 Rückfrage: dürfen wir Stao wechseln?", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-25", satz: "Antwort zu 50: IED bestätigt, Raum gesperrt", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-26", satz: "Notiz: Ablösung H02 um 1000 geplant", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-27", satz: "S2: Det 1 wird in AN6 erwartet", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-28", satz: "H02 verlangt Sanität, 1 Verletzter", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", nr: 21, paket: "C/D", soll: { stufe: "bereit", art: "meldung", seite: "eigen", ort: "bei H02", dringend: true, begehren: true, zeichenNeu: 0 } },
  { id: "neu30-29", satz: "Funkcheck H03 schwach verständlich", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "neu30-30", satz: "Kp: H04 wird um 1200 abgelöst", quelle: "einfachheit-neu30", uhr: "2030-05-15T10:30:00+02:00", soll: "schnappschuss" },
  { id: "s02-01", satz: "H02 2 Pers zu Fuss AK10 Rtg N", quelle: "einsatz-s02", uhr: "2030-05-15T07:31:00+02:00", soll: "schnappschuss" },
  { id: "s02-02", satz: "h3 3 pers bewaffnet bei ak 8 richtung westen", quelle: "einsatz-s02", uhr: "2030-05-15T07:32:00+02:00", soll: "schnappschuss" },
  { id: "s02-03", satz: "H01 A: 0732 E: 2 Fz gn Rtg O I: langsam O: AD7 B U: beobachten weiter", quelle: "einsatz-s02", uhr: "2030-05-15T07:33:00+02:00", soll: "schnappschuss" },
  { id: "s02-04", satz: "A: 0733 E: 1 Drohne I: kreist O: AH9 U: wolkig", quelle: "einsatz-s02", uhr: "2030-05-15T07:34:00+02:00", soll: "schnappschuss" },
  { id: "s02-05", satz: "A: 0734 E: 4 Pers mit Funkgerät I: zu Fuss Rtg S O: AF11 C U: Regen", quelle: "einsatz-s02", uhr: "2030-05-15T07:35:00+02:00", truppKnopf: "H04", soll: "schnappschuss" },
  { id: "s02-06", satz: "H05 A: 0734 E: 2 gn Trp O: AQ10", quelle: "einsatz-s02", uhr: "2030-05-15T07:36:00+02:00", soll: "schnappschuss" },
  { id: "s02-07", satz: "H03 A: 0736 E: 2 Pers bewaffnet I: Rtg N U: Nebel", quelle: "einsatz-s02", uhr: "2030-05-15T07:37:00+02:00", soll: "schnappschuss" },
  { id: "s02-08", satz: "H02 A 0737 E 3 Fz I Rtg W O AK9", quelle: "einsatz-s02", uhr: "2030-05-15T07:38:00+02:00", soll: "schnappschuss" },
  { id: "s02-09", satz: "A: 0738 E: H03 I: 3 Pers bewaffnet O: AN7", quelle: "einsatz-s02", uhr: "2030-05-15T07:39:00+02:00", soll: "schnappschuss" },
  { id: "s02-10", satz: "Auftrag an H03: Beo NAI 2 bis 0821", quelle: "einsatz-s02", uhr: "2030-05-15T07:41:00+02:00", soll: "schnappschuss" },
  { id: "s02-11", satz: "Auftrag an H05: Stellungsbezug AQ12 bis 0807", quelle: "einsatz-s02", uhr: "2030-05-15T07:42:00+02:00", soll: "schnappschuss" },
  { id: "s02-12", satz: "H03 Quittung", quelle: "einsatz-s02", uhr: "2030-05-15T07:43:00+02:00", soll: "schnappschuss" },
  { id: "s02-13", satz: "H05 Auftrag ausgeführt, Stao AQ12 bezogen", quelle: "einsatz-s02", uhr: "2030-05-15T07:46:00+02:00", soll: "schnappschuss" },
  { id: "s02-14", satz: "Bat: ab 0907 Feind Det mit 2 Fz aus Rtg Belp erwartet", quelle: "einsatz-s02", uhr: "2030-05-15T07:47:00+02:00", soll: "schnappschuss" },
  { id: "s02-15", satz: "Kp: Verpflegung um 1200 im KP", quelle: "einsatz-s02", uhr: "2030-05-15T07:48:00+02:00", soll: "schnappschuss" },
  { id: "s02-16", satz: "H04 Rückfrage: Sperre AG13 noch besetzt?", quelle: "einsatz-s02", uhr: "2030-05-15T07:49:00+02:00", soll: "schnappschuss" },
  { id: "s02-17", satz: "Rückfrage an H02: Anzahl Fz bestätigen", quelle: "einsatz-s02", uhr: "2030-05-15T07:50:00+02:00", soll: "schnappschuss" },
  { id: "s02-18", satz: "H01 Vbk gut", quelle: "einsatz-s02", uhr: "2030-05-15T07:52:00+02:00", soll: "schnappschuss" },
  { id: "s02-19", satz: "H04 Vbk schlecht", quelle: "einsatz-s02", uhr: "2030-05-15T07:53:00+02:00", soll: "schnappschuss" },
  { id: "s02-20", satz: "H03 keine Verbindung", quelle: "einsatz-s02", uhr: "2030-05-15T07:54:00+02:00", soll: "schnappschuss" },
  { id: "s02-21", satz: "Vbk H05 laut und klar", quelle: "einsatz-s02", uhr: "2030-05-15T07:55:00+02:00", soll: "schnappschuss" },
  { id: "s02-22", satz: "Funkcheck", quelle: "einsatz-s02", uhr: "2030-05-15T07:56:00+02:00", soll: "schnappschuss" },
  { id: "s02-23", satz: "Antwort zu 72: Sperre AG13 noch besetzt, 2 Pers", quelle: "einsatz-s02", uhr: "2030-05-15T07:58:00+02:00", soll: "schnappschuss" },
  { id: "s02-24", satz: "H02 Antwort: 3 Fz bestätigt", quelle: "einsatz-s02", uhr: "2030-05-15T07:59:00+02:00", soll: "schnappschuss" },
  { id: "s02-25", satz: "Kontakt! H05 unter Feuer aus AR11, 1 Verwundeter, San angefordert", quelle: "einsatz-s02", uhr: "2030-05-15T08:00:00+02:00", soll: "schnappschuss" },
  { id: "s02-26", satz: "H02 sollen wir weiter beobachten?", quelle: "einsatz-s02", uhr: "2030-05-15T08:01:00+02:00", soll: "schnappschuss" },
  { id: "s02-27", satz: "H01 hat Rückzug nach AC5 befohlen erhalten", quelle: "einsatz-s02", uhr: "2030-05-15T08:02:00+02:00", soll: "schnappschuss" },
  { id: "s02-28", satz: "H04 neue Sperre AH13", quelle: "einsatz-s02", uhr: "2030-05-15T08:04:00+02:00", soll: "schnappschuss" },
  { id: "s02-29", satz: "H04 Sperre AH13 aufgehoben", quelle: "einsatz-s02", uhr: "2030-05-15T08:05:00+02:00", soll: "schnappschuss" },
  { id: "s02-30", satz: "H02 Strassensperre AL10", quelle: "einsatz-s02", uhr: "2030-05-15T08:06:00+02:00", soll: "schnappschuss" },
  { id: "s02-31", satz: "H05 Sperre AL10", quelle: "einsatz-s02", uhr: "2030-05-15T08:07:00+02:00", soll: "schnappschuss" },
  { id: "s02-32", satz: "H02 Sperre AL10 aufgehoben", quelle: "einsatz-s02", uhr: "2030-05-15T08:08:00+02:00", soll: "schnappschuss" },
  { id: "s02-33", satz: "H01 Sperre AA1 aufgehoben", quelle: "einsatz-s02", uhr: "2030-05-15T08:09:00+02:00", soll: "schnappschuss" },
  { id: "s02-34", satz: "H05 IED AF13 geräumt", quelle: "einsatz-s02", uhr: "2030-05-15T08:10:00+02:00", soll: "schnappschuss" },
  { id: "s02-35", satz: "Notiz: Fahrer Wechsel um 0800", quelle: "einsatz-s02", uhr: "2030-05-15T08:12:00+02:00", soll: "schnappschuss" },
  { id: "s02-36", satz: "Notiz: H02 sieht 2 Fz AK8", quelle: "einsatz-s02", uhr: "2030-05-15T08:13:00+02:00", soll: "schnappschuss" },
  { id: "s02-37", satz: "H03 Standort Det 2 bekannt", quelle: "einsatz-s02", uhr: "2030-05-15T08:14:00+02:00", soll: "schnappschuss" },
  { id: "s02-38", satz: "T2 0715 H02 1 Fz AK7", quelle: "einsatz-s02", uhr: "2030-05-15T08:15:00+02:00", soll: "schnappschuss" },
  { id: "s02-39", satz: "H01 0846 2 Pers AC7", quelle: "einsatz-s02", uhr: "2030-05-15T08:16:00+02:00", soll: "schnappschuss" },
  { id: "s02-40", satz: "Antwort zu 999: alles ruhig", quelle: "einsatz-s02", uhr: "2030-05-15T08:17:00+02:00", soll: "schnappschuss" },
  { id: "s02-41", satz: "H06 2 Pers AK5", quelle: "einsatz-s02", uhr: "2030-05-15T08:18:00+02:00", nr: 27, paket: "C/E", soll: { stufe: "pruefen", grund: "trupp-neu", art: "meldung", seite: "feind", gesehen: /person/i, anzahl: 2, ort: "AK5", melder: null, blauNeu: [], zeichenNeu: 1 } },
  { id: "s02-42", satz: "H01 2 Pers AC 77", quelle: "einsatz-s02", uhr: "2030-05-15T08:19:00+02:00", soll: "schnappschuss" },
  { id: "s02-43", satz: "hier h zwo, zwei fahrzeuge, äh, eins davon schützenpanzer, bei AL elf, fahren rtg nord", quelle: "einsatz-s02", uhr: "2030-05-15T08:22:00+02:00", soll: "schnappschuss" },
  { id: "s02-44", satz: "H03 ähm 2 oder 3 Pers, Rtg unklar, ungefähr AN 7", quelle: "einsatz-s02", uhr: "2030-05-15T08:23:00+02:00", soll: "schnappschuss" },
  { id: "s02-45", satz: "H04 nichts Neues", quelle: "einsatz-s02", uhr: "2030-05-15T08:24:00+02:00", nr: 14, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "eigen", zeichenNeu: 0 } },
  { id: "s02-46", satz: "H05 Stao AQ12 bezogen, alles ruhig", quelle: "einsatz-s02", uhr: "2030-05-15T08:25:00+02:00", soll: "schnappschuss" },
  { id: "s02-47", satz: "H01 Beo Stao AC6 B unverändert", quelle: "einsatz-s02", uhr: "2030-05-15T08:26:00+02:00", soll: "schnappschuss" },
  { id: "s02-48", satz: "H02 1 Pw schwarz AL9 Rtg Bern", quelle: "einsatz-s02", uhr: "2030-05-15T08:27:00+02:00", soll: "schnappschuss" },
  { id: "s02-49", satz: "H03 Drohne über NAI 2", quelle: "einsatz-s02", uhr: "2030-05-15T08:29:00+02:00", soll: "schnappschuss" },
  { id: "s02-50", satz: "Bat: Lagerapport 1000 im KP Bat", quelle: "einsatz-s02", uhr: "2030-05-15T08:30:00+02:00", soll: "schnappschuss" },
  { id: "s02-51", satz: "Auftrag an H01: Vbk alle 30 min", quelle: "einsatz-s02", uhr: "2030-05-15T08:31:00+02:00", soll: "schnappschuss" },
  { id: "s02-52", satz: "Auftrag: Beo Strasse AK nach AL", quelle: "einsatz-s02", uhr: "2030-05-15T08:32:00+02:00", soll: "schnappschuss" },
  { id: "s02-53", satz: "H04 Befehl erhalten, verschieben nach AF10", quelle: "einsatz-s02", uhr: "2030-05-15T08:33:00+02:00", soll: "schnappschuss" },
  { id: "s02-54", satz: "H02 2 Kpz AK9 Rtg W, dringend", quelle: "einsatz-s02", uhr: "2030-05-15T08:34:00+02:00", soll: "schnappschuss" },
  { id: "s02-55", satz: "Frage an H05: Munition genug?", quelle: "einsatz-s02", uhr: "2030-05-15T08:35:00+02:00", soll: "schnappschuss" },
  { id: "s02-56", satz: "H05 Antwort: Mun genug", quelle: "einsatz-s02", uhr: "2030-05-15T08:36:00+02:00", soll: "schnappschuss" },
  { id: "s02-57", satz: "Quittung H01", quelle: "einsatz-s02", uhr: "2030-05-15T08:37:00+02:00", soll: "schnappschuss" },
  { id: "s02-58", satz: "H03 Vbk i.O.", quelle: "einsatz-s02", uhr: "2030-05-15T08:39:00+02:00", soll: "schnappschuss" },
  { id: "s02-59", satz: "H04 3 Pers bauen Sperre AG12", quelle: "einsatz-s02", uhr: "2030-05-15T08:40:00+02:00", soll: "schnappschuss" },
  { id: "s02-60", satz: "H04 Sperre AG13 geräumt", quelle: "einsatz-s02", uhr: "2030-05-15T08:41:00+02:00", soll: "schnappschuss" },
  { id: "s02-61", satz: "H05 1 Verletzter eigene Trp, San benötigt", quelle: "einsatz-s02", uhr: "2030-05-15T08:42:00+02:00", soll: "schnappschuss" },
  { id: "s02-62", satz: "NB: Batterien Funk H02 schwach", quelle: "einsatz-s02", uhr: "2030-05-15T08:43:00+02:00", soll: "schnappschuss" },
  { id: "s02-63", satz: "H01 2 Pers AD8 C Rtg SW", quelle: "einsatz-s02", uhr: "2030-05-15T08:44:00+02:00", soll: "schnappschuss" },
  { id: "s02-64", satz: "H02 Feind weg aus AK9", quelle: "einsatz-s02", uhr: "2030-05-15T08:45:00+02:00", soll: "schnappschuss" },
  { id: "s02-65", satz: "Orientierung von Bat: Nachbar Kp 61/2 links", quelle: "einsatz-s02", uhr: "2030-05-15T08:46:00+02:00", soll: "schnappschuss" },
  { id: "s02-66", satz: "H03 4 Pers zu Fuss AO5 Rtg S", quelle: "einsatz-s02", uhr: "2030-05-15T08:47:00+02:00", soll: "schnappschuss" },
  { id: "s12-01", satz: "H04 Sperre AG13 aufgehobn", quelle: "einsatz-s12", uhr: "2030-05-15T07:31:00+02:00", soll: "schnappschuss" },
  { id: "s12-02", satz: "H05 IED AF13 geraeumt", quelle: "einsatz-s12", uhr: "2030-05-15T07:32:00+02:00", soll: "schnappschuss" },
  { id: "s12-03", satz: "H05 IED AF13 aufgehben", quelle: "einsatz-s12", uhr: "2030-05-15T07:33:00+02:00", soll: "schnappschuss" },
  { id: "s12-04", satz: "Auftr an H01: Beo NAI 1", quelle: "einsatz-s12", uhr: "2030-05-15T07:34:00+02:00", soll: "schnappschuss" },
  { id: "s12-05", satz: "Auftarg an H03: Beo AN7", quelle: "einsatz-s12", uhr: "2030-05-15T07:35:00+02:00", soll: "schnappschuss" },
  { id: "s12-06", satz: "H04 antwortet: Sperre AG13 besetzt", quelle: "einsatz-s12", uhr: "2030-05-15T07:36:00+02:00", soll: "schnappschuss" },
  { id: "s12-07", satz: "Antw zu 57: verstanden", quelle: "einsatz-s12", uhr: "2030-05-15T07:37:00+02:00", soll: "schnappschuss" },
  { id: "s12-08", satz: "antwrt zu 57 ja", quelle: "einsatz-s12", uhr: "2030-05-15T07:38:00+02:00", soll: "schnappschuss" },
  { id: "s12-09", satz: "zu 57: ja", quelle: "einsatz-s12", uhr: "2030-05-15T07:39:00+02:00", soll: "schnappschuss" },
  { id: "s12-10", satz: "Kdt: ab sofort Funkstille", quelle: "einsatz-s12", uhr: "2030-05-15T07:40:00+02:00", soll: "schnappschuss" },
  { id: "s12-11", satz: "H02 meldet 3 Pers AK10 Rtg O", quelle: "einsatz-s12", uhr: "2030-05-15T07:41:00+02:00", soll: "schnappschuss" },
  { id: "s12-12", satz: "Bat befiehlt: H02 Beo AK10 halten bis 1000", quelle: "einsatz-s12", uhr: "2030-05-15T07:42:00+02:00", nr: 37, paket: "D", soll: { stufe: "bereit", art: "auftrag", an: "H02", quelle: "Bat", frist: "10:00", zeichenNeu: 0 } },
  { id: "s12-13", satz: "an H02: Stellungswechsel nach AH10 bis 0900", quelle: "einsatz-s12", uhr: "2030-05-15T07:43:00+02:00", nr: 33, paket: "D", soll: { stufe: "bereit", art: "auftrag", an: "H02", frist: "09:00", zeichenNeu: 0 } },
  { id: "s12-14", satz: "H01: Stellungswechsel nach AC5 erfolgt", quelle: "einsatz-s12", uhr: "2030-05-15T07:44:00+02:00", soll: "schnappschuss" },
  { id: "s12-15", satz: "H03 verlegt nach AN6", quelle: "einsatz-s12", uhr: "2030-05-15T07:45:00+02:00", soll: "schnappschuss" },
  { id: "s12-16", satz: "H03 in AN6 eingetroffen", quelle: "einsatz-s12", uhr: "2030-05-15T07:46:00+02:00", soll: "schnappschuss" },
  { id: "s12-17", satz: "H05 1 Verwundeter, Sanität angefordert", quelle: "einsatz-s12", uhr: "2030-05-15T07:47:00+02:00", soll: "schnappschuss" },
  { id: "s12-18", satz: "Melder fehlt hier 2 Pers AF9", quelle: "einsatz-s12", uhr: "2030-05-15T07:48:00+02:00", soll: "schnappschuss" },
  { id: "s12-19", satz: "H02 wir weichen aus nach AK11, Kontakt mit 4 Pers AK10", quelle: "einsatz-s12", uhr: "2030-05-15T07:49:00+02:00", nr: 13, paket: "C", soll: { stufe: "pruefen", grund: "zwei-orte", art: "meldung", seite: "feind", gesehen: /kontakt/i, anzahl: 4, ort: "AK10", teile: true, zeichenNeu: 1 } },
  { id: "s12-20", satz: "H04 2 Fz Rtg Kehrsatz", quelle: "einsatz-s12", uhr: "2030-05-15T07:50:00+02:00", soll: "schnappschuss" },
  { id: "s12-21", satz: "H01 1 Pers beim Gasthof Bären", quelle: "einsatz-s12", uhr: "2030-05-15T07:51:00+02:00", nr: 52, paket: "C", soll: { stufe: "pruefen", grund: "ort-online-aus", art: "meldung", seite: "feind", ort: null, zeichenNeu: 0 } },
  { id: "s12-22", satz: "H02 Kpz AK9 hat Stellung bezogen, vermutlich 2", quelle: "einsatz-s12", uhr: "2030-05-15T07:52:00+02:00", soll: "schnappschuss" },
  { id: "s12-23", satz: "H03 Lärm von Motoren aus Rtg AP5", quelle: "einsatz-s12", uhr: "2030-05-15T07:53:00+02:00", nr: 12, paket: "C", soll: { stufe: "pruefen", grund: "ort-bei-trupp", art: "meldung", seite: "unklar", ort: "bei H03", zeichenNeu: 1 } },
  { id: "s12-24", satz: "H04 Schüsse gehört Rtg S", quelle: "einsatz-s12", uhr: "2030-05-15T07:54:00+02:00", soll: "schnappschuss" },
  { id: "s12-25", satz: "H01 Rückzug nach AC5", quelle: "einsatz-s12", uhr: "2030-05-15T07:55:00+02:00", nr: 11, paket: "C", soll: { stufe: "pruefen", grund: "seite", art: "meldung", seite: "eigen", ort: "AC5", truppNach: { H01: "AC5" }, zeichenNeu: 0 } },
  { id: "s12-26", satz: "H02 Wiederholen?", quelle: "einsatz-s12", uhr: "2030-05-15T07:56:00+02:00", soll: "schnappschuss" },
  { id: "s12-27", satz: "H02 Verstanden", quelle: "einsatz-s12", uhr: "2030-05-15T07:57:00+02:00", nr: 46, paket: "D", soll: { stufe: "bereit", art: "notiz", bezugArt: "quittung", zeichenNeu: 0 } },
  { id: "s12-28", satz: "H05 Mun Stand 60%", quelle: "einsatz-s12", uhr: "2030-05-15T07:58:00+02:00", nr: 25, paket: "C/D", soll: { stufe: "bereit", art: "meldung", seite: "eigen", gesehen: /^(?!.*munitionslager)/i, begehren: true, zeichenNeu: 0 } },
  { id: "s12-29", satz: "H03 Funkstille ab jetzt", quelle: "einsatz-s12", uhr: "2030-05-15T07:59:00+02:00", soll: "schnappschuss" },
  { id: "s12-30", satz: "Bat: Lage-Rapport auf 1100 verschoben", quelle: "einsatz-s12", uhr: "2030-05-15T08:00:00+02:00", soll: "schnappschuss" },
  { id: "s12-31", satz: "H01 Feind hat AD7 verlassen Rtg N", quelle: "einsatz-s12", uhr: "2030-05-15T08:01:00+02:00", nr: 10, paket: "C", soll: { stufe: "pruefen", grund: "kein-zeichen", art: "notiz", zeichenNeu: 0, nachZweitemEnter: { art: "notiz" } } },
  { id: "s12-32", satz: "H04 Sperre AG13 nicht mehr besetzt", quelle: "einsatz-s12", uhr: "2030-05-15T08:02:00+02:00", soll: "schnappschuss" },
  { id: "s12-33", satz: "H02 ziv Fz AL9 Rtg Bern", quelle: "einsatz-s12", uhr: "2030-05-15T08:03:00+02:00", soll: "schnappschuss" },
  { id: "s12-34", satz: "H02 2 Pers in Zivil AL9", quelle: "einsatz-s12", uhr: "2030-05-15T08:04:00+02:00", soll: "schnappschuss" },
  { id: "s12-35", satz: "H04 Pz Sperre AG13 verstärkt", quelle: "einsatz-s12", uhr: "2030-05-15T08:05:00+02:00", soll: "schnappschuss" },
  { id: "s16-01", satz: "Auftrag an H03: Beo AN7 bis 0800", quelle: "einsatz-s16", uhr: "2030-05-15T07:31:00+02:00", soll: "schnappschuss" },
  { id: "s16-02", satz: "H03 Auftrag erhalten", quelle: "einsatz-s16", uhr: "2030-05-15T07:32:00+02:00", nr: 45, paket: "D", soll: { stufe: "bereit", art: "notiz", bezugArt: "quittung", zeichenNeu: 0 } },
  { id: "s16-03", satz: "H03 Auftrag erfüllt", quelle: "einsatz-s16", uhr: "2030-05-15T07:33:00+02:00", soll: "schnappschuss" },
  { id: "s16-04", satz: "An Bat: Lage unverändert", quelle: "einsatz-s16", uhr: "2030-05-15T07:34:00+02:00", nr: 39, paket: "D", soll: { stufe: "bereit", art: "ausgang", an: "Bat", zeichenNeu: 0 } },
  { id: "s16-05", satz: "Meldung an Bat: 2 Kpz AK9 Rtg W", quelle: "einsatz-s16", uhr: "2030-05-15T07:35:00+02:00", nr: 38, paket: "D", soll: { stufe: "bereit", art: "ausgang", an: "Bat", zeichenNeu: 0 } },
  { id: "s16-06", satz: "Lagemeldung an Kp: ruhig", quelle: "einsatz-s16", uhr: "2030-05-15T07:36:00+02:00", nr: 40, paket: "D", soll: { stufe: "bereit", art: "ausgang", an: "Kp", zeichenNeu: 0 } },
  { id: "s16-07", satz: "Weitergemeldet an Bat: Nr 54", quelle: "einsatz-s16", uhr: "2030-05-15T07:37:00+02:00", nr: 41, paket: "D", soll: { stufe: "bereit", art: "ausgang", an: "Bat", bezugArt: "weiter", zeichenNeu: 0 } },
  { id: "s16-08", satz: "Bat fragt: Standort H02?", quelle: "einsatz-s16", uhr: "2030-05-15T07:38:00+02:00", nr: 42, paket: "D", soll: { stufe: "bereit", art: "rueckfrage", quelle: "Bat", zeichenNeu: 0 } },
  { id: "s16-09", satz: "Rückfrage Bat: wie viele Fz in AK9?", quelle: "einsatz-s16", uhr: "2030-05-15T07:39:00+02:00", nr: 43, paket: "D", soll: { stufe: "bereit", art: "rueckfrage", quelle: "Bat", zeichenNeu: 0 } },
  { id: "s16-10", satz: "Antwort an Bat: 2 Kpz", quelle: "einsatz-s16", uhr: "2030-05-15T07:40:00+02:00", nr: 44, paket: "D", soll: { stufe: "bereit", art: "ausgang", an: "Bat", bezugArt: "antwort", zeichenNeu: 0 } },
  { id: "s16-11", satz: "H05 Ablösung erfolgt", quelle: "einsatz-s16", uhr: "2030-05-15T07:41:00+02:00", soll: "schnappschuss" },
  { id: "s16-12", satz: "H02 Mun- und Verpflegungsnachschub benötigt", quelle: "einsatz-s16", uhr: "2030-05-15T07:42:00+02:00", nr: 26, paket: "C/D", soll: { stufe: "bereit", art: "meldung", seite: "eigen", begehren: true, zeichenNeu: 0 } },
  { id: "s16-13", satz: "H01 Funkgerät defekt, Melder unterwegs", quelle: "einsatz-s16", uhr: "2030-05-15T07:43:00+02:00", soll: "schnappschuss" },
  { id: "s16-14", satz: "Kdt: H02 sofort Stellungswechsel nach AH10", quelle: "einsatz-s16", uhr: "2030-05-15T07:44:00+02:00", nr: 36, paket: "D", soll: { stufe: "pruefen", grund: "art-schwach", art: "auftrag", an: "H02", zeichenNeu: 0 } },
  { id: "s16-15", satz: "H04 meldet: Zivilisten AF11, 3 Pers, ruhig", quelle: "einsatz-s16", uhr: "2030-05-15T07:45:00+02:00", soll: "schnappschuss" },
  { id: "erst-01", satz: "H01 Verletzter in AC7, braucht Sanität", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", nr: 22, paket: "C/D", soll: { stufe: "bereit", art: "meldung", seite: "eigen", orte: ["AC7"], dringend: true, begehren: true, zeichenNeu: 0 } },
  { id: "erst-02", satz: "H05 dringend: Verwundeter bei uns AQ11", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", nr: 23, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "eigen", orte: ["AQ11"], dringend: true, zeichenNeu: 0 } },
  { id: "erst-03", satz: "Kp Kdt: Auftrag an H03 NAI 2 überwachen bis 1200", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", nr: 34, paket: "D", soll: { stufe: "bereit", art: "auftrag", an: "H03", quelle: "Kdt", frist: "12:00", zeichenNeu: 0 } },
  { id: "erst-04", satz: "Kdt: H05 sofort Stellungswechsel nach AR12", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", nr: 35, paket: "D", soll: { stufe: "pruefen", grund: "art-schwach", art: "auftrag", an: "H05", zeichenNeu: 0 } },
  { id: "erst-05", satz: "H03 Feuerkampf AP 11", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", nr: 28, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /kontakt/i, ort: "AP11", dringend: true, zeichenNeu: 1 } },
  { id: "erst-06", satz: "H04 2 Fz von AK7 nach AM9", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", nr: 29, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /nach AM9/i, anzahl: 2, ort: "AK7", zeichenNeu: 1 } },
  { id: "erst-07", satz: "Funkkontakt verloren zu H03", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", nr: 49, paket: "D", soll: { stufe: "bereit", art: "vbk", vbk: "keine", melder: "H03", zeichenNeu: 0 } },
  { id: "erst-08", satz: "H05 Mun Nachschub benötigt", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", nr: 24, paket: "C/D", soll: { stufe: "bereit", art: "meldung", seite: "eigen", begehren: true, zeichenNeu: 0 } },
  { id: "erst-09", satz: "H04 nichts Neues", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", nr: 14, paket: "C", soll: { stufe: "bereit", art: "meldung", seite: "eigen", zeichenNeu: 0 } },
  { id: "erst-10", satz: "H02 1 Fz AK9", quelle: "erstbenutzer", uhr: "2030-05-15T07:31:00+02:00", soll: "schnappschuss" },
  { id: "spez-9", satz: "H03 Det 2 Standort unbekannt", quelle: "spez", uhr: "2030-05-15T07:31:00+02:00", nr: 9, paket: "C", soll: { stufe: "pruefen", grund: "kein-zeichen", art: "notiz", zeichenNeu: 0, nachZweitemEnter: { art: "notiz" } } },
  { id: "spez-47", satz: "H03 erledigt", quelle: "spez", uhr: "2030-05-15T07:35:00+02:00", vorher: ["Auftrag an H03: Beo NAI 2 bis 0900"], nr: 47, paket: "D", soll: { stufe: "bereit", art: "meldung", bezugArt: "ausgefuehrt", abschluss: true, zeichenNeu: 0 } },
  { id: "spez-48", satz: "H03 erledigt", quelle: "spez", uhr: "2030-05-15T07:35:00+02:00", vorher: ["Auftrag an H03: Beo NAI 2 bis 0900", "Auftrag an H03: Vbk alle 30 min"], nr: 48, paket: "D", soll: { stufe: "pruefen", grund: "auftrag-wahl", art: "meldung", zeichenNeu: 0 } },
  { id: "spez-50", satz: "Antwort zu 64", quelle: "spez", uhr: "2030-05-15T07:40:00+02:00", vorher: ["H02 3 Fz AK9", "H04 1 Pers AF11"], vorherNr: [64, 64], nr: 50, paket: "D", soll: { stufe: "pruefen", grund: "bezug-wahl", art: "notiz", zeichenNeu: 0 } },
  { id: "spez-51", satz: "2 Fz fahren an H02 vorbei Rtg N", quelle: "spez", uhr: "2030-05-15T07:31:00+02:00", truppKnopf: "H04", nr: 51, paket: "D", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /fahrzeug/i, anzahl: 2, ort: "bei H02", zeichenNeu: 1 } },
  { id: "spez-53", satz: "0255 H01 1 Pers AC7", quelle: "spez", uhr: "2030-10-27T02:10:00+01:00", tage: ["2030-10-26", "2030-10-27"], nr: 53, paket: "C", soll: { stufe: "bereit", art: "meldung", ort: "AC7", zeit: "02:55", tOffset: "+02:00", zeichenNeu: 1 } },
  { id: "spez-54", satz: "0230 H01 1 Pers AC7", quelle: "spez", uhr: "2030-03-31T03:40:00+02:00", tage: ["2030-03-30", "2030-03-31"], nr: 54, paket: "C", soll: { stufe: "geht-nicht", grund: "zeit-fehlt", art: "meldung", vorschlag: "0330", zeichenNeu: 0 } },
  { id: "spez-55", satz: "0735 H02 1 Fz AK9", quelle: "spez", uhr: "2030-05-15T07:31:00+02:00", nr: 55, paket: "C/E", soll: { stufe: "bereit", art: "meldung", ort: "AK9", zeichenNeu: 1 } },
];
