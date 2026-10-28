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
4. Lagejournal: Hinweise zu Rot (4a ✅), Foto- und Spracheingabe (4b ✅), KI optional (4c ✅)
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

## Lagejournal – Lagedarstellung (Etappe 3d)
- **Zeitfenster:** Alles · 30′ · 1 h · 2 h · 6 h oder Anfang auf dem Zeitstrahl ziehen. Sichtungen/Ereignisse ausserhalb fallen weg, Elemente bleiben an ihrem letzten Standort. Gilt für Karte, Liste, Legende, Präsentation; pro Übung gemerkt.
- **Stapel statt Führungsstriche:** Zeichen am gleichen Ort liegen übereinander mit Zahl-Marke; Klick fächert auf (Linien zum Ort nur dann), Klick daneben/Esc/Zoom klappt zu; Tastatur: Tab/Enter/Esc.
- **Zeichen verschieben:** gewähltes Zeichen ziehen (Touch: lang drücken), korrigiert den Ort der Meldung als neue Revision; Hinweis mit «Rückgängig» (Ctrl+Z); Schloss «Zeichen fixieren». In der Präsentation gesperrt.
- **Flächen und Linien:** Bereitstellungsraum, Minenfeld, Sperrgebiet, verseuchtes Gebiet, Beobachtungs-, Ziel-, Feuerraum, Landezone, Evakuierungsraum; Stacheldraht, Sperrlinie, Panzergraben, Kontakt-, Phasenlinie, Abschnittsgrenze, Vormarsch-/Verschiebungsachse. Automatisch aus Planquadrat, Unterquadrant, NAI oder Koordinate; von Hand zeichnen und bearbeiten.
- **Deutsche Kürzel** in allen Zeichen (Spez, EKF, Mil Pol, Log …); IED bleibt.
- **Strassenwahl:** bei mehrdeutigen Feldern Auswahl der Kandidaten; Strassenname im Text gewinnt; «Kein Strassenbezug».

## Lagejournal – Hinweise zu Rot (Etappe 4a)
Das Lagejournal gibt **Hinweise, keine Fakten**: Jeder Hinweis nennt Auslöser (Meldungen), Regel und Quelle (Reglement-Nr. und Ziffer; Regeln in eigenen Worten). Der Zfhr bestätigt oder verwirft. Alles offline, Regeln in `packages/core/src/hints.ts` mit dokumentierten Schwellen.
- **A Normallage:** Grundlast je NAI lernen (Referenz), Abweichung, auffällige Ruhe.
- **B Eigene Präsenz:** Reaktion nach Patrouille, Checkpoint verbraucht, Ausweichen vor Checkpoint.
- **C Absicht Rot:** Übergabe/Zusammenschluss, Pendel mit Prognose der nächsten Durchfahrt, Aufklärung vor Aktion, Schwergewicht, Hinterhalt-Gefahr an Engnis, Formation.
- **D Rot sieht Blau:** eigener Stao aufgeklärt (Drohne/Beobachter ≤ 500 m), Stao zu nahe an Rot, Lücke in der Überwachung (NAI ohne Meldung des zugeteilten Trupps).
- **E Qualität:** bestätigt durch zweite Quelle, unvollständig (AEIOU), Plausibilität (Tempo), mögliche Täuschung (fremde, unbestätigte Quelle).
- NAI mit zugeteiltem Trupp und Geländetyp («NAI 2 · H03»).
- Bedienung: Reiter «Hinweise» mit Zahl der offenen, kompakte Liste, Klick zeigt Begründung, Auslöser, Karte; Entscheide haften auch bei Nachträgen; Hinweise folgen Lagezeit und Zeitfenster; CSV und Anhang im Journal-PDF.
- Leitlinie gegen Alarm-Müdigkeit: «hoch» nur, wenn etwas zu prüfen oder zu tun ist. Messung: 25 ruhige 6-h-Lagen ohne einen «hoch»-Hinweis.

## Lagejournal – Foto und Sprache (Etappe 4b)
- **Foto:** Meldezettel oder Journalseite fotografieren/hochladen/einfügen. Gedruckter Text offline erkannt (tesseract.js, ca. 5 MB, erst bei Gebrauch geladen), Papier gerade ziehen, automatisch drehen, Hinweis bei dunklem/unscharfem Foto. Handschrift: KI (Etappe 4c).
- **Sprache:** Mikrofon halten/antippen/Leertaste; Memo wird immer gespeichert. Erkennung offline mit Whisper (small, ca. 250 MB, einmal laden; mehrere Threads, WebGPU falls vorhanden) oder wahlweise Browser-Erkennung (online, nur nach Einwilligung). Warteschlange: Sprechen blockiert nie, Restzeit je Memo, Abbrechen.
- **Funksprache offline übersetzt:** Buchstabieralphabet, gesprochene Zahlen und Zeiten (auch Schweizerdeutsch), Elemente, Planquadrate, NAI, Koordinaten, Richtungen; Funkfloskeln entfernt.
- **Mehrere Meldungen:** Foto/Memo → Übersicht mit Vorschau je Meldung, einzeln oder alle übernehmen (gleich wie Enter im Meldungsfeld). Nichts vermischt sich mit getipptem Text.
- **Anhänge:** an Meldung oder Planquadrat (Kamera-Symbol auf der Karte), Bildbetrachter, Memo-Player; «Übung speichern» mit Anhängen als `.lage.zip`.

## Lagejournal – Lage Rot (Etappe 4a+)
Oben im Reiter «Hinweise», darunter die Hinweise.
- **Mögliche Aktionen Rot:** Katalog (Überfall auf eigenen Stao, Hinterhalt an Engnis/Strasse, Sperren/Kanalisieren, Versorgung/Übergabe, Aufklärung zur Vorbereitung, Infiltration durch unbewachten NAI, Absetzen) mit gewichteten Indikatoren und Gegenindikatoren aus Hinweisen und Meldungen. Angezeigt höchstens: wahrscheinlichste, gefährlichste, eine weitere – erst ab zwei Rot-Indikatoren aus verschiedenen Meldungen. Je Möglichkeit Indikatoren (✓ erfüllt, ○ offen, ✗ dagegen), Annäherung, Zeitraum (fest, «überfällig», «jetzt»), «Prüfen». Indikatoren altern (90 Min), Rangfolge mit Hysterese, verworfene Hinweise zählen nicht.
- **Kräfte Rot:** erkannt (benannte Elemente einmal, unbenannte Sichtungen über Erreichbarkeit abgeglichen: «mind.» vorsichtig, «bis» alle verschieden) gegenüber der Feindannahme (eine Kurzschrift-Zeile pro Übung, z. B. «2 Det, 14 Pers, 5 Fz, 1 Drohne»), «nicht mehr gesehen seit», mit Zeitfenster Zusatzspalte «im Fenster».
- Karte: Ebene «Aktionen Rot» (Annäherungspfeil, Ziel mit Zeitraum, Engnis-Warnung). Export im Journal-PDF und CSV.

## Lagejournal – KI auf Wunsch (Etappe 4c)
- Claude mit **eigenem Anthropic-Schlüssel**, nur auf dem Gerät gespeichert (nie in Übung, Export, Protokoll). Modelle: Standard (Sonnet), Genauer (Opus), Schneller (Haiku); Kosten über das eigene Konto, Schätzung im Protokoll.
- **Pro Übung einschalten** und **pro Gerät einwilligen** (Hinweis: keine klassifizierten Daten; Daten gehen an Anthropic, USA). Ohne KI funktioniert alles andere.
- **Jeder Aufruf sichtbar:** vor dem Senden «Wird gesendet: …» (Daten zuerst, Anweisung eingeklappt), danach «Gesendet: …» – auch bei «nicht mehr fragen». Datensparsam: keine IDs, Gerätekennung, Übungsname, Kalenderdaten; Koordinaten nur als PQ.
- **Einsatz:** Handschrift auf Fotos lesen · unklare Meldung deuten (Vorschlag mit Begründung) · Hinweis bzw. mögliche Aktion Rot ausformulieren · Lagebericht für Rapport/Übergabe entwerfen. Alles Vorschläge; unsichere Zeilen sind nicht vorab angehakt; übernommene Meldungen tragen die Marke «KI».
- Schutz gegen Erfindungen: unbekannte Melder/PQ/NAI, nicht genannte Zeiten/Anzahlen und weggefallene Unsicherheit werden als «unsicher» markiert. Text in Meldungen und auf Fotos gilt als Inhalt, nie als Anweisung.
