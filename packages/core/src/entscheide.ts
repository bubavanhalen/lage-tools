/**
 * Entscheide des Kunden zu MVP 3 «LVZ-Betrieb» (Spez. MVP 3, Kap. 9, beantwortet am 29.10.2026). Alle Stellen im Kern
 * und in der Oberfläche lesen diese Werte von hier – ändert sich ein Entscheid, wird nur hier angepasst (und die
 * zugehörigen Tests).
 *
 * 1 Laufende Nummer · 2 AEIOU-Feld E · 3 «Trupp still» · 4 Standard «Journal drucken» · 5 Quittung
 *
 * MVP 3.5 «Feinschliff» (Spez. MVP 3.5, Kap. 0, 5.6, 9): Online-Standard (K2), Kartenzeichen V4 (K3), Service Worker,
 * Treffer, Datei sichern, Übergabe «Von oben» und die drei offenen Kundenfragen (Vorschlag gilt bis zur Antwort) –
 * Abschnitt am Ende der Datei.
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

// =====================================================================================================================
// MVP 3.5 «Feinschliff» (Spez. MVP 3.5, Kap. 0 und 5.6) – Kundenentscheide K1–K3 vom 29.10.2026 und Entscheide der
// Spezifikation. Offene Kundenfragen (Kap. 9): unten mit dem Vorschlag der Spezifikation (gilt bis zur Antwort).
// =====================================================================================================================

/**
 * K2 – Online-Dienste (Ortsnamensuche, Strassenzuordnung) standardmässig **aus**; nur ein ausdrückliches `true` in
 * `Exercise.onlineDienste` schaltet ein (`onlineAllowed`). Fehlt das Feld (neue, alte, Beispiel-Übung), gilt dieser Wert.
 * Beim Öffnen wird nichts geschrieben; beim Zusammenführen einer Datei gewinnt die lokale Wahl (`mergeExercise`).
 */
export const ONLINE_STANDARD = false;

/** S4 – Service Worker: Seite höchstens so lange aus dem Netz, dann aus dem Zwischenspeicher */
export const SW_NETZ_TIMEOUT_MS = 3000;
/** S4 – Kartenkachel höchstens so lange aus dem Netz (nicht im Zwischenspeicher), dann 504 */
export const SW_KACHEL_TIMEOUT_MS = 8000;

/** K3 – Kartenzeichen Variante V4 der Symbolstudie (Grundmass je m/px, Stufen, Linien, ältere Zeichen) */
export const ZEICHEN = {
  /** Grundmass M in px ab dieser Auflösung (m/px, absteigend): > 15 → 24, 10–15 → 26, 5–10 → 28, < 5 → 32 */
  grundmass: [{ abMPerPx: 15, px: 24 }, { abMPerPx: 10, px: 26 }, { abMPerPx: 5, px: 28 }, { abMPerPx: 0, px: 32 }],
  /** gewählte Meldung: so viel grösser */
  gewaehlt: 6,
  /** Regler S/M/L im Anzeige-Menü (pro Gerät, Standard M) */
  stufe: { S: -4, M: 0, L: 8 },
  /** Präsentation: statt der Stufe */
  praesentation: 14,
  strokeWidth: 7,
  outlineWidth: 8,
  /** ältere Zeichen (map/quiet.ts): Deckkraft und Sättigung */
  altDeckkraft: 0.72,
  altSaettigung: 0.55,
  beschriftungPx: 12,
  beschriftungPraesentationPx: 16,
} as const;
/** K3 – graue Tageskarte (nur bei Tag; Nacht unverändert) */
export const TAGESKARTE_FILTER = "grayscale(1) contrast(.62) brightness(1.22)";
/** S11 – Feind-Planquadrat: Füllung und Rahmen (Unklar: Schraffur statt Füllung) */
export const PQ_FLAECHE = { feindFuellung: 0.22, rahmen: 0.4 } as const;
/** S12 – Trefferfläche auf der Karte (Durchmesser in px): Finger bzw. Maus */
export const TREFFER_PX = { coarse: 48, fine: 32 } as const;
/** S9 – «Datei sichern» bei der Übergabe anbieten, wenn die letzte Sicherung auf diesem Gerät älter ist (oder fehlt) */
export const DATEI_SICHERN_NACH_MIN = 120;
/** D4 – Übergabe «Von oben (gültig)»: so viele gültige, dazu höchstens `VON_OBEN_VORBEI` vorbei */
export const VON_OBEN_MAX = 8;
export const VON_OBEN_VORBEI = 2;

// ---------- Offene Kundenfragen (Spez. MVP 3.5, Kap. 9) – Vorschlag gilt bis zur Antwort -----------------------------

/**
 * Frage 9.1 – Kartenkacheln (wmts.geo.admin.ch) sind **kein** Online-Dienste-Inhalt: sie enthalten keine Meldung, ohne
 * sie ist die Karte beim Erststart leer. Bei «Ja» (true): Schalter `karte` in `onlineDienste` (Standard aus), Erststart
 * zeigt eine leere Karte mit Hinweis – Umsetzung dann in Paket A (`onlineAllowed(ex, "karte")`, `tiles.ts`).
 */
export const KACHELN_SIND_ONLINE_DIENST = false;

/**
 * Frage 9.2 – Ungeschütztes Gerät (Speicher nicht geschützt, App nicht installiert) zeigt **kein** dauerndes ⚠ im Kopf;
 * das ⚠ steht nur für fehlende App/Karte. Schutz und Anleitung stehen im Offline-Popover und im Menü «Auf diesem Gerät
 * sicher?», dazu ein einmaliger Hinweis pro Übung und Gerät und die Erinnerung «Datei sichern» bei der Übergabe.
 */
export const SCHUTZ_WARNT_IM_KOPF = false;

/**
 * Frage 9.3 (S22) – Meldungen bis so viele Minuten nach der Geräteuhr gehören schon zur Lage (Uhren gehen verschieden);
 * die Zeile zeigt «4 min nach jetzt – Uhr des Melders?», LIVE zeigt immer die Geräteuhr. Mehr bleibt «liegt in der
 * Zukunft». Alternative des Kunden «keine Toleranz»: 0 (jede Zeit nach jetzt gelb «in 4 min – jetzt eintragen?»).
 */
export const LIVE_TOLERANZ_MIN = 10;
