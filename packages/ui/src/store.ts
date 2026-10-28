/**
 * Lokaler Speicher (IndexedDB) für Übungen. Alles bleibt auf dem Gerät.
 *
 * Ab Version 4 liegt jede Meldung als eigener Datensatz in `events` (Schlüssel [Übungs-ID, Meldungs-ID]); die Übung
 * in `exercises` ist nur noch die Hülle (Raster, NAI, Anhänge-Metadaten …) mit Zähler `__rev`. So schreibt jede
 * Meldung nur sich selbst (zwei Fenster überschreiben sich nicht) – siehe `persist.ts`. Ältere Datensätze mit
 * `events` in der Hülle werden beim ersten Laden umgezogen.
 */
import { openDB, type IDBPDatabase } from "idb";
import { mergeEvents, type Exercise, type LageEvent } from "@lage/core";

const DB_NAME = "lage-tools";
/** 1: exercises, meta · 2: roads (Strassen-Kacheln, siehe roadsource.ts) · 3: blobs (Anhänge: Fotos, Sprachmemos) · 4: events (Meldungen einzeln) */
const DB_VERSION = 4;
export const ROADS_STORE = "roads";
export const BLOB_STORE = "blobs";
export const EVENT_STORE = "events";

/** Datensatz einer Meldung in `events` */
export interface EventRec { exId: string; id: string; ev: LageEvent }
/** Hülle einer Übung in `exercises` (ohne Meldungen), `__rev` steigt bei jedem Schreiben */
export type HullRec = Omit<Exercise, "events"> & { __rev?: number; events?: LageEvent[] };
/** alle Meldungen einer Übung */
export const eventRange = (exId: string) => IDBKeyRange.bound([exId, ""], [exId, "\uffff"]);

// ---------- Speicherstatus (Fehler nie verschlucken)

export type StoreProblem = { where: "uebung" | "anhang"; kind: "voll" | "blockiert" | "fehlt"; text: string; at: number };
const statusListeners = new Set<(p: StoreProblem | null, where: StoreProblem["where"]) => void>();
/** Speicherfehler (bzw. `null` = wieder gespeichert) abonnieren – für das rote Band «Nicht gespeichert» */
export function onStoreStatus(cb: (p: StoreProblem | null, where: StoreProblem["where"]) => void): () => void {
  statusListeners.add(cb);
  return () => { statusListeners.delete(cb); };
}
/** Fehler in Klartext: Speicher voll, blockiert (anderes Fenster), nicht verfügbar (privates Fenster, gelöscht) */
export function storeProblem(where: StoreProblem["where"], e: unknown): StoreProblem {
  const name = (e as DOMException)?.name ?? "";
  const msg = String((e as Error)?.message ?? e ?? "");
  const kind: StoreProblem["kind"] = name === "QuotaExceededError" || /quota|voll/i.test(msg) ? "voll" : /blockiert|blocked/i.test(msg) ? "blockiert" : "fehlt";
  const text = kind === "voll" ? "Gerätespeicher voll" : kind === "blockiert" ? "Speicher blockiert – andere (ältere) Lagejournal-Fenster schliessen"
    : name === "VersionError" ? "In einem anderen Fenster läuft eine neuere Version – Datei sichern, dann dieses Fenster neu laden" : "Gerätespeicher nicht verfügbar";
  return { where, kind, text, at: Date.now() };
}
/** Status melden: Fehler (`e`) oder wieder gespeichert (`null`) */
export function reportStore(where: StoreProblem["where"], e: unknown | null): void {
  const p = e === null ? null : storeProblem(where, e);
  statusListeners.forEach((cb) => { try { cb(p, where); } catch { /* egal */ } });
}

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
        if (!d.objectStoreNames.contains(EVENT_STORE)) d.createObjectStore(EVENT_STORE, { keyPath: ["exId", "id"] });
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

/** Übung mit allen Meldungen laden; `rev` = Zähler der Hülle (für `persist.ts`), `migrated` = Altbestand umgezogen */
export async function loadExerciseFull(id: string): Promise<{ ex: Exercise; rev: number; legacy: number } | null> {
  const d = await db();
  const rec = (await d.get("exercises", id)) as HullRec | undefined;
  if (!rec) return null;
  const recs = (await d.getAll(EVENT_STORE, eventRange(id))) as EventRec[];
  let events = recs.map((r) => r.ev);
  const legacy = rec.events ?? [];
  const { __rev, events: _old, ...hull } = rec;
  void _old;
  let rev = __rev ?? 0;
  if (legacy.length) {
    // Altbestand (bis Version 3: Meldungen in der Übung): in die eigene Ablage umziehen
    events = mergeEvents(events, legacy);
    try {
      const tx = d.transaction(["exercises", EVENT_STORE], "readwrite");
      const es = tx.objectStore(EVENT_STORE);
      for (const ev of events) void es.put({ exId: id, id: ev.id, ev } satisfies EventRec);
      rev += 1;
      void tx.objectStore("exercises").put({ ...hull, __rev: rev });
      await tx.done;
    } catch (e) {
      // Umzug nicht möglich (Speicher voll): Hülle bleibt mit den Meldungen; `legacy` > 0 → alles neu schreiben
      reportStore("uebung", e);
      return { ex: { ...(hull as Exercise), events }, rev: -1, legacy: legacy.length };
    }
  }
  return { ex: { ...(hull as Exercise), events }, rev, legacy: legacy.length };
}

export async function loadExercise(id: string): Promise<Exercise | null> {
  try {
    return (await loadExerciseFull(id))?.ex ?? null;
  } catch {
    return null;
  }
}

/**
 * Ganze Übung schreiben (Hülle + alle Meldungen), zusammenführend: eine gespeicherte Meldung mit höherer Revision
 * bleibt. Mit `replace` werden zuerst alle gespeicherten Meldungen der Übung entfernt (nur «Ersetzen» auf Wunsch).
 * Fehler werden gemeldet (`onStoreStatus`) und weitergegeben.
 */
export async function writeExercise(ex: Exercise, opts: { replace?: boolean } = {}): Promise<number> {
  const d = await db();
  const tx = d.transaction(["exercises", EVENT_STORE, "meta"], "readwrite");
  const es = tx.objectStore(EVENT_STORE);
  const hs = tx.objectStore("exercises");
  const old = (await hs.get(ex.id)) as HullRec | undefined;
  const rev = (old?.__rev ?? 0) + 1;
  if (opts.replace) await es.delete(eventRange(ex.id));
  const stored = opts.replace ? new Map<string, LageEvent>() : new Map(((await es.getAll(eventRange(ex.id))) as EventRec[]).map((r) => [r.id, r.ev]));
  for (const ev of ex.events ?? []) {
    const cur = stored.get(ev.id);
    if (cur && mergeEvents([ev], [cur])[0] === cur && JSON.stringify(cur) !== JSON.stringify(ev)) continue;
    void es.put({ exId: ex.id, id: ev.id, ev } satisfies EventRec);
  }
  // Altbestand der Meldungen in der Hülle (falls noch vorhanden) mitnehmen
  if (!opts.replace) for (const ev of old?.events ?? []) if (!stored.has(ev.id) && !(ex.events ?? []).some((x) => x.id === ev.id)) void es.put({ exId: ex.id, id: ev.id, ev } satisfies EventRec);
  const { events: _e, ...hull } = ex;
  void _e;
  void hs.put({ ...hull, __rev: rev });
  void tx.objectStore("meta").put(ex.id, "current");
  await tx.done;
  return rev;
}

/** Übung speichern (ganz, zusammenführend) – Fehler werden als Status gemeldet, nicht verschluckt */
export async function saveExercise(ex: Exercise): Promise<void> {
  try {
    await writeExercise(ex);
    reportStore("uebung", null);
  } catch (e) {
    reportStore("uebung", e);
  }
}

/** Übung als zuletzt benutzt merken */
export async function setCurrentExercise(id: string): Promise<void> {
  try { await (await db()).put("meta", id, "current"); } catch { /* egal */ }
}

export async function deleteExercise(id: string): Promise<void> {
  try {
    const d = await db();
    await d.delete("exercises", id);
    await d.delete(EVENT_STORE, eventRange(id));
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

/**
 * Inhalte, die nicht in den Gerätespeicher passten (Speicher voll, blockiert): bleiben im Arbeitsspeicher dieses
 * Fensters – für Anzeige, Erkennung und «Datei sichern» (`getBlob` liest hier nach). Nach dem nächsten gelungenen
 * Speichern wird erneut versucht, sie abzulegen (`retryMemBlobs`).
 */
const memBlobs = new Map<string, Blob>();
/** Anzahl Anhänge (ohne Vorschaubilder), die nur im Arbeitsspeicher liegen */
export function memBlobCount(): number { return [...memBlobs.keys()].filter((k) => !k.endsWith(":thumb")).length; }

/**
 * Inhalt eines Anhangs speichern (Schlüssel = Attachment.id). Gelingt das nicht, bleibt er im Arbeitsspeicher
 * (`getBlob` findet ihn weiter, «Datei sichern» nimmt ihn mit) und der Fehler wird gemeldet und weitergegeben.
 */
export async function putBlob(id: string, blob: Blob): Promise<void> {
  sessionBlobs.add(baseId(id));
  try {
    await (await db()).put(BLOB_STORE, blob, id);
    memBlobs.delete(id);
  } catch (e) {
    memBlobs.set(id, blob);
    // Vorschaubilder sind ersetzbar – nur Originale melden
    if (!id.endsWith(":thumb")) reportStore("anhang", e);
    throw e;
  }
}

let retrying = false;
/** Inhalte aus dem Arbeitsspeicher erneut im Gerätespeicher ablegen (z. B. nachdem wieder Platz ist). Anzahl abgelegt. */
export async function retryMemBlobs(): Promise<number> {
  if (retrying || !memBlobs.size) return 0;
  retrying = true;
  let n = 0;
  try {
    const d = await db();
    for (const [id, b] of [...memBlobs]) {
      try { await d.put(BLOB_STORE, b, id); memBlobs.delete(id); n++; } catch { break; /* noch voll */ }
    }
  } catch { /* Speicher nicht verfügbar */ } finally { retrying = false; }
  if (n && !memBlobCount()) reportStore("anhang", null);
  return n;
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

/** Inhalt eines Anhangs lesen (null, wenn nicht auf diesem Gerät) – auch, was nur im Arbeitsspeicher liegt */
export async function getBlob(id: string): Promise<Blob | null> {
  const mem = memBlobs.get(id);
  if (mem) return mem;
  try {
    return ((await (await db()).get(BLOB_STORE, id)) as Blob | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function deleteBlob(id: string): Promise<void> {
  memBlobs.delete(id);
  try { await (await db()).delete(BLOB_STORE, id); } catch { /* egal */ }
}
