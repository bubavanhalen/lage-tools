/**
 * MVP 3.5 Nachbesserung (Review 6): alle Sätze aus den drei Prüfberichten (Einsatz, Erstbenutzer, Feldgerät), die die
 * Erkennung betreffen – **0 falsche Zeichen, 0 falsche Melder, 0 falsche Bezüge**. Nur fiktive Sätze (Beispiel Bern,
 * Raster BERN bzw. Feld-Raster `demoFeldSheet`, Trupps H01–H05).
 *
 * Jeder Fall läuft wie im Meldungsfeld (`saetze35.lauf.ts` `auswerten`: Einträge davor, Enter, bei Gelb zweites Enter) und
 * prüft mindestens Art, Melder, neue Zeichen und – wo es einen gibt – den Bezug. Entscheide des Koordinators
 * (BRIEF_MVP35_FIX): Bezug immer eindeutig · Melder nur bei echten Meldungen eines Trupps · Vollzug schliesst Auftrag ·
 * Meldeauftrag von oben · Grün nur ohne Zweifel · Rasterzeile H · > 12 h voraus = rot.
 */
process.env.TZ = "Europe/Zurich";
import { describe, expect, it } from "vitest";
import {
  BEZUG_KEINER, demoExercise, demoFeldSheet, entryState, eventFromDraft, journalToCsv, lageBlau, lastPosition, lebenszeichen, lvzIndex,
  nrLabel, offenePunkte, parseMeldung, vermerkeOf, type Exercise, type JournalContext, type LageEvent,
} from "../src";
import type { SatzFall } from "./fixtures/saetze35";
import { abweichungen, auswerten, beispielFuer, type SatzErgebnis } from "./fixtures/saetze35.lauf";

const UHR = "2030-05-15T07:40:00+02:00";
const T_LIVE = "2030-05-15T07:40";

interface FixFall extends Omit<SatzFall, "quelle" | "uhr"> {
  quelle?: SatzFall["quelle"];
  uhr?: string;
  /** Feld-Raster (Zeilen A–X, Spalten 1–30) mit Trupps H01–H03 statt Beispiel Bern */
  feld?: boolean;
  /** weitere Prüfungen nach dem Eintragen: `vorher` = IDs der Einträge davor */
  pruefe?: (r: SatzErgebnis, ex: Exercise, vorher: LageEvent[]) => string[];
}

const byId = (ex: Exercise, id: string) => ex.events!.find((e) => e.id === id)!;
const status = (ex: Exercise, e: LageEvent) => vermerkeOf(byId(ex, e.id), lvzIndex(ex.events!)).status;
const letzter = (ex: Exercise) => ex.events![ex.events!.length - 1]!;
const bezugNrVon = (ex: Exercise) => { const e = letzter(ex); const z = e.bezug ? byId(ex, e.bezug) : undefined; return z ? nrLabel(z, ex) : null; };
const pruefen = (ok: boolean, text: string) => (ok ? [] : [text]);

function feldUebung(): Exercise {
  const ex = demoExercise();
  return { ...ex, sheets: [demoFeldSheet()], areas: [], places: [], units: { blau: ["H01", "H02", "H03"], rot: [], ul: [] }, events: [] };
}

// ---------------------------------------------------------------------------------------------------------------------
const FAELLE: FixFall[] = [
  // ---- Einsatz H1: Bezug immer eindeutig
  {
    id: "e-h1-fest", satz: "Antwort an Bat: H02 in AL9", vorher: ["Bat fragt: Standort H02?", "Bat fragt: wie viele Fz bei AD7?"], vorherNr: [57, 58],
    kontext: { art: "ausgang", bezugNr: "57" },
    soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, bezugArt: "antwort", zeichenNeu: 0 },
    pruefe: (_r, ex, [a, b]) => [
      ...pruefen(bezugNrVon(ex) === "57", `Bezug Nr ${bezugNrVon(ex)} statt 57`),
      ...pruefen(status(ex, a!) === "erledigt", "Nr 57 nicht erledigt"), ...pruefen(status(ex, b!) === "offen", "Nr 58 nicht mehr offen"),
    ],
  },
  {
    id: "e-h1-getippt", satz: "Antwort an Bat: H02 in AL9", vorher: ["Bat fragt: Standort H02?", "Bat fragt: wie viele Fz bei AD7?"], vorherNr: [57, 58],
    soll: { stufe: "pruefen", grund: "bezug-wahl", art: "ausgang", an: "Bat", melder: null, zeichenNeu: 0 },
    pruefe: (_r, ex, [a, b]) => [...pruefen(bezugNrVon(ex) === null, `still Bezug Nr ${bezugNrVon(ex)}`), ...pruefen(status(ex, a!) === "offen" && status(ex, b!) === "offen", "eine Rückfrage still erledigt")],
  },
  {
    id: "e-h1-eine", satz: "Antwort an Bat: H02 in AL9", vorher: ["Bat fragt: Standort H02?"], vorherNr: [57],
    soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, bezugArt: "antwort", zeichenNeu: 0 },
    pruefe: (_r, ex) => pruefen(bezugNrVon(ex) === "57", `Bezug Nr ${bezugNrVon(ex)} statt 57`),
  },
  {
    id: "e-h1-auftrag-zwei", satz: "H03 Auftrag ausgeführt", vorher: ["an H03: Beo NAI 2 bis 0900", "an H03: Vbk alle 30 min"], vorherNr: [93, 94],
    soll: { stufe: "pruefen", grund: "auftrag-wahl", art: "meldung", melder: "H03", zeichenNeu: 0 },
    pruefe: (_r, ex, [a, b]) => [...pruefen(bezugNrVon(ex) === null, `still Bezug Nr ${bezugNrVon(ex)}`), ...pruefen(status(ex, a!) === "offen" && status(ex, b!) === "offen", "ein Auftrag still erledigt")],
  },
  {
    id: "e-h1-auftrag-fest", satz: "H03 Auftrag ausgeführt", vorher: ["an H03: Beo NAI 2 bis 0900", "an H03: Vbk alle 30 min"], vorherNr: [93, 94],
    kontext: { bezugNr: "93" },
    soll: { stufe: "bereit", art: "meldung", melder: "H03", bezugArt: "ausgefuehrt", abschluss: true, zeichenNeu: 0 },
    pruefe: (_r, ex, [a, b]) => [...pruefen(bezugNrVon(ex) === "93", `Bezug Nr ${bezugNrVon(ex)} statt 93`), ...pruefen(status(ex, a!) === "erledigt" && status(ex, b!) === "offen", "falscher Auftrag erledigt")],
  },
  {
    id: "e-h1-antwort-trupp-zwei", satz: "H04 Antwort: Sperre AG13 nicht mehr besetzt", vorher: ["Rückfrage an H04: Sperre AG13 noch besetzt?", "Rückfrage an H04: Fz bei AF11?"], vorherNr: [70, 71],
    soll: { stufe: "pruefen", grund: "bezug-wahl", art: "notiz", melder: "H04", zeichenNeu: 0 },
    pruefe: (_r, ex) => pruefen(bezugNrVon(ex) === null, `still Bezug Nr ${bezugNrVon(ex)}`),
  },

  // ---- Einsatz H2: Melder nur bei echten Meldungen eines Trupps
  {
    id: "e-h2-fragt", satz: "Bat fragt: wo ist H01?", soll: { stufe: "bereit", art: "rueckfrage", quelle: "Bat", melder: null, zeichenNeu: 0 },
    pruefe: (_r, ex) => {
      const vor = offenePunkte({ ...ex, events: ex.events!.slice(0, -1) }, T_LIVE).filter((o) => o.art === "still").map((o) => o.key);
      const nach = offenePunkte(ex, T_LIVE).filter((o) => o.art === "still").map((o) => o.key);
      return [...pruefen(lebenszeichen(letzter(ex)) === null, "Rückfrage von oben ist Lebenszeichen"), ...pruefen(JSON.stringify(vor) === JSON.stringify(nach), `stille Trupps ${vor} → ${nach}`)];
    },
  },
  { id: "e-h2-kdt", satz: "Kp Kdt: Wo ist H02?", soll: { stufe: "bereit", art: "rueckfrage", quelle: "Kdt", melder: null, zeichenNeu: 0 } },
  { id: "e-h2-rf-bat", satz: "Rückfrage Bat: wie viele Fz bei AD7?", soll: { stufe: "bereit", art: "rueckfrage", quelle: "Bat", melder: null, zeichenNeu: 0 } },
  { id: "e-h2-lage-nai", satz: "Bat: Lage NAI 2?", soll: { stufe: "bereit", art: "rueckfrage", quelle: "Bat", melder: null, zeichenNeu: 0 } },
  { id: "e-h2-erstattet", satz: "Lagemeldung an Bat 0745 erstattet", soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, abschluss: false, zeichenNeu: 0 } },
  {
    id: "e-h2-wann", satz: "Bat fragt: Wann ist H03 in NAI 2 bereit?", soll: { stufe: "bereit", art: "rueckfrage", quelle: "Bat", melder: null, zeichenNeu: 0 },
    pruefe: (_r, ex) => { const z = lageBlau(ex, T_LIVE).find((x) => x.trupp === "H03")!; return pruefen(!/Wann ist H03/.test(z.letzteMeldung?.text ?? ""), `Übergabe H03 letzte Meldung «${z.letzteMeldung?.text}»`); },
  },
  { id: "e-h2-ausgang", satz: "Meldung an Bat: Kontakt H04 AH12, keine Verluste", soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, zeichenNeu: 0 } },
  { id: "e-h2-ausgang2", satz: "Meldung an Bat: H01 seit 0630 ohne Verbindung", soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, zeichenNeu: 0 } },
  {
    id: "e-h2-weiter", satz: "Weitergemeldet an Bat: Nr 154", vorher: ["H05 2 Kpz AJ9 Rtg W"], vorherNr: [154],
    soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, bezugArt: "weiter", zeichenNeu: 0 },
    pruefe: (_r, ex, [a]) => pruefen(vermerkeOf(byId(ex, a!.id), lvzIndex(ex.events!)).weiter?.an === "Bat", "Nr 154 ohne «weitergemeldet»"),
  },

  // ---- Einsatz M1: Vollzug schliesst Auftrag
  {
    id: "e-m1-erfolgt", satz: "H02 Stellungswechsel nach AH10 erfolgt", vorher: ["an H02: Stellungswechsel nach AH10 bis 0800"], vorherNr: [65],
    soll: { stufe: "bereit", art: "meldung", seite: "eigen", melder: "H02", abschluss: true, bezugArt: "ausgefuehrt", truppNach: { H02: "AH10" }, zeichenNeu: 0 },
    pruefe: (_r, ex, [a]) => [...pruefen(status(ex, a!) === "erledigt", "Auftrag 65 bleibt offen"), ...pruefen(bezugNrVon(ex) === "65", `Bezug Nr ${bezugNrVon(ex)}`)],
  },
  {
    id: "e-m1-eingetroffen", satz: "H02 in AH10 eingetroffen", vorher: ["an H02: Stellungswechsel nach AH10 bis 0800"], vorherNr: [65],
    soll: { stufe: "bereit", art: "meldung", seite: "eigen", melder: "H02", abschluss: true, truppNach: { H02: "AH10" }, zeichenNeu: 0 },
    pruefe: (_r, ex, [a]) => pruefen(status(ex, a!) === "erledigt", "Auftrag 65 bleibt offen"),
  },
  {
    id: "e-m1-nicht", satz: "H02 in AH10 eingetroffen", vorher: ["an H02: Stellungswechsel nach AH10 bis 0800"], vorherNr: [65], kontext: { abschlussAus: true },
    soll: { stufe: "bereit", art: "meldung", seite: "eigen", melder: "H02", abschluss: false, truppNach: { H02: "AH10" }, zeichenNeu: 0 },
    pruefe: (_r, ex, [a]) => [...pruefen(status(ex, a!) === "offen", "«nicht abschliessen» schliesst trotzdem"), ...pruefen(bezugNrVon(ex) === null, "Bezug trotz «nicht abschliessen»")],
  },
  {
    id: "e-m1-anderer-ort", satz: "H02 in AL9 eingetroffen", vorher: ["an H02: Stellungswechsel nach AH10 bis 0800"], vorherNr: [65],
    soll: { stufe: "bereit", art: "meldung", seite: "eigen", melder: "H02", abschluss: false, truppNach: { H02: "AL9" }, zeichenNeu: 0 },
  },

  // ---- Einsatz M2: Grün nur ohne Zweifel
  {
    id: "e-m2-sperre", satz: "H05 Sperre AQ12 errichtet", vorher: ["an H05: Sperre AQ12 errichten bis 0812"], vorherNr: [66],
    soll: { stufe: "bereit", art: "meldung", seite: "eigen", gesehen: /^sperre/, melder: "H05", abschluss: true, zeichenNeu: 1 },
    pruefe: (_r, ex, [a]) => [...pruefen(letzter(ex).side === "blau" && letzter(ex).aff === "F", "Sperre nicht eigen"), ...pruefen(status(ex, a!) === "erledigt", "Auftrag 66 bleibt offen")],
  },
  { id: "e-m2-gemeldet", satz: "An Bat gemeldet: H02 in AL9", soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, zeichenNeu: 0 } },
  { id: "e-m2-auftrag-bat", satz: "Auftrag Bat: Sperre AG13 halten bis 1000", soll: { stufe: "bereit", art: "auftrag", quelle: "Bat", frist: "10:00", melder: null, zeichenNeu: 0 } },
  { id: "e-m2-auftrag-bat-trupp", satz: "Auftrag Bat: H05 Sperre AQ12 halten", soll: { stufe: "bereit", art: "auftrag", quelle: "Bat", an: "H05", melder: null, zeichenNeu: 0 } },

  // ---- Einsatz M3: Meldeauftrag von oben
  {
    id: "e-m3-melden", satz: "Bat: Standort H02 melden bis 0800", soll: { stufe: "bereit", art: "auftrag", quelle: "Bat", frist: "08:00", melder: null, zeichenNeu: 0 },
    pruefe: (_r, ex) => {
      const o = offenePunkte(ex, T_LIVE).find((x) => x.eventId === letzter(ex).id);
      const spaet = offenePunkte(ex, "2030-05-15T08:05").find((x) => x.eventId === letzter(ex).id);
      return [...pruefen(o?.art === "rueckfrage-oben" && !!o.auftragOben && !o.ueberfaellig, `Offen ${JSON.stringify(o)}`), ...pruefen(o?.text === "Bat: Standort H02 melden – bis 08:00", `Text «${o?.text}»`),
        ...pruefen(!!spaet?.ueberfaellig && spaet.prio === 25, "Frist vorbei nicht gewarnt")];
    },
  },
  {
    id: "e-m3-verlangt", satz: "Bat verlangt Lagemeldung bis 0800", soll: { stufe: "bereit", art: "auftrag", quelle: "Bat", frist: "08:00", melder: null, zeichenNeu: 0 },
    pruefe: (_r, ex) => { const o = offenePunkte(ex, T_LIVE).find((x) => x.eventId === letzter(ex).id); return pruefen(o?.text === "Bat verlangt Lagemeldung – bis 08:00", `Text «${o?.text}»`); },
  },
  { id: "e-m3-wissen", satz: "Bat will wissen, wie viele Kpz bei AJ9", soll: { stufe: "bereit", art: "auftrag", quelle: "Bat", melder: null, zeichenNeu: 0 } },
  { id: "e-m3-stehend", satz: "Bat: jede Feindsichtung sofort melden", soll: { stufe: "bereit", art: "orientierung", quelle: "Bat", melder: null, zeichenNeu: 0 } },
  { id: "e-m3-ori", satz: "Bat: ab 0907 Feind Det mit 2 Fz aus Rtg Belp erwartet", soll: { stufe: "bereit", art: "orientierung", quelle: "Bat", melder: null, zeichenNeu: 0 } },
  {
    id: "e-m3-erstattet", satz: "Lagemeldung an Bat 0745 erstattet", vorher: ["Bat verlangt Lagemeldung bis 0800"], vorherNr: [80],
    soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, abschluss: true, zeichenNeu: 0 },
    pruefe: (_r, ex, [a]) => pruefen(status(ex, a!) === "erledigt", "Meldeauftrag 80 bleibt offen"),
  },
  {
    id: "e-m3-anderes", satz: "Meldung an Bat: Kontakt H04 AH12", vorher: ["Bat verlangt Lagemeldung bis 0800"], vorherNr: [80],
    soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, abschluss: false, zeichenNeu: 0 },
    pruefe: (_r, ex, [a]) => pruefen(status(ex, a!) === "offen", "anderer Ausgang erledigt den Meldeauftrag"),
  },
  {
    id: "e-m3-antwort", satz: "Antwort an Bat: H02 in AL9", vorher: ["Bat: Standort H02 melden bis 0800"], vorherNr: [81], kontext: { art: "ausgang", bezugNr: "81" },
    soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, zeichenNeu: 0 },
    pruefe: (_r, ex, [a]) => [...pruefen(status(ex, a!) === "erledigt", "Meldeauftrag 81 bleibt offen"), ...pruefen(bezugNrVon(ex) === "81", `Bezug Nr ${bezugNrVon(ex)}`)],
  },

  // ---- Einsatz M4: Verneinung
  { id: "e-m4-verluste", satz: "Kontakt! H04 Beschuss aus Rtg AH12, keine Verluste", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /^kontakt Kontakt$/, melder: "H04", dringend: true, zeichenNeu: 1 } },
  { id: "e-m4-kein-feind", satz: "H02 kein Feind in Sicht", soll: { stufe: "bereit", art: "meldung", seite: "eigen", gesehen: /^einheit$/, melder: "H02", zeichenNeu: 0 } },
  { id: "e-m4-kein-feind-ort", satz: "H02 kein Feind in AK9", soll: { stufe: "bereit", art: "meldung", seite: "eigen", gesehen: /^einheit$/, melder: "H02", zeichenNeu: 0 } },
  { id: "e-m4-keine-fz", satz: "H04 keine Fz gesehen", soll: { stufe: "bereit", art: "meldung", seite: "eigen", gesehen: /^einheit$/, melder: "H04", zeichenNeu: 0 } },

  // ---- Einsatz N
  {
    id: "e-n-vbk-dritter", satz: "H03 keine Verbindung zu H04", soll: { stufe: "bereit", art: "vbk", vbk: "keine", melder: "H03", zeichenNeu: 0 },
    pruefe: (_r, ex) => {
      const o = offenePunkte(ex, T_LIVE).filter((x) => x.art === "verbindung");
      return [...pruefen(o.length === 1 && o[0]!.unit === "H04", `Verbindung offen bei ${o.map((x) => x.unit)}`), ...pruefen(lebenszeichen(letzter(ex)) === "H03", "H03 meldet, ist aber kein Lebenszeichen")];
    },
  },
  {
    id: "e-n-zwei-nr", satz: "Nr 155 und 156 an Bat weitergemeldet", vorher: ["H05 2 Kpz AJ9 Rtg W", "H02 3 Pers AK10"], vorherNr: [155, 156],
    soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, bezugArt: "weiter", zeichenNeu: 0 },
    pruefe: (_r, ex, [a, b]) => { const idx = lvzIndex(ex.events!); return pruefen(vermerkeOf(byId(ex, a!.id), idx).weiter?.an === "Bat" && vermerkeOf(byId(ex, b!.id), idx).weiter?.an === "Bat", "nicht beide weitergemeldet"); },
  },
  {
    id: "e-n-korrektur", satz: "Antwort zu 64: H02 in AL9, verschiebt nach AH10", vorher: ["Bat fragt: Standort H02?"], vorherNr: [64], kontext: { art: "ausgang" },
    soll: { stufe: "bereit", art: "ausgang", an: "Bat", melder: null, bezugArt: "antwort", zeichenNeu: 0 },
    pruefe: (_r, ex, [a]) => [...pruefen(bezugNrVon(ex) === "64", `Bezug Nr ${bezugNrVon(ex)}`), ...pruefen(status(ex, a!) === "erledigt", "Rückfrage 64 bleibt offen")],
  },
  { id: "e-n-gefallen", satz: "H05 1 Gefallener", soll: { stufe: "bereit", art: "meldung", seite: "eigen", melder: "H05", dringend: true, zeichenNeu: 0 } },
  { id: "e-n-verwundet-feind", satz: "H05 3 verwundete Feinde in AQ11", soll: { stufe: "bereit", art: "meldung", seite: "feind", anzahl: 3, ort: "AQ11", melder: "H05", dringend: false, zeichenNeu: 1 } },
  { id: "e-n-kontakt-pers", satz: "H02 Kontakt mit 4 Pers AK10", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /^inf_trp 4 gegnerische Personen/, anzahl: 4, ort: "AK10", melder: "H02", zeichenNeu: 1 } },
  { id: "e-n-personen", satz: "H02 3 Personen in AK10", soll: { stufe: "bereit", art: "meldung", seite: "feind", gesehen: /^inf_trp/, anzahl: 3, ort: "AK10", melder: "H02", zeichenNeu: 1 } },

  // ---- Erstbenutzer H4: Rasterzeile H (Feld-Raster, Trupps H01–H03)
  { id: "eb-h4-h3", feld: true, satz: "H01 2 Fz in H3", soll: { stufe: "bereit", art: "meldung", seite: "feind", ort: "H3", melder: "H01", zeichenNeu: 1 } },
  { id: "eb-h4-h12", feld: true, satz: "H02 bezogen in H12", soll: { stufe: "bereit", art: "meldung", seite: "eigen", ort: "H12", melder: "H02", truppNach: { H02: "H12" }, zeichenNeu: 1, blauNeu: [] } },
  { id: "eb-h4-anfang", feld: true, satz: "H3 2 Fz in K5", soll: { stufe: "bereit", art: "meldung", seite: "feind", ort: "K5", melder: "H03", zeichenNeu: 1 } },
  { id: "eb-h4-frage", feld: true, satz: "H01 2 Fz H3", soll: { stufe: "pruefen", grund: "einordnung", art: "meldung", melder: "H01", zeichenNeu: 0 } },

  // ---- Erstbenutzer N: Zeit weit voraus
  { id: "eb-n-44tage", tage: ["2030-05-14", "2030-05-15", "2030-06-28"], satz: "T3 1620 H01 2 Fz in AK7", soll: { stufe: "geht-nicht", grund: "zukunft", art: "meldung", melder: "H01", zeichenNeu: 0 } },
  { id: "eb-n-14h", satz: "T2 2200 H01 2 Fz in AK7", soll: { stufe: "geht-nicht", grund: "zukunft", art: "meldung", melder: "H01", zeichenNeu: 0 } },
  // 8 h voraus mit Tag: nur gelb (2. Enter trägt ein; LIVE zeigt das Zeichen erst ab 15:35)
  { id: "eb-n-8h", satz: "T2 1535 H02 2 Pers in AK9", soll: { stufe: "pruefen", grund: "zukunft", art: "meldung", melder: "H02", zeichenNeu: 0 } },
  { id: "eb-n-25min", satz: "0805 H01 2 Fz in AK7", soll: { stufe: "geht-nicht", grund: "zukunft", art: "meldung", melder: "H01", zeichenNeu: 0 } },
];

describe("Sätze der Prüfberichte Review 6 (0 falsche Zeichen, Melder, Bezüge)", () => {
  for (const f of FAELLE) {
    it(`${f.id} «${f.satz}»`, () => {
      const ex = f.feld ? feldUebung() : beispielFuer(f);
      if (f.tage) ex.days = [...f.tage];
      const n0 = ex.events!.length;
      const r = auswerten({ ...f, quelle: f.quelle ?? "spez", uhr: f.uhr ?? UHR } as SatzFall, ex);
      const vorher = ex.events!.slice(n0, n0 + (f.vorher?.length ?? 0));
      const soll = f.soll === "schnappschuss" ? null : f.soll;
      expect([...(soll ? abweichungen(r, soll) : []), ...(f.pruefe?.(r, ex, vorher) ?? [])]).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
const at = (iso: string) => new Date(iso);
function ctxOf(ex: Exercise, now: Date, o: Partial<JournalContext> = {}): JournalContext {
  return { sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now, lastPos: (u, s) => lastPosition(ex.events!, s, u), events: ex.events, ex, zone: "Europe/Zurich", ...o };
}
function trage(ex: Exercise, s: string, now: Date, nr: number, o: Partial<JournalContext> = {}): LageEvent {
  const e = eventFromDraft(parseMeldung(s, ctxOf(ex, now, o)), "dev-a", now, { nr, kuerzel: "BSP" });
  ex.events = [...(ex.events ?? []), e];
  return e;
}

describe("Fester Bezug aus Offen (Einsatz H1, `JournalContext.bezugNr`)", () => {
  it("Vorschau «Antwort auf Nr 57 (Standort H02?)»: `bezugFest`; gewinnt gegen die Nummer im Text und gegen die Wahl", () => {
    const ex = demoExercise();
    const a = trage(ex, "Bat fragt: Standort H02?", at("2030-05-15T07:38:00+02:00"), 57);
    const b = trage(ex, "Bat fragt: wie viele Fz bei AD7?", at("2030-05-15T07:39:00+02:00"), 58);
    const now = at(UHR);
    const d = parseMeldung("Antwort an Bat: H02 in AL9", ctxOf(ex, now, { art: "ausgang", bezugNr: "57" }));
    expect(d).toMatchObject({ bezug: a.id, bezugNr: "57", bezugArt: "antwort", bezugFest: { id: a.id, nr: "57", text: "Standort H02?" } });
    expect(d.wahl).toBeUndefined();
    // ID statt Nummer
    expect(parseMeldung("Antwort an Bat: 2 Fz", ctxOf(ex, now, { bezugNr: b.id })).bezug).toBe(b.id);
    // Nummer im Text verliert gegen den festen Bezug
    expect(parseMeldung("Antwort an Bat zu Nr 58: H02 in AL9", ctxOf(ex, now, { bezugNr: "57" })).bezug).toBe(a.id);
    // Wahl «ohne Bezug»
    const ohne = parseMeldung("Antwort an Bat: H02 in AL9", ctxOf(ex, now, { bezugWahl: BEZUG_KEINER }));
    expect(ohne.bezug).toBeUndefined();
    expect(entryState(ohne, { hasRaster: true, online: false, placePending: false, manualPos: false, now, knownUnits: ex.units.blau, unitsPrepared: true, days: ex.days }).level).toBe("bereit");
  });
  it("Auftrag als fester Bezug («Erledigt»): Abschluss mit Nummer; «nicht abschliessen» behält nur den Verweis", () => {
    const ex = demoExercise();
    const a = trage(ex, "an H03: Beo NAI 2 bis 0900", at("2030-05-15T07:30:00+02:00"), 93);
    trage(ex, "an H03: Vbk alle 30 min", at("2030-05-15T07:31:00+02:00"), 94);
    const now = at(UHR);
    expect(parseMeldung("H03 erledigt", ctxOf(ex, now, { bezugNr: "93" }))).toMatchObject({ bezug: a.id, bezugArt: "ausgefuehrt", abschluss: { id: a.id, nr: "93" }, bezugFest: { nr: "93" } });
    expect(parseMeldung("H03 erledigt", ctxOf(ex, now, { bezugNr: "93", abschlussAus: true }))).toMatchObject({ bezug: a.id, bezugArt: "verweis", abschluss: null });
  });
});

describe("Lebenszeichen, Melder (Einsatz H2, N)", () => {
  it("früher gespeicherte Rückfrage von oben mit Melder ist kein Lebenszeichen; Vbk «keine» eines Dritten schon für den Melder", () => {
    const base = { id: "x", rev: 1, device: "d", updatedAt: "2030-05-15T05:00:00.000Z", t: "2030-05-15T07:00", side: "blau", unit: "", text: "", sym: "einheit", aff: "F" } as LageEvent;
    expect(lebenszeichen({ ...base, art: "rueckfrage", notiz: true, quelle: "Bat", melder: "H01" })).toBeNull();
    expect(lebenszeichen({ ...base, art: "rueckfrage", notiz: true, melder: "H04" })).toBe("H04");
    expect(lebenszeichen({ ...base, art: "vbk", notiz: true, vbk: "keine", melder: "H03", an: "H04" })).toBe("H03");
    expect(lebenszeichen({ ...base, art: "vbk", notiz: true, vbk: "keine", melder: "H04" })).toBeNull();
  });
  it("Lebenszeichen nach Eingang: «0255» um 02:10 MEZ nachgemeldet (Rückstellung) ist ein Lebenszeichen von 02:10 MEZ", () => {
    const ex = demoExercise();
    ex.days = ["2030-10-26", "2030-10-27"];
    ex.events = [];
    // 02:55 MESZ (= 00:55 UTC), eingetragen um 02:10 MEZ (= 01:10 UTC)
    const e = trage(ex, "0255 H01 2 Pers AC7", at("2030-10-27T01:10:00Z"), 1, { day: "2030-10-27" });
    expect(e.tOffset).toBe("+02:00");
    const still = offenePunkte(ex, "2030-10-27T02:40+01:00").find((o) => o.key === "still:H01");
    // 02:40 MEZ − 02:10 MEZ = 30 min: nicht still (Lagezeit hätte 105 min ergeben)
    expect(still).toBeUndefined();
    expect(lageBlau(ex, "2030-10-27T02:40+01:00").find((z) => z.trupp === "H01")!.stillMin).toBe(30);
  });
});

describe("CSV: Spalte «Zeitzone» (Einsatz N)", () => {
  it("MESZ/MEZ je Eintrag – die doppelte Stunde ist eindeutig", () => {
    const ex = demoExercise();
    ex.days = ["2030-10-26", "2030-10-27"];
    ex.events = [];
    trage(ex, "0255 H01 2 Pers AC7", at("2030-10-27T00:56:00Z"), 1, { day: "2030-10-27" });
    trage(ex, "0255 H02 1 Fz AK9", at("2030-10-27T01:56:00Z"), 2, { day: "2030-10-27" });
    const rows = journalToCsv(ex.events!, ex.days).replace(/^﻿/, "").split("\r\n").map((r) => r.split(";"));
    const col = rows[0]!.indexOf("Zeitzone");
    expect(col).toBe(rows[0]!.length - 1);
    expect(rows.slice(1).map((r) => `${r[1]} ${r[col]}`)).toEqual(["02:55 MESZ", "02:55 MEZ"]);
  });
});
