/**
 * Entscheide des Kunden zu MVP 3 «LVZ-Betrieb» (Spez. MVP 3, Kap. 9, beantwortet am 29.10.2026). Alle Stellen im Kern
 * und in der Oberfläche lesen diese Werte von hier – ändert sich ein Entscheid, wird nur hier angepasst (und die
 * zugehörigen Tests).
 *
 * 1 Laufende Nummer · 2 AEIOU-Feld E · 3 «Trupp still» · 4 Standard «Journal drucken» · 5 Quittung
 */

/**
 * 1 – Laufende Nummer: **eine gemeinsame Folge, kein Gerätebuchstabe**. Fenster desselben Geräts teilen den Zähler;
 * nach dem Öffnen/Zusammenführen einer Datei zählt jedes Gerät ab der höchsten bekannten Nummer weiter. Vergeben zwei
 * Geräte offline dieselbe Nummer, **bleibt sie** (eine Nummer ändert nie); die Doppelten werden in der Anzeige mit
 * diesen Endungen gekennzeichnet («12a», «12b» – nach `createdAt`, dann ID, auf jedem Gerät gleich).
 * Umsetzung an einer Stelle: nummer.ts (später durch echten Abgleich ersetzbar, Etappe 6).
 */
export const NR_DOPPELT_ENDUNGEN = "abcdefghijklmnopqrstuvwxyz";

/**
 * 2 – AEIOU-Feld E (bzw. «Wer:»/«Was:») ist **immer das Gesehene**, nie der Melder. Der Melder kommt aus dem
 * Trupp-Knopf, dem Text vor «A:» oder einem eigenen Feld («Melder:», «Von:»); fehlt er, gilt die bisherige Regel
 * («Wer meldet? fehlt», gelb). Die frühere Annahme A1 («eigener Trupp allein in E = Melder») entfällt.
 */
export type AeiouERegel = "gesehenes";
export const AEIOU_E_REGEL: AeiouERegel = "gesehenes";

/**
 * 3 – Ab so vielen Minuten ohne Lebenszeichen erscheint ein Trupp in «Offen» und in der Übergabe. 60 = Schwelle
 * «nicht überwacht» der Hinweise (`HINT_THRESHOLDS.D3_SILENT_MIN`), damit Offen und «Was Rot» sich nicht widersprechen.
 */
export const STILL_MIN = 60;

/**
 * 4 – Standard-Umfang im Dialog «Journal drucken»: laufende Schicht (seit der letzten Übergabe), gibt es keine
 * Übergabe, der ganze (heutige) Tag.
 */
export type JournalDruckStandard = "schicht-sonst-tag" | "tag" | "alles";
export const JOURNAL_DRUCK_STANDARD: JournalDruckStandard = "schicht-sonst-tag";

/** Umfang, der im Dialog «Journal drucken» vorgewählt ist (Entscheid 4) */
export function journalDruckVorwahl(hatUebergaben: boolean, regel: JournalDruckStandard = JOURNAL_DRUCK_STANDARD): "schicht" | "tag" | "alles" {
  if (regel === "schicht-sonst-tag") return hatUebergaben ? "schicht" : "tag";
  return regel;
}

/**
 * 5 – «Quittung» ist eine Notiz mit Bezug auf den jüngsten offenen Auftrag an diesen Trupp («quittiert 07:31»).
 * Erledigt wird der Auftrag erst mit «ausgeführt» oder dem Knopf «Erledigt».
 */
export const QUITTUNG_ART = "notiz" as const;
export const QUITTUNG_ERLEDIGT = false;
