/**
 * Karte für den Einsatz ohne Netz vorbereiten (Vorbereiten, Schritt 6; Spez. MVP 1, Kap. 2.9, 3.1):
 * ein Knopf «Alles für offline laden» = Speicher schützen (`storage.persist()`), Strassen und Landeskarte fürs
 * Raster-Gebiet speichern. Detailstufe und Luftbild unter «Genauer einstellen». Danach Offline-Status neu prüfen.
 * Texterkennung und Spracherkennung (optional) stehen in `prepare/OfflineStep.tsx`.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Exercise } from "@lage/core";
import { toLv95 } from "@lage/map";
import { clearTileCache, downloadTiles, estimateTiles, tileCacheCount } from "./offline";
import { clearRoads, estimateRoadTiles, prefetchRoads, roadTileCount } from "./roadsource";
import type { Bounds } from "./tiles";
import { requestPersist } from "./persist";
import { notifyOfflineChanged, rasterArea } from "./offlineStatus";
import { useKi } from "./ki/context";

const DETAIL: Array<[number, string]> = [[5, "Übersicht (bis 5 m)"], [2, "Normal (bis 2 m)"], [1, "Detail (bis 1 m)"]];

export function areaOf(ex: Exercise, map: L.Map): { b: Bounds; label: string } {
  const r = rasterArea(ex);
  if (r) return { b: r, label: "das Raster-Gebiet" };
  const v = map.getBounds();
  const sw = toLv95(v.getSouthWest()), ne = toLv95(v.getNorthEast());
  return { b: { minE: sw.e, maxE: ne.e, minN: sw.n, maxN: ne.n }, label: "den aktuellen Kartenausschnitt" };
}

export function OfflineBox({ ex, map }: { ex: Exercise; map: L.Map }) {
  // KI-Hinweis nur, wenn sie auf diesem Gerät wirklich eingeschaltet ist (Übung an + eigene Einwilligung)
  const ki = useKi();
  const kiOn = !!ex.ki?.enabled && !!ki && ki.state !== "aus" && ki.state !== "einwilligung";
  const [finest, setFinest] = useState(2);
  const [img, setImg] = useState(false);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [roadCount, setRoadCount] = useState<number | null>(null);
  const [roadProg, setRoadProg] = useState<{ done: number; total: number; failed?: number } | null>(null);
  const [failed, setFailed] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [more, setMore] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    void tileCacheCount().then(setCount);
    void roadTileCount().then(setRoadCount);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  const { b, label } = areaOf(ex, map);
  const est = estimateTiles(b, finest, "lk");
  const estImg = img ? estimateTiles(b, finest, "img") : { count: 0, mb: 0 };
  const total = est.count + estImg.count;
  const tooBig = total > 25000;
  // Strassen (für Sperren, Checkpoints … im Gelände) nur fürs Raster-Gebiet, max. 400 km²
  const roadTiles = ex.sheets.length ? estimateRoadTiles(b) : 0;
  const withRoads = roadTiles > 0 && roadTiles <= 400;
  const mb = Math.max(1, Math.round(est.mb + estImg.mb));

  const run = async () => {
    ctl.current = new AbortController();
    setFailed(0);
    await requestPersist();
    notifyOfflineChanged();
    setProg({ done: 0, total });
    // Strassen zuerst (klein, schnell), Fortschritt separat
    if (withRoads) {
      setRoadProg({ done: 0, total: roadTiles });
      const r = await prefetchRoads(b, (d, t) => setRoadProg({ done: d, total: t }), ctl.current.signal);
      setRoadProg(r.failed ? { done: roadTiles, total: roadTiles, failed: r.failed } : null);
      setRoadCount(await roadTileCount());
    }
    let base = 0, bad = 0;
    for (const layer of (img ? ["lk", "img"] : ["lk"]) as Array<"lk" | "img">) {
      const n = layer === "lk" ? est.count : estImg.count;
      const r = await downloadTiles(b, finest, layer, (d) => setProg({ done: base + d, total }), ctl.current.signal);
      bad += r.failed;
      base += n;
    }
    setFailed(bad);
    setProg(null);
    setCount(await tileCacheCount());
    notifyOfflineChanged();
  };

  return (
    <div className="pp-offline">
      {prog ? (
        <>
          {roadProg && !roadProg.failed && <div className="progress"><div style={{ width: `${Math.round((roadProg.done / Math.max(1, roadProg.total)) * 100)}%` }} /><span>Strassen {roadProg.done} / {roadProg.total} km²</span></div>}
          <div className="progress"><div style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /><span>Karte {prog.done} / {prog.total} Kacheln</span></div>
          <button type="button" className="pp-btn" onClick={() => ctl.current?.abort()}>Abbrechen</button>
        </>
      ) : (
        <>
          <button type="button" className="pp-btn primary" disabled={!online || tooBig} onClick={run}>Alles für offline laden</button>
          <p className="pp-note">Karte für {label} (≈ {mb} MB){withRoads ? ", Strassen" : ""} und Speicherschutz. Bereits angesehene Kartenteile sind automatisch gespeichert.</p>
        </>
      )}
      {!online && !prog && <p className="pp-note">Zum Laden braucht es einmal Netz.</p>}
      {failed > 0 && <p className="pp-warn">⚠ {failed} Kartenteile nicht geladen – später nochmals «Alles für offline laden».</p>}
      {roadProg?.failed ? <p className="pp-warn">⚠ Strassen: {roadProg.failed} von {roadProg.total} km² nicht geladen – später nochmals laden.</p> : null}
      {tooBig && <p className="pp-warn">⚠ Zu gross – unter «Genauer einstellen» die Detailstufe senken oder ein kleineres Raster wählen.</p>}
      <button type="button" className="pp-link" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "▾" : "▸"} Genauer einstellen</button>
      {more && (
        <div className="pp-more">
          <div className="pp-btns">
            <select value={finest} onChange={(e) => setFinest(+e.target.value)} aria-label="Detailstufe der Karte">
              {DETAIL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="pp-check"><input type="checkbox" checked={img} onChange={(e) => setImg(e.target.checked)} /> Luftbild dazu</label>
          </div>
          <p className="pp-note">{total.toLocaleString("de-CH")} Kacheln, ≈ {mb} MB.</p>
          {count !== null && count > 0 && (
            <div className="pp-btns">
              <span className="pp-note">Gespeichert: {count.toLocaleString("de-CH")} Kacheln</span>
              <button type="button" className="pp-btn" onClick={async () => { await clearTileCache(); setCount(0); notifyOfflineChanged(); }}>Karte löschen</button>
            </div>
          )}
          {roadCount !== null && roadCount > 0 && (
            <div className="pp-btns">
              <span className="pp-note">Strassen gespeichert: {roadCount.toLocaleString("de-CH")} km²</span>
              <button type="button" className="pp-btn" onClick={async () => { await clearRoads(); setRoadCount(0); }}>Strassen löschen</button>
            </div>
          )}
        </div>
      )}
      {kiOn && <p className="pp-note">KI (Claude) ist für diese Übung eingeschaltet und braucht Netz – ohne Netz sind nur die KI-Knöpfe gesperrt.</p>}
    </div>
  );
}
