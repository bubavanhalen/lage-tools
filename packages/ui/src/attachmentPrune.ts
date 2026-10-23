/**
 * Welche Anhänge braucht niemand mehr? (reine Funktion, ohne Browser – getestet in test/foto.test.ts)
 */
import type { Exercise } from "@lage/core";

/** so lange nach dem Löschen einer Meldung warten, bevor ihre Anhänge freigegeben werden (Rückgängig bleibt möglich) */
export const PRUNE_AFTER_MS = 60000;

/**
 * Anhänge, die niemand mehr braucht: nur an gelöschten Meldungen (länger als `PRUNE_AFTER_MS` gelöscht) bzw. Fotos
 * ohne Meldung und ohne Planquadrat. Ungebrauchte Sprachmemos (Memo-Fach) und Fotos an einem Planquadrat bleiben.
 */
export function pruneAttachments(ex: Pick<Exercise, "attachments" | "events">, now = Date.now()): string[] {
  const live = new Set<string>(), dead = new Map<string, number>();
  for (const e of ex.events ?? []) for (const id of e.attachments ?? []) {
    if (!e.deleted) live.add(id);
    else dead.set(id, Math.max(dead.get(id) ?? 0, Date.parse(e.updatedAt) || now));
  }
  return (ex.attachments ?? []).filter((a) => {
    if (live.has(a.id) || a.cell) return false;
    const t = dead.get(a.id);
    if (t !== undefined) return now - t >= PRUNE_AFTER_MS;
    return a.kind === "foto";
  }).map((a) => a.id);
}
