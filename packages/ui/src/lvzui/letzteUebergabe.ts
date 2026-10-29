/**
 * «Letzte Übergabe als PDF» (Prüfung Übergabe M1): beim Abschliessen wird der Inhalt der Übergabe mit Visum auf diesem
 * Gerät gemerkt (`localStorage`, pro Übung). So bleibt das Übergabe-PDF mit beiden Kürzeln greifbar, auch wenn der
 * Dialog schon die neue Schicht zeigt (Menü ☰ und Übergabe-Dialog). Nur lokal, nie nach aussen.
 */
import type { UebergabeDaten } from "./uebergabeDaten";

export interface LetzteUebergabe {
  d: UebergabeDaten;
  visum: { von: string; an: string; um: string };
  /** Lagezeit der Übergabe (ISO lokal) */
  t: string;
}

const KEY = (exId: string) => `lage-tools.letzteUebergabe.${exId}`;
const EVENT = "lage:letzte-uebergabe";

export function speichereLetzteUebergabe(exId: string, lu: LetzteUebergabe): void {
  try { localStorage.setItem(KEY(exId), JSON.stringify(lu)); } catch { /* gesperrter Speicher: nur in diesem Fenster */ }
  MEM.set(exId, lu);
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: exId })); } catch { /* egal */ }
}

const MEM = new Map<string, LetzteUebergabe>();
export function ladeLetzteUebergabe(exId: string): LetzteUebergabe | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(exId)) ?? "null") as LetzteUebergabe | null;
    if (v && v.d && v.visum && typeof v.t === "string") return v;
  } catch { /* weiter */ }
  return MEM.get(exId) ?? null;
}

/** «06:45 BSP → WMA» */
export const letzteUebergabeText = (lu: LetzteUebergabe) => `${lu.visum.um} ${lu.visum.von || "–"} → ${lu.visum.an}`;

/** Änderungen (anderes Fenster, eben abgeschlossen) mitbekommen */
export function onLetzteUebergabe(f: () => void): () => void {
  const a = () => f();
  const b = (e: StorageEvent) => { if (e.key?.startsWith("lage-tools.letzteUebergabe.")) f(); };
  window.addEventListener(EVENT, a);
  window.addEventListener("storage", b);
  return () => { window.removeEventListener(EVENT, a); window.removeEventListener("storage", b); };
}

/** PDF herunterladen (jsPDF erst jetzt nachladen) */
export async function ladeUebergabePdf(name: string, lu: LetzteUebergabe): Promise<void> {
  const { uebergabePdf } = await import("./uebergabePdf");
  const blob = uebergabePdf(lu.d, lu.visum);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Uebergabe_${name.replace(/[^\wäöüÄÖÜ-]+/g, "_")}_${lu.t.replace(/[:T]/g, "-")}.pdf`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
