/**
 * Anhänge (Fotos, Sprachmemos): Inhalt im Gerätespeicher (`blobs`), Metadaten in `Exercise.attachments`.
 * Vorschaubilder (≈ 320 px) liegen unter `<id>:thumb` – beim Speichern/Import erzeugt, für ältere Anhänge beim ersten
 * Anzeigen nachgeholt; Listen zeigen nur sie. Kartenebene «Anhänge»: Kamera-Symbol am Planquadrat.
 * Speicher freigeben: `pruneAttachments` (Meldung gelöscht, Foto nirgends mehr gebraucht) und `collectOrphanBlobs`.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { cellBounds, findCells, type Attachment, type Exercise, type LV95 } from "@lage/core";
import { toLatLng } from "@lage/map";
import { collectOrphanBlobs, deleteBlob, getBlob, putBlob } from "./store";
import { PRUNE_AFTER_MS, pruneAttachments } from "./attachmentPrune";

export { PRUNE_AFTER_MS, pruneAttachments };

export const thumbKey = (id: string) => `${id}:thumb`;
/** längste Seite des Vorschaubilds (scharf auch auf Retina-Bildschirmen bei 26–160 px Anzeige) */
export const THUMB = 320;

/** Anhang-Metadaten zu IDs (in der Reihenfolge der IDs; fehlende weggelassen) */
export function attachmentsOf(ex: Pick<Exercise, "attachments">, ids?: string[]): Attachment[] {
  if (!ids?.length) return [];
  const all = ex.attachments ?? [];
  return ids.map((id) => all.find((a) => a.id === id)).filter((a): a is Attachment => !!a);
}

/** Vorschaubild (JPEG, längste Seite `THUMB`) aus Canvas oder Bild-Blob */
export async function makeThumb(src: HTMLCanvasElement | Blob): Promise<Blob | null> {
  try {
    const img = src instanceof Blob ? await createImageBitmap(src) : src;
    const k = Math.min(1, THUMB / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
    const c = cv.getContext("2d")!;
    c.imageSmoothingQuality = "high";
    c.drawImage(img, 0, 0, cv.width, cv.height);
    if ("close" in img) img.close();
    return await new Promise<Blob | null>((r) => cv.toBlob(r, "image/jpeg", 0.75));
  } catch {
    return null;
  }
}

/** Inhalt (und bei Fotos ein Vorschaubild) speichern */
export async function storeAttachmentBlob(att: Attachment, blob: Blob, src?: HTMLCanvasElement): Promise<void> {
  await putBlob(att.id, blob);
  if (att.kind === "foto") {
    const t = await makeThumb(src ?? blob);
    if (t) await putBlob(thumbKey(att.id), t).catch(() => { /* ohne Vorschaubild */ });
  }
}

/** Import (ZIP): Inhalt speichern, bei Bildern gleich das Vorschaubild */
export async function putAttachmentBlob(id: string, blob: Blob): Promise<void> {
  await putBlob(id, blob);
  if (blob.type.startsWith("image/")) {
    const t = await makeThumb(blob);
    if (t) await putBlob(thumbKey(id), t).catch(() => { /* ohne Vorschaubild */ });
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
      let b = await getBlob(key);
      if (!b && thumb) {
        // älterer Anhang ohne Vorschaubild: jetzt erzeugen (Listen laden sonst das ganze Foto)
        const orig = await getBlob(id);
        if (orig?.type.startsWith("image/")) {
          b = await makeThumb(orig);
          if (b) await putBlob(key, b).catch(() => { /* egal */ });
        }
        b ??= orig;
      }
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

/** Inhalt und Vorschaubild löschen, zwischengespeicherte URL vergessen */
export async function dropAttachmentBlobs(ids: string[]): Promise<void> {
  for (const id of ids) {
    for (const key of [id, thumbKey(id)]) { const p = urls.get(key); urls.delete(key); p?.then((u) => u && URL.revokeObjectURL(u)); }
    await deleteAttachmentBlob(id);
  }
}

/**
 * Speicher freigeben (im Arbeitsbereich eingebunden): beim Start still verwaiste Inhalte aufräumen; danach Anhänge
 * gelöschter Meldungen nach `PRUNE_AFTER_MS` aus der Übung und dem Gerätespeicher entfernen.
 */
export function useAttachmentGc(ex: Exercise | null, update: (f: (x: Exercise) => Exercise) => void): void {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const t = window.setTimeout(() => { void collectOrphanBlobs(); }, 8000);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!ex?.attachments?.length) return;
    const check = () => {
      const drop = pruneAttachments(ex);
      if (!drop.length) return;
      const gone = new Set(drop);
      update((x) => { x.attachments = (x.attachments ?? []).filter((a) => !gone.has(a.id)); return x; });
      void dropAttachmentBlobs(drop);
    };
    const t = window.setTimeout(check, 1500);
    const iv = window.setInterval(check, PRUNE_AFTER_MS / 2);
    return () => { window.clearTimeout(t); window.clearInterval(iv); };
  }, [ex]); // eslint-disable-line react-hooks/exhaustive-deps
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
