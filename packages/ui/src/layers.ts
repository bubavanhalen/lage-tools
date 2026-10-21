/** Ebenen der Lagekarte (ein/aus), gemerkt pro Gerät. */
export interface LayerFlags {
  raster: boolean;
  nai: boolean;
  eigene: boolean;
  feind: boolean;
  spuren: boolean;
  zeiten: boolean;
  legende: boolean;
  /** Flächen- und Linienzeichen (Minenfeld, Stacheldraht, Phasenlinie …) */
  flaechen: boolean;
  /** Hinweise zu Rot (Fähnchen, Pendel-Routen, Kreis um Stao) */
  hinweise: boolean;
}
export const DEFAULT_FLAGS: LayerFlags = { raster: true, nai: true, eigene: true, feind: true, spuren: true, zeiten: true, legende: true, flaechen: true, hinweise: true };
const KEY = "lage-tools.layers";
export function loadFlags(): LayerFlags {
  try { return { ...DEFAULT_FLAGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { ...DEFAULT_FLAGS }; }
}
export function saveFlags(f: LayerFlags): void {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* egal */ }
}

// ---------- Zeichen fixieren (kein Verschieben auf der Karte), gemerkt pro Gerät
const LOCK_KEY = "lage-tools.zeichen-fixiert";
let locked = (() => { try { return localStorage.getItem(LOCK_KEY) === "1"; } catch { return false; } })();
const lockSubs = new Set<() => void>();
export const isLocked = (): boolean => locked;
export function setLocked(v: boolean): void {
  locked = v;
  try { localStorage.setItem(LOCK_KEY, v ? "1" : "0"); } catch { /* egal */ }
  lockSubs.forEach((cb) => cb());
}
export const subscribeLock = (cb: () => void) => { lockSubs.add(cb); return () => { lockSubs.delete(cb); }; };
