/**
 * Offline: Service Worker anmelden, Kartenkacheln für ein Gebiet vorab speichern.
 */
import { RESOLUTIONS } from "@lage/map";
import { tileUrl, WMTS_LAYER, type Bounds, type TileLayer } from "./tiles";
import type { TileCoverage } from "./shell/contracts";

const TILE_CACHE = "lt-tiles-v1";
const TILE = 256;
const ORIGIN_E = 2420000, ORIGIN_N = 1350000;
/** mittlere Grösse einer Kachel (Landeskarte JPEG), für die Schätzung */
const AVG_KB: Record<TileLayer, number> = { lk: 28, grau: 22, img: 45 };

export function registerOffline(): void {
  const prod = (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD;
  if (!("serviceWorker" in navigator) || !prod) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => { /* z. B. privates Fenster */ });
  });
}

export function offlineReady(): boolean {
  return !!navigator.serviceWorker?.controller;
}

function tileRange(b: Bounds, z: number) {
  const res = RESOLUTIONS[z]!;
  return {
    x0: Math.floor((b.minE - ORIGIN_E) / (TILE * res)), x1: Math.floor((b.maxE - ORIGIN_E) / (TILE * res)),
    y0: Math.floor((ORIGIN_N - b.maxN) / (TILE * res)), y1: Math.floor((ORIGIN_N - b.minN) / (TILE * res)),
  };
}

/** Alle Stufen von der Übersicht bis zur Auflösung `finest` (Meter pro Pixel). */
function levels(finest: number): number[] {
  const out: number[] = [];
  for (let z = 14; z < RESOLUTIONS.length; z++) if (RESOLUTIONS[z]! >= finest - 1e-9) out.push(z);
  return out;
}

export function estimateTiles(b: Bounds, finest: number, layer: TileLayer = "lk"): { count: number; mb: number } {
  let count = 0;
  for (const z of levels(finest)) { const r = tileRange(b, z); count += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); }
  return { count, mb: (count * AVG_KB[layer]) / 1024 };
}

/** Kachel-URLs des Gebiets auf Stufe `z` */
function tileUrlsAt(b: Bounds, z: number, layer: TileLayer): string[] {
  const urls: string[] = [];
  const r = tileRange(b, z);
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) urls.push(tileUrl(layer, z, x, y));
  return urls;
}

/** alle Kachel-URLs des Gebiets von der Übersicht bis `finest` (m/px), gröbste Stufe zuerst */
export function tileUrls(b: Bounds, finest: number, layer: TileLayer = "lk"): string[] {
  return levels(finest).flatMap((z) => tileUrlsAt(b, z, layer));
}

/**
 * Kartenteile, die swisstopo beim Vorladen mit 4xx nicht liefert (gibt es dort nicht, z. B. ausserhalb der Landeskarte):
 * eigener Zwischenspeicher mit leerer Antwort und Kopf `x-lt-fehlt: 1` (Spez. MVP 3.5, S8/A5). Sie zählen als vorhanden –
 * sonst würde die Ampel «Karte» nie grün.
 */
export const TILES_FEHLEN = "lt-tiles-fehlen";

/** eine Makrotask abwarten (zwischen Bündeln: kein Long Task > 50 ms, Eingaben bleiben flüssig) */
const pause = () => new Promise<void>((ok) => setTimeout(ok, 0));

export async function downloadTiles(b: Bounds, finest: number, layer: TileLayer, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ saved: number; failed: number; fehlen: number }> {
  const cache = await caches.open(TILE_CACHE);
  const fehltCache = await caches.open(TILES_FEHLEN).catch(() => null);
  const urls = tileUrls(b, finest, layer);
  let done = 0, saved = 0, failed = 0, fehlen = 0;
  const queue = [...urls];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length && !signal?.aborted) {
      const u = queue.shift()!;
      try {
        if (!(await cache.match(u)) && !(await fehltCache?.match(u))) {
          const r = await fetch(u, { mode: "cors", signal });
          if (r.ok) { await cache.put(u, r); saved++; }
          else if (r.status >= 400 && r.status < 500) {
            // gibt es bei swisstopo nicht: merken, zählt als erledigt (S8)
            await fehltCache?.put(u, new Response("", { status: 200, headers: { "x-lt-fehlt": "1" } }));
            fehlen++;
          } else failed++;
        }
      } catch { if (!signal?.aborted) failed++; }
      onProgress(++done, urls.length);
    }
  }));
  return { saved, failed, fehlen };
}

/** Ladestufe «Normal» (m/px): «Alles für offline laden» holt bis hier, die Ampel prüft bis hier (`betrieb/laden.ts`) */
export const OFFLINE_FEINSTE_M = 2;

/** Teilezahlen einer Gruppe von Stufen */
export interface TeileZahl { total: number; cached: number }
/** Übersicht = Stufen ab dieser Auflösung (m/px); feiner = Detail (Ampel «Übersicht ✓ · Detail 25 %», Review 6 Feld H1) */
export const UEBERSICHT_AB_M = 10;

/**
 * Ist das Gebiet offline vorhanden – **alle Stufen** von der Übersicht bis `finest` (m/px; die Ampel prüft bis zur
 * Ladestufe «Normal» 2 m, Review 6 Feld H1: vorher nur bis 5 m, ein abgebrochenes Laden galt deshalb als vollständig)?
 * Vollständige Prüfung aller Kacheln (Spez. MVP 3.5, S8/A5 – keine Stichprobe): Bündel à 64 `cache.match`, zwischen den
 * Bündeln eine Makrotask Pause (kein Long Task). Kacheln in `lt-tiles-fehlen` (4xx beim Vorladen) zählen als vorhanden.
 * Nur Cache-Abfragen, keine Netzanfragen. Messpunkte `lt:offline-pruefung:start|ende`. Ohne Cache-API: nichts vorhanden.
 * Zusätzlich: `uebersicht` (Stufen ≥ 10 m/px), `detail` (feiner) und `feinsteZ` = feinste vollständig vorhandene Stufe
 * (alle gröberen ebenfalls vollständig), null = keine.
 */
export async function areaTileCoverage(b: Bounds, finest = 5): Promise<{ share: number; total: number; cached: number; uebersicht: TeileZahl; detail: TeileZahl; feinsteZ: number | null }> {
  const zs = levels(finest);
  const proStufe = zs.map((z) => tileUrlsAt(b, z, "lk"));
  const total = proStufe.reduce((n, u) => n + u.length, 0);
  const leer = (): TeileZahl => ({ total: 0, cached: 0 });
  const uebersicht = leer(), detail = leer();
  const gruppe = (z: number) => (RESOLUTIONS[z]! >= UEBERSICHT_AB_M - 1e-9 ? uebersicht : detail);
  zs.forEach((z, i) => { gruppe(z).total += proStufe[i]!.length; });
  if (!total) return { share: 1, total: 0, cached: 0, uebersicht, detail, feinsteZ: zs.length ? zs[zs.length - 1]! : null };
  const mark = (n: string) => { try { performance.mark(n); } catch { /* egal */ } };
  mark("lt:offline-pruefung:start");
  try {
    if (typeof caches === "undefined") return { share: 0, total, cached: 0, uebersicht, detail, feinsteZ: null };
    const cache = await caches.open(TILE_CACHE);
    const fehlt = (await caches.has(TILES_FEHLEN).catch(() => false)) ? await caches.open(TILES_FEHLEN) : null;
    let cached = 0, erstes = true, feinsteZ: number | null = null, lueckenlos = true;
    for (let s = 0; s < zs.length; s++) {
      const urls = proStufe[s]!;
      let hier = 0;
      for (let i = 0; i < urls.length; i += 64) {
        if (!erstes) await pause();
        erstes = false;
        const part = urls.slice(i, i + 64);
        const hits = await Promise.all(part.map((u) => cache.match(u)));
        const miss = part.filter((_, k) => !hits[k]);
        hier += part.length - miss.length;
        if (fehlt && miss.length) hier += (await Promise.all(miss.map((u) => fehlt.match(u)))).filter(Boolean).length;
      }
      cached += hier;
      gruppe(zs[s]!).cached += hier;
      if (lueckenlos && hier === urls.length) feinsteZ = zs[s]!;
      else lueckenlos = false;
    }
    return { share: cached / total, total, cached, uebersicht, detail, feinsteZ };
  } catch {
    return { share: 0, total, cached: 0, uebersicht, detail, feinsteZ: null };
  } finally {
    mark("lt:offline-pruefung:ende");
  }
}

/**
 * Abdeckung des Kachel-Caches für Gebiet `b` auf Stufe `z` (Spez. MVP 3, Kap. 3.10): nur `caches.match`, keine
 * Netzanfragen. Bei sehr vielen Kacheln wird eine gleichmässige Stichprobe (`maxCheck`) geprüft und hochgerechnet.
 * Ohne Cache-API (z. B. unsicherer Ursprung): nichts vorhanden.
 */
export async function tileCoverage(b: Bounds, z: number, layer: TileLayer = "lk", maxCheck = 800): Promise<TileCoverage> {
  const r = tileRange(b, z);
  const xs = r.x1 - r.x0 + 1, ys = r.y1 - r.y0 + 1;
  const total = Math.max(0, xs * ys);
  if (!total) return { z, total: 0, cached: 0, share: 1 };
  try {
    if (typeof caches === "undefined") return { z, total, cached: 0, share: 0 };
    const cache = await caches.open(TILE_CACHE);
    const step = Math.max(1, Math.ceil(total / maxCheck));
    const idx: number[] = [];
    for (let i = 0; i < total; i += step) idx.push(i);
    let hit = 0;
    for (let k = 0; k < idx.length; k += 64) {
      const part = await Promise.all(idx.slice(k, k + 64).map((i) => cache.match(tileUrl(layer, z, r.x0 + (i % xs), r.y0 + Math.floor(i / xs)))));
      hit += part.filter(Boolean).length;
    }
    const share = hit / idx.length;
    return { z, total, cached: step === 1 ? hit : Math.round(share * total), share };
  } catch {
    return { z, total, cached: 0, share: 0 };
  }
}

export async function tileCacheCount(): Promise<number> {
  try { return (await (await caches.open(TILE_CACHE)).keys()).length; } catch { return 0; }
}

export async function clearTileCache(): Promise<void> {
  try { await caches.delete(TILE_CACHE); await caches.delete(TILES_FEHLEN); } catch { /* egal */ }
}

export async function storageEstimate(): Promise<{ usedMb: number; quotaMb: number } | null> {
  try {
    const e = await navigator.storage.estimate();
    return { usedMb: (e.usage ?? 0) / 1048576, quotaMb: (e.quota ?? 0) / 1048576 };
  } catch { return null; }
}
