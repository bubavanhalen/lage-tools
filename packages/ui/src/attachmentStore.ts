/**
 * Anhänge (Fotos, Sprachmemos): Inhalt im Gerätespeicher (`blobs`), Metadaten in `Exercise.attachments`.
 * Vorschaubilder (klein) liegen unter `<id>:thumb`. Kartenebene «Anhänge»: Kamera-Symbol am Planquadrat.
 */
import { useEffect, useState } from "react";
import L from "leaflet";
import { cellBounds, findCells, type Attachment, type Exercise, type LV95 } from "@lage/core";
import { toLatLng } from "@lage/map";
import { deleteBlob, getBlob, putBlob } from "./store";

export const thumbKey = (id: string) => `${id}:thumb`;
const THUMB = 160;

/** Anhang-Metadaten zu IDs (in der Reihenfolge der IDs; fehlende weggelassen) */
export function attachmentsOf(ex: Pick<Exercise, "attachments">, ids?: string[]): Attachment[] {
  if (!ids?.length) return [];
  const all = ex.attachments ?? [];
  return ids.map((id) => all.find((a) => a.id === id)).filter((a): a is Attachment => !!a);
}

/** Inhalt (und bei Fotos ein Vorschaubild) speichern */
export async function storeAttachmentBlob(att: Attachment, blob: Blob, src?: HTMLCanvasElement): Promise<void> {
  await putBlob(att.id, blob);
  if (att.kind === "foto" && src) {
    try {
      const k = Math.min(1, THUMB / Math.max(src.width, src.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(src.width * k)); cv.height = Math.max(1, Math.round(src.height * k));
      const c = cv.getContext("2d")!;
      c.imageSmoothingQuality = "high";
      c.drawImage(src, 0, 0, cv.width, cv.height);
      const t = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/jpeg", 0.7));
      if (t) await putBlob(thumbKey(att.id), t);
    } catch { /* ohne Vorschaubild */ }
  }
}

export async function deleteAttachmentBlob(id: string): Promise<void> {
  await deleteBlob(id);
  await deleteBlob(thumbKey(id));
}

// Objekt-URLs wiederverwenden (Liste mit vielen Zeilen, Banner, Betrachter)
const urls = new Map<string, Promise<string | null>>();
/** Objekt-URL zum Anhang (bzw. zum Vorschaubild, falls `thumb`; sonst Original) – null, wenn nicht auf dem Gerät */
export function blobUrl(id: string, thumb = false): Promise<string | null> {
  const key = thumb ? thumbKey(id) : id;
  let p = urls.get(key);
  if (!p) {
    p = (async () => {
      const b = (await getBlob(key)) ?? (thumb ? await getBlob(id) : null);
      return b ? URL.createObjectURL(b) : null;
    })();
    urls.set(key, p);
    p.then((u) => { if (!u) urls.delete(key); });
  }
  return p;
}
/** nach Import/Löschen: zwischengespeicherte URLs vergessen */
export function forgetBlobUrls(): void {
  for (const p of urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
  urls.clear();
}

export function useBlobUrl(id: string | undefined, thumb = false): string | null | undefined {
  const [u, setU] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!id) { setU(null); return; }
    let on = true;
    setU(undefined);
    blobUrl(id, thumb).then((x) => { if (on) setU(x); });
    return () => { on = false; };
  }, [id, thumb]);
  return u;
}

/** Anhang im Gerätespeicher? (Übung von einem anderen Gerät geöffnet: nur Metadaten) */
export async function hasBlob(id: string): Promise<boolean> {
  return !!(await getBlob(id));
}

export const fmtTime = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
export const attLabel = (a: Attachment) => `${a.kind === "audio" ? "Memo" : "Foto"} ${fmtTime(a.createdAt)}`;

// ---------------------------------------------------------------- Kartenebene «Anhänge»

const CAM = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 7.5h3l1.6-2h6.8l1.6 2h3c.6 0 1 .4 1 1V18c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V8.5c0-.6.4-1 1-1z" fill="#fff" stroke="#101414" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.4" fill="none" stroke="#101414" stroke-width="1.6"/></svg>';

/** Ort fürs Kamera-Symbol: oben links im Planquadrat (die Mitte gehört den Zeichen) */
function cellCenter(ex: Exercise, cell: string): LV95 | null {
  const c = findCells(cell, ex.sheets)[0];
  const sh = c && ex.sheets.find((s) => s.id === c.sheetId);
  if (!c || !sh) return null;
  const b = cellBounds(sh, c.col, c.row, c.quadrant);
  return { e: b.minE + 0.2 * (b.maxE - b.minE), n: b.maxN - 0.2 * (b.maxN - b.minN) };
}

/** Kamera-Symbol an jedem Planquadrat mit Foto (Zahl bei mehreren) */
export function attachmentLayer(ex: Exercise, onClick: (atts: Attachment[]) => void): L.LayerGroup {
  const g = L.layerGroup();
  const byCell = new Map<string, Attachment[]>();
  for (const a of ex.attachments ?? []) if (a.cell) byCell.set(a.cell.toUpperCase(), [...(byCell.get(a.cell.toUpperCase()) ?? []), a]);
  for (const [cell, list] of byCell) {
    const p = cellCenter(ex, cell);
    if (!p) continue;
    const n = list.length;
    const icon = L.divIcon({
      className: "att-cam",
      html: `<span class="att-cam-b" title="${n} ${n === 1 ? "Foto" : "Fotos"} an ${cell}">${CAM}${n > 1 ? `<b>${n}</b>` : ""}</span>`,
      iconSize: [n > 1 ? 36 : 26, 22], iconAnchor: [n > 1 ? 18 : 13, 11],
    });
    const m = L.marker(toLatLng(p), { icon, keyboard: true, title: `Foto an ${cell}`, zIndexOffset: 400 });
    m.on("click", () => onClick(list));
    g.addLayer(m);
  }
  return g;
}
