/**
 * «bei Hxx»-Zeichen neben den Trupp (Review 6 Einsatz M5): Eine Sichtung ohne eigenen Ort steht am Standort des
 * meldenden bzw. genannten Trupps («bei H03») – genau auf dem Trupp-Zeichen. Auf Bildschirm und Lagekarte verdeckte sie
 * den Trupp samt Namen. Solche Zeichen rücken deshalb neben den Trupp: oben, links, unten, oben links, unten links …
 * (rechts steht der Name des Trupps). Der wahre Ort bleibt der Ort des Trupps (Tooltip, Liste, Auswahl).
 * Reine Funktionen (Bildschirm `situationLayer.ts`, Druck `print/lagekarte.ts`), Test `ui/test/beiTrupp.test.ts`.
 */
import type { Box, LV95 } from "@lage/core";

/** gleicher Ort (m): der Ort einer «bei Hxx»-Sichtung ist der Standort des Trupps, auf den Meter genau */
const GLEICH_M = 1;

export interface BeiTruppItem { kind: string; isUnit: boolean; pos: LV95; road?: unknown; e: { id: string; t: string } }

/**
 * Sichtungen (nicht eigen, nicht an der Strasse), die genau auf dem Standort eines eigenen Trupps liegen → Trupp und
 * Platz-Nummer (0 = neueste, dicht am Trupp). Eigene Meldungen ohne Element (Ereignisse) zählen wie Sichtungen.
 */
export function beiTruppZuordnung<T extends BeiTruppItem>(items: readonly T[]): Map<T, { trupp: T; slot: number }> {
  const out = new Map<T, { trupp: T; slot: number }>();
  const trupps = items.filter((i) => i.kind === "eigen" && i.isUnit);
  if (!trupps.length) return out;
  const je = new Map<T, T[]>();
  for (const it of items) {
    if (it.isUnit && it.kind === "eigen") continue;
    if (it.road) continue;
    const tr = trupps.find((t) => Math.abs(t.pos.e - it.pos.e) < GLEICH_M && Math.abs(t.pos.n - it.pos.n) < GLEICH_M);
    if (!tr) continue;
    const l = je.get(tr) ?? [];
    l.push(it);
    je.set(tr, l);
  }
  for (const [tr, l] of je) {
    l.sort((a, b) => b.e.t.localeCompare(a.e.t) || a.e.id.localeCompare(b.e.id));
    l.forEach((it, slot) => out.set(it, { trupp: tr, slot }));
  }
  return out;
}

/** Richtungen der Plätze: oben, links, unten, oben links, unten links, oben rechts, unten rechts (x, y ∈ −1/0/1) */
const PLAETZE: ReadonlyArray<readonly [number, number]> = [[0, -1], [-1, 0], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

/**
 * Versatz (Pixel, x nach rechts, y nach unten) für ein Zeichen mit Rahmen `kern` neben dem Trupp mit Rahmen
 * `truppKern` (beide relativ zum Anker): berührungsfrei mit `luft` px Abstand. Ab dem 8. Platz in einem zweiten Ring.
 */
export function beiVersatz(slot: number, truppKern: Box, kern: Box, luft = 3): [number, number] {
  const [ux, uy] = PLAETZE[slot % PLAETZE.length]!;
  const ring = 1 + Math.floor(slot / PLAETZE.length);
  const w = kern[2] - kern[0], h = kern[3] - kern[1];
  const x = ux < 0 ? truppKern[0] - kern[2] - luft - (ring - 1) * (w + luft) : ux > 0 ? truppKern[2] - kern[0] + luft + (ring - 1) * (w + luft) : 0;
  const y = uy < 0 ? truppKern[1] - kern[3] - luft - (ring - 1) * (h + luft) : uy > 0 ? truppKern[3] - kern[1] + luft + (ring - 1) * (h + luft) : 0;
  return [Math.round(x), Math.round(y)];
}
