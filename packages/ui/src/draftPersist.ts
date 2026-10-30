/**
 * Angefangene Meldung im Meldungsfeld überlebt Neuladen, Reiterwechsel und Absturz – **pro Fenster und Übung**:
 * Jedes Fenster hat eine eigene Kennung (im `sessionStorage`, bleibt beim Neuladen desselben Fensters gleich); der
 * Entwurf liegt im `localStorage` unter Übung + Fenster. Zwei Fenster mit derselben Übung überschreiben oder löschen
 * sich die Entwürfe also nicht gegenseitig. Nur Text, kein Ort/keine Zeichenwahl. Jeder Zugriff in try/catch
 * (privates Fenster, Speicher gesperrt). Entwürfe geschlossener Fenster werden nach `DRAFT_KEEP_MS` aufgeräumt.
 *
 * MVP 3.5 (Spez. MVP 3.5, E7, S26): Jedes Fenster schreibt alle 10 s ein Lebenszeichen
 * (`localStorage["lage-tools.fenster.lebt.<winId>"] = Date.now()`, beim `pagehide` gelöscht). Startet ein Fenster ohne
 * eigenen Entwurf, übernimmt es den jüngsten **verwaisten** Entwurf derselben Übung (Fenster > 30 s ohne Lebenszeichen,
 * z. B. Browser abgestürzt oder Tablet neu gestartet): der Schlüssel wird umgeschrieben, das Meldungsfeld meldet
 * «Entwurf von 07:31 wiederhergestellt · Verwerfen». Zwei offene Fenster übernehmen nie den Entwurf des anderen.
 *
 * MVP 3.5 Nachbesserung (Review 6, Feld N): `localStorage` schreibt Chromium verzögert auf die Platte – nach einem harten
 * Absturz (`kill -9`, Akku leer) fehlten die letzten ≈ 6 s. Darum zusätzlich ein **IndexedDB-Spiegel** mit
 * `durability: "strict"`: spätestens 1 s nach der letzten Taste und sofort bei `visibilitychange` (verborgen) und
 * `pagehide`; Leeren (eingetragen, verworfen) sofort. Und «lebt das Fenster noch?» fragt zuerst die Web Locks
 * (`navigator.locks`: jedes Fenster hält eine Sperre `lage-tools.fenster.<id>`, die der Browser beim Absturz freigibt) –
 * so wird ein Entwurf auch bei einem Neustart nach < 30 s übernommen; ohne Web Locks gilt das Lebenszeichen (30 s).
 */
import { useEffect, useRef } from "react";

const PREFIX = "lage-tools.entwurf.";
const WIN_KEY = "lage-tools.fenster";
/** Entwürfe so lange aufbewahren (danach beim nächsten Start gelöscht) */
export const DRAFT_KEEP_MS = 3 * 86400000;

let winId: string | null = null;
/** Kennung dieses Fensters (bleibt beim Neuladen gleich, neues Fenster = neue Kennung) */
export function windowId(): string {
  if (winId) return winId;
  try {
    winId = sessionStorage.getItem(WIN_KEY);
    if (!winId) { winId = Math.random().toString(36).slice(2, 10); sessionStorage.setItem(WIN_KEY, winId); }
  } catch { winId = Math.random().toString(36).slice(2, 10); }
  return winId;
}

const KEY = (exId: string) => `${PREFIX}${exId}.${windowId()}`;
/** Lebenszeichen eines Fensters (ms seit 1970) */
export const LEBT_KEY = (win: string) => `lage-tools.fenster.lebt.${win}`;
/** Takt des Lebenszeichens */
export const LEBT_MS = 10000;
/** ein Fenster ohne Lebenszeichen seit so lange gilt als geschlossen (sein Entwurf ist verwaist) */
export const VERWAIST_MS = 30000;

let beat: ReturnType<typeof setInterval> | null = null;
/** Lebenszeichen dieses Fensters schreiben (sofort, dann alle 10 s; beim Verlassen der Seite löschen) */
export function startLebenszeichen(now: () => number = Date.now): void {
  const write = () => { try { localStorage.setItem(LEBT_KEY(windowId()), String(now())); } catch { /* Speicher gesperrt */ } };
  write();
  if (beat || typeof window === "undefined") return;
  beat = setInterval(write, LEBT_MS);
  window.addEventListener("pagehide", () => { try { localStorage.removeItem(LEBT_KEY(windowId())); } catch { /* egal */ } });
  // zurück aus dem Zwischenspeicher des Browsers (bfcache): wieder lebendig
  window.addEventListener("pageshow", write);
}

/**
 * Jüngsten verwaisten Entwurf der Übung übernehmen (nur wenn dieses Fenster keinen eigenen hat): Fenster ohne
 * Lebenszeichen seit > `VERWAIST_MS`. Schreibt den Entwurf unter dieses Fenster um und gibt ihn zurück, sonst null.
 */
export function adoptOrphan(exId: string, now = Date.now()): Stored | null {
  try {
    if (localStorage.getItem(KEY(exId))) return null;
    const pre = `${PREFIX}${exId}.`;
    const me = windowId();
    let best: { k: string; v: Stored } | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(pre)) continue;
      const win = k.slice(pre.length);
      if (!win || win.includes(".") || win === me) continue;
      const lebt = Number(localStorage.getItem(LEBT_KEY(win)) ?? 0) || 0;
      if (now - lebt <= VERWAIST_MS) continue; // zeit-ok: Millisekunden, keine Lagezeit
      let v: Stored | null = null;
      try { v = JSON.parse(localStorage.getItem(k) ?? "") as Stored; } catch { continue; }
      if (!v?.t?.trim() || typeof v.at !== "number") continue;
      if (!best || v.at > best.v.at) best = { k, v }; // zeit-ok: Millisekunden
    }
    if (!best) return null;
    localStorage.removeItem(best.k);
    localStorage.setItem(KEY(exId), JSON.stringify(best.v));
    return best.v;
  } catch { return null; }
}
/** Format bis MVP 0 (ein Entwurf pro Übung für alle Fenster) */
const LEGACY = (exId: string) => `${PREFIX}${exId}`;

export interface Stored { t: string; at: number }

export function loadDraftText(exId: string): string {
  try {
    const raw = localStorage.getItem(KEY(exId));
    if (raw) return (JSON.parse(raw) as Stored).t ?? "";
    // alter Entwurf (ein Schlüssel für alle Fenster): einmal übernehmen
    const old = localStorage.getItem(LEGACY(exId));
    if (old) { localStorage.removeItem(LEGACY(exId)); saveDraftText(exId, old); return old; }
    return "";
  } catch { return ""; }
}
export function saveDraftText(exId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(KEY(exId), JSON.stringify({ t: text, at: Date.now() } satisfies Stored));
    else localStorage.removeItem(KEY(exId));
  } catch { /* Speicher gesperrt – Entwurf nur im Fenster */ }
  spiegeln(exId, text);
}

// ---------- IndexedDB-Spiegel (übersteht einen harten Absturz) ----------

const IDB_NAME = "lage-tools-entwurf";
const IDB_STORE = "e";
/** spätestens so lange nach der letzten Taste liegt der Entwurf dauerhaft auf der Platte */
export const SPIEGEL_MS = 1000;
interface Gespiegelt extends Stored { ex: string; win: string }
let dbP: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbP) return dbP;
  dbP = new Promise((ok) => {
    try {
      if (typeof indexedDB === "undefined") { ok(null); return; }
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(IDB_STORE)) r.result.createObjectStore(IDB_STORE); };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
      r.onblocked = () => ok(null);
    } catch { ok(null); }
  });
  return dbP;
}
async function idbPut(key: string, v: Gespiegelt | null): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((ok) => {
    try {
      const tx = (d.transaction as (n: string, m: IDBTransactionMode, o?: { durability?: string }) => IDBTransaction)
        .call(d, IDB_STORE, "readwrite", { durability: "strict" });
      if (v) tx.objectStore(IDB_STORE).put(v, key); else tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => ok(); tx.onerror = () => ok(); tx.onabort = () => ok();
    } catch { ok(); }
  });
}
async function idbAlle(): Promise<Array<[string, Gespiegelt]>> {
  const d = await db();
  if (!d) return [];
  return new Promise((ok) => {
    try {
      const out: Array<[string, Gespiegelt]> = [];
      const c = d.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) { ok(out); return; } out.push([String(cur.key), cur.value as Gespiegelt]); cur.continue(); };
      c.onerror = () => ok(out);
    } catch { ok([]); }
  });
}
/** ausstehender Spiegel (je Schlüssel der jüngste Stand) */
const offen = new Map<string, Gespiegelt | null>();
let spiegelT: ReturnType<typeof setTimeout> | null = null;
/** ausstehende Spiegel sofort schreiben (Taste, verborgen, Seite verlassen) */
export function spiegelJetzt(): Promise<void> {
  if (spiegelT) { clearTimeout(spiegelT); spiegelT = null; }
  const l = [...offen];
  offen.clear();
  return Promise.all(l.map(([k, v]) => idbPut(k, v))).then(() => undefined);
}
let spiegelHoerer = false;
function spiegeln(exId: string, text: string): void {
  if (typeof indexedDB === "undefined") return;
  const k = KEY(exId);
  offen.set(k, text.trim() ? { t: text, at: Date.now(), ex: exId, win: windowId() } : null);
  if (!spiegelHoerer && typeof window !== "undefined" && typeof document !== "undefined") {
    spiegelHoerer = true;
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void spiegelJetzt(); });
    window.addEventListener("pagehide", () => { void spiegelJetzt(); });
  }
  // Leeren (eingetragen, verworfen) sofort – ein schon eingetragener Text kommt nach einem Absturz nie zurück
  if (!text.trim()) { void spiegelJetzt(); return; }
  if (!spiegelT) spiegelT = setTimeout(() => { spiegelT = null; void spiegelJetzt(); }, SPIEGEL_MS);
}

// ---------- lebt das Fenster noch? (Web Locks) ----------

type Locks = { request(n: string, f: () => Promise<void>): Promise<void>; query(): Promise<{ held?: Array<{ name?: string }> }> };
const locks = (): Locks | null => {
  try { return (navigator as Navigator & { locks?: Locks }).locks ?? null; } catch { return null; }
};
const LOCK = (win: string) => `lage-tools.fenster.${win}`;
let gesperrt = false;
/** Sperre dieses Fensters halten, solange es lebt (der Browser gibt sie bei Absturz und Schliessen frei) */
function sperreHalten(): void {
  const l = locks();
  if (gesperrt || !l) return;
  gesperrt = true;
  void l.request(LOCK(windowId()), () => new Promise<void>(() => { /* bis das Fenster geht */ })).catch(() => { /* egal */ });
}
/** Kennungen lebender Fenster (Web Locks), null = unbekannt (dann gilt das Lebenszeichen) */
async function lebendeFenster(): Promise<Set<string> | null> {
  const l = locks();
  if (!l) return null;
  try {
    const q = await l.query();
    const s = new Set<string>();
    for (const h of q.held ?? []) if (h.name?.startsWith("lage-tools.fenster.")) s.add(h.name.slice("lage-tools.fenster.".length));
    return s;
  } catch { return null; }
}

/**
 * Nach dem Start (asynchron): Entwurf aus dem dauerhaften Spiegel bzw. eines **toten** Fensters übernehmen, wenn das Feld
 * noch leer ist. Eigener Spiegel (gleiches Fenster neu geladen, `localStorage` hatte den Stand nicht mehr) → `eigen`;
 * fremdes, nicht mehr lebendes Fenster (Web Locks; ohne Web Locks > 30 s ohne Lebenszeichen) → übernommen.
 */
export async function wiederherstellen(exId: string, now = Date.now()): Promise<{ v: Stored; eigen: boolean } | null> {
  const me = windowId();
  const lebend = await lebendeFenster();
  const tot = (win: string) => {
    if (win === me) return false;
    if (lebend) return !lebend.has(win);
    const lebt = Number(localStorage.getItem(LEBT_KEY(win)) ?? 0) || 0;
    return now - lebt > VERWAIST_MS; // zeit-ok: Millisekunden, keine Lagezeit
  };
  let best: { k: string; v: Stored; eigen: boolean } | null = null;
  const nimm = (k: string, win: string, v: Stored | null) => {
    if (!v?.t?.trim() || typeof v.at !== "number" || now - v.at > DRAFT_KEEP_MS) return;
    const eigen = win === me;
    if (!eigen && !tot(win)) return;
    if (!best || (eigen && !best.eigen) || (eigen === best.eigen && v.at > best.v.at)) best = { k, v: { t: v.t, at: v.at }, eigen }; // zeit-ok: Millisekunden
  };
  try {
    const pre = `${PREFIX}${exId}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(pre)) continue;
      const win = k.slice(pre.length);
      if (!win || win.includes(".")) continue;
      let v: Stored | null = null;
      try { v = JSON.parse(localStorage.getItem(k) ?? "") as Stored; } catch { continue; }
      nimm(k, win, v);
    }
  } catch { /* Speicher gesperrt */ }
  for (const [k, v] of await idbAlle()) if (v?.ex === exId && v.win) nimm(k, v.win, v);
  if (!best) return null;
  const b: { k: string; v: Stored; eigen: boolean } = best;
  // umschreiben auf dieses Fenster; der fremde Entwurf verschwindet (kein zweites Fenster übernimmt ihn nochmals)
  if (b.k !== KEY(exId)) {
    try { localStorage.removeItem(b.k); } catch { /* egal */ }
    void idbPut(b.k, null);
  }
  saveDraftText(exId, b.v.t);
  return { v: b.v, eigen: b.eigen };
}

/** alte Entwürfe (geschlossene Fenster) aufräumen */
export function pruneDrafts(now = Date.now()): number {
  let n = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) keys.push(k); }
    for (const k of keys) {
      let v: unknown;
      try { v = JSON.parse(localStorage.getItem(k) ?? ""); } catch { continue; /* alter Entwurf (Klartext): beim Laden übernommen */ }
      const at = (v as Stored | null)?.at;
      if (typeof at !== "number") continue;
      if (now - at > DRAFT_KEEP_MS) { localStorage.removeItem(k); n++; }
    }
    // Lebenszeichen längst geschlossener Fenster (pagehide kam nicht) aufräumen
    const lebt: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith("lage-tools.fenster.lebt.")) lebt.push(k); }
    for (const k of lebt) if (now - (Number(localStorage.getItem(k)) || 0) > DRAFT_KEEP_MS) localStorage.removeItem(k);
  } catch { /* egal */ }
  return n;
}
let pruned = false;

/**
 * Entwurf der Übung laden (beim ersten Anzeigen und beim Wechsel der Übung) und jede Änderung sofort ablegen.
 * `onRestore` z. B. für die Höhe des Feldes; `onAdopt` meldet einen übernommenen verwaisten Entwurf (Zeit `at`).
 */
export function useDraftPersist(exId: string, text: string, setText: (t: string) => void, onRestore?: (t: string) => void, onAdopt?: (at: number) => void): void {
  const owner = useRef<string | null>(null);
  /** aktueller Text (für die asynchrone Wiederherstellung: nur in ein noch leeres Feld) */
  const textRef = useRef(text);
  textRef.current = text;
  useEffect(() => {
    if (owner.current !== exId) {
      owner.current = exId;
      startLebenszeichen();
      sperreHalten();
      if (!pruned) { pruned = true; pruneDrafts(); }
      const own = loadDraftText(exId);
      const adopted = own ? null : adoptOrphan(exId);
      const t = own || adopted?.t || "";
      if (t !== text) { setText(t); if (t) onRestore?.(t); }
      if (adopted) onAdopt?.(adopted.at);
      if (!t) {
        // dauerhafter Spiegel und Web Locks (Absturz, Neustart nach < 30 s): nur ins leere Feld, nie überschreiben
        void wiederherstellen(exId).then((r) => {
          if (!r || owner.current !== exId || textRef.current.trim()) return;
          setText(r.v.t);
          onRestore?.(r.v.t);
          if (!r.eigen) onAdopt?.(r.v.at);
        });
      }
      return;
    }
    saveDraftText(exId, text);
  }, [exId, text]); // eslint-disable-line react-hooks/exhaustive-deps
}
