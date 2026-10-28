/**
 * Online-Ortssuche nur für echte Ortsnamen: Buchstabier- und Rastertexte («Alpha Kilo 7», «AK77», «NAI 9», «H04»)
 * gehen nie ans Netz – sie sind entweder ein Planquadrat/Element oder ein Problem in der Meldung, aber kein Ort.
 * Dazu die Einstellungen «Online-Dienste» einer Übung (Standard an).
 */
import type { Exercise } from "./model";

/** Buchstabieralphabet (NATO) inkl. gängiger Schreibweisen der Spracherkennung */
const SPELL = new Set([
  "alpha", "alfa", "bravo", "charlie", "charly", "charli", "delta", "echo", "foxtrot", "foxtrott", "golf", "hotel", "india",
  "juliett", "juliet", "julia", "kilo", "lima", "mike", "maik", "november", "oscar", "oskar", "papa", "quebec", "romeo",
  "sierra", "tango", "uniform", "victor", "viktor", "whiskey", "whisky", "x-ray", "xray", "yankee", "zulu",
]);
/** Zahlwörter (Funk), die zu Raster/Element gehören */
const NUM = new Set(["null", "eins", "ein", "zwo", "zwei", "drei", "vier", "fünf", "fuenf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"]);
/** Planquadrat («AK7», «AK 77», «AK7 C», «G19»), NAI, Element («H04», «Det 2»), Koordinate, reine Zahl */
const RASTER_RE = /^[a-z]{1,2}\s?\d{1,3}(\s?[a-d])?$/i;
const TECH_RE = /^(nai|bnb|ao|pq|h|det|zug|gr|trp|pat|patr)\.?\s?\d{0,3}$/i;
const COORD_RE = /^[\d\s.'’,/-]+$/;

/**
 * Lohnt sich die Online-Ortssuche für diesen Text? Nur für Ortsnamen mit mindestens drei Buchstaben am Stück,
 * die nicht nur aus Buchstabierwörtern, Zahlwörtern, Planquadraten, NAI oder Elementen bestehen.
 */
export function isPlaceName(query: string | undefined | null): boolean {
  const q = (query ?? "").trim();
  if (q.length < 3 || !/[a-zäöüéèàâç]{3}/i.test(q)) return false;
  if (RASTER_RE.test(q) || TECH_RE.test(q) || COORD_RE.test(q)) return false;
  const words = q.toLowerCase().split(/[\s,;:]+/).filter(Boolean);
  // jedes Wort ist Buchstabierwort, Zahlwort, Zahl, Planquadrat oder Unterquadrant → Rastertext, kein Ort
  const tech = (w: string) => SPELL.has(w) || NUM.has(w) || /^\d+$/.test(w) || RASTER_RE.test(w) || TECH_RE.test(w) || /^[a-d]$/.test(w);
  if (words.every(tech)) return false;
  // beginnt mit zwei Buchstabierwörtern («Alpha Kilo sieben Charlie …»)
  if (words.length >= 2 && SPELL.has(words[0]!) && SPELL.has(words[1]!)) return false;
  return true;
}

export type OnlineDienst = "ortssuche" | "strassen";

/** Ist der Online-Dienst für diese Übung erlaubt? (Standard: an) */
export function onlineAllowed(ex: Pick<Exercise, "onlineDienste"> | null | undefined, dienst: OnlineDienst): boolean {
  return ex?.onlineDienste?.[dienst] !== false;
}
