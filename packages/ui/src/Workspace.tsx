import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  blattFromRect,
  cellAtAny,
  exerciseFromFile,
  exerciseToFile,
  feldFromRect,
  formatLv95,
  makeBlattSheet,
  makeFeldSheet,
  newExercise,
  nextPrefix,
  niceCellSize,
  referencePoint,
  sheetBounds,
  type Area,
  type Exercise,
  type LV95,
  type RasterSheet,
  wgs84ToLv95,
} from "@lage/core";
import {
  AffineImageLayer,
  areasLayer,
  toLatLng,
  createSwissMap,
  drawRect,
  rasterLayer,
  toLv95,
  type Basemap,
  type SwissMap,
} from "@lage/map";
import { currentExerciseId, downloadText, listExercises, loadExercise, pickFile, safeFileName, saveExercise } from "./store";
import { NaiPanel } from "./NaiPanel";
import { GeorefPane } from "./GeorefPane";
import type { Candidate } from "./imageimport";

interface Props {
  product: string;
  tagline: string;
}

type Tab = "raster" | "nai";
type SheetPatch = Partial<{ name: string; prefix: string; cellSize: number; cols: number; rows: number; basemap: "lk" | "img"; classification: string; quadrants: boolean }>;

export function Workspace({ product, tagline }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const sm = useRef<SwissMap | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [ex, setEx] = useState<Exercise | null>(null);
  const [saved, setSaved] = useState<Array<{ id: string; name: string }>>([]);
  const [tab, setTab] = useState<Tab>("raster");
  const [basemap, setBasemap] = useState<Basemap>("lk");
  const [selSheet, setSelSheet] = useState<string | null>(null);
  const [selArea, setSelArea] = useState<string | null>(null);
  const [cursor, setCursor] = useState<LV95 | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [georef, setGeoref] = useState<Candidate[] | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const say = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), 4000);
  }, []);

  // Übung laden
  useEffect(() => {
    (async () => {
      const id = await currentExerciseId();
      const loaded = id ? await loadExercise(id) : null;
      setEx(loaded ?? newExercise());
      setSaved(await listExercises());
    })();
  }, []);

  // Speichern (verzögert)
  useEffect(() => {
    if (!ex) return;
    const t = window.setTimeout(async () => {
      await saveExercise(ex);
      setSaved(await listExercises());
    }, 400);
    return () => window.clearTimeout(t);
  }, [ex]);

  // Karte
  useEffect(() => {
    if (!el.current || sm.current) return;
    const s = createSwissMap(el.current, { center: { e: 2660000, n: 1190000 }, zoom: 16 });
    sm.current = s;
    s.map.on("mousemove", (ev: L.LeafletMouseEvent) => setCursor(toLv95(ev.latlng)));
    setMapReady(true);
  }, [ex === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { sm.current?.map.remove(); sm.current = null; }, []);

  // Ebenen neu zeichnen
  useEffect(() => {
    const s = sm.current;
    if (!s || !ex) return;
    layerRef.current?.remove();
    const g = L.layerGroup();
    for (const o of ex.overlays ?? []) if (o.visible) g.addLayer(new AffineImageLayer(o.dataUrl, o.width, o.height, o.affine, o.opacity));
    for (const sh of ex.sheets) g.addLayer(rasterLayer(s.map, sh, { color: sh.id === selSheet ? "#c8102e" : "#1d1d1d" }));
    g.addLayer(areasLayer(ex.areas, { selectedId: selArea ?? undefined, onClick: (a) => { setTab("nai"); setSelArea(a.id); } }));
    g.addTo(s.map);
    layerRef.current = g;
  }, [ex, selSheet, selArea, mapReady]);

  const fitSheet = (sh: RasterSheet) => {
    const b = sheetBounds(sh);
    sm.current?.fitLv95({ e: b.minE, n: b.minN }, { e: b.maxE, n: b.maxN }, 30);
  };
  const fitAll = (x: Exercise) => {
    const pts: LV95[] = [];
    x.sheets.forEach((s) => { const b = sheetBounds(s); pts.push({ e: b.minE, n: b.minN }, { e: b.maxE, n: b.maxN }); });
    x.areas.forEach((a) => pts.push(...a.ring));
    if (!pts.length) return;
    sm.current?.fitLv95({ e: Math.min(...pts.map((p) => p.e)), n: Math.min(...pts.map((p) => p.n)) }, { e: Math.max(...pts.map((p) => p.e)), n: Math.max(...pts.map((p) => p.n)) }, 30);
  };
  useEffect(() => { if (ex && sm.current) fitAll(ex); /* nur beim Laden */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex?.id, mapReady]);

  const update = (f: (x: Exercise) => Exercise) => setEx((x) => (x ? f(structuredClone(x)) : x));

  // ---------- Raster ----------
  const addSheet = async (kind: "gesamt" | "detail" | "feld") => {
    const s = sm.current;
    if (!s || !ex) return;
    setDrawing(kind === "gesamt" ? "Gesamtblatt: Rechteck über den ganzen Raum aufziehen (vorher hinzoomen)" : kind === "detail" ? "Detailblatt: Rechteck über den Ausschnitt aufziehen" : "Feld-Raster: Rechteck über den Raum aufziehen (vorher hinzoomen)");
    const r = await drawRect(s.map);
    setDrawing(null);
    if (!r) return;
    let sh: RasterSheet;
    if (kind === "feld") {
      const size = niceCellSize(Math.max(r.maxE - r.minE, r.maxN - r.minN) / 30);
      sh = feldFromRect(r, "AOR", size);
    } else {
      const prefix = kind === "gesamt" ? nextPrefix(ex.sheets, "A") : nextPrefix(ex.sheets, "U");
      sh = blattFromRect(r, kind === "gesamt" ? "GESAMT" : `BLATT ${prefix}`, prefix);
    }
    update((x) => { x.sheets.push(sh); return x; });
    setSelSheet(sh.id);
    fitSheet(sh);
  };

  const patchSheet = (id: string, patch: SheetPatch) =>
    update((x) => {
      const i = x.sheets.findIndex((s) => s.id === id);
      const old = x.sheets[i];
      if (!old) return x;
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
      x.sheets[i] = sh;
      return x;
    });

  const pdf = async (sh: RasterSheet, paper: "A4" | "A3") => {
    setBusy("Karte wird geladen … 0 %");
    try {
      const { printSheet } = await import("./pdf");
      const blob = await printSheet(sh, { paper, areas: ex?.areas, onProgress: (p) => setBusy(`Karte wird geladen … ${Math.round(p * 100)} %`) });
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

  // ---------- Datei ----------
  const saveFile = () => ex && downloadText(`${safeFileName(ex.name)}.lage.json`, exerciseToFile(ex));
  const openFile = async () => {
    const f = await pickFile(".json,.lage.json,application/json");
    if (!f) return;
    try {
      const x = exerciseFromFile(await f.text());
      setEx(x);
      setSelSheet(null);
      say(`«${x.name}» geladen`);
    } catch (e) {
      say((e as Error).message);
    }
  };

  const onGeorefAreas = (areas: Area[]) => {
    update((x) => { x.areas.push(...areas); return x; });
    say(`${areas.length} Fläche${areas.length === 1 ? "" : "n"} übernommen`);
  };

  if (!ex) return <div className="app"><div className="loading">Wird geladen …</div></div>;
  const cell = cursor ? cellAtAny(ex.sheets, cursor) : null;
  const sel = ex.sheets.find((s) => s.id === selSheet) ?? null;
  const hasBlatt = ex.sheets.some((s) => s.variant === "blatt");

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <strong>{product}</strong>
          <span className="tag">{tagline}</span>
        </div>
        <div className="tools">
          <input className="exname" value={ex.name} onChange={(e) => update((x) => { x.name = e.target.value; return x; })} aria-label="Name der Übung" />
          <select aria-label="Gespeicherte Übungen" value="" onChange={async (e) => {
            const v = e.target.value;
            if (v === "__new") { const x = newExercise(); setEx(x); setSelSheet(null); return; }
            const x = await loadExercise(v);
            if (x) { setEx(x); setSelSheet(null); }
          }}>
            <option value="" disabled>Übungen …</option>
            <option value="__new">+ Neue Übung</option>
            {saved.filter((s) => s.id !== ex.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={openFile}>Öffnen</button>
          <button onClick={saveFile}>Speichern</button>
        </div>
      </header>
      <div className="work">
        <aside className="side">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "raster"} onClick={() => setTab("raster")}>Führungsraster</button>
            <button role="tab" aria-selected={tab === "nai"} onClick={() => setTab("nai")}>NAI / BNB</button>
          </div>
          {georef ? (
            <GeorefPane candidates={georef} map={sm.current!.map} existing={ex.areas} onAreas={onGeorefAreas} onClose={() => { setGeoref(null); setTab("nai"); }} />
          ) : tab === "raster" ? (
            <div className="panel">
              {ex.sheets.length === 0 && (
                <div className="empty">
                  <p>Noch kein Führungsraster. Wähle eine Variante und ziehe auf der Karte ein Rechteck über den Raum.</p>
                </div>
              )}
              <div className="btnrow">
                <button className="primary" onClick={() => addSheet(hasBlatt ? "detail" : "gesamt")}>{hasBlatt ? "+ Detailblatt" : "+ Blatt-Raster (Gesamtblatt)"}</button>
                <button onClick={() => addSheet("feld")}>+ Feld-Raster</button>
              </div>
              <ul className="list">
                {ex.sheets.map((s) => (
                  <li key={s.id} className={s.id === selSheet ? "sel" : ""}>
                    <button className="row" onClick={() => { setSelSheet(s.id); fitSheet(s); }}>
                      <b>{s.name}</b>
                      <span className="mono">{s.variant === "blatt" ? `${s.colLabels[0]}–${s.colLabels.at(-1)} · 1–${s.rowLabels.length}` : `A–${s.rowLabels.at(-1)} · 1–${s.colLabels.length}`} · {s.cellW} m</span>
                    </button>
                  </li>
                ))}
              </ul>
              {sel && <SheetForm sheet={sel} onPatch={(p) => patchSheet(sel.id, p)} onPdf={(paper) => pdf(sel, paper)}
                onDelete={() => { update((x) => { x.sheets = x.sheets.filter((s) => s.id !== sel.id); return x; }); setSelSheet(null); }} />}
            </div>
          ) : (
            <NaiPanel exercise={ex} selected={selArea} onSelect={(id) => setSelArea(id)} map={sm.current!.map}
              onChange={(areas: Area[]) => update((x) => { x.areas = areas; return x; })}
              onOverlays={(o) => update((x) => { x.overlays = o; return x; })}
              onImage={(c) => setGeoref(c)} say={say} />
          )}
        </aside>
        <main className="mapwrap">
          <div ref={el} className="map" />
          <div className="maptools">
            <PlaceSearch onGo={(p) => sm.current?.map.setView(toLatLng(p), 21)} />
            <div className="seg" role="group" aria-label="Kartengrundlage">
              {(["lk", "img", "grau"] as Basemap[]).map((b) => (
                <button key={b} aria-pressed={basemap === b} onClick={() => { setBasemap(b); sm.current?.setBasemap(b); }}>
                  {b === "lk" ? "Landeskarte" : b === "img" ? "Luftbild" : "Grau"}
                </button>
              ))}
            </div>
          </div>
          {drawing && <div className="hint">{drawing} · Esc = Abbrechen</div>}
          <div className="status mono" aria-live="polite">
            {cursor ? <>{formatLv95(cursor)}{cell ? <> · <b>{cell.label}</b></> : null}</> : "Maus über die Karte bewegen"}
          </div>
        </main>
      </div>
      {busy && <div className="busy"><div>{busy}</div></div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/** Ortssuche über den Suchdienst von swisstopo (nur online). */
function PlaceSearch({ onGo }: { onGo: (p: LV95) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ label: string; p: LV95 }>>([]);
  const chosen = useRef<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2 || q === chosen.current) { setHits([]); return; }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch(`https://api3.geo.admin.ch/rest/services/api/SearchServer?type=locations&limit=8&searchText=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const j = await r.json();
        setHits((j.results ?? []).map((x: { attrs: { label: string; lat: number; lon: number } }) => ({
          label: x.attrs.label.replace(/<[^>]+>/g, ""),
          p: wgs84ToLv95({ lat: x.attrs.lat, lon: x.attrs.lon }),
        })));
      } catch { /* offline */ }
    }, 250);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [q]);
  return (
    <div className="search">
      <input placeholder="Ort suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ort suchen"
        onKeyDown={(e) => { if (e.key === "Escape") setHits([]); if (e.key === "Enter" && hits[0]) { chosen.current = hits[0].label; onGo(hits[0].p); setHits([]); setQ(hits[0].label); } }} />
      {hits.length > 0 && (
        <ul className="hits">
          {hits.map((h, i) => <li key={i}><button onClick={() => { chosen.current = h.label; onGo(h.p); setHits([]); setQ(h.label); }}>{h.label}</button></li>)}
        </ul>
      )}
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
    <div className="form">
      <label>Codename<input value={sheet.name} onChange={(e) => onPatch({ name: e.target.value })} /></label>
      {sheet.variant === "blatt" && (
        <label>Präfix<input value={prefix} maxLength={1} onChange={(e) => onPatch({ prefix: e.target.value })} className="short mono" /></label>
      )}
      <label>Feldgrösse
        <select value={sheet.cellW} onChange={(e) => onPatch({ cellSize: +e.target.value })}>
          {cells.map((v) => <option key={v} value={v}>{v} m</option>)}
        </select>
      </label>
      <div className="two">
        <label>Spalten<input type="number" min={2} max={sheet.variant === "blatt" ? 26 : 60} value={sheet.colLabels.length} onChange={(e) => onPatch({ cols: Math.max(2, +e.target.value || 2) })} /></label>
        <label>Zeilen<input type="number" min={2} max={60} value={sheet.rowLabels.length} onChange={(e) => onPatch({ rows: Math.max(2, +e.target.value || 2) })} /></label>
      </div>
      <label>Karte
        <select value={sheet.basemap} onChange={(e) => onPatch({ basemap: e.target.value as "lk" | "img" })}>
          <option value="lk">Landeskarte</option>
          <option value="img">Luftbild</option>
        </select>
      </label>
      <label>Klassifizierung<input value={sheet.classification} onChange={(e) => onPatch({ classification: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={sheet.quadrants} onChange={(e) => onPatch({ quadrants: e.target.checked })} /> Unterquadranten A B / D C</label>
      <div className="btnrow">
        <button className="primary" onClick={() => onPdf("A4")}>PDF A4</button>
        <button className="primary" onClick={() => onPdf("A3")}>PDF A3</button>
        <button className="danger" onClick={onDelete}>Löschen</button>
      </div>
    </div>
  );
}
