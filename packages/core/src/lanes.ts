/**
 * Zeitstrahl mit Schwimmbahnen: Spuren, Zeitachse, Stapelung gleichzeitiger Meldungen.
 * Reine Funktionen ohne Laufzeit-Abhängigkeiten (Zeiten in ms, lokale Zeit).
 */
import { compareEvents, zeitMs } from "./clock";
import type { Exercise, LageEvent } from "./model";

export type LaneGroup = "feind" | "ul" | "eigen";
export type DotKind = "eigen" | "feind" | "unklar" | "ul";

export interface Lane {
  key: string;
  label: string;
  group: LaneGroup;
  /** Sammelspur (z. B. «Sichtungen» ohne bekanntes Feindelement) */
  sammel?: boolean;
  /** Anzahl Meldungen in dieser Spur (ohne Melder-Ringe) */
  count: number;
}

export interface LaneItem {
  id: string;
  /** Zeitpunkt in ms (lokale Zeit) */
  ms: number;
  lane: string;
  kind: DotKind;
  /** Meldung mit Ort (Koordinate, Planquadrat, NAI …) → gefüllter Punkt; ohne Ort → hohl */
  located: boolean;
  /** Spur des Melders, wenn er nicht selbst das Element der Meldung ist (Sichtung → Melder) */
  melderLane?: string;
}

export const LANE_GROUP_LABEL: Record<LaneGroup, string> = { feind: "Feind", ul: "UL", eigen: "Eigene" };
const SAMMEL_LABEL: Record<LaneGroup, string> = { feind: "Sichtungen", ul: "UL", eigen: "ohne Element" };

const norm = (s: string) => s.toLowerCase().replace(/[\s.\-_]/g, "").replace(/(\D)0+(\d)/g, "$1$2");

export function dotKind(e: Pick<LageEvent, "side" | "aff">): DotKind {
  if (e.side === "blau") return "eigen";
  if (e.side === "ul") return "ul";
  return e.aff === "U" ? "unklar" : "feind";
}

/**
 * Spuren für den Zeitstrahl: Feind oben (bekannte Elemente aus `units.rot`, weitere in Reihenfolge des
 * ersten Auftretens, zuletzt die Sammelspur «Sichtungen»), dann UL, dann Eigene (Elemente aus `units.blau`,
 * weitere Elemente und Melder in Reihenfolge des ersten Auftretens).
 */
export function buildLanes(events: LageEvent[], units: Exercise["units"]): { lanes: Lane[]; items: LaneItem[] } {
  const live = events.filter((e) => !e.deleted).sort(compareEvents);
  const groups: Record<LaneGroup, Lane[]> = { feind: [], ul: [], eigen: [] };
  const byKey = new Map<string, Lane>();
  const lane = (group: LaneGroup, name: string): Lane => {
    const label = name.trim();
    const key = label ? `${group}:${norm(label)}` : `${group}:*`;
    let l = byKey.get(key);
    if (!l) {
      l = label ? { key, label, group, count: 0 } : { key, label: SAMMEL_LABEL[group], group, sammel: true, count: 0 };
      byKey.set(key, l);
      groups[group].push(l);
    }
    return l;
  };
  for (const u of units?.rot ?? []) if (u.trim()) lane("feind", u);
  for (const u of units?.ul ?? []) if (u.trim()) lane("ul", u);
  for (const u of units?.blau ?? []) if (u.trim()) lane("eigen", u);

  const items: LaneItem[] = [];
  for (const e of live) {
    const ms = zeitMs(e);
    if (!Number.isFinite(ms)) continue;
    const group: LaneGroup = e.side === "blau" ? "eigen" : e.side === "ul" ? "ul" : "feind";
    const melder = e.melder?.trim() ?? "";
    const unit = e.unit?.trim() || (group === "eigen" ? melder : "");
    const l = lane(group, unit);
    l.count++;
    const melderLane = melder && !(group === "eigen" && norm(melder) === norm(unit)) ? lane("eigen", melder).key : undefined;
    items.push({ id: e.id, ms, lane: l.key, kind: dotKind(e), located: !!(e.pos || e.cells?.length), ...(melderLane ? { melderLane } : {}) });
  }
  const sammelLast = (ls: Lane[]) => [...ls.filter((l) => !l.sammel), ...ls.filter((l) => l.sammel)];
  return { lanes: [...sammelLast(groups.feind), ...sammelLast(groups.ul), ...sammelLast(groups.eigen)], items };
}

// ---------- Zeit ----------

const HOUR = 3600000;
const floorHour = (ms: number) => { const d = new Date(ms); d.setMinutes(0, 0, 0); return d.getTime(); };
const ceilHour = (ms: number) => { const f = floorHour(ms); return f === ms ? ms : floorHour(f + HOUR + 1000); };

/**
 * Zeitpunkt der Lage «Live»: jetzt, solange die Übung läuft (letzte Meldung jünger als 12 h),
 * sonst die letzte Meldung. Entspricht der Regel im Workspace.
 */
export function liveTime(lastMs: number | undefined, nowMs: number): number {
  if (lastMs === undefined) return nowMs;
  return nowMs - lastMs < 12 * HOUR ? Math.max(nowMs, lastMs) : lastMs;
}

/** Bereich des Zeitstrahls: früheste Meldung abgerundet auf die volle Stunde, Live-Zeit (mind. letzte Meldung + 1 min) aufgerundet. */
export function timeBounds(firstMs: number | undefined, lastMs: number | undefined, liveMs: number): { t0: number; t1: number } {
  const t0 = floorHour(firstMs ?? liveMs - HOUR);
  let t1 = ceilHour(Math.max((lastMs ?? liveMs) + 60000, liveMs));
  if (t1 - t0 < HOUR) t1 = t0 + HOUR;
  return { t0, t1 };
}

const MAJOR = [60, 120, 180, 360, 720, 1440, 2880, 10080];
const MINOR = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];

/** Schrittweiten der Achse (Minuten): Beschriftung mind. `labelPx` auseinander, Nebenlinien mind. `minorPx`. */
export function axisSteps(pxPerMin: number, labelPx = 84, minorPx = 14): { major: number; minor: number } {
  const major = MAJOR.find((s) => s * pxPerMin >= labelPx) ?? MAJOR[MAJOR.length - 1]!;
  const minor = MINOR.find((s) => s < major && major % s === 0 && s * pxPerMin >= minorPx) ?? major;
  return { major, minor };
}

/** Linien der Zeitachse im Bereich [v0, v1] (ms), ausgerichtet auf die lokale Uhrzeit. */
export function axisTicks(v0: number, v1: number, pxPerMin: number, labelPx = 84, minorPx = 14): { major: number[]; minor: number[]; steps: { major: number; minor: number } } {
  const steps = axisSteps(pxPerMin, labelPx, minorPx);
  const major: number[] = [];
  const minor: number[] = [];
  const d0 = new Date(v0);
  d0.setHours(0, 0, 0, 0);
  // ab Mitternacht des ersten Tages in Nebenschritten (lokale Uhrzeit, robust gegen Sommerzeit-Wechsel)
  for (let day = d0.getTime(); day <= v1; ) {
    const d = new Date(day);
    for (let m = 0; m < 1440; m += steps.minor) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m).getTime();
      if (t < v0 || t > v1) continue;
      const dayIndex = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - d0.getTime()) / 86400000);
      const isMajor = steps.major <= 1440 ? m % steps.major === 0 : m === 0 && (dayIndex * 1440) % steps.major === 0;
      (isMajor ? major : minor).push(t);
    }
    day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }
  return { major, minor, steps };
}

// ---------- Stapeln ----------

/**
 * Fasst Punkte zusammen, die höchstens `gap` px nach dem ersten Punkt einer Gruppe liegen.
 * `xs` muss aufsteigend sortiert sein. Liefert pro Punkt Gruppen-Nummer, Index und Grösse der Gruppe.
 */
export function clusterX(xs: number[], gap: number): Array<{ group: number; index: number; size: number }> {
  const out: Array<{ group: number; index: number; size: number }> = [];
  let g = -1, start = -Infinity, idx = 0;
  const sizes: number[] = [];
  for (const x of xs) {
    if (x - start > gap) { g++; start = x; idx = 0; sizes.push(0); }
    out.push({ group: g, index: idx++, size: 0 });
    sizes[g]!++;
  }
  for (const o of out) o.size = sizes[o.group]!;
  return out;
}

/**
 * Versatz für `k` gleichzeitige Punkte (Radius `r`) in einer Spur der Höhe `laneH`:
 * erst übereinander gleichmässig verteilt, bei Platzmangel in bis zu `maxCols` Spalten nebeneinander.
 * Passen nicht alle hin, enthält `offs` einen Platz weniger als Plätze vorhanden sind und der letzte
 * Platz (`badge`) zeigt «+overflow».
 */
export function stackOffsets(k: number, laneH: number, r: number, maxCols = 3): { offs: Array<{ dx: number; dy: number }>; overflow: number; badge?: { dx: number; dy: number } } {
  if (k <= 0) return { offs: [], overflow: 0 };
  const sp = r * 1.4;
  const rows = Math.max(laneH >= 3 * r ? 2 : 1, Math.floor(Math.max(0, laneH - 2 * r) / sp) + 1);
  const cap = rows * maxCols;
  const shown = k > cap ? cap - 1 : k;
  const slots = k > cap ? cap : k;
  const cols = Math.ceil(slots / rows);
  const perCol = Math.ceil(slots / cols);
  const pos: Array<{ dx: number; dy: number }> = [];
  for (let i = 0; i < slots; i++) {
    const c = Math.floor(i / perCol), j = i % perCol;
    const inCol = Math.min(perCol, slots - c * perCol);
    pos.push({ dx: (c - (cols - 1) / 2) * r * 1.7, dy: (j - (inCol - 1) / 2) * sp });
  }
  return k > cap ? { offs: pos.slice(0, shown), overflow: k - shown, badge: pos[cap - 1]! } : { offs: pos, overflow: 0 };
}
