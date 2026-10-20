/**
 * Offline: Service Worker anmelden, Kartenkacheln für ein Gebiet vorab speichern.
 */
import { RESOLUTIONS } from "@lage/map";
import { WMTS_LAYER, type Bounds, type TileLayer } from "./tiles";

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
