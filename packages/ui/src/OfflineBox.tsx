/**
 * Karte für den Einsatz ohne Netz vorbereiten: Kacheln für das Übungsgebiet speichern.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { sheetBounds, type Exercise } from "@lage/core";
import { toLv95 } from "@lage/map";
import { clearTileCache, downloadTiles, estimateTiles, offlineReady, tileCacheCount } from "./offline";
import type { Bounds } from "./tiles";

const DETAIL: Array<[number, string]> = [[5, "Übersicht (bis 5 m)"], [2, "Normal (bis 2 m)"], [1, "Detail (bis 1 m)"]];

function areaOf(ex: Exercise, map: L.Map): { b: Bounds; label: string } {
  if (ex.sheets.length) {
    const bs = ex.sheets.map(sheetBounds);
    const b = { minE: Math.min(...bs.map((x) => x.minE)), maxE: Math.max(...bs.map((x) => x.maxE)), minN: Math.min(...bs.map((x) => x.minN)), maxN: Math.max(...bs.map((x) => x.maxN)) };
    const m = 0.1 * Math.max(b.maxE - b.minE, b.maxN - b.minN);
    return { b: { minE: b.minE - m, maxE: b.maxE + m, minN: b.minN - m, maxN: b.maxN + m }, label: "das Raster-Gebiet" };
  }
  const v = map.getBounds();
  const sw = toLv95(v.getSouthWest()), ne = toLv95(v.getNorthEast());
  return { b: { minE: sw.e, maxE: ne.e, minN: sw.n, maxN: ne.n }, label: "den aktuellen Kartenausschnitt" };
}

export function OfflineBox({ ex, map }: { ex: Exercise; map: L.Map }) {
  const [finest, setFinest] = useState(2);
  const [img, setImg] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [, setTick] = useState(0);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    tileCacheCount().then(setCount);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", on);
    const t = window.setInterval(() => setTick((x) => x + 1), 5000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); window.clearInterval(t); };
  }, []);
  const { b, label } = areaOf(ex, map);
  const est = estimateTiles(b, finest, "lk");
  const estImg = img ? estimateTiles(b, finest, "img") : { count: 0, mb: 0 };
  const total = est.count + estImg.count;
  const tooBig = total > 25000;

  const run = async () => {
    ctl.current = new AbortController();
    setProg({ done: 0, total });
    let base = 0;
    for (const layer of (img ? ["lk", "img"] : ["lk"]) as Array<"lk" | "img">) {
      const n = layer === "lk" ? est.count : estImg.count;
      await downloadTiles(b, finest, layer, (d) => setProg({ done: base + d, total }), ctl.current.signal);
      base += n;
    }
    setProg(null);
    setCount(await tileCacheCount());
  };

  return (
    <div className="importbox offline">
      <b>Offline</b>
      <p className="help">{offlineReady() ? "✓ App funktioniert ohne Netz." : "App wird für den Offline-Betrieb vorbereitet (nach dem ersten Laden neu öffnen)."}{online ? "" : " · Zurzeit offline."}</p>
      <p className="help">Karte für {label} speichern – bereits angesehene Kartenteile werden automatisch gespeichert.</p>
      <div className="btnrow">
        <select value={finest} onChange={(e) => setFinest(+e.target.value)} aria-label="Detailstufe">
          {DETAIL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={img} onChange={(e) => setImg(e.target.checked)} /> Luftbild</label>
      </div>
      {prog ? (
        <>
          <div className="progress"><div style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /><span>{prog.done} / {prog.total} Kacheln</span></div>
          <button onClick={() => ctl.current?.abort()}>Abbrechen</button>
        </>
      ) : (
        <div className="btnrow">
          <button className="primary" disabled={!online || tooBig} onClick={run}>Karte speichern ({total.toLocaleString("de-CH")} Kacheln, ≈ {Math.max(1, Math.round(est.mb + estImg.mb))} MB)</button>
        </div>
      )}
      {tooBig && <p className="help warn">Zu gross – Detailstufe senken oder kleineres Gebiet wählen.</p>}
      {count !== null && count > 0 && (
        <div className="btnrow">
          <span className="help">Gespeichert: {count.toLocaleString("de-CH")} Kacheln</span>
          <button onClick={async () => { await clearTileCache(); setCount(0); }}>Löschen</button>
        </div>
      )}
    </div>
  );
}
