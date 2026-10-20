# Konzept

## Gemeinsam

### Führungsraster
- **Variante «blatt» (Standard):** Gesamtblatt + Detailblätter mit Codenamen. Spalten zweibuchstabig mit Blatt-Präfix (AA–AU, UA–UU), Zeilen 1–15, Beschriftung auf allen Seiten, Unterquadranten A B / D C, Referenzkreuz mit Koordinaten, Klassifizierung, Massstabsbalken, Kompassrose, Landeskarte oder Luftbild.
- **Variante «feld»:** ein Blatt, Zeilen A–Z, AA–AD …, Spalten 1–30.
- Feldgrösse, Anzahl Zeilen/Spalten und Beschriftung frei einstellbar.
- Export: PDF zum Drucken (A4/A3, Massstab) und Datei für beide Apps.

### NAI / BNB einpflegen
- GIS-Dateien (KML, GeoJSON, GPX, Zeichnungen aus map.geo.admin.ch): direkt und exakt.
- Word / PDF / Bilder: Kartenausschnitte (z. B. von map.geo.admin.ch) werden automatisch mit der Landeskarte verglichen und eingepasst; sonst von Hand mit 2 Passpunkten (Fotos/Scans: 3 Punkte, verzerrt). Linienfarbe und umrandete bzw. gefüllte NAI werden automatisch erkannt und als Linien übernommen, das Bild wird verworfen.

## Produkt 1 – Lagejournal (offline)
- Ein Eingabefeld: Text einfügen, Foto, Sprachmemo → Vorschlag für Zeichen, Ort, Zeit, Seite → ein Klick bestätigt.
- Erkennung offline: Meldungsformate (AEIOU, Wann/Wer/Tut was/Wo, Kurzmeldung), Trupps, Planquadrate («O20 (C)», «UK7 C», «G 19 Delta»), LV95/LV03, swisstopo-Links; Sprache und gedruckter Text im Browser.
- Ausgabe: Zeitstrahl, Seite Blau, Seite Rot, Hinweise zu Rot (Rhythmus, Achsen, wiederholte Halte, Übergaben); später Regelwerk aus Reglementen.
- KI optional, pro Übung ausdrücklich einschalten.
- vNext: Abgleich Gerät ↔ Gerät (Datei, QR, lokales WLAN) über das Ereignismodell (ID + Revision + Gerät).

## Produkt 2 – Übungsauswertung (online)
- Import: Journale als Foto/Text/Export aus Produkt 1; KI überträgt Handschrift und Chat-Verläufe.
- Auswertung Rot ↔ Blau, Bilder pro Planquadrat.
- AAR-Regie: PowerPoint als PDF, pro Folie Kartenlage festlegen, Folien und Karte synchron auf zwei Bildschirmen.

## Etappen
1. Projektgerüst, Kern, Karten-Shell, GitHub Pages ✅
2. Führungsraster-Editor (beide Varianten, PDF-Export) und NAI-Import ✅
3. Lagejournal: Texteingabe, Karte, Zeitstrahl, offline (Kartenpakete) ✅
4. Lagejournal: Foto- und Spracheingabe, Hinweise zu Rot, KI optional
5. Übungsauswertung: Import, Auswertung, AAR-Regie
6. vNext: Abgleich Gerät ↔ Gerät

## Lagejournal – Eingabe (Etappe 3)
Eine Zeile pro Meldung, so wie man mitschreibt:

| Teil | Beispiele | Hinweis |
|---|---|---|
| Tag, Zeit | `T2 0315`, `10:15`, `1015` | ohne Zeit: jetzt; ohne Tag: gewählter Übungstag |
| Seite | `Rot`, `Blau`, `UL`, `Gegner` | sonst Umschalter; bekannte Elemente bestimmen die Seite selbst |
| Element | `H04`, `Det 2`, `Zug 1`, `Gr 3` | neue Elemente werden gemerkt |
| was | `2 Fz`, `Beo Stao`, `Kontakt mit Gegner`, `Checkpoint` | Zeichen und Anzahl automatisch |
| wo | `C12 D`, `UK7 C`, `NAI 3`, `2'600'100 / 1'200'200`, `in Wabern` | Ortsnamen online nachgeschlagen und für offline gemerkt; ohne Ort: letzter Standort des Elements |
| Richtung | `Rtg N`, `Richtung Bern` | Pfeil am Zeichen |

Karte: pro Element das aktuelle Zeichen mit Spur; Tätigkeiten (Kontakt, Sperre, Checkpoint …) als eigenes Zeichen am Ort.
Zeitstrahl: Lage zu jedem Zeitpunkt, Abspielen, «Live». Export: CSV, PDF, Übungsdatei.
Offline: App als PWA; Karte für das Raster-Gebiet vorab speichern (Detailstufe wählbar), angesehene Kartenteile bleiben gespeichert.
