/**
 * Lokaler Speicher (IndexedDB) für Übungen. Alles bleibt auf dem Gerät.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { Exercise } from "@lage/core";

const DB_NAME = "lage-tools";
/** 1: exercises, meta · 2: roads (Strassen-Kacheln, siehe roadsource.ts) */
const DB_VERSION = 2;
export const ROADS_STORE = "roads";

let dbp: Promise<IDBPDatabase> | null = null;
/** Gemeinsame Datenbank «lage-tools» (alle Stores werden hier angelegt). */
export function db(): Promise<IDBPDatabase> {
  dbp ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains("exercises")) d.createObjectStore("exercises", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      if (!d.objectStoreNames.contains(ROADS_STORE)) d.createObjectStore(ROADS_STORE, { keyPath: "key" });
    },
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
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
