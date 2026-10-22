/**
 * Übung speichern/öffnen mit Anhängen: ohne Anhänge bleibt es eine `.lage.json`; mit Anhängen eine `.lage.zip`
 * (uebung.lage.json + anhaenge/<id>.<endung>). Öffnen liest beides; Anhänge kommen in den Gerätespeicher.
 */
import JSZip from "jszip";
import { exerciseFromFile, exerciseToFile, type Attachment, type Exercise } from "@lage/core";

export const ZIP_JSON = "uebung.lage.json";
export const ZIP_DIR = "anhaenge/";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav" };
export const extOf = (mime: string) => EXT[mime.split(";")[0]!.trim()] ?? "bin";
const fileOf = (a: Attachment) => `${ZIP_DIR}${a.id}.${extOf(a.mime)}`;

export interface SaveResult { blob: Blob; name: string; /** Anhänge in der Datei / ohne Inhalt auf diesem Gerät */ files: number; missing: number }

/**
 * Datei für «Speichern»: JSON oder ZIP (wenn Anhänge da sind). `getBlob` liefert den Inhalt eines Anhangs.
 * Fehlt ein Inhalt (Übung von einem anderen Gerät ohne Anhänge), bleiben nur die Metadaten.
 */
export async function exerciseFile(ex: Exercise, baseName: string, getBlob: (id: string) => Promise<Blob | null>): Promise<SaveResult> {
  const json = exerciseToFile(ex);
  const atts = ex.attachments ?? [];
  if (!atts.length) return { blob: new Blob([json], { type: "application/json" }), name: `${baseName}.lage.json`, files: 0, missing: 0 };
  const zip = new JSZip();
  zip.file(ZIP_JSON, json);
  let files = 0, missing = 0;
  for (const a of atts) {
    const b = await getBlob(a.id);
    if (!b) { missing++; continue; }
    // Fotos/Memos sind schon komprimiert: nur ablegen (schnell)
    zip.file(fileOf(a), b, { compression: "STORE" });
    files++;
  }
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { blob, name: `${baseName}.lage.zip`, files, missing };
}

/** ZIP? (erste Bytes «PK») */
export async function isZip(f: Blob): Promise<boolean> {
  const b = new Uint8Array(await f.slice(0, 4).arrayBuffer());
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

export interface OpenResult { ex: Exercise; files: number }

/** Übungsdatei (JSON oder ZIP) lesen; Anhänge mit `putBlob` in den Gerätespeicher */
export async function exerciseFromAny(f: Blob, putBlob: (id: string, b: Blob) => Promise<void>): Promise<OpenResult> {
  if (!(await isZip(f))) return { ex: exerciseFromFile(await f.text()), files: 0 };
  const zip = await JSZip.loadAsync(await f.arrayBuffer());
  const j = zip.file(ZIP_JSON) ?? zip.file(/\.lage\.json$|\.json$/i)[0];
  if (!j) throw new Error("ZIP enthält keine Übung (uebung.lage.json fehlt)");
  const ex = exerciseFromFile(await j.async("string"));
  let files = 0;
  for (const a of ex.attachments ?? []) {
    const e = zip.file(fileOf(a)) ?? zip.file(new RegExp(`^${ZIP_DIR}${a.id.replace(/[^\w-]/g, "")}\\.`))[0];
    if (!e) continue;
    await putBlob(a.id, new Blob([await e.async("uint8array") as BlobPart], { type: a.mime }));
    files++;
  }
  return { ex, files };
}

export const sizeText = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / 1048576).toFixed(1).replace(".", ",")} MB`);
