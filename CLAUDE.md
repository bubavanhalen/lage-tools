# Hinweise für Claude

- Sprache in UI, Kommentaren und Doku: Deutsch (Schweiz, «ss» statt «ß»), militärische Begriffe wie in der Schweizer Armee (Zfhr, Grfhr, Trp, LVZ, NAI, Stao, EOT, MMM).
- **Niemals Übungsdaten committen** (echte Koordinaten von Stao, Namen, Journale, Raster einer Übung, Reglementstexte). Tests und Beispiele nur mit fiktiven Daten (Raum Bern, `demoFeldSheet`).
- Kern (`packages/core`) bleibt ohne Laufzeit-Abhängigkeiten und ist mit vitest getestet: `npm test`.
- Koordinaten intern immer LV95 (EPSG:2056). Karte in LV95 (`packages/map`), damit Rasterlinien exakt gerade sind.
- Bedienung so einfach wie möglich; Lagejournal muss offline funktionieren, KI nur nach ausdrücklichem Einschalten.
- Vor dem Push: `npm test && npm run build`.
