# MVP 1 «Lage führen»: Zuständigkeiten und Regeln

Grundlage: Spezifikation MVP 1, Kap. 6 (Pakete) und 7 (Abnahme). Phase 0 hat Verträge, Tokens, Testzugang und Abnahme-Gerüst gelegt. Die Pakete A–D bauen jetzt parallel.

## Wer besitzt welche Dateien

| Paket | Neu | Umbau (allein zuständig) |
|---|---|---|
| **A** Hülle, Modi, Menü, Vorbereiten | `shell/AppShell.tsx`, `shell/Header.tsx`, `shell/MainMenu.tsx`, `shell/mode.ts`, `shell/shell.css`, `shell/ExerciseList.tsx`, `prepare/*` (PrepareMode, RasterPanel, TruppsPanel, FeindannahmeEdit, OfflineStep), `offlineStatus.ts` | **`Workspace.tsx` (nur A)**, `style.css`, `MapToolbar.tsx`, `layers.ts`, `OfflineBox.tsx`, `NaiPanel.tsx`, `MapContextMenu.tsx` |
| **B** Meldungsfeld, Korrektur, Liste, Suche | `entry/*` (EntryBox, TruppChips, PreviewLine, HelpPopover, useEntryDraft, entry.css), `journal/*` (JournalList, UnifiedSearch, journal.css) | `JournalPanel.tsx`, `MapSearch.tsx`, `commit.ts`, `QualityMarks.tsx`, `journalpdf.ts`, `MapOverlays.tsx`, Kern: `entrystate.ts`, `correctEvent`/`history` (`journal.ts`, `model.ts`), `journalToCsv` |
| **C** Zeit und ruhige Karte | `time/*` (useLageZeit, TimeBand, RueckblickBanner, time.css), `map/quiet.ts` | `SwimTimeline.tsx`, `swimtimeline.css`, `mapedit.tsx`, `situationLayer.ts`, `shapeLayer.ts`, `hintLayer.ts`, `coaLayer.ts`, `mapoverlays.css`, Kern: `timewindow.ts`, `packages/map` |
| **D** Klartext, «Was Rot», Farbe | `red/*` (RedPanel, RedCard, RedDetail, red.css) | `HintsPanel.tsx`, `LageRotPanel.tsx`, `hintsData.ts`, `hints.css`, `lagerot.css`, Farbersatz in `batch.css`, `photo.css`, `voice.css`, `symbolpicker.css`, `roadchoice.css`, `shapes.css`, `navigation.css`, `ki/ki.css`, Kern: `klartext.ts`, `hints.ts` (`headline`/`todo`), `coa.ts` (`headline`) |
| **Koordinator** | – | `shell/contracts.ts`, `theme.css`, `colors.ts`, `beispiel.ts`, `apps/lagejournal/e2e/*`, `test/tokens.test.ts` |

Alles, was hier nicht steht, gehört niemandem allein. Vor dem Ändern einer solchen Datei: im Schlussbericht ankündigen, nur kleine, in sich geschlossene Änderungen.

## Regeln für gemeinsame Dateien

- **`contracts.ts`**: nur ergänzen (neue optionale Felder `?`, neue Typen), nie umbenennen oder entfernen. Wer einen Vertrag ändern muss, meldet es dem Koordinator mit Code im Bericht.
- **`theme.css` / `colors.ts`**: keine neuen Grundfarben. Neue Ableitungen (z. B. `color-mix`) gehören in die eigene CSS-Datei. Die Blöcke `vertrag:hell|dunkel … vertrag:ende` liest `test/tokens.test.ts`. Ändert sich dort ein Wert, muss `colors.ts` mitziehen.
- **Übergangs-Tokens** (`--paper --card --grid --hi --rot --rot-soft --blau --blau-soft --warn --m-*`) nur noch ersetzen, nie neu verwenden. Phase 0 hat alle `var(--line)` mechanisch in `var(--line-soft)` umbenannt (gleicher Wert wie vorher). Rahmen von **Bedienelementen** stellt jedes Paket in seinen Dateien bewusst auf `var(--line)` um (≥ 3:1).
- **Hex-Farben**: `test/tokens.test.ts` führt die heutigen Verstösse je Datei (`BEKANNT`). Die Zahlen nur senken (wenn du Hex-Farben in deinen Dateien ersetzt, senkst du die Zahl dort). Neue Hex-Farben sind ein Testfehler.
- **Kern** (`packages/core`): ohne Laufzeit-Abhängigkeiten, jede neue Funktion mit vitest-Test. Bestehende Signaturen bleiben, `title` von Hinweisen und Möglichkeiten bleibt für CSV/PDF/Tests unverändert.
- Eigene Styles in eigener CSS-Datei, in der Komponente importiert. Typografie nur `--fs-12/14/16/20/28`, Abstände `--sp-*`, Radien `--r-4/--r-8/--r-pill`, Bedienelemente `min-height: var(--hit)`.
- Kein `git commit`, kein `git push`, kein `npm install`. Eigener Build-Ordner und eigener Port pro Paket.

## Testhaken (stabil, nur lesen)

| Attribut | Wo | Werte |
|---|---|---|
| `data-zaehl="<gruppe>"` | Segmente, Chipreihen, Zoom ± | Alle Bedienelemente mit gleichem nächstem `data-zaehl` zählen im Inventar als 1 |
| `data-zustand` | Vorschau-Block des Meldungsfelds (B) | `bereit` · `pruefen` · `geht-nicht` (= `EntryState.level`) |
| `data-lagezeit` | `.app` (A, Wert von C) | `live` · `rueckblick` |

Keine `data-testid` für Abnahmeschritte: Die Abnahme klickt nur über sichtbaren Klartext (`getByRole(…, { name })`, `getByText`, `getByPlaceholder("Was wurde gemeldet?")`). Texte aus Kap. 4 also wörtlich übernehmen. Die Journal-Liste braucht die Klasse `.jlist` mit `li` je Zeile (Inventar und Abnahme lesen sie).

## Testzugang und Prüfen

- `?beispiel` lädt Beispiel Bern (fiktiv, 20 Meldungen, T2 = 2030-05-15). `?beispiel=leer` lädt dieselbe Vorbereitung ohne Meldungen (eigene ID `ex-beispiel-bern-leer`). Beide ersetzen nur sich selbst, der Parameter verschwindet danach aus der Adresse (`beispiel.ts`).
- Harness: `node …/scratchpad/harness/shot.js out.png URL --demo` (= `?beispiel`), `--beispiel leer`, `--uhr 2030-05-15T07:30:00+02:00`. Alte Variante: `--demo-select`.
- Abnahme: `npm run e2e` (Root) baut eine Kopie nach `apps/lagejournal/e2e/out/site`, serviert sie auf Port 9050 (`--port N`) und schreibt `e2e/out/<spec>.json` und Screenshots. Weitere Optionen: `--nur inventar,kontrast`, `--ohne-build`, `--echte-kacheln`. Es braucht Node ≥ 22.18 und das globale Playwright. Rot ist bis Phase 2 erlaubt.
- Vor Abgabe: `npm test`, `npx tsc -p packages/core --noEmit`, `npx tsc -p packages/ui --noEmit` (bekannt: pdfjs `?url`), Typen der App.
