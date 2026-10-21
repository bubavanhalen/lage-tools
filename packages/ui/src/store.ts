/**
 * Lokaler Speicher (IndexedDB) für Übungen. Alles bleibt auf dem Gerät.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { Exercise } from "@lage/core";

const DB_NAME = "lage-tools";
/** 1: exercises, meta · 2: roads (Strassen-Kacheln, siehe roadsource.ts) */
const DB_VERSION = 2;
export const ROADS_STORE = "roads";

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
