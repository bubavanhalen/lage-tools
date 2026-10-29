# MVP 3 «LVZ-Betrieb»: Zuständigkeiten und Regeln

Grundlage: Spezifikation MVP 3 (Kap. 5 Verträge, 6.2 Pakete, 8 Abnahme) und die Entscheide des Kunden vom 29.10.2026
(Kap. 9, im Code `packages/core/src/entscheide.ts`). Phase 0 hat die Verträge gelegt; die Pakete A–D bauen parallel.
Die Regeln für gemeinsame Dateien, Tokens und Hex-Farben aus MVP 1 (unten) gelten weiter.

## Wer besitzt welche Dateien (Kap. 6.2)

| Paket | Neu | Umbau (allein zuständig) |
|---|---|---|
| **A** Kern: Arten, Felder, LVZ, Nummern, Zusammenführen | – (Phase-0-Dateien ausbauen: `arten.ts`, `felder.ts`, `lvz.ts`, `nummer.ts`, `schicht.ts` + Tests) | nur `packages/core`: `journal.ts` (`parseMeldung` mit `readMeldeFelder` → `readArt`, `asNonLageDraft`, Zeitregel Nicht-Meldungen, Bezug/Aufheben über `ctx.events`, `situationAt` mit `liftMap`, `journalToCsv`, `situationIndex`), `model.ts`, `entrystate.ts`, `hints.ts`, `redforce.ts`/`coa.ts` (`isLage`), `sync.ts`, `exercise.ts`, `catalog.ts`, `funk.ts`, `erkennung.ts`, `entscheide.ts` |
| **B** Eingabe und Journal-Liste | `entry/ArtSwitch.tsx`, `entry/KuerzelAsk.tsx`, `journal/LvzMenu.tsx`, `journal/lvz.css` | `entry/*` (PreviewLine, useEntryDraft, EntryBox, stateOptions, labels, entry.css), `journal/*` (JournalList, filter, actions, UnifiedSearch, journal.css), `JournalPanel.tsx`, `commit.ts`, `BatchReview.tsx`, `QualityMarks.tsx` |
| **C** Offen, Übergabe, Hülle, Zeit | `lvzui/*` (OffenPanel, OffenTabLabel, UebergabeView, uebergabePdf, useSchicht, lvzui.css), `MergeNotice.tsx` | **`Workspace.tsx` (nur C)**, `shell/AppShell.tsx`, `shell/Header.tsx`, `shell/MainMenu.tsx`, `SaveBand.tsx`, `time/*` (useLageZeit, TimeBand), `MapToolbar.tsx`, `red/RedCard.tsx`, `ki/KiFeatures.tsx`, `prepare/PrepareMode.tsx`; e2e-Fälle nach Abschluss von `inventar3` nach `inventar.spec.ts` übernehmen |
| **D** Druck und Leistung | `print/*` (lagekarte, LagekarteDialog, JournalDruckDialog, print.css), `analyse.worker.ts`, `perf.ts` | `journalpdf.ts`, `hintsExport.ts`, `lageRotExport.ts`, `pdfSafe.ts`, `offline.ts` (`tileCoverage`), `tiles.ts`, `hintsData.ts`, `lageRot.ts`, `situationLayer.ts`, `shapeLayer.ts`, `MapOverlays.tsx`, `persist.ts`, `store.ts`, `useExerciseStore.ts` |
| **Koordinator** | – | `shell/contracts.ts`, `beispiel.ts`, `theme.css`, `colors.ts`, `apps/lagejournal/e2e/*`, `docs/KONZEPT.md` |

Absprachen über `<scratchpad>/mvp3-notizen.md` (je Paket ein Abschnitt). Build-Ordner `<scratchpad>/mvp3-<paket>/site`,
Ports A 9171, B 9172, C 9173, D 9174. B arbeitet gegen die Phase-0-Stände von `readArt`/`Draft`, D gegen `liftMap`,
`isLage`, `nrLabel`, `artText` (liefern schon sinnvolle Werte). C verdrahtet `LvzMenu` nicht selbst – B hängt es in
`JournalList` ein; C liefert `SchichtApi` und `onNr` an `EntryBox`/`JournalPanel` (`JournalListProps.lvz`).

## Verträge (Phase 0)

- **Kern** (`@lage/core`): `EntryArt`, `Stamp`, `LvzVermerke`, `MeldeFelder`, `SchichtWechsel`, neue optionale Felder an
  `LageEvent`/`EventRevision`/`Exercise` (model.ts); `mergeEventPair`, `mergeLvz` (model.ts, `lvz` zählt nie als
  Konflikt); `artOf`, `isLage`, `lebenszeichen`, `artText`, `readArt`, `istDringend` (arten.ts); `readMeldeFelder`,
  `felderZuText` (felder.ts); `nextNr`, `nrLabel`, `findByNr`, `nrDoppelte`, `doppeltText` (nummer.ts); `setVermerk`,
  `vermerkeOf`, `lvzIndex`, `liftMap`, `istAufhebbar`, `aufhebZiele`, `offenePunkte` (lvz.ts); `aktuelleSchicht`,
  `schichtenIm`, `lageBlau`, `rapportZahlen`, `zaehleMeldungen` (schicht.ts); `demoLang` (demolang.ts);
  `Draft.art/artFrom/…`, `JournalContext.art/events/ex`, `eventFromDraft(d, device, now, { nr, kuerzel })` (journal.ts);
  neue `EntryReasonCode`s und `EntryStateOptions.follow/lastReport` (entrystate.ts); `MergeReport.doppelt` (sync.ts).
- **UI** (`contracts.ts`, Abschnitt MVP 3): `ShowLast` + 360, `SideView` mit «offen», `SearchArt` erweitert,
  `SchichtApi`, `SCHICHT_KEY`/`SchichtLokal`, `NR_KEY`, `kuerzelNorm`, `LvzRowProps`, `OffenPanelProps`,
  `UebergabeProps`, `JournalDruck`, `LagekarteDruck`, `TileCoverage`, `klassifizierungOf`, Worker-Nachrichten
  `AnalyseAuftrag`/`AnalyseErgebnis`, `PERF_MARK`, `LtPerf`, `LtPdfInfo` (`window.__ltPerf`, `window.__ltPdfInfo`).
- Rückwärtskompatibel (Kap. 5.5, Test `packages/core/test/mvp3kompat.test.ts`): alles optional, `FILE_VERSION` 1,
  nichts wird beim Öffnen geschrieben; Nicht-Meldungen tragen `notiz: true` und nie einen Ort.

## Entscheide des Kunden (Kap. 9) – nur in `entscheide.ts` ändern

1. **Laufende Nummer:** eine gemeinsame Folge, kein Gerätebuchstabe. Fenster teilen den Zähler (`NR_KEY`); nach Öffnen/
   Zusammenführen weiter ab der höchsten bekannten Nummer. Gleiche Nummer von zwei Geräten offline **bleibt**; Anzeige
   «12a/12b» (nach Eingang), Rückmeldung «2 Nummern doppelt – als 12a/12b gekennzeichnet». Alles in `nummer.ts`.
2. **AEIOU-Feld E ist immer das Gesehene**, nie der Melder (Melder aus Trupp-Knopf, Text vor «A:», «Melder:»/«Von:»).
3. **«Trupp still»** ab 60 min (`STILL_MIN`). 4. **Journal drucken:** Standard laufende Schicht, sonst ganzer Tag
   (`journalDruckVorwahl`). 5. **Quittung** = Notiz mit Bezug, erledigt erst mit «ausgeführt»/Knopf.

## Testhaken MVP 3 (stabil, nur lesen)

| Haken | Wo (Paket) | Werte |
|---|---|---|
| `data-zaehl="art"` | Auswahl «Was ist es?» in der Vorschau (B) | ersetzt `einordnung` |
| `data-art`, `data-nr` | `.jl-row` (B) | `EntryArt` · Anzeige-Nummer («54», «12a») |
| `[role=dialog][aria-label="Übergabe"]` | Übergabe-Seite (C) | Text und Wörter werden darin gelesen |
| Klasse `jl-trenner` | Trenner «Neu in deiner Schicht ↑» (B) | kein `li` |
| `window.__ltPerf()` | `perf.ts` (D) | `LtPerf` |
| `window.__ltPdfInfo` | letztes PDF (D, C für Übergabe-PDF) | `LtPdfInfo` |
| Tab «Offen n» | Umschalter `role="tab"` (C) | Name beginnt mit «Offen» |
| Feld «Kürzel» | Kürzel-Abfrage (B), `aria-label`/`label` «Kürzel» | Abfragetext «Wer erfasst?» |

## Testzugang und Abnahme

- `?beispiel` setzt zusätzlich die fiktive Schicht «BSP» seit T2 06:00 auf dem Gerät (`localStorage[SCHICHT_KEY]`,
  `ex.schichten`), `?beispiel=leer` keine. **`?beispiel=lang`**: 800 Einträge über 4 Tage (T1 15.05.2030 06:00 –
  T4 18.05.2030 07:30), alle Arten, 12 Übergaben, Schicht BSP seit T4 06:00; Uhr für Tests `UHR_T4_0730`.
- Harness: `shot.js … --beispiel lang`.
- `npm run e2e` führt alle `*.spec.ts` aus. Neu (dürfen bis Phase 2 rot sein): `arten`, `lvz`, `uebergabe`, `druck`,
  `leistung`, `lang`, `inventar3`, `kontrast3`. Bestehende (`erstbenutzer`, `inventar`, `kontrast`) bleiben grün.
  Einzeln: `npm run e2e -- --nur arten,lvz`.

---

# MVP 1 «Lage führen»: Zuständigkeiten und Regeln (abgeschlossen, Regeln gelten weiter)

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
