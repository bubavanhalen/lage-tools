# Lage-Tools

Führungsraster, Lageverfolgung und Übungsauswertung auf swisstopo-Karten.

| Produkt | Zweck | Betrieb |
|---|---|---|
| **Lagejournal** | Lageverfolgung im LVZ: Meldungen als Text, Bild oder Sprache erfassen; taktische Zeichen, Ort und Zeit werden automatisch gesetzt; Zeitstrahl, Seite Blau, Seite Rot | offline, KI optional |
| **Übungsauswertung** | Journale Rot und Blau zusammenführen, auswerten (erkannt / nicht erkannt, Meldeverzug, blinde Flecken) und den AAR mit Folien und Lagekarte auf zwei Bildschirmen führen | online, KI optional |

Beide nutzen denselben Kern: LV95-Koordinaten, Führungsraster (Blatt- und Feld-Variante), Planquadrat-Erkennung, NATO-Zeichen (APP-6 / MIL-STD-2525) und ein Ereignismodell, das sich später von Gerät zu Gerät zusammenführen lässt.

**Live:** https://bubavanhalen.github.io/lage-tools/

## Grundsätze

- **Keine Übungsdaten im Repository.** Journale, Bilder, Raster und NAI einer Übung bleiben auf dem Gerät (Browser-Speicher oder Dateien). Testdaten sind fiktiv.
- **So einfach wie möglich.** Ein Eingabefeld, eine Karte, ein Zeitstrahl.
- **Offline zuerst** (Lagejournal). KI nur nach ausdrücklichem Einschalten pro Übung.
- **Karten:** swisstopo WMTS (LV95 / EPSG:2056), Quellenangabe «© swisstopo».

## Aufbau

```
packages/core   LV95, Raster, Planquadrate, Zeichen, Zeiten, Ereignismodell (ohne Abhängigkeiten, getestet)
packages/map    swisstopo-Karte in LV95 (Leaflet), Rasterebene, Zeichen-Icons (milsymbol)
packages/ui     gemeinsame React-Komponenten
apps/lagejournal        Produkt 1
apps/uebungsauswertung  Produkt 2
site/           Startseite
docs/           Konzept und Etappen
```

## Entwicklung

```bash
npm install
npm test                 # Kern-Tests
npm run dev:lagejournal  # http://localhost:5173
npm run build            # baut beide Apps nach _site/
```

Ein Push auf `main` baut, testet und veröffentlicht automatisch auf GitHub Pages
(Einstellung im Repo: *Settings → Pages → Source: GitHub Actions*).
