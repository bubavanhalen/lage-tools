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

## Lagejournal – Lageverfolgung im LVZ (Etappe 3 / 3b)
Jede Meldung kommt von einem **eigenen Element (Melder)**. Der Inhalt entscheidet, was auf die Karte kommt:
**eigene Lage** (blau, verschiebt den Melder), **Feindsichtung** (rot, am gemeldeten Ort) oder **unklar** (gelb).
Der Vergleich Rot ↔ Blau (Erkennung) gehört ins Auswertungstool.

Eingabe in einer Zeile:

| Teil | Beispiele | Hinweis |
|---|---|---|
| Tag, Zeit | `T2 0315`, `10:15`, `1015` | ohne Zeit: jetzt; Zeit in der Zukunft wird angemerkt |
| Melder | `H04`, `Det 2`, `Zug 1`, `Gr 3` | neue Elemente werden gemerkt; fehlt er, erscheint «Melder fehlt» |
| was | `2 Fz`, `Beo Stao`, `Kontakt mit Gegner`, `Checkpoint`, `3 Pers unklar` | Zeichen, Anzahl, Einordnung automatisch (Alt+1/2/3 übersteuert) |
| wo | `AK7 C`, `NAI 3`, `2'600'100 / 1'200'200`, `in Wabern` | sonst letzter Standort bzw. «bei Melder» |
| Richtung | `Rtg N`, `Richtung Bern` | Pfeil am Zeichen |

Tasten: Enter = eintragen, ↑ = letzte korrigieren, N = zurück ins Meldungsfeld, / oder Strg+K = Suche.

**Darstellung (wie Lagebild-Prototyp, verbessert):** Zeitstrahl mit Zeile pro Element (Feind oben, Eigene unten), Linie Sichtung → Melder, Live, Abspielen, Ziehen auch mit Touch.
Karte: Raster mit grosser Feldbeschriftung, Uhrzeit an frischen Zeichen, älter als 30 min blass, überlappende Zeichen aufgefächert mit Führungsstrich,
gewähltes Planquadrat hinterlegt, Meldungsband, Legende aus dem Sichtbaren, eigene Elemente ohne Meldung > 60 min mit Altersangabe.
Navigation: eine Suche für Planquadrat/NAI/Element/Koordinate/Ort, Doppelklick Feld → Unterquadrant, Messen (Distanz, Azimut ° und ‰), Rechtsklick-Menü («Meldung hier»).
Präsentationsmodus (Vollbild, ←/→ blättert), Nachtbetrieb, Tablet- und Handy-Ansicht.
Offline: App als PWA; Karte für das Raster-Gebiet vorab speichern, angesehene Kartenteile bleiben gespeichert.

## Lagejournal – Taktische Zeichen (Etappe 3c)
- **Katalog** mit gut 110 Zeichen nach MIL-STD-2525C (milsymbol): Kampftruppen, Unterstützung, Führung/Logistik, Zivile/Irreguläre, Fahrzeuge, Waffen, Luftfahrzeuge, Anlagen, Hindernisse, Tätigkeiten, Ereignisse. Stufen Trp, Gr, Hz, Zug, Kp, Bat, Rgt, Br, Div.
- **Armee-Kürzel** werden gelesen und ausgeschrieben: «1 gn hz inf» → 1 gegnerischer Halbzug Infanterie; «gn Pz Gren Zug mit 3 Spz»; «Kp Gfs» → Kommandoposten; «Fz-Kolonne 5 Lastw»; «zerstörter gn Kpz».
- **Status:** «möglich/vermutet/vmtl» = Feind gestrichelt; «unklar/verdächtig» = gelb; «zerstört/beschädigt» nach 2525C.
- **Einordnung:** Ereignisse, Anlagen, Tätigkeiten sind nur mit «eig» eigene Lage und verschieben den Melder nicht. Melder- und Elementnummern («H05», «Det 2») sind keine Anzahl.
- **Herkunft** «aus Rtg O» ohne Bewegungspfeil.
- **Im Gelände:** Sperren, Checkpoints, IED, Kolonnen, Hinterhalt usw. werden auf die wahrscheinlichste Strasse im gemeldeten Feld bzw. NAI gelegt (swisstopo TLM3D, Hauptstrasse vor Nebenstrasse, Autobahn nur mit «auf Autobahn»). Sperren liegen quer zur Strasse. Strassendaten werden mit dem Kartenpaket offline gespeichert.
- **Zeichen-Auswahl:** Klick auf das Zeichen in der Vorschau oder beim Korrigieren. Suche versteht Kürzel («hz inf», «vermutete IED»), Kategorien, Zugehörigkeit, Stufe, «vermutet». Punkt-Zeichen mit deutschen Kurzzeichen (Mun, Bst, Vrk …).
- Regressionstest mit über 120 Meldungen (`packages/core/test/meldungen.test.ts`).
- Offen: Flächen- und Linienzeichen (Bereitstellungsraum, Minenfeld als Fläche) sind vorerst Punktzeichen.
