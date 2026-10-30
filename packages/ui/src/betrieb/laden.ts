/**
 * «Alles für offline laden» ohne Oberfläche (Spez. MVP 3.5, S6/A4): ein Modul-Speicher mit `subscribe`, damit das Laden
 * das Schliessen des Popovers überlebt und Popover, Kopf («Lädt 42 %») und Vorbereiten (OfflineBox) denselben Stand
 * zeigen. Eine Logik für beide Orte (keine doppelte): Speicherschutz anfragen (mit Benutzergeste), Strassen **nur mit
 * Online-Dienst `strassen`** (K2), Landeskarte Detailstufe Normal (2 m) fürs Raster-Gebiet + 10 % (sonst Kartenausschnitt),
 * Abbruch über `AbortController`, danach `notifyOfflineChanged()` (Kopf und Popover prüfen die Karte vollständig neu).
 * Es läuft höchstens ein Laden zugleich; ein zweiter Aufruf wartet auf das laufende.
 */
import { useEffect, useState } from "react";
import type L from "leaflet";
import { onlineAllowed, type Exercise } from "@lage/core";
import { toLv95 } from "@lage/map";
import { downloadTiles, estimateTiles, OFFLINE_FEINSTE_M } from "../offline";
import { karteNeuPruefen, notifyOfflineChanged, rasterArea } from "../offlineStatus";
import { estimateRoadTiles, prefetchRoads } from "../roadsource";
import { requestPersist } from "../persist";
import type { Bounds, TileLayer } from "../tiles";

/** Fortschritt: `done/total` über alles (Kopf «Lädt 42 %»); `teil` = was gerade lädt (Popover «Karte 412 von 971 …») */
export interface LadenStand { done: number; total: number; teil: "strassen" | "karte" | "pruefen"; teilDone: number; teilTotal: number }
/** Ergebnis des letzten Ladens (Popover/OfflineBox zeigen Fehlendes, nie still) */
export interface LadenErgebnis { saved: number; failed: number; fehlen: number; strassenFehlt: number; abgebrochen: boolean; at: number }

/** Strassen höchstens für so viele km² vorladen (wie bisher OfflineBox) */
export const STRASSEN_MAX_KM2 = 400;
/** Detailstufe «Normal» (m/px) – dieselbe Stufe prüft die Ampel (`OFFLINE_FEINSTE_M`, Review 6 Feld H1) */
export const DETAIL_NORMAL = OFFLINE_FEINSTE_M;

let stand: LadenStand | null = null;
let ergebnis: LadenErgebnis | null = null;
let laufend: Promise<{ saved: number; failed: number; fehlen: number }> | null = null;
let ctl: AbortController | null = null;
const hoerer = new Set<() => void>();
const melden = () => { for (const h of hoerer) h(); };

/** Fortschritt setzen (nur dieses Modul; exportiert für Tests) */
export function setLadenStand(s: LadenStand | null): void {
  stand = s;
  melden();
}
export const ladenStand = (): LadenStand | null => stand;
export const ladenErgebnis = (): LadenErgebnis | null => ergebnis;
/** auf Änderungen von Stand/Ergebnis hören; gibt das Abmelden zurück */
export function onLaden(h: () => void): () => void { hoerer.add(h); return () => { hoerer.delete(h); }; }

/** Gebiet des Kartenpakets: Raster-Gebiet + 10 %, ohne Raster der aktuelle Kartenausschnitt */
export function areaOf(ex: Exercise, map: L.Map | null): { b: Bounds; label: string } | null {
  const r = rasterArea(ex);
  if (r) return { b: r, label: "das Raster-Gebiet" };
  if (!map) return null;
  const v = map.getBounds();
  const sw = toLv95(v.getSouthWest()), ne = toLv95(v.getNorthEast());
  return { b: { minE: sw.e, maxE: ne.e, minN: sw.n, maxN: ne.n }, label: "den aktuellen Kartenausschnitt" };
}

export interface LadenOptionen { signal?: AbortSignal; finest?: number; img?: boolean }

/** Was «Alles für offline laden» holt (Schätzung für den Knopf «· ca. 27 MB») */
export function ladenUmfang(ex: Exercise, map: L.Map | null, o: Pick<LadenOptionen, "finest" | "img"> = {}): { kacheln: number; mb: number; strassen: number; label: string } | null {
  const a = areaOf(ex, map);
  if (!a) return null;
  const finest = o.finest ?? DETAIL_NORMAL;
  const lk = estimateTiles(a.b, finest, "lk");
  const img = o.img ? estimateTiles(a.b, finest, "img") : { count: 0, mb: 0 };
  const roads = ex.sheets.length && onlineAllowed(ex, "strassen") ? estimateRoadTiles(a.b) : 0;
  return { kacheln: lk.count + img.count, mb: Math.max(1, Math.round(lk.mb + img.mb)), strassen: roads > 0 && roads <= STRASSEN_MAX_KM2 ? roads : 0, label: a.label };
}

/** laufendes Laden abbrechen (Knopf «Abbrechen» im Popover und in Vorbereiten) */
export function ladenAbbrechen(): void { ctl?.abort(); }

/**
 * Alles für offline laden. Der erste Schritt (`requestPersist` mit Geste) läuft synchron im Klick.
 * @returns gespeichert / fehlgeschlagen / bei swisstopo nicht vorhanden (4xx, zählen als vorhanden)
 */
export function allesOffline(ex: Exercise, map: L.Map | null, o: LadenOptionen = {}): Promise<{ saved: number; failed: number; fehlen: number }> {
  if (laufend) return laufend;
  const a = areaOf(ex, map);
  if (!a) return Promise.reject(new Error("Kein Gebiet: zuerst ein Raster anlegen oder die Karte zeigen"));
  const umfang = ladenUmfang(ex, map, o)!;
  const finest = o.finest ?? DETAIL_NORMAL;
  const c = new AbortController();
  ctl = c;
  if (o.signal) { if (o.signal.aborted) c.abort(); else o.signal.addEventListener("abort", () => c.abort(), { once: true }); }
  const persist = requestPersist({ geste: true });
  const total = umfang.kacheln + umfang.strassen;
  // sofort sichtbar (Kopf «Lädt 0 %»), noch im Klick – nicht erst nach der Antwort zum Speicherschutz
  setLadenStand({ done: 0, total, teil: umfang.strassen ? "strassen" : "karte", teilDone: 0, teilTotal: umfang.strassen || umfang.kacheln });
  laufend = (async () => {
    let saved = 0, failed = 0, fehlen = 0, strassenFehlt = 0;
    try {
      await persist;
      notifyOfflineChanged();
      // Strassen zuerst (klein, schnell) – nur mit Online-Dienst «Strassen» (K2); ohne bleibt die Meldung ohne Strasse
      if (umfang.strassen && !c.signal.aborted) {
        const r = await prefetchRoads(a.b, (d, t) => setLadenStand({ done: d, total, teil: "strassen", teilDone: d, teilTotal: t }), c.signal);
        strassenFehlt = r.failed;
      }
      let base = umfang.strassen;
      const layers: TileLayer[] = o.img ? ["lk", "img"] : ["lk"];
      let karteDone = 0;
      for (const layer of layers) {
        if (c.signal.aborted) break;
        const n = estimateTiles(a.b, finest, layer).count;
        const r = await downloadTiles(a.b, finest, layer, (d) => setLadenStand({ done: base + d, total, teil: "karte", teilDone: karteDone + d, teilTotal: umfang.kacheln }), c.signal);
        saved += r.saved; failed += r.failed; fehlen += r.fehlen;
        base += n; karteDone += n;
      }
    } finally {
      ergebnis = { saved, failed, fehlen, strassenFehlt, abgebrochen: c.signal.aborted, at: Date.now() };
      // erst nach der vollständigen Neuprüfung «fertig» melden (Kopf und Popover zeigen dann schon das neue Ergebnis)
      setLadenStand({ done: total, total, teil: "pruefen", teilDone: 0, teilTotal: 0 });
      await karteNeuPruefen().catch(() => {});
      laufend = null;
      if (ctl === c) ctl = null;
      setLadenStand(null);
    }
    return { saved, failed, fehlen };
  })();
  return laufend;
}

/** Fortschritt von «Alles für offline laden», null = läuft nicht */
export function useLaden(): LadenStand | null {
  const [s, setS] = useState<LadenStand | null>(stand);
  useEffect(() => { setS(stand); return onLaden(() => setS(stand)); }, []);
  return s;
}

/** Ergebnis des letzten Ladens (null = noch keines in dieser Sitzung) */
export function useLadenErgebnis(): LadenErgebnis | null {
  const [e, setE] = useState<LadenErgebnis | null>(ergebnis);
  useEffect(() => { setE(ergebnis); return onLaden(() => setE(ergebnis)); }, []);
  return e;
}
