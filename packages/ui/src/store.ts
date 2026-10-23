/**
 * Lokaler Speicher (IndexedDB) für Übungen. Alles bleibt auf dem Gerät.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { Exercise } from "@lage/core";

const DB_NAME = "lage-tools";
/** 1: exercises, meta · 2: roads (Strassen-Kacheln, siehe roadsource.ts) · 3: blobs (Anhänge: Fotos, Sprachmemos) */
const DB_VERSION = 3;
export const ROADS_STORE = "roads";
export const BLOB_STORE = "blobs";

/** so lange höchstens auf die Datenbank warten, wenn ein anderes Fenster das Öffnen blockiert */
const BLOCKED_WAIT_MS = 6000;

type DbNotice = "blocked" | "ready";
const listeners = new Set<(n: DbNotice) => void>();
let blockedNow = false;
/**
 * Hinweise zur Datenbank abonnieren: «blocked» = ein anderes (altes) Lagejournal-Fenster hält die Datenbank offen
 * und verhindert das Aktualisieren → Benutzer soll es schliessen; «ready» = wieder frei.
 */
export function onDbNotice(cb: (n: DbNotice) => void): () => void {
  listeners.add(cb);
  if (blockedNow) cb("blocked");
  return () => { listeners.delete(cb); };
}
const notify = (n: DbNotice) => { blockedNow = n === "blocked"; listeners.forEach((cb) => { try { cb(n); } catch { /* egal */ } }); };

let dbp: Promise<IDBPDatabase> | null = null;
let opened = false;
/**
 * Gemeinsame Datenbank «lage-tools» (alle Stores werden hier angelegt).
 * Hängt nie: Blockiert ein anderes Fenster das Aktualisieren, wird ein Hinweis gemeldet (`onDbNotice`) und der
 * einzelne Zugriff nach `BLOCKED_WAIT_MS` mit einem Fehler beendet (Aufrufer fangen ihn ab); das Öffnen selbst
 * läuft weiter und gelingt, sobald das andere Fenster geschlossen ist.
 */
export function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    opened = false;
    const p = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains("exercises")) d.createObjectStore("exercises", { keyPath: "id" });
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
        if (!d.objectStoreNames.contains(ROADS_STORE)) d.createObjectStore(ROADS_STORE, { keyPath: "key" });
        if (!d.objectStoreNames.contains(BLOB_STORE)) d.createObjectStore(BLOB_STORE);
      },
      // ein älteres Fenster hält die Datenbank offen und lässt das Aktualisieren nicht zu
      blocked() { notify("blocked"); },
      // anderes Fenster will eine neuere Version: Verbindung sofort freigeben, beim nächsten Zugriff neu öffnen
      blocking() { if (dbp === p) dbp = null; p.then((d) => d.close()).catch(() => { /* egal */ }); },
      // Verbindung vom Browser beendet (z. B. Speicher gelöscht): beim nächsten Zugriff neu öffnen
      terminated() { if (dbp === p) dbp = null; },
    });
    dbp = p;
    p.then(() => { opened = true; if (blockedNow) notify("ready"); }, () => { if (dbp === p) dbp = null; });
  }
  const p = dbp;
  if (opened) return p;
  // noch nicht offen: nicht endlos warten (z. B. blockiert durch ein altes Fenster)
  return new Promise<IDBPDatabase>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Datenbank blockiert – andere Lagejournal-Fenster schliessen")), BLOCKED_WAIT_MS);
    p.then((d) => { clearTimeout(t); resolve(d); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function listExercises(): Promise<Array<Pick<Exercise, "id" | "name">>> {
  try {
    const all = (await (await db()).getAll("exercises")) as Exercise[];
    return all.map((e) => ({ id: e.id, name: e.name }));
  } catch {
    return [];
  }
}

export async function loadExercise(id: string): Promise<Exercise | null> {
  try {
    return ((await (await db()).get("exercises", id)) as Exercise) ?? null;
  } catch {
    return null;
  }
}

export async function saveExercise(ex: Exercise): Promise<void> {
  try {
    const d = await db();
    await d.put("exercises", ex);
    await d.put("meta", ex.id, "current");
  } catch {
    /* Speicher nicht verfügbar (privates Fenster) – App läuft trotzdem */
  }
}

export async function deleteExercise(id: string): Promise<void> {
  try {
    await (await db()).delete("exercises", id);
  } catch { /* egal */ }
  // Fotos/Memos der Übung freigeben (sofern keine andere Übung sie braucht)
  await collectOrphanBlobs();
}

export async function currentExerciseId(): Promise<string | null> {
  try {
    return ((await (await db()).get("meta", "current")) as string) ?? null;
  } catch {
    return null;
  }
}

/** Datei im Browser herunterladen. */
export function downloadText(name: string, text: string, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Datei auswählen lassen (gibt null zurück, wenn abgebrochen). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.oncancel = () => resolve(null);
    inp.click();
  });
}

export function safeFileName(s: string): string {
  return s.replace(/[^\p{L}\p{N}_ -]+/gu, "").trim().replace(/\s+/g, "_") || "uebung";
}

// ---------- Anhänge (Inhalt; Metadaten stehen in Exercise.attachments)

/** in dieser Sitzung gespeicherte Inhalte (noch nicht in einer gespeicherten Übung, z. B. Foto im Dialog) – nie aufräumen */
const sessionBlobs = new Set<string>();
const baseId = (key: string) => key.replace(/:thumb$/, "");

/** Inhalt eines Anhangs speichern (Schlüssel = Attachment.id) */
export async function putBlob(id: string, blob: Blob): Promise<void> {
  sessionBlobs.add(baseId(id));
  await (await db()).put(BLOB_STORE, blob, id);
}

/**
 * Verwaiste Inhalte löschen: Fotos/Memos (samt Vorschaubild), die in keiner gespeicherten Übung mehr vorkommen
 * (Übung gelöscht, Meldung gelöscht, Foto im Dialog verworfen). Was in dieser Sitzung gespeichert wurde, bleibt.
 * @returns Anzahl gelöschter Einträge und freigegebene Bytes
 */
export async function collectOrphanBlobs(): Promise<{ n: number; bytes: number }> {
  try {
    const d = await db();
    const used = new Set<string>();
    for (const e of (await d.getAll("exercises")) as Exercise[]) for (const a of e.attachments ?? []) used.add(a.id);
    let n = 0, bytes = 0;
    for (const key of (await d.getAllKeys(BLOB_STORE)) as string[]) {
      const id = baseId(String(key));
      if (used.has(id) || sessionBlobs.has(id)) continue;
      const b = (await d.get(BLOB_STORE, key)) as Blob | undefined;
      bytes += b?.size ?? 0;
      await d.delete(BLOB_STORE, key);
      n++;
    }
    return { n, bytes };
  } catch {
    return { n: 0, bytes: 0 };
  }
}

/** Inhalt eines Anhangs lesen (null, wenn nicht auf diesem Gerät) */
export async function getBlob(id: string): Promise<Blob | null> {
  try {
    return ((await (await db()).get(BLOB_STORE, id)) as Blob | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function deleteBlob(id: string): Promise<void> {
  try { await (await db()).delete(BLOB_STORE, id); } catch { /* egal */ }
}
