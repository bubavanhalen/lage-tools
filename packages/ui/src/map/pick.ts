/**
 * Treffen auf der Karte (Spez. MVP 3.5, S12, B4) – reine Regeln ohne Leaflet, geprüft in test/pick.test.ts.
 *
 * Ein Tipp/Klick auf die Karte neben ein Zeichen (nicht direkt darauf – das bleibt wie heute) sucht unter allen
 * platzierten, nicht verdeckten Zeichen (auch den obersten geschlossener Stapel) nach dem Bildschirmabstand zum Anker.
 * Radius: halbe Trefferfläche, `TREFFER_PX.coarse / 2` (Finger/Handschuh, 24 px) bzw. `TREFFER_PX.fine / 2` (Maus, 16 px).
 * - 0 Kandidaten → wie heute (Klick auf leere Karte),
 * - 1 → wählen (geschlossener Stapel: auffächern),
 * - ≥ 2 verschiedene → Auswahlliste «Welches Zeichen?» (höchstens `AUSWAHL_MAX` Zeilen, dann «weitere …»).
 */
import { TREFFER_PX } from "@lage/core";

/** ein Ziel auf dem Bildschirm (Containerpixel des Ankers) */
export interface PickZiel<T = unknown> {
  id: string;
  x: number;
  y: number;
  /** Stapel-Gruppe (gleiche Zahl = gleicher geschlossener Stapel), -1 = einzeln */
  stapel: number;
  /** oberstes Zeichen seines Stapels bzw. einzeln (nur diese sind Kandidaten; die übrigen sind verdeckt) */
  oben: boolean;
  /** verdeckt (Stapel geschlossen, nicht zuoberst) oder ausgeblendet */
  verdeckt?: boolean;
  data?: T;
}

export interface PickTreffer<T = unknown> extends PickZiel<T> { dist: number }

/** Zeilen der Auswahlliste, danach «weitere …» */
export const AUSWAHL_MAX = 6;

/** Radius in px je Zeigerart (halbe Trefferfläche) */
export function trefferRadius(coarse: boolean): number {
  return (coarse ? TREFFER_PX.coarse : TREFFER_PX.fine) / 2;
}

/** grobe Zeiger (Finger, Handschuh, Stift ohne Maus)? */
export function istGrob(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/**
 * Kandidaten im Radius um `p`, nach Abstand sortiert. Verdeckte Zeichen zählen nicht; ein geschlossener Stapel zählt
 * einmal (sein oberstes Zeichen). Gleich weit: Reihenfolge der Eingabe (= Rang auf der Karte).
 */
export function pickAt<T>(p: { x: number; y: number }, radiusPx: number, ziele: ReadonlyArray<PickZiel<T>>): Array<PickTreffer<T>> {
  const out: Array<PickTreffer<T> & { i: number }> = [];
  const stapel = new Set<number>();
  ziele.forEach((z, i) => {
    if (z.verdeckt || !z.oben) return;
    const dist = Math.hypot(z.x - p.x, z.y - p.y);
    if (dist > radiusPx) return;
    if (z.stapel >= 0) { if (stapel.has(z.stapel)) return; stapel.add(z.stapel); }
    out.push({ ...z, dist, i });
  });
  return out.sort((a, b) => a.dist - b.dist || a.i - b.i).map(({ i: _i, ...r }) => r);
}

/** Was tut der Tipp? «leer» (wie heute), «waehlen» (genau ein Kandidat) oder «liste» (≥ 2 verschiedene) */
export function pickAktion(n: number): "leer" | "waehlen" | "liste" {
  return n <= 0 ? "leer" : n === 1 ? "waehlen" : "liste";
}
