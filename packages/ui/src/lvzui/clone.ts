import type { Exercise } from "@lage/core";

/**
 * Kopie der Übung für `update` in der Hülle (P3, Spez. MVP 3 Kap. 3.12): wie `structuredClone`, aber ohne die grossen
 * Bilddaten (`overlays[].dataUrl`, Megabytes) – die Zeichenkette wird übernommen (nie an Ort und Stelle geändert).
 * Anhänge sind nur Metadaten mit flachen Feldern (flache Kopie je Anhang).
 */
export function cloneForUpdate(x: Exercise): Exercise {
  const { overlays, attachments, ...rest } = x;
  const c = structuredClone(rest) as Exercise;
  if (overlays) c.overlays = overlays.map((o) => ({ ...structuredClone({ ...o, dataUrl: "" }), dataUrl: o.dataUrl }));
  if (attachments) c.attachments = attachments.map((a) => ({ ...a }));
  return c;
}
