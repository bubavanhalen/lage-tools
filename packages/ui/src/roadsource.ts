/**
 * Strassen (swisstopo swissTLM3D) für «Lage im Gelände»: kachelweise laden (1 km), im Browser speichern
 * (IndexedDB «lage-tools», Store «roads») und ohne Netz aus dem Speicher liefern.
 * Fehler (offline, Zeitüberschreitung, Speicher voll) → leere Liste bzw. Zählung als «fehlgeschlagen», nie werfen.
 */
import {
  NAMED_ROAD_NEAR, parseTlmIdentify, placeAlongRoad, placeOnRoad, roadsInBounds, roadTiles, tlmRoadsUrl,
  type Bounds, type LV95, type PlaceOptions, type RoadHint, type RoadPlacement, type RoadSegment, type RoadTarget, type RoadTile,
} from "@lage/core";
import { db, ROADS_STORE } from "./store";

const TILE_M = 1000;
/** Datenformat im Speicher (bei Änderung erhöhen → alte Kacheln werden neu geladen) */
const FORMAT = 1;
const PAGE = 200;
const MAX_PAGES = 25;
const TIMEOUT_MS = 15000;
/** nach so vielen Tagen online still neu laden (Daten ändern sich selten) */
const MAX_AGE_DAYS = 180;

/** gespeicherte Form: Punkte flach [e0, n0, e1, n1, …] */
interface StoredSeg { i: string; n?: string; c: number; v?: number; p: number[] }
interface TileRec { key: string; f: number; t: number; segs: StoredSeg[] }

const mem = new Map<string, RoadSegment[]>();
const pending = new Map<string, Promise<RoadSegment[] | null>>();

const pack = (s: RoadSegment): StoredSeg => {
  const o: StoredSeg = { i: s.id, c: s.cls, p: s.pts.flatMap((q) => [q.e, q.n]) };
  if (s.name) o.n = s.name;
  if (s.vb) o.v = s.vb;
  return o;
};
const unpack = (o: StoredSeg): RoadSegment => {
  const pts = [];
  for (let k = 0; k + 1 < o.p.length; k += 2) pts.push({ e: o.p[k]!, n: o.p[k + 1]! });
  const s: RoadSegment = { id: o.i, cls: o.c, pts };
  if (o.n) s.name = o.n;
  if (o.v) s.vb = o.v;
  return s;
};

async function readTile(key: string): Promise<TileRec | null> {
  try { return ((await (await db()).get(ROADS_STORE, key)) as TileRec | undefined) ?? null; } catch { return null; }
}
async function writeTile(rec: TileRec): Promise<void> {
  try { await (await db()).put(ROADS_STORE, rec); } catch { /* Speicher nicht verfügbar – App läuft trotzdem */ }
}

function withTimeout(signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  const on = () => c.abort();
  signal?.addEventListener("abort", on);
  if (signal?.aborted) c.abort();
  return { signal: c.signal, done: () => { clearTimeout(t); signal?.removeEventListener("abort", on); } };
}

/** Eine Kachel aus dem Netz (alle Seiten); null bei Fehler */
async function fetchTile(tile: RoadTile): Promise<RoadSegment[] | null> {
  const out: RoadSegment[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const to = withTimeout();
    try {
      const r = await fetch(tlmRoadsUrl(tile.b, page * PAGE, PAGE), { mode: "cors", signal: to.signal });
      if (!r.ok) return null;
      const json = (await r.json()) as { results?: unknown[] };
      if (!Array.isArray(json?.results)) return null;
      out.push(...parseTlmIdentify(json));
      if (json.results.length < PAGE) break;
    } catch {
      return null;
    } finally {
      to.done();
    }
  }
  // gleiche Kennung kann auf mehreren Seiten vorkommen
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

/** Auf ein geteiltes Ergebnis warten, aber mit eigenem Abbruch: bei Abbruch sofort null (der Abruf läuft weiter). */
function waitFor<T>(p: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return p;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve) => {
    const on = () => resolve(null);
    signal.addEventListener("abort", on, { once: true });
    p.then((v) => resolve(v), () => resolve(null)).finally(() => signal.removeEventListener("abort", on));
  });
}

/**
 * Strassen einer Kachel: Arbeitsspeicher → IndexedDB → Netz (und dann speichern).
 * Der Abruf wird zwischen gleichzeitigen Aufrufern geteilt und hängt an keinem Abbruchsignal eines Aufrufers
 * (nur an der eigenen Zeitüberschreitung); jeder Aufrufer wartet mit seinem eigenen `signal`.
 * @returns null, wenn weder gespeichert noch ladbar (oder der Aufrufer abgebrochen hat)
 */
async function tileRoads(tile: RoadTile, o: { signal?: AbortSignal; refresh?: boolean } = {}): Promise<RoadSegment[] | null> {
  const hit = mem.get(tile.key);
  if (hit && !o.refresh) return hit;
  let run = pending.get(tile.key);
  if (!run) {
    const refresh = !!o.refresh;
    run = (async () => {
      const rec = await readTile(tile.key);
      const fresh = rec && rec.f === FORMAT && Date.now() - rec.t < MAX_AGE_DAYS * 864e5;
      if (rec && rec.f === FORMAT && (fresh || !isOnline()) && !refresh) {
        const segs = rec.segs.map(unpack);
        mem.set(tile.key, segs);
        return segs;
      }
      if (!isOnline()) return null;
      const segs = await fetchTile(tile);
      if (!segs) {
        // Netzfehler: lieber alte Daten als keine
        if (rec && rec.f === FORMAT) { const old = rec.segs.map(unpack); mem.set(tile.key, old); return old; }
        return null;
      }
      mem.set(tile.key, segs);
      await writeTile({ key: tile.key, f: FORMAT, t: Date.now(), segs: segs.map(pack) });
      return segs;
    })().catch(() => null).finally(() => pending.delete(tile.key));
    pending.set(tile.key, run);
  }
  return waitFor(run, o.signal);
}

/** Strassen im Gebiet und ob alle Kacheln da waren (`missing` > 0: offline/Fehler – später nochmals versuchen). */
export async function getRoadsInfo(b: Bounds, o: { signal?: AbortSignal } = {}): Promise<{ roads: RoadSegment[]; missing: number }> {
  try {
    const tiles = roadTiles(b, TILE_M);
    if (tiles.length > 64) return { roads: [], missing: 0 }; // Schutz: viel zu grosses Gebiet
    const parts = await Promise.all(tiles.map((t) => tileRoads(t, o).catch(() => null)));
    const seen = new Set<string>();
    const all: RoadSegment[] = [];
    let missing = 0;
    for (const segs of parts) {
      if (!segs) { missing++; continue; }
      for (const s of segs) if (!seen.has(s.id)) { seen.add(s.id); all.push(s); }
    }
    return { roads: roadsInBounds(all, b, 1), missing };
  } catch {
    return { roads: [], missing: 1 };
  }
}

/**
 * Strassen im Gebiet (z. B. Planquadrat, Unterquadrant, NAI-Umriss als Rechteck). Lädt fehlende Kacheln nach,
 * offline nur aus dem Speicher. Strassen, die das Gebiet berühren (auch nur durchqueren), sind dabei.
 * Nie ein Fehler: im schlimmsten Fall eine leere Liste.
 */
export async function getRoads(b: Bounds, o: { signal?: AbortSignal } = {}): Promise<RoadSegment[]> {
  return (await getRoadsInfo(b, o)).roads;
}

/** Nur aus dem Speicher (ohne Netz, sofort) – z. B. für eine erste Platzierung, bevor das Netz antwortet. */
export function cachedRoads(b: Bounds): RoadSegment[] | null {
  const tiles = roadTiles(b, TILE_M);
  const all: RoadSegment[] = [];
  const seen = new Set<string>();
  for (const t of tiles) {
    const segs = mem.get(t.key);
    if (!segs) return null;
    for (const s of segs) if (!seen.has(s.id)) { seen.add(s.id); all.push(s); }
  }
  return roadsInBounds(all, b, 1);
}

/** Anzahl Kacheln für ein Gebiet (für die Anzeige) */
export function estimateRoadTiles(b: Bounds): number {
  return roadTiles(b, TILE_M).length;
}

/**
 * Strassen für ein ganzes Gebiet (Raster) vorab speichern. Bereits gespeicherte Kacheln werden übersprungen.
 * @param onProgress (fertig, total)
 */
export async function prefetchRoads(b: Bounds, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ saved: number; cached: number; failed: number }> {
  const tiles = roadTiles(b, TILE_M);
  let done = 0, saved = 0, cached = 0, failed = 0;
  const queue = [...tiles];
  onProgress?.(0, tiles.length);
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length && !signal?.aborted) {
      const t = queue.shift()!;
      try {
        const rec = mem.has(t.key) ? null : await readTile(t.key);
        if (mem.has(t.key) || (rec && rec.f === FORMAT)) cached++;
        else if (await tileRoads(t, { signal })) saved++;
        else failed++;
      } catch { failed++; }
      onProgress?.(++done, tiles.length);
    }
  }));
  return { saved, cached, failed };
}

/** Wie viele Strassen-Kacheln sind gespeichert? */
export async function roadTileCount(): Promise<number> {
  try { return await (await db()).count(ROADS_STORE); } catch { return 0; }
}

/** Sind alle Kacheln dieses Gebiets gespeichert? */
export async function roadsStored(b: Bounds): Promise<boolean> {
  try {
    const d = await db();
    for (const t of roadTiles(b, TILE_M)) if (!mem.has(t.key) && !(await d.getKey(ROADS_STORE, t.key))) return false;
    return true;
  } catch { return false; }
}

export async function clearRoads(): Promise<void> {
  mem.clear();
  try { await (await db()).clear(ROADS_STORE); } catch { /* egal */ }
}

/** Rechteck um ein Zielgebiet (Rechteck oder Ring) */
export function targetBounds(t: RoadTarget): Bounds {
  if (!Array.isArray(t)) return t;
  return { minE: Math.min(...t.map((p) => p.e)), maxE: Math.max(...t.map((p) => p.e)), minN: Math.min(...t.map((p) => p.n)), maxN: Math.max(...t.map((p) => p.n)) };
}

/** Optionen der Platzierung in der App: Strassenrand (Hinterhalt) und Hinweis aus der Meldung */
export type PlaceTryOptions = PlaceOptions & { along?: boolean; signal?: AbortSignal; hint?: RoadHint };

/**
 * Strassen für ein Zielgebiet holen (Speicher/Netz) – mit Rand, damit eine im Text genannte Strasse knapp
 * ausserhalb des Gebiets auch gefunden wird.
 */
export async function roadsForTarget(target: RoadTarget, o: { signal?: AbortSignal } = {}): Promise<{ roads: RoadSegment[]; missing: number }> {
  const b = targetBounds(target);
  const m = NAMED_ROAD_NEAR;
  return getRoadsInfo({ minE: b.minE - m, maxE: b.maxE + m, minN: b.minN - m, maxN: b.maxN + m }, o);
}

/** Zeichen auf eine der gegebenen Strassen legen (ohne Laden, sofort). Siehe `placeOnRoad` (Kandidaten, mehrdeutig). */
export function placeWith(target: RoadTarget, roads: RoadSegment[], prefer?: LV95, o: PlaceTryOptions = {}): RoadPlacement | null {
  if (!roads.length) return null;
  const { along, signal: _s, hint, ...rest } = o;
  const opts: PlaceOptions = { ...rest, motorway: o.motorway ?? hint === "autobahn" };
  return along ? placeAlongRoad(target, roads, prefer, 25, opts) : placeOnRoad(target, roads, prefer, opts);
}

/**
 * Alles in einem: Strassen fürs Gebiet holen (Speicher/Netz) und das Zeichen darauf legen.
 * `along` = Strassenrand (Hinterhalt) statt Strassenmitte. `hint`: «haupt» = höchster Rang ohne Autobahn (Standard),
 * «autobahn» = Autobahn normal werten (sie gewinnt dann). `text` = Meldungstext (genannte Strasse gewinnt),
 * `road`/`segId` = von Hand gewählte Strasse. `pl` = null, wenn keine Strasse bekannt ist;
 * `complete` = false, wenn Kacheln fehlten (offline/Fehler) – dann lohnt sich später ein neuer Versuch.
 */
export async function placeOnRoadTry(target: RoadTarget, prefer?: LV95, o: PlaceTryOptions = {}): Promise<{ pl: RoadPlacement | null; complete: boolean }> {
  try {
    const named = !!(o.text || o.road);
    const { roads, missing } = named ? await roadsForTarget(target, { signal: o.signal }) : await getRoadsInfo(targetBounds(target), { signal: o.signal });
    if (o.signal?.aborted) return { pl: null, complete: false };
    return { pl: placeWith(target, roads, prefer, o), complete: missing === 0 };
  } catch {
    return { pl: null, complete: false };
  }
}

/** Wie `placeOnRoadTry`, nur das Ergebnis (null, wenn keine Strasse bekannt ist). */
export async function placeOnRoadIn(target: RoadTarget, prefer?: LV95, o: PlaceTryOptions = {}): Promise<RoadPlacement | null> {
  return (await placeOnRoadTry(target, prefer, o)).pl;
}
