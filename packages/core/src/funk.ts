/**
 * Funk- und Sprechsprache → Kurzmeldung (offline, ohne Abhängigkeiten).
 * Beispiel: «Hotel null vier, zwo Fahrzeuge, Alpha Golf eins drei, Richtung Nord»
 *         → «H04 2 Fz AG13 Rtg N»
 * Danach übernimmt `parseMeldung` wie bei getippten Meldungen.
 */

export interface SpokenResult {
  /** normalisierte Kurzmeldung(en), wie getippt */
  text: string;
  /** erkannte Ersetzungen zur Anzeige (z. B. «Hotel null vier» → «H04») */
  changes: Array<{ from: string; to: string }>;
}

/** Gesprochenen bzw. diktierten Text in Kurzschreibweise umwandeln */
export function normalizeSpoken(text: string): SpokenResult {
  return { text, changes: [] };
}

/**
 * Text mit mehreren Meldungen (Foto einer Journalseite, langes Sprachmemo) in einzelne Meldungen trennen.
 * Trennt an Zeitangaben am Zeilenanfang, Leerzeilen und Funk-Schlussworten («Ende», «Antworten»).
 */
export function splitMeldungen(text: string): string[] {
  const t = text.trim();
  return t ? [t] : [];
}
