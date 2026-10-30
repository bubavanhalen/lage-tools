/**
 * Karte für den Einsatz ohne Netz vorbereiten (Vorbereiten, Schritt 6; Spez. MVP 1, Kap. 2.9, 3.1; MVP 3.5, A4):
 * ein Knopf «Alles für offline laden» = gleiche Logik wie im Offline-Popover (`betrieb/laden.ts`, keine doppelte):
 * Speicher schützen, Strassen nur mit Online-Dienst «Strassen», Landeskarte fürs Raster-Gebiet. Fortschritt und Abbruch
 * gelten für beide Orte. Detailstufe und Luftbild unter «Genauer einstellen». Danach prüft der Status die Karte neu.
 */
import { useEffect, useState } from "react";
import type L from "leaflet";
import { onlineAllowed, type Exercise } from "@lage/core";
import { clearTileCache, tileCacheCount } from "./offline";
import { clearRoads, roadTileCount } from "./roadsource";
import { notifyOfflineChanged } from "./offlineStatus";
import { allesOffline, areaOf as areaOfLaden, DETAIL_NORMAL, ladenAbbrechen, ladenUmfang, useLaden, useLadenErgebnis } from "./betrieb/laden";
import type { Bounds } from "./tiles";
import { useKi } from "./ki/context";

const DETAIL: Array<[number, string]> = [[5, "Übersicht (bis 5 m)"], [2, "Normal (bis 2 m)"], [1, "Detail (bis 1 m)"]];

/** Gebiet des Kartenpakets (Raster-Gebiet + 10 %, sonst Kartenausschnitt) – jetzt in `betrieb/laden.ts` */
export function areaOf(ex: Exercise, map: L.Map): { b: Bounds; label: string } {
  return areaOfLaden(ex, map)!;
}

export function OfflineBox({ ex, map }: { ex: Exercise; map: L.Map }) {
  // KI-Hinweis nur, wenn sie auf diesem Gerät wirklich eingeschaltet ist (Übung an + eigene Einwilligung)
  const ki = useKi();
  const kiOn = !!ex.ki?.enabled && !!ki && ki.state !== "aus" && ki.state !== "einwilligung";
  const [finest, setFinest] = useState(DETAIL_NORMAL);
  const [img, setImg] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [roadCount, setRoadCount] = useState<number | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [more, setMore] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const prog = useLaden();
  const erg = useLadenErgebnis();
  useEffect(() => {
    void tileCacheCount().then(setCount);
    void roadTileCount().then(setRoadCount);
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  // nach dem Laden die Zahlen neu lesen
  useEffect(() => { if (erg) { void tileCacheCount().then(setCount); void roadTileCount().then(setRoadCount); } }, [erg]);
  const u = ladenUmfang(ex, map, { finest, img })!;
  const tooBig = u.kacheln > 25000;
  const strassenAus = !onlineAllowed(ex, "strassen");

  const run = () => {
    setFehler(null);
    allesOffline(ex, map, { finest, img }).catch((e: Error) => setFehler(e.message));
  };

  return (
    <div className="pp-offline">
      {prog ? (
        <>
          <div className="progress"><div style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} />
            <span>{prog.teil === "pruefen" ? "Karte wird geprüft …" : `${prog.teil === "strassen" ? "Strassen" : "Karte"} ${prog.teilDone} von ${prog.teilTotal} …`}</span></div>
          <button type="button" className="pp-btn" onClick={ladenAbbrechen}>Abbrechen</button>
        </>
      ) : (
        <>
          <button type="button" className="pp-btn primary" disabled={!online || tooBig} onClick={run}>Alles für offline laden · ca. {u.mb} MB</button>
          <p className="pp-note">Karte für {u.label}{u.strassen ? ", Strassen" : ""} und Speicherschutz. Angesehene Kartenteile werden ab dem zweiten Öffnen automatisch gespeichert.</p>
          {strassenAus && ex.sheets.length > 0 && <p className="pp-note">Strassen werden nicht geladen: Online-Dienst «Strassen» ist aus (Schritt 1 «Übung»).</p>}
        </>
      )}
      {!online && !prog && <p className="pp-note">Zum Laden braucht es einmal Netz.</p>}
      {fehler && <p className="pp-warn">⚠ {fehler}.</p>}
      {!prog && erg && !erg.abgebrochen && erg.failed > 0 && <p className="pp-warn">⚠ {erg.failed} Kartenteile nicht geladen – später nochmals «Alles für offline laden».</p>}
      {!prog && erg && erg.strassenFehlt > 0 && <p className="pp-warn">⚠ Strassen: {erg.strassenFehlt} km² nicht geladen – später nochmals laden.</p>}
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
          <p className="pp-note">{u.kacheln.toLocaleString("de-CH")} Kacheln, ≈ {u.mb} MB.</p>
          {count !== null && count > 0 && (
            <div className="pp-btns">
              <span className="pp-note">Gespeichert: {count.toLocaleString("de-CH")} Kacheln</span>
              <button type="button" className="pp-btn" disabled={!!prog} onClick={async () => { await clearTileCache(); setCount(0); notifyOfflineChanged(); }}>Karte löschen</button>
            </div>
          )}
          {roadCount !== null && roadCount > 0 && (
            <div className="pp-btns">
              <span className="pp-note">Strassen gespeichert: {roadCount.toLocaleString("de-CH")} km²</span>
              <button type="button" className="pp-btn" disabled={!!prog} onClick={async () => { await clearRoads(); setRoadCount(0); }}>Strassen löschen</button>
            </div>
          )}
        </div>
      )}
      {kiOn && <p className="pp-note">KI (Claude) ist für diese Übung eingeschaltet und braucht Netz – ohne Netz sind nur die KI-Knöpfe gesperrt.</p>}
    </div>
  );
}
