/**
 * Ebenen der Lagekarte (ein/aus) und Grundkarte, gemerkt pro Gerät – getrennt für Basis und Experte
 * (`lage-tools.layers.basis` / `.experte`, Spez. MVP 1, Kap. 3.7). «Zeige letzte» wird nie gespeichert (Paket C).
 * Wirksam auf der Karte ist `effectiveFlags(arbeitsweise, wahl)` (Vertrag in shell/contracts.ts).
 */
import type { Basemap } from "@lage/map";

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
  /** Mögliche Aktionen Rot (Annäherung als Pfeil, Ziel mit Zeitraum, Engnis-Warnung) */
  aktionen: boolean;
  /** Fotos an Planquadraten (Kamera-Symbol) */
  anhaenge: boolean;
}
/** Standard: alles an, Legende aus (Kap. 1.2 «Legende … Standard aus») */
export const DEFAULT_FLAGS: LayerFlags = { raster: true, nai: true, eigene: true, feind: true, spuren: true, zeiten: true, legende: false, flaechen: true, hinweise: true, aktionen: true, anhaenge: true };

export type FlagVariant = "basis" | "experte";
/** vor MVP 1: ein Schlüssel für alle – wird für Experte übernommen */
const KEY_ALT = "lage-tools.layers";
const KEY = (v: FlagVariant) => `${KEY_ALT}.${v}`;
const BASEMAP_KEY = (v: FlagVariant) => `lage-tools.grundkarte.${v}`;

export const flagVariant = (experte: boolean): FlagVariant => (experte ? "experte" : "basis");

export function loadFlags(v: FlagVariant = "basis"): LayerFlags {
  try {
    const raw = localStorage.getItem(KEY(v)) ?? (v === "experte" ? localStorage.getItem(KEY_ALT) : null);
    return { ...DEFAULT_FLAGS, ...JSON.parse(raw ?? "{}") };
  } catch { return { ...DEFAULT_FLAGS }; }
}
export function saveFlags(v: FlagVariant, f: LayerFlags): void {
  try { localStorage.setItem(KEY(v), JSON.stringify(f)); } catch { /* egal */ }
}

/** Grundkarte: Standard «grau» (Landeskarte mit Filter, Kap. 5.4) */
export function loadBasemap(v: FlagVariant = "basis"): Basemap {
  try {
    const b = localStorage.getItem(BASEMAP_KEY(v));
    return b === "lk" || b === "img" || b === "grau" ? b : "grau";
  } catch { return "grau"; }
}
export function saveBasemap(v: FlagVariant, b: Basemap): void {
  try { localStorage.setItem(BASEMAP_KEY(v), b); } catch { /* egal */ }
}

export { effectiveFlags } from "./shell/contracts";

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
