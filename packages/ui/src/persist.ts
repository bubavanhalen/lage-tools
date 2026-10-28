/**
 * Sofort speichern – ohne Verzögerung, jede Meldung einzeln, mit Notfall-Puffer:
 *
 * 1. Bei jeder Änderung der Übung (`save`) wird verglichen, was sich gegenüber dem Gespeicherten geändert hat:
 *    geänderte Meldungen und – falls nötig – die Hülle (Raster, NAI, Anhänge-Metadaten …).
 * 2. Diese Änderungen kommen **zuerst synchron** in einen kleinen Puffer im `localStorage` (überlebt Neuladen,
 *    Absturz, Akku leer 100 ms nach Enter), danach in einer IndexedDB-Transaktion in die Datenbank. Erst wenn die
 *    Transaktion fertig ist, wird der Puffer geleert. Beim Laden wird ein übrig gebliebener Puffer eingemischt.
 * 3. Eine gespeicherte Meldung mit höherer Revision wird nie überschrieben (zweites Fenster); die Hülle wird bei
 *    gleichzeitigem Schreiben zusammengeführt (`mergeHull`).
 * 4. Nach dem Speichern erfahren andere Fenster davon (`BroadcastChannel`, sonst `storage`-Ereignis) und lesen nach.
 * 5. Fehler (Speicher voll, blockiert) werden gemeldet (`onStoreStatus`) – das rote Band bietet «Datei sichern» an;
 *    die Änderungen bleiben im Puffer und werden beim nächsten Speichern erneut versucht (Anhänge im Arbeitsspeicher
 *    ebenso, `retryMemBlobs`).
 * 6. Meldungen aus anderen Fenstern werden gemerkt (`noteForeign`): eine offene Bearbeitung zeigt dann den Konflikt
 *    («in einem anderen Fenster geändert/gelöscht», `editConflict`) statt still zu überschreiben oder zu verschwinden.
 */
import { mergeEvents, mergeHull, type Exercise, type LageEvent } from "@lage/core";
import { EVENT_STORE, db, eventRange, loadExerciseFull, reportStore, retryMemBlobs, writeExercise, type EventRec, type HullRec } from "./store";

const WAL_KEY = "lage-tools.wal";
const SYNC_KEY = "lage-tools.sync";
const CHANNEL = "lage-tools.sync";
/** Hülle nur bis zu dieser Grösse in den Notfall-Puffer (Bilder/Overlays können MB gross sein) */
const WAL_HULL_MAX = 300_000;
/** nach einem Speicherfehler erneut versuchen */
const RETRY_MS = 10_000;

/** Kennung dieses Fensters (Nachrichten an sich selbst ignorieren) */
export const TAB_ID = Math.random().toString(36).slice(2, 10);

export type SyncMsg =
  | { t: "saved"; ex: string; ids: string[]; hull: boolean; from: string; rev: number }
  | { t: "replaced"; ex: string; from: string };

// ---------- Vergleich

const evSig = (e: LageEvent) => JSON.stringify(e);
type Hull = Omit<Exercise, "events">;
function hullOf(ex: Exercise): Hull {
  const { events: _e, ...h } = ex;
  void _e;
  return h;
}
/** Kennung der Hülle; Bilder (Data-URL) nur über Länge und Anfang/Ende – sonst würde jedes Speichern MB vergleichen */
function hullSig(ex: Exercise | Hull): string {
  const { events: _e, overlays, ...h } = ex as Exercise;
  void _e;
  const ov = (overlays ?? []).map((o) => ({ ...o, dataUrl: `${o.dataUrl.length}:${o.dataUrl.slice(0, 40)}:${o.dataUrl.slice(-40)}` }));
  return JSON.stringify(h) + "|" + JSON.stringify(ov);
}

// ---------- Notfall-Puffer (localStorage, synchron)

interface WalEntry { events: Record<string, LageEvent>; hull?: Hull }
type Wal = Record<string, WalEntry>;
function readWal(): Wal {
  try { return JSON.parse(localStorage.getItem(WAL_KEY) || "{}") as Wal; } catch { return {}; }
}
function writeWal(w: Wal): boolean {
  try {
    const clean = Object.fromEntries(Object.entries(w).filter(([, e]) => Object.keys(e.events).length || e.hull));
    if (Object.keys(clean).length) localStorage.setItem(WAL_KEY, JSON.stringify(clean));
    else localStorage.removeItem(WAL_KEY);
    return true;
  } catch { return false; }
}

const CURRENT_KEY = "lage-tools.current";
/** zuletzt bearbeitete Übung, synchron gemerkt (die Datenbank könnte beim Neuladen noch nicht geschrieben sein) */
function rememberCurrent(id: string) { try { localStorage.setItem(CURRENT_KEY, id); } catch { /* egal */ } }
export function lastCurrent(): string | null { try { return localStorage.getItem(CURRENT_KEY); } catch { return null; } }

// ---------- Nachrichten an andere Fenster

let channel: BroadcastChannel | null = null;
try { channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null; } catch { channel = null; }
function broadcast(m: SyncMsg) {
  try {
    if (channel) channel.postMessage(m);
    else localStorage.setItem(SYNC_KEY, JSON.stringify({ ...m, n: Math.random() }));
  } catch { /* egal */ }
}
/** Nachrichten anderer Fenster abonnieren */
export function onSync(cb: (m: SyncMsg) => void): () => void {
  const onMsg = (ev: MessageEvent) => { const m = ev.data as SyncMsg; if (m && m.from !== TAB_ID) cb(m); };
  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== SYNC_KEY || !ev.newValue) return;
    try { const m = JSON.parse(ev.newValue) as SyncMsg; if (m.from !== TAB_ID) cb(m); } catch { /* egal */ }
  };
  channel?.addEventListener("message", onMsg);
  window.addEventListener("storage", onStorage);
  return () => { channel?.removeEventListener("message", onMsg); window.removeEventListener("storage", onStorage); };
}

// ---------- Änderungen anderer Fenster (für Konflikte beim Bearbeiten)

/** höchste Revision einer Meldung, die von einem anderen Fenster kam (Schlüssel «Übung|Meldung») */
const foreign = new Map<string, number>();
/** Meldungen, die ein anderes Fenster geschrieben hat (hier gelesen), merken */
export function noteForeign(exId: string, events: LageEvent[]): void {
  for (const e of events) { const k = `${exId}|${e.id}`; if ((foreign.get(k) ?? -1) < e.rev) foreign.set(k, e.rev); }
}
/** höchste Revision dieser Meldung aus einem anderen Fenster (−1 = keine) */
export function foreignRev(exId: string, id: string): number { return foreign.get(`${exId}|${id}`) ?? -1; }
/**
 * Wurde eine Meldung, die hier seit Revision `base.rev` bearbeitet wird, inzwischen in einem anderen Fenster geändert
 * oder gelöscht? `cur` = Fassung, die dieses Fenster jetzt zeigt. Eigene Änderungen (z. B. Strasse nachgeführt) zählen nicht.
 */
export function editConflict(exId: string, base: LageEvent, cur: LageEvent | undefined): "geaendert" | "geloescht" | null {
  if (!cur || cur.rev <= base.rev || foreignRev(exId, base.id) <= base.rev) return null;
  return cur.deleted && !base.deleted ? "geloescht" : "geaendert";
}

// ---------- Speichern

type Hull0 = Hull;
/** Stand einer Übung in der Datenbank, so weit dieses Fenster ihn kennt */
interface DbState {
  /** Meldungs-ID → Kennung des gespeicherten Inhalts */
  stored: Map<string, string>;
  /** Kennung der gespeicherten Hülle */
  hull: string;
  /** Zähler der Hülle in der Datenbank (−1 = unbekannt: beim Schreiben nachsehen und zusammenführen) */
  rev: number;
}
interface WriteResult { rev: number; merged: Hull0 | null; newer: LageEvent[] }

class Persister {
  /** angezeigte Übung (Rückmeldungen nur für sie) */
  current: string | null = null;
  private st = new Map<string, DbState>();
  /** neueste, noch nicht geschriebene Fassung pro Übung (Zwischenstände werden zusammengefasst) */
  private pending = new Map<string, Exercise>();
  private loop: Promise<void> | null = null;
  private lock: Promise<unknown> = Promise.resolve();
  /** beim Schreiben entstand eine zusammengeführte Hülle (gleichzeitig in zwei Fenstern) → in die Anzeige übernehmen */
  onMergedHull: ((exId: string, hull: Hull0, rev: number) => void) | null = null;
  /** in der Datenbank lag eine neuere Fassung von Meldungen (anderes Fenster) → in die Anzeige übernehmen */
  onNewer: ((exId: string, events: LageEvent[]) => void) | null = null;
  /** nach erfolgreichem Schreiben (z. B. Liste der Übungen nachführen) */
  onSaved: ((exId: string, hull: boolean) => void) | null = null;
  /** zuletzt gespeichert (ms seit 1970) */
  savedAt = 0;
  private retry: number | undefined;

  private state(id: string): DbState {
    let s = this.st.get(id);
    if (!s) { s = { stored: new Map(), hull: "", rev: -1 }; this.st.set(id, s); }
    return s;
  }

  /** Übung anzeigen: `stored` = so in der Datenbank (mit Zähler), `write` = beim nächsten Speichern alles schreiben */
  adopt(ex: Exercise, mode: "stored" | "write", rev = -1) {
    this.current = ex.id;
    this.pending.delete(ex.id);
    this.st.set(ex.id, mode === "stored"
      ? { stored: new Map((ex.events ?? []).map((e) => [e.id, evSig(e)])), hull: hullSig(ex), rev }
      : { stored: new Map(), hull: "", rev: -1 });
  }

  /** Meldungen/Hülle, die so in der Datenbank stehen (von einem anderen Fenster geschrieben und hier gelesen) */
  markStored(exId: string, events: LageEvent[], hull?: { ex: Hull0; rev: number }) {
    const s = this.state(exId);
    for (const e of events) s.stored.set(e.id, evSig(e));
    if (hull && hull.rev >= s.rev) { s.hull = hullSig(hull.ex); s.rev = hull.rev; }
  }

  /** bekannter Zähler der Hülle (−1 = unbekannt) */
  rev(exId: string): number { return this.st.get(exId)?.rev ?? -1; }

  private diff(ex: Exercise) {
    const s = this.state(ex.id);
    const changed = (ex.events ?? []).filter((e) => s.stored.get(e.id) !== evSig(e));
    const hs = hullSig(ex);
    return { s, changed, hs, hullChanged: hs !== s.hull };
  }

  /**
   * Änderungen sofort speichern: synchron in den Notfall-Puffer, dann (in Reihe, zusammengefasst) in die Datenbank.
   * @returns ob etwas zu speichern war (und ob die Hülle dabei ist)
   */
  save(ex: Exercise): { changed: boolean; hull: boolean } {
    const { changed, hs, hullChanged } = this.diff(ex);
    if (!changed.length && !hullChanged) { this.pending.delete(ex.id); return { changed: false, hull: false }; }
    const wal = readWal();
    const w = (wal[ex.id] ??= { events: {} });
    for (const e of changed) w.events[e.id] = e;
    if (hullChanged && hs.length < WAL_HULL_MAX) w.hull = hullOf(ex);
    writeWal(wal);
    rememberCurrent(ex.id);
    this.pending.set(ex.id, ex);
    this.kick();
    return { changed: true, hull: hullChanged };
  }

  private exclusive<T>(f: () => Promise<T>): Promise<T> {
    const p = this.lock.then(f, f);
    this.lock = p.catch(() => undefined);
    return p;
  }

  private kick() {
    if (this.loop) return;
    this.loop = (async () => {
      while (this.pending.size) {
        const [id, ex] = this.pending.entries().next().value as [string, Exercise];
        this.pending.delete(id);
        await this.exclusive(() => this.writeOne(id, ex));
      }
    })().finally(() => { this.loop = null; });
  }

  private async writeOne(id: string, ex: Exercise): Promise<void> {
    const { s, changed, hs, hullChanged } = this.diff(ex);
    if (!changed.length && !hullChanged) return;
    try {
      const r = await this.write(id, changed, hullChanged ? hullOf(ex) : null, s.rev);
      const newer = new Map(r.newer.map((e) => [e.id, e]));
      for (const e of changed) s.stored.set(e.id, evSig(newer.get(e.id) ?? e));
      if (hullChanged) s.hull = r.merged ? hullSig(r.merged) : hs;
      s.rev = r.rev;
      // Puffer leeren – nur, was seither nicht wieder geändert wurde
      const wl = readWal();
      const we = wl[id];
      if (we) {
        for (const e of changed) if (we.events[e.id] && evSig(we.events[e.id]!) === evSig(e)) delete we.events[e.id];
        if (hullChanged && we.hull && hullSig(we.hull) === hs) delete we.hull;
        writeWal(wl);
      }
      this.savedAt = Date.now();
      reportStore("uebung", null);
      void retryMemBlobs();
      if (r.newer.length) noteForeign(id, r.newer);
      broadcast({ t: "saved", ex: id, ids: changed.map((e) => e.id), hull: hullChanged, from: TAB_ID, rev: r.rev });
      if (id === this.current) {
        if (r.merged) this.onMergedHull?.(id, r.merged, r.rev);
        if (r.newer.length) this.onNewer?.(id, r.newer);
      }
      this.onSaved?.(id, hullChanged);
    } catch (e) {
      // nicht gespeichert: Puffer bleibt, beim nächsten Speichern (spätestens in 10 s) wird alles Ungespeicherte erneut versucht
      reportStore("uebung", e);
      window.clearTimeout(this.retry);
      this.retry = window.setTimeout(() => flushNow(), RETRY_MS);
    }
  }

  /** Eine Transaktion: Meldungen (ohne neuere zu überschreiben) und ggf. Hülle (bei fremdem Zwischenstand zusammenführen) */
  private async write(exId: string, events: LageEvent[], hull: Hull0 | null, baseRev: number): Promise<WriteResult> {
    const d = await db();
    const tx = d.transaction(["exercises", EVENT_STORE, "meta"], "readwrite");
    const es = tx.objectStore(EVENT_STORE);
    const hsto = tx.objectStore("exercises");
    const newer: LageEvent[] = [];
    for (const ev of events) {
      const cur = ((await es.get([exId, ev.id])) as EventRec | undefined)?.ev;
      if (cur && mergeEvents([ev], [cur])[0] === cur && evSig(cur) !== evSig(ev)) { newer.push(cur); continue; }
      void es.put({ exId, id: ev.id, ev } satisfies EventRec);
    }
    const old = (await hsto.get(exId)) as HullRec | undefined;
    let rev = old?.__rev ?? 0;
    let merged: Hull0 | null = null;
    if (hull) {
      let h: Hull0 = hull;
      if (old && (old.__rev ?? 0) !== baseRev) {
        // ein anderes Fenster hat inzwischen geschrieben (oder Zähler unbekannt): zusammenführen, nichts verlieren
        const { __rev: _r, events: legacy, ...oh } = old;
        void _r;
        for (const ev of legacy ?? []) if (!(await es.get([exId, ev.id]))) void es.put({ exId, id: ev.id, ev } satisfies EventRec);
        h = hullOf(mergeHull({ ...hull, events: [] } as Exercise, { ...(oh as Exercise), events: [] }).ex);
        if (hullSig(h) !== hullSig(hull)) merged = h;
      }
      rev += 1;
      void hsto.put({ ...h, __rev: rev });
      void tx.objectStore("meta").put(exId, "current");
    }
    await tx.done;
    return { rev, merged, newer };
  }

  /** Ganze Übung schreiben (Öffnen, Beispiel, neue Übung); `replace` = gespeicherte Meldungen dieser Übung zuerst entfernen */
  writeAll(ex: Exercise, replace = false): Promise<boolean> {
    // sofort als gespeichert führen, damit die nächste Darstellung nicht doppelt schreibt; Puffer für den Notfall
    this.adopt(ex, "stored", -1);
    rememberCurrent(ex.id);
    const wal = readWal();
    wal[ex.id] = { events: Object.fromEntries((ex.events ?? []).map((e) => [e.id, e])), hull: hullSig(ex).length < WAL_HULL_MAX ? hullOf(ex) : undefined };
    if (!replace) writeWal(wal);
    return this.exclusive(async () => {
      try {
        const rev = await writeExercise(ex, { replace });
        const s = this.state(ex.id);
        s.rev = rev;
        const wl = readWal();
        if (wl[ex.id]) { delete wl[ex.id]; writeWal(wl); }
        reportStore("uebung", null);
        void retryMemBlobs();
        this.savedAt = Date.now();
        broadcast(replace ? { t: "replaced", ex: ex.id, from: TAB_ID } : { t: "saved", ex: ex.id, ids: (ex.events ?? []).map((e) => e.id), hull: true, from: TAB_ID, rev });
        this.onSaved?.(ex.id, true);
        return true;
      } catch (e) {
        // beim nächsten Speichern alles erneut versuchen
        this.st.set(ex.id, { stored: new Map(), hull: "", rev: -1 });
        reportStore("uebung", e);
        return false;
      }
    });
  }

  /** gibt es noch Ungeschriebenes? */
  busy(): boolean { return this.pending.size > 0 || this.loop !== null; }

  /** warten, bis alles geschrieben ist */
  async flush(): Promise<void> { while (this.loop) await this.loop; await this.lock; }
}

export const persister = new Persister();

/** Notfall-Puffer in eine geladene Übung einmischen (nach Absturz/Neuladen). Gibt die Anzahl geretteter Meldungen zurück. */
export function recoverWal(ex: Exercise): { ex: Exercise; recovered: number } {
  const w = readWal()[ex.id];
  if (!w) return { ex, recovered: 0 };
  const list = Object.values(w.events);
  const before = new Map((ex.events ?? []).map((e) => [e.id, evSig(e)]));
  const events = mergeEvents(ex.events ?? [], list);
  const recovered = events.filter((e) => before.get(e.id) !== evSig(e)).length;
  let out: Exercise = { ...ex, events };
  if (w.hull) out = { ...mergeHull({ ...(w.hull as Exercise), events: [] }, { ...ex, events: [] }).ex, events };
  return { ex: out, recovered };
}

/**
 * Gespeicherte Übung öffnen: aus der Datenbank, Notfall-Puffer eingemischt, für das Speichern übernommen.
 * null = nicht vorhanden. Wirft bei nicht verfügbarem Speicher.
 */
export async function openStored(id: string): Promise<{ ex: Exercise; recovered: number } | null> {
  const r = await loadExerciseFull(id);
  if (!r) {
    // nur im Puffer (z. B. erste Meldung einer neuen Übung, Datenbank nie erreicht)
    const w = readWal()[id];
    if (!w?.hull) return null;
    const ex = { ...(w.hull as Exercise), events: Object.values(w.events) };
    persister.adopt(ex, "write");
    return { ex, recovered: ex.events.length };
  }
  if (r.legacy && r.rev < 0) persister.adopt(r.ex, "write");
  else persister.adopt(r.ex, "stored", r.rev);
  return recoverWal(r.ex);
}

/** Meldungen (IDs) und ggf. Hülle einer Übung lesen – für die Nachricht eines anderen Fensters */
export async function readChanges(exId: string, ids: string[] | null, withHull: boolean): Promise<{ events: LageEvent[]; hull?: { ex: Hull; rev: number } }> {
  const d = await db();
  const tx = d.transaction(["exercises", EVENT_STORE], "readonly");
  const es = tx.objectStore(EVENT_STORE);
  let events: LageEvent[];
  if (ids && ids.length <= 200) events = (await Promise.all(ids.map((id) => es.get([exId, id])))).filter(Boolean).map((r) => (r as EventRec).ev);
  else events = ((await es.getAll(eventRange(exId))) as EventRec[]).map((r) => r.ev);
  let hull: { ex: Hull; rev: number } | undefined;
  if (withHull) {
    const rec = (await tx.objectStore("exercises").get(exId)) as HullRec | undefined;
    if (rec) { const { __rev, events: _e, ...h } = rec; void _e; hull = { ex: h as Hull, rev: __rev ?? 0 }; }
  }
  await tx.done;
  return { events, hull };
}

// ---------- Dauerhafter Speicher (navigator.storage.persist)

export type PersistState = "dauerhaft" | "abgelehnt" | "unbekannt";
let persistState: PersistState = "unbekannt";
let persistAsked = false;
/**
 * Browser bitten, den Speicher nicht automatisch zu löschen (beim Anlegen/Öffnen einer Übung). Fragt nur einmal pro
 * Sitzung; Ergebnis mit `storagePersistState()` abfragbar (für die spätere Statusanzeige).
 */
export async function requestPersist(): Promise<PersistState> {
  try {
    const st = navigator.storage;
    if (!st?.persisted) return persistState;
    if (await st.persisted()) return (persistState = "dauerhaft");
    if (persistAsked || !st.persist) return persistState;
    persistAsked = true;
    persistState = (await st.persist()) ? "dauerhaft" : "abgelehnt";
  } catch { /* nicht unterstützt */ }
  return persistState;
}
/** zuletzt bekannter Zustand («unbekannt» = nicht unterstützt oder noch nicht gefragt) */
export async function storagePersistState(): Promise<{ state: PersistState; usage?: number; quota?: number }> {
  try {
    const st = navigator.storage;
    if (st?.persisted && (await st.persisted())) persistState = "dauerhaft";
    const est = st?.estimate ? await st.estimate() : undefined;
    return { state: persistState, usage: est?.usage, quota: est?.quota };
  } catch {
    return { state: persistState };
  }
}

// Notfall: beim Verlassen/Verstecken der Seite das Neueste sofort sichern (falls ein Darstellungsschritt fehlte)
let latest: (() => Exercise | null) | null = null;
/** Quelle für das Speichern beim Verlassen der Seite (aktuelle Übung) */
export function setLatest(get: () => Exercise | null) { latest = get; }
function flushNow() {
  const ex = latest?.();
  if (ex) persister.save(ex);
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNow(); });
}

/** Gespeicherte Fassung lesen (mit Notfall-Puffer), ohne sie anzuzeigen – zum Zusammenführen beim Öffnen einer Datei */
export async function peekStored(id: string): Promise<Exercise | null> {
  try {
    const r = await loadExerciseFull(id);
    if (r) return recoverWal(r.ex).ex;
  } catch { /* Speicher nicht verfügbar */ }
  const w = readWal()[id];
  return w?.hull ? { ...(w.hull as Exercise), events: Object.values(w.events) } : null;
}

/** Notfall-Puffer einer gelöschten Übung verwerfen */
export function dropWal(id: string) {
  const wl = readWal();
  if (wl[id]) { delete wl[id]; writeWal(wl); }
}

/** wird gerade (oder gleich) geschrieben? */
export function hasPending(): boolean { return persister.busy(); }
