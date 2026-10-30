/**
 * Datei sichern (Spez. MVP 3.5, S9, A7) – Phase 0 fertig: wann wurde die Übung auf diesem Gerät zuletzt als Datei
 * gesichert («Datei für anderes Gerät …»)? Ohne Abgleich liegt das Journal sonst nur auf einem Gerät. Gespeichert pro
 * Übung in `localStorage[DATEI_KEY(exId)]` (ISO UTC); Fenster gleichen über `storage` ab. Paket A zeigt «zuletzt 07:31»
 * im Menü und im Popover, Paket D bietet den Schritt «Datei sichern» nach der Übergabe an (`dateiErinnern`).
 */
import { useEffect, useState } from "react";
import { DATEI_SICHERN_NACH_MIN } from "@lage/core";
import { DATEI_KEY } from "../shell/contracts";

const hoerer = new Set<(exId: string) => void>();

/** nach erfolgreichem «Datei für anderes Gerät …» (Workspace) */
export function markDateiGesichert(exId: string, at: Date = new Date()): void {
  try { localStorage.setItem(DATEI_KEY(exId), at.toISOString()); } catch { /* Speicher gesperrt: nur diese Sitzung nicht */ }
  for (const h of hoerer) h(exId);
}

/** letzte Sicherung (ISO UTC) oder null (nie, oder Speicher gesperrt) */
export function dateiGesichertAm(exId: string): string | null {
  try { const v = localStorage.getItem(DATEI_KEY(exId)); return v && !Number.isNaN(Date.parse(v)) ? v : null; } catch { return null; }
}

/** «Datei sichern» anbieten? nie gesichert oder älter als `DATEI_SICHERN_NACH_MIN` */
export function dateiErinnern(exId: string, now: Date = new Date()): boolean {
  const am = dateiGesichertAm(exId);
  return !am || now.getTime() - Date.parse(am) > DATEI_SICHERN_NACH_MIN * 60000;
}

/** «zuletzt 07:31» bzw. «nie gesichert» (Menü, Popover); Tag dazu, wenn nicht heute («zuletzt 14.05. 22:10») */
export function dateiText(am: string | null, now: Date = new Date()): string {
  if (!am) return "nie gesichert";
  const d = new Date(am);
  const p = (n: number) => String(n).padStart(2, "0");
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const heute = d.toDateString() === now.toDateString();
  return `zuletzt ${heute ? "" : `${p(d.getDate())}.${p(d.getMonth() + 1)}. `}${hm}`;
}

/** letzte Sicherung der angezeigten Übung, folgt Änderungen (dieses und andere Fenster) */
export function useDateiGesichert(exId: string | null | undefined): string | null {
  const [am, setAm] = useState(() => (exId ? dateiGesichertAm(exId) : null));
  useEffect(() => {
    setAm(exId ? dateiGesichertAm(exId) : null);
    if (!exId) return;
    const h = (id: string) => { if (id === exId) setAm(dateiGesichertAm(exId)); };
    const st = (e: StorageEvent) => { if (e.key === DATEI_KEY(exId)) setAm(dateiGesichertAm(exId)); };
    hoerer.add(h);
    window.addEventListener("storage", st);
    return () => { hoerer.delete(h); window.removeEventListener("storage", st); };
  }, [exId]);
  return am;
}
