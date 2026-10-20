/** Ebenen der Lagekarte (ein/aus), gemerkt pro Gerät. */
export interface LayerFlags {
  raster: boolean;
  nai: boolean;
  eigene: boolean;
  feind: boolean;
  spuren: boolean;
  zeiten: boolean;
  legende: boolean;
}
export const DEFAULT_FLAGS: LayerFlags = { raster: true, nai: true, eigene: true, feind: true, spuren: true, zeiten: true, legende: true };
const KEY = "lage-tools.layers";
export function loadFlags(): LayerFlags {
  try { return { ...DEFAULT_FLAGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { ...DEFAULT_FLAGS }; }
}
export function saveFlags(f: LayerFlags): void {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* egal */ }
}
