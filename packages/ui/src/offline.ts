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

export async function downloadTiles(b: Bounds, finest: number, layer: TileLayer, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ saved: number; failed: number }> {
  try { await navigator.storage?.persist?.(); } catch { /* egal */ }
  const cache = await caches.open(TILE_CACHE);
  const urls: string[] = [];
  for (const z of levels(finest)) {
    const r = tileRange(b, z);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) urls.push(`https://wmts.geo.admin.ch/1.0.0/${WMTS_LAYER[layer]}/default/current/2056/${z}/${x}/${y}.jpeg`);
  }
  let done = 0, saved = 0, failed = 0;
  const queue = [...urls];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length && !signal?.aborted) {
      const u = queue.shift()!;
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: "cors", signal });
          if (r.ok) { await cache.put(u, r); saved++; } else failed++;
        }
      } catch { failed++; }
      onProgress(++done, urls.length);
    }
  }));
  return { saved, failed };
}

/**
 * Ist das Gebiet offline vorhanden (Landeskarte bis Übersicht 5 m)? Nur Cache-Abfragen, keine Netzanfragen.
 * Bei sehr vielen Kacheln wird gleichmässig eine Stichprobe (`maxCheck`) geprüft. Für den Offline-Status (Kap. 3.1).
 */
export async function areaTilesCached(b: Bounds, finest = 5, maxCheck = 160): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    const cache = await caches.open(TILE_CACHE);
    const urls: string[] = [];
    for (const z of levels(finest)) {
      const r = tileRange(b, z);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) urls.push(`https://wmts.geo.admin.ch/1.0.0/${WMTS_LAYER.lk}/default/current/2056/${z}/${x}/${y}.jpeg`);
    }
    if (!urls.length) return true;
    const step = Math.max(1, Math.ceil(urls.length / maxCheck));
    for (let i = 0; i < urls.length; i += step) if (!(await cache.match(urls[i]!))) return false;
    return !!(await cache.match(urls[urls.length - 1]!));
  } catch {
    return false;
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
  try { await caches.delete(TILE_CACHE); } catch { /* egal */ }
}

export async function storageEstimate(): Promise<{ usedMb: number; quotaMb: number } | null> {
  try {
    const e = await navigator.storage.estimate();
    return { usedMb: (e.usage ?? 0) / 1048576, quotaMb: (e.quota ?? 0) / 1048576 };
  } catch { return null; }
}
