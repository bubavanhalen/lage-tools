import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import {
  cellAtAny,
  demoFeldSheet,
  formatLv95,
  makeBlattSheet,
  sheetBounds,
  type LV95,
  type RasterSheet,
} from "@lage/core";
import { createSwissMap, rasterLayer, toLv95, type Basemap, type SwissMap } from "@lage/map";

interface Props {
  product: string;
  tagline: string;
}

const CELL_SIZES = [100, 200, 400, 1000];

export function PreviewShell({ product, tagline }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const sm = useRef<SwissMap | null>(null);
  const layers = useRef(new Map<string, L.LayerGroup>());
  const [basemap, setBasemap] = useState<Basemap>("lk");
  const [sheets, setSheets] = useState<RasterSheet[]>(() => [demoFeldSheet()]);
  const [cellSize, setCellSize] = useState(200);
  const [cursor, setCursor] = useState<{ p: LV95; cell: string | null } | null>(null);

  useEffect(() => {
    if (!el.current || sm.current) return;
    const s = createSwissMap(el.current, { center: { e: 2599500, n: 1200000 }, zoom: 17.5 });
    sm.current = s;
    const b0 = sheetBounds(sheets[0]!);
    s.fitLv95({ e: b0.minE, n: b0.minN }, { e: b0.maxE, n: b0.maxN }, 30);
    s.map.on("mousemove", (ev: L.LeafletMouseEvent) => {
      const p = toLv95(ev.latlng);
      setCursor({ p, cell: null });
    });
    return () => {
      s.map.remove();
      sm.current = null;
    };
  }, []);

  // Raster-Ebenen synchron halten
  useEffect(() => {
    const s = sm.current;
    if (!s) return;
    const want = new Set(sheets.map((x) => x.id));
    for (const [id, lyr] of layers.current) if (!want.has(id)) { s.map.removeLayer(lyr); layers.current.delete(id); }
    for (const sh of sheets) if (!layers.current.has(sh.id)) {
      const lyr = rasterLayer(s.map, sh, { color: sh.variant === "blatt" ? "#c8102e" : "#1d1d1d" }).addTo(s.map);
      layers.current.set(sh.id, lyr);
    }
  }, [sheets]);

  const cell = cursor ? cellAtAny(sheets, cursor.p) : null;

  const addBlatt = () => {
    const s = sm.current;
    if (!s) return;
    const c = toLv95(s.map.getCenter());
    const idx = sheets.filter((x) => x.variant === "blatt").length;
    const prefix = "UVWXYZ"[idx % 6]!;
    const sh = makeBlattSheet({ name: `BLATT ${prefix}`, prefix, center: { e: Math.round(c.e), n: Math.round(c.n) }, cellSize });
    setSheets((xs) => [...xs, sh]);
    const b = sheetBounds(sh);
    s.fitLv95({ e: b.minE, n: b.minN }, { e: b.maxE, n: b.maxN }, 40);
  };

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <strong>{product}</strong>
          <span className="tag">{tagline}</span>
        </div>
        <div className="tools">
          <div className="seg" role="group" aria-label="Kartengrundlage">
            {(["lk", "img", "grau"] as Basemap[]).map((b) => (
              <button key={b} aria-pressed={basemap === b} onClick={() => { setBasemap(b); sm.current?.setBasemap(b); }}>
                {b === "lk" ? "Landeskarte" : b === "img" ? "Luftbild" : "Grau"}
              </button>
            ))}
          </div>
          <label className="field">
            Feld
            <select value={cellSize} onChange={(e) => setCellSize(+e.target.value)}>
              {CELL_SIZES.map((v) => <option key={v} value={v}>{v} m</option>)}
            </select>
          </label>
          <button className="primary" onClick={addBlatt}>+ Blatt-Raster hier</button>
          <button onClick={() => setSheets([demoFeldSheet()])}>Zurücksetzen</button>
        </div>
      </header>
      <main className="mapwrap">
        <div ref={el} className="map" />
        <div className="status mono" aria-live="polite">
          {cursor ? <>{formatLv95(cursor.p)}{cell ? <> · <b>{cell.label}</b></> : null}</> : "Maus über die Karte bewegen"}
        </div>
        <div className="note">Vorschau Etappe 1 · Raster «DEMO» ist fiktiv · Karte © swisstopo</div>
      </main>
    </div>
  );
}
