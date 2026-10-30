/**
 * Vorbereiten, Schritt 2 «Führungsraster» (Spez. MVP 1, Kap. 2.9, Texte 4.1): Raster anlegen (Rechteck auf der Karte
 * ziehen), Liste, Formular des gewählten Rasters, PDF A4/A3, Löschen mit Rückgängig. Aus `Workspace.tsx` herausgelöst
 * (vorher Reiter «Führungsraster»). Die Klassifizierung gilt für alle Raster und steht in Schritt 1.
 * MVP 3.5 (A6, Kap. 2.8): Raster «Feld» ohne Zoom ergäbe Felder von mehreren Kilometern – dann zuerst die Warnung
 * «Die Felder wären 4500 m gross (28 × 26 Felder)» mit Feldgrössen 250/500/1000 m und «Trotzdem 4500 m»; kein Raster ohne
 * diese Wahl. Geprüft schon beim Klick (sichtbarer Kartenausschnitt) und nach dem Aufziehen.
 */
import L from "leaflet";
import {
  blattFromRect,
  feldFromRect,
  makeBlattSheet,
  makeFeldSheet,
  nextPrefix,
  niceCellSize,
  referencePoint,
  sheetBounds,
  type Exercise,
  type RasterSheet,
} from "@lage/core";
import { drawRect, toLatLng, toLv95 } from "@lage/map";
import { useState } from "react";
import { safeFileName } from "../store";
import "./prepare.css";

export type SheetPatch = Partial<{ name: string; prefix: string; cellSize: number; cols: number; rows: number; basemap: "lk" | "img"; classification: string; quadrants: boolean }>;

/** Raster neu berechnen (Name, Anfangsbuchstabe, Feldgrösse, Spalten/Zeilen …), ID bleibt */
export function patchedSheet(old: RasterSheet, patch: SheetPatch): RasterSheet {
  const cols = patch.cols ?? old.colLabels.length, rows = patch.rows ?? old.rowLabels.length;
  const cell = patch.cellSize ?? old.cellW;
  let sh: RasterSheet;
  if (old.variant === "blatt") {
    const b = sheetBounds(old);
    const prefix = (patch.prefix ?? old.colLabels[0]!.slice(0, -1)).toUpperCase().slice(0, 1) || "A";
    sh = makeBlattSheet({ name: patch.name ?? old.name, prefix, center: { e: (b.minE + b.maxE) / 2, n: (b.minN + b.maxN) / 2 }, cellSize: cell, cols, rows, basemap: patch.basemap ?? old.basemap, classification: patch.classification ?? old.classification, quadrants: patch.quadrants ?? old.quadrants });
  } else {
    sh = makeFeldSheet({ name: patch.name ?? old.name, origin: old.origin, cellW: cell, cellH: cell, cols, rows, basemap: patch.basemap ?? old.basemap, classification: patch.classification ?? old.classification, quadrants: patch.quadrants ?? old.quadrants });
  }
  sh.id = old.id;
  sh.reference = referencePoint(sh);
  return sh;
}

export const rasterSummary = (s: RasterSheet) =>
  s.variant === "blatt" ? `${s.colLabels[0]}–${s.colLabels.at(-1)} · 1–${s.rowLabels.length}` : `A–${s.rowLabels.at(-1)} · 1–${s.colLabels.length}`;

export function fitSheet(map: L.Map, sh: RasterSheet) {
  const b = sheetBounds(sh);
  map.fitBounds(L.latLngBounds(toLatLng({ e: b.minE, n: b.minN }), toLatLng({ e: b.maxE, n: b.maxN })), { padding: [30, 30] });
}

/** Feld-Raster: so viele Felder pro Seite ergibt die automatische Feldgrösse */
const FELDER_PRO_SEITE = 30;
/** grösste übliche Feldgrösse einer Kp (m); darüber fragt «Feld» nach (A6) */
export const FELD_MAX_M = 1000;
/** wählbare Feldgrössen in der Warnung */
export const FELD_WAHL = [250, 500, 1000] as const;
/** höchstens so viele Spalten/Zeilen (wie im Formular) */
const FELD_MAX_ANZAHL = 60;

type Rechteck = { minE: number; maxE: number; minN: number; maxN: number };
/** automatische Feldgrösse und Felderzahl für ein Rechteck (reine Rechnung, testbar) */
export function feldVorschlag(r: Rechteck): { size: number; cols: number; rows: number; zuGross: boolean } {
  const size = niceCellSize(Math.max(r.maxE - r.minE, r.maxN - r.minN) / FELDER_PRO_SEITE);
  const cols = Math.max(1, Math.ceil((r.maxE - r.minE) / size)), rows = Math.max(1, Math.ceil((r.maxN - r.minN) / size));
  return { size, cols, rows, zuGross: size > FELD_MAX_M };
}
const sichtbar = (map: L.Map): Rechteck => {
  const v = map.getBounds();
  const a = toLv95(v.getSouthWest()), b = toLv95(v.getNorthEast());
  return { minE: Math.min(a.e, b.e), maxE: Math.max(a.e, b.e), minN: Math.min(a.n, b.n), maxN: Math.max(a.n, b.n) };
};

export interface RasterPanelProps {
  ex: Exercise;
  map: L.Map;
  update(f: (x: Exercise) => Exercise): void;
  say(t: string): void;
  offerUndo(label: string, restore: () => void): void;
  selected: string | null;
  onSelect(id: string | null): void;
  /** Hinweis über der Karte während des Zeichnens (null = keiner) */
  setDrawing(t: string | null): void;
  setBusy(t: string | null): void;
}

export function RasterPanel({ ex, map, update, say, offerUndo, selected, onSelect, setDrawing, setBusy }: RasterPanelProps) {
  const hasBlatt = ex.sheets.some((s) => s.variant === "blatt");
  const sel = ex.sheets.find((s) => s.id === selected) ?? null;

  /** Warnung «Felder zu gross» (A6): mit aufgezogenem Rechteck oder vor dem Aufziehen (sichtbarer Ausschnitt) */
  const [warn, setWarn] = useState<{ rect: Rechteck | null; size: number; cols: number; rows: number } | null>(null);

  const place = (sh: RasterSheet) => {
    // Klassifizierung gilt für alle Raster (Schritt 1)
    const cls = ex.sheets[0]?.classification;
    if (cls) sh.classification = cls;
    update((x) => { x.sheets.push(sh); return x; });
    onSelect(sh.id);
    fitSheet(map, sh);
  };

  /** Feld-Raster mit Feldgrösse `size` (null = automatisch); `frage` = bei zu grossen Feldern zuerst warnen */
  const feld = (r: Rechteck, size: number | null, frage: boolean) => {
    const v = feldVorschlag(r);
    if (size === null && frage && v.zuGross) { setWarn({ rect: r, size: v.size, cols: v.cols, rows: v.rows }); return; }
    const s = size ?? v.size;
    const cols = Math.ceil((r.maxE - r.minE) / s), rows = Math.ceil((r.maxN - r.minN) / s);
    if (cols > FELD_MAX_ANZAHL || rows > FELD_MAX_ANZAHL) {
      say(`Mit ${s} m wären es ${cols} × ${rows} Felder – kleineren Raum aufziehen oder grössere Felder wählen.`);
      setWarn({ rect: null, size: v.size, cols: v.cols, rows: v.rows });
      return;
    }
    setWarn(null);
    place(feldFromRect(r, "AOR", s));
  };

  const drawFeld = async (size: number | null, frage: boolean) => {
    setWarn(null);
    setDrawing(size ? `Einfaches Raster (Felder ${size} m): Rechteck über den Raum aufziehen` : "Einfaches Raster: Rechteck über den Raum aufziehen (vorher hinzoomen)");
    const r = await drawRect(map);
    setDrawing(null);
    if (r) feld(r, size, frage);
  };

  const addSheet = async (kind: "gesamt" | "detail" | "feld") => {
    if (kind === "feld") {
      // schon vor dem Aufziehen: ohne Zoom wären die Felder Kilometer gross (Erstbenutzer M3)
      const v = feldVorschlag(sichtbar(map));
      if (v.zuGross) { setWarn({ rect: null, size: v.size, cols: v.cols, rows: v.rows }); return; }
      await drawFeld(null, true);
      return;
    }
    setWarn(null);
    setDrawing(kind === "gesamt" ? "Raster über ganzen Raum: Rechteck auf der Karte aufziehen (vorher hinzoomen)" : "Detailblatt: Rechteck über den Ausschnitt aufziehen");
    const r = await drawRect(map);
    setDrawing(null);
    if (!r) return;
    const prefix = kind === "gesamt" ? nextPrefix(ex.sheets, "A") : nextPrefix(ex.sheets, "U");
    place(blattFromRect(r, kind === "gesamt" ? "GESAMT" : `BLATT ${prefix}`, prefix));
  };

  /** Wahl in der Warnung: Feldgrösse → (Rechteck da) sofort anlegen bzw. aufziehen; «Trotzdem» → automatische Grösse */
  const waehle = (size: number | null) => {
    const w = warn;
    if (!w) return;
    if (w.rect) { feld(w.rect, size ?? w.size, false); return; }
    void drawFeld(size, false);
  };

  const patch = (id: string, p: SheetPatch) => update((x) => {
    const i = x.sheets.findIndex((s) => s.id === id);
    const old = x.sheets[i];
    if (old) x.sheets[i] = patchedSheet(old, p);
    return x;
  });

  const pdf = async (sh: RasterSheet, paper: "A4" | "A3") => {
    setBusy("Karte wird geladen … 0 %");
    try {
      const { printSheet } = await import("../pdf");
      const blob = await printSheet(sh, { paper, areas: ex.areas, onProgress: (p) => setBusy(`Karte wird geladen … ${Math.round(p * 100)} %`) });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Fhr_Raster_${safeFileName(sh.name)}_${paper}.pdf`;
      a.click();
    } catch (e) {
      say("PDF konnte nicht erstellt werden: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const del = (gone: RasterSheet) => {
    const i = ex.sheets.findIndex((s) => s.id === gone.id);
    update((x) => { x.sheets = x.sheets.filter((s) => s.id !== gone.id); return x; });
    onSelect(null);
    offerUndo(`Raster «${gone.name}» gelöscht`, () => update((x) => { if (!x.sheets.some((s) => s.id === gone.id)) x.sheets.splice(Math.min(i, x.sheets.length), 0, gone); return x; }));
  };

  return (
    <div className="pp">
      {ex.sheets.length === 0 && <p className="pp-empty">Noch kein Führungsraster. Wähle eine Art und ziehe auf der Karte ein Rechteck.</p>}
      <div className="pp-btns">
        <button type="button" className="pp-btn primary" onClick={() => addSheet(hasBlatt ? "detail" : "gesamt")}>{hasBlatt ? "Ausschnitt genauer (Detailblatt)" : "Raster über ganzen Raum (Blatt)"}</button>
        <button type="button" className="pp-btn" onClick={() => addSheet("feld")}>Einfaches Raster (Feld)</button>
      </div>
      {warn && (
        <div className="pp-warn pp-feldwarn" role="alert">
          <p>⚠ Die Felder wären {warn.size} m gross ({warn.cols} × {warn.rows} Felder). Für eine Kp üblich: 250–1000 m.</p>
          <p>{warn.rect ? "Feldgrösse wählen:" : "Erst in den Raum hineinzoomen oder Feldgrösse wählen:"}</p>
          <div className="pp-btns">
            {FELD_WAHL.map((g) => <button key={g} type="button" className="pp-btn" onClick={() => waehle(g)}>{g} m</button>)}
            <button type="button" className="pp-btn" onClick={() => waehle(null)}>Trotzdem {warn.size} m</button>
          </div>
        </div>
      )}
      {ex.sheets.length > 0 && (
        <ul className="pp-list">
          {ex.sheets.map((s) => (
            <li key={s.id} className={s.id === selected ? "sel" : ""}>
              <button type="button" className="pp-row" aria-pressed={s.id === selected} onClick={() => { onSelect(s.id === selected ? null : s.id); fitSheet(map, s); }}>
                <b>{s.name}</b>
                <span className="mono">{rasterSummary(s)} · {s.cellW} m</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {sel && <SheetForm sheet={sel} onPatch={(p) => patch(sel.id, p)} onPdf={(paper) => pdf(sel, paper)} onDelete={() => del(sel)} />}
    </div>
  );
}

const CELL_OPTIONS = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1500, 2000];

function SheetForm({ sheet, onPatch, onPdf, onDelete }: {
  sheet: RasterSheet;
  onPatch: (p: SheetPatch) => void;
  onPdf: (paper: "A4" | "A3") => void;
  onDelete: () => void;
}) {
  const prefix = sheet.variant === "blatt" ? sheet.colLabels[0]!.slice(0, -1) : "";
  const cells = CELL_OPTIONS.includes(sheet.cellW) ? CELL_OPTIONS : [...CELL_OPTIONS, sheet.cellW].sort((a, b) => a - b);
  return (
    <div className="pp-form">
      <label>Name des Rasters<input value={sheet.name} onChange={(e) => onPatch({ name: e.target.value })} /></label>
      {sheet.variant === "blatt" && (
        <label>Anfangsbuchstabe der Spalten<input value={prefix} maxLength={1} onChange={(e) => onPatch({ prefix: e.target.value })} className="short mono" /></label>
      )}
      <label>Feldgrösse
        <select value={sheet.cellW} onChange={(e) => onPatch({ cellSize: +e.target.value })}>
          {cells.map((v) => <option key={v} value={v}>{v} m</option>)}
        </select>
      </label>
      <div className="pp-two">
        <label>Spalten<input type="number" min={2} max={sheet.variant === "blatt" ? 26 : 60} value={sheet.colLabels.length} onChange={(e) => onPatch({ cols: Math.max(2, +e.target.value || 2) })} /></label>
        <label>Zeilen<input type="number" min={2} max={60} value={sheet.rowLabels.length} onChange={(e) => onPatch({ rows: Math.max(2, +e.target.value || 2) })} /></label>
      </div>
      <label>Karte auf dem Ausdruck
        <select value={sheet.basemap} onChange={(e) => onPatch({ basemap: e.target.value as "lk" | "img" })}>
          <option value="lk">Landeskarte</option>
          <option value="img">Luftbild</option>
        </select>
      </label>
      <label className="pp-check"><input type="checkbox" checked={sheet.quadrants} onChange={(e) => onPatch({ quadrants: e.target.checked })} /> Planquadrate vierteln (A B / D C)</label>
      <div className="pp-btns">
        <button type="button" className="pp-btn" onClick={() => onPdf("A4")}>Drucken A4 (PDF)</button>
        <button type="button" className="pp-btn" onClick={() => onPdf("A3")}>Drucken A3 (PDF)</button>
        <button type="button" className="pp-btn" onClick={onDelete}>Raster löschen</button>
      </div>
    </div>
  );
}
