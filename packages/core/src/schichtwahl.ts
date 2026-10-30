/**
 * Zuordnung der Einträge zu Schichten (MVP 3 Fix 3) – eigenes Modul ohne Abhängigkeiten ausser dem Modell, damit
 * journal.ts (CSV) und schicht.ts (Übergabe, Zahlen) dieselbe Regel verwenden, ohne sich gegenseitig zu importieren.
 */
import { zeitBis } from "./clock";
import type { Exercise, LageEvent, SchichtWechsel } from "./model";

/** Zeitpunkt der Erfassung (ISO UTC): `createdAt`, bei alten Einträgen `updatedAt` */
export const erfasstUm = (e: Pick<LageEvent, "createdAt" | "updatedAt">): string => e.createdAt ?? e.updatedAt;

/**
 * Einträge einer Schicht (MVP 3 Fix 3) – **eine** Regel für Übergabe (Kopf, «Neu», Zahlen), Druck («Diese Schicht»,
 * «Letzte Schicht», Journal-PDF) und CSV (Spalte «Schicht»): erfasst ab `at` (Schichtbeginn, ISO UTC; null = von Anfang)
 * und vor `bis` (nächster Wechsel), Lagezeit ≤ `to` (ISO lokal, wenn gesetzt). Gestrichene nur mit `o.gestrichene`.
 * Ein Eintrag gehört so genau einer Schicht – auch nachgetragene mit früherer Lagezeit, nie die der nächsten Schicht
 * zur gleichen Minute.
 */
export function schichtEintraege(ex: Pick<Exercise, "events">, s: { at: string | null; bis?: string | null }, to?: string | null, o: { gestrichene?: boolean } = {}): LageEvent[] {
  return (ex.events ?? []).filter((e) => {
    if (e.deleted && !o.gestrichene) return false;
    const at = erfasstUm(e);
    return (!s.at || at >= s.at) && (!s.bis || at < s.bis) && (!to || zeitBis(e, to));
  });
}

/** Schicht, in der ein Eintrag erfasst wurde (jüngster Wechsel mit `at` ≤ erfasst) – für die CSV-Spalte «Schicht» */
export function schichtZuordnung(ex: Pick<Exercise, "schichten">): (e: Pick<LageEvent, "createdAt" | "updatedAt">) => SchichtWechsel | null {
  const ws = [...(ex.schichten ?? [])].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return (e) => {
    const at = erfasstUm(e);
    let best: SchichtWechsel | null = null;
    for (const w of ws) { if (w.at <= at) best = w; else break; }
    return best;
  };
}

