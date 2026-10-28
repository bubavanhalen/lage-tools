/**
 * Speichern ohne Datenverlust – persist.ts, store.ts, useExerciseStore.ts (applySync), sync.ts mit fake-indexeddb.
 * Jedes «Fenster» ist eine eigene Modul-Instanz (vi.resetModules) mit eigener Datenbank-Verbindung, eigenem
 * sessionStorage und eigenem BroadcastChannel; localStorage und IndexedDB teilen sie wie im Browser.
 * Alle Daten fiktiv (Beispielübung Raum Bern).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clockDay, demoExercise, markRemovals, mergeExercise, mergeHull, mergeReportText, takeHullItems, type Exercise, type LageEvent,
} from "@lage/core";

// ---------------------------------------------------------------- Browser-Umgebung (gerade so viel wie nötig)

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

/** BroadcastChannel-Ersatz: Nachrichten gehen asynchron an alle anderen Kanäle gleichen Namens */
const channels = new Set<MockChannel>();
class MockChannel {
  private ls = new Set<(ev: { data: unknown }) => void>();
  closed = false;
  constructor(public name: string) { channels.add(this); }
  postMessage(m: unknown) {
    const data = structuredClone(m);
    for (const c of channels) if (c !== this && c.name === this.name && !c.closed) setTimeout(() => c.ls.forEach((l) => l({ data })), 0);
  }
  addEventListener(_t: string, l: (ev: { data: unknown }) => void) { this.ls.add(l); }
  removeEventListener(_t: string, l: (ev: { data: unknown }) => void) { this.ls.delete(l); }
  close() { this.closed = true; channels.delete(this); }
}

const local = new MemStorage();
vi.stubGlobal("localStorage", local);
vi.stubGlobal("BroadcastChannel", MockChannel);
vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout });
vi.stubGlobal("document", { addEventListener() {}, visibilityState: "visible" });

type Persist = typeof import("../src/persist");
type Store = typeof import("../src/store");
type Sync = typeof import("../src/useExerciseStore");
type Draft = typeof import("../src/draftPersist");
interface Win { persist: Persist; store: Store; sync: Sync; draft: Draft; session: MemStorage }

/** neues Fenster (bzw. Neuladen): frische Module, eigener sessionStorage */
async function openWindow(session = new MemStorage()): Promise<Win> {
  vi.resetModules();
  vi.stubGlobal("sessionStorage", session);
  const persist = await import("../src/persist");
  const store = await import("../src/store");
  const sync = await import("../src/useExerciseStore");
  const draft = await import("../src/draftPersist");
  return { persist, store, sync, draft, session };
}

/** Speicher voll: put/add werfen (ausser «meta»), wie im Browser bei erschöpftem Kontingent */
const origPut = IDBObjectStore.prototype.put;
const origAdd = IDBObjectStore.prototype.add;
function storageFull(on: boolean) {
  if (!on) { IDBObjectStore.prototype.put = origPut; IDBObjectStore.prototype.add = origAdd; return; }
  for (const [k, o] of [["put", origPut], ["add", origAdd]] as const) {
    IDBObjectStore.prototype[k] = function (this: IDBObjectStore, ...a: Parameters<typeof origPut>) {
      if (this.name !== "meta") throw new DOMException("Quota exceeded", "QuotaExceededError");
      return o.apply(this, a);
    } as typeof origPut;
  }
}

async function until(f: () => boolean | Promise<boolean>, ms = 2000) {
  const t0 = Date.now();
  while (!(await f())) { if (Date.now() - t0 > ms) throw new Error("Zeitüberschreitung"); await new Promise((r) => setTimeout(r, 5)); }
}

let seq = 0;
function ev(text: string, p: Partial<LageEvent> = {}): LageEvent {
  seq++;
  return {
    id: `e${String(seq).padStart(4, "0")}`, rev: 1, device: "dev-test", updatedAt: new Date(Date.UTC(2030, 5, 1, 8, seq)).toISOString(),
    t: `2030-06-01T08:${String(seq % 60).padStart(2, "0")}`, side: "blau", unit: "H01", melder: "H01", text, sym: "einheit", aff: "F", confirmed: false,
    ...p,
  } as LageEvent;
}
function exercise(): Exercise {
  const d = demoExercise();
  return { ...d, id: "ex-test", name: "Test Bern (fiktiv)", events: [] };
}
const revise = (e: LageEvent, p: Partial<LageEvent>, ms = 1): LageEvent => ({ ...e, ...p, rev: e.rev + 1, updatedAt: new Date(Date.parse(e.updatedAt) + ms * 60000).toISOString() });

/** angezeigter Zustand eines Fensters (wie React-State) */
function view(w: Win, ex: Exercise | null) {
  const st = { ex, said: [] as string[], saved: [] as Array<{ id: string; name: string }> };
  const deps = {
    cur: () => st.ex,
    setEx: (f: Exercise | null | ((x: Exercise | null) => Exercise | null)) => { st.ex = typeof f === "function" ? f(st.ex) : f; },
    setSaved: (l: Array<{ id: string; name: string }>) => { st.saved = l; },
    say: (t: string) => { st.said.push(t); },
  };
  const offSync = w.persist.onSync((m) => { void w.sync.applySync(m, deps); });
  const offSave = w.sync.connectPersister(deps);
  const off = () => { offSync(); offSave(); };
  /** wie Workspace.update: ändern, Löschmarken nachführen, sofort speichern */
  const update = (f: (x: Exercise) => Exercise) => { const x = st.ex!; st.ex = markRemovals(x, f(structuredClone(x))); w.persist.persister.save(st.ex); };
  return { st, off, update };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  local.clear();
  storageFull(false);
});
afterEach(() => {
  storageFull(false);
  for (const c of [...channels]) c.close();
});

// ---------------------------------------------------------------- Sofort speichern, Notfallpuffer, Neuladen

describe("Sofort speichern", () => {
  it("jede Meldung einzeln, Notfallpuffer synchron, danach geleert", async () => {
    const w = await openWindow();
    const ex = exercise();
    await w.persist.persister.writeAll(ex);
    const e1 = ev("H01 Beo Stao bezogen AE7");
    const r = w.persist.persister.save({ ...ex, events: [e1] });
    expect(r).toEqual({ changed: true, hull: false });
    // synchron im Puffer – überlebt Absturz 0 ms nach Enter
    expect(JSON.parse(local.getItem("lage-tools.wal")!)["ex-test"].events[e1.id].text).toBe(e1.text);
    await w.persist.persister.flush();
    const back = await w.store.loadExerciseFull("ex-test");
    expect(back!.ex.events!.map((e) => e.id)).toEqual([e1.id]);
    expect(local.getItem("lage-tools.wal")).toBeNull();
    // nur die geänderte Meldung wird geschrieben, die Hülle nicht
    expect(w.persist.persister.save({ ...ex, events: [e1] })).toEqual({ changed: false, hull: false });
  });

  it("Neuladen 0 ms nach Enter: Meldung aus dem Notfallpuffer, nichts verloren", async () => {
    let w = await openWindow();
    const ex = exercise();
    await w.persist.persister.writeAll(ex);
    await w.persist.persister.flush();
    // Datenbank nicht erreicht (Fenster geschlossen, bevor die Transaktion lief): nur der Puffer hat sie
    storageFull(true);
    const e1 = ev("H02 2 Fz AF8 Rtg N", { side: "rot", aff: "H", unit: "" });
    w.persist.persister.save({ ...ex, events: [e1] });
    await w.persist.persister.flush();
    storageFull(false);
    w = await openWindow(w.session); // Neuladen
    expect(w.persist.lastCurrent()).toBe("ex-test");
    const r = await w.persist.openStored("ex-test");
    expect(r!.recovered).toBe(1);
    expect(r!.ex.events!.map((e) => e.text)).toEqual([e1.text]);
    // beim nächsten Speichern landet sie in der Datenbank
    w.persist.persister.save(r!.ex);
    await w.persist.persister.flush();
    expect((await w.store.loadExerciseFull("ex-test"))!.ex.events).toHaveLength(1);
    expect(local.getItem("lage-tools.wal")).toBeNull();
  });

  it("neue Übung nur im Puffer (Datenbank nie erreicht): beim Neuladen da", async () => {
    let w = await openWindow();
    storageFull(true);
    const ex = { ...exercise(), id: "ex-neu", events: [ev("H03 Beo Stao bezogen AG7")] };
    w.persist.persister.save(ex);
    await w.persist.persister.flush();
    storageFull(false);
    w = await openWindow(w.session);
    const r = await w.persist.openStored("ex-neu");
    expect(r!.ex.events).toHaveLength(1);
    expect(r!.ex.sheets.length).toBe(ex.sheets.length);
  });
});

describe("Speicher voll (Quota)", () => {
  it("rotes Band (Status «voll»), Puffer bleibt, wieder frei → nachgeholt", async () => {
    const w = await openWindow();
    const states: Array<string | null> = [];
    w.store.onStoreStatus((p, where) => { if (where === "uebung") states.push(p ? p.kind : null); });
    const ex = exercise();
    await w.persist.persister.writeAll(ex);
    storageFull(true);
    const evs = [ev("H01 Beo Stao bezogen AE8"), ev("H02 Beo Stao bezogen AF8"), ev("H03 Beo Stao bezogen AG8")];
    for (let i = 1; i <= evs.length; i++) { w.persist.persister.save({ ...ex, events: evs.slice(0, i) }); await w.persist.persister.flush(); }
    expect(states.at(-1)).toBe("voll");
    expect(w.store.storeProblem("uebung", new DOMException("x", "QuotaExceededError")).text).toBe("Gerätespeicher voll");
    expect(Object.keys(JSON.parse(local.getItem("lage-tools.wal")!)["ex-test"].events)).toHaveLength(3);
    storageFull(false);
    const e4 = ev("H04 Beo Stao bezogen AH8");
    w.persist.persister.save({ ...ex, events: [...evs, e4] });
    await w.persist.persister.flush();
    expect(states.at(-1)).toBeNull();
    expect((await w.store.loadExerciseFull("ex-test"))!.ex.events).toHaveLength(4);
    expect(local.getItem("lage-tools.wal")).toBeNull();
  });

  it("Foto/Sprachmemo: bleibt im Arbeitsspeicher, «Datei sichern» findet es, später abgelegt", async () => {
    const w = await openWindow();
    const att: string[] = [];
    w.store.onStoreStatus((p, where) => { if (where === "anhang") att.push(p ? p.kind : "ok"); });
    storageFull(true);
    const blob = new Blob(["fiktives Memo"], { type: "audio/webm" });
    await expect(w.store.putBlob("a-memo1", blob)).rejects.toThrow();
    expect(att).toEqual(["voll"]);
    expect(w.store.memBlobCount()).toBe(1);
    // Anzeige und Export (exerciseFile → getBlob) haben den Inhalt trotzdem
    expect(await (await w.store.getBlob("a-memo1"))!.text()).toBe("fiktives Memo");
    storageFull(false);
    expect(await w.store.retryMemBlobs()).toBe(1);
    expect(w.store.memBlobCount()).toBe(0);
    expect(att.at(-1)).toBe("ok");
    // jetzt aus der Datenbank (neues Fenster ohne Arbeitsspeicher)
    const w2 = await openWindow();
    expect(await (await w2.store.getBlob("a-memo1"))!.text()).toBe("fiktives Memo");
  });

  it("Foto verworfen (×): Band zurückgesetzt, nichts mehr im Arbeitsspeicher", async () => {
    const w = await openWindow();
    const att: string[] = [];
    let ticks = 0;
    w.store.onStoreStatus((p, where) => { if (where === "anhang") att.push(p ? p.kind : "ok"); });
    w.store.onMemBlobs(() => { ticks++; });
    storageFull(true);
    await w.store.putBlob("a-foto2", new Blob(["jpg"], { type: "image/jpeg" })).catch(() => undefined);
    await w.store.putBlob("a-foto2:thumb", new Blob(["t"], { type: "image/jpeg" })).catch(() => undefined);
    expect(w.store.memBlobIds()).toEqual(["a-foto2"]);
    expect(att).toEqual(["voll"]);
    await w.store.deleteBlob("a-foto2:thumb");
    expect(att).toEqual(["voll"]);
    await w.store.deleteBlob("a-foto2");
    expect(w.store.memBlobCount()).toBe(0);
    expect(att.at(-1)).toBe("ok");
    expect(ticks).toBeGreaterThan(0);
    storageFull(false);
  });

  it("nach gelungenem Speichern werden Anhänge aus dem Arbeitsspeicher automatisch abgelegt", async () => {
    const w = await openWindow();
    const ex = exercise();
    await w.persist.persister.writeAll(ex);
    storageFull(true);
    await w.store.putBlob("a-foto1", new Blob(["jpg"], { type: "image/jpeg" })).catch(() => undefined);
    storageFull(false);
    w.persist.persister.save({ ...ex, events: [ev("H01 Beo Stao bezogen AE7")] });
    await w.persist.persister.flush();
    await until(() => w.store.memBlobCount() === 0);
  });
});

// ---------------------------------------------------------------- Migration v3 → v4

describe("Migration v3 → v4", () => {
  it("Meldungen aus der Hülle in die eigene Ablage, nichts verloren, Hülle ohne Meldungen", async () => {
    // alte App (bis MVP 0): Datenbank Version 3, Meldungen in der Übung
    const ex = exercise();
    const evs = [ev("H01 Beo Stao bezogen AE7"), ev("H02 2 Fz AF8", { side: "rot", aff: "H" }), ev("H03 gelöscht", { deleted: true, rev: 2 })];
    await new Promise<void>((res, rej) => {
      const q = indexedDB.open("lage-tools", 3);
      q.onupgradeneeded = () => {
        const d = q.result;
        d.createObjectStore("exercises", { keyPath: "id" });
        d.createObjectStore("meta");
        d.createObjectStore("roads", { keyPath: "key" });
        d.createObjectStore("blobs");
      };
      q.onsuccess = () => {
        const tx = q.result.transaction(["exercises", "meta"], "readwrite");
        tx.objectStore("exercises").put({ ...ex, events: evs });
        tx.objectStore("meta").put("ex-test", "current");
        tx.oncomplete = () => { q.result.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      q.onerror = () => rej(q.error);
    });
    const w = await openWindow();
    const ups: number[] = [];
    w.store.onDbUpgraded((v) => ups.push(v));
    expect(await w.store.currentExerciseId()).toBe("ex-test");
    await until(() => ups.length > 0);
    expect(ups).toEqual([3]); // Update-Notiz «alte Lagejournal-Fenster schliessen»
    const r = await w.persist.openStored("ex-test");
    expect(r!.ex.events!.map((e) => e.id).sort()).toEqual(evs.map((e) => e.id).sort());
    expect(r!.ex.events!.find((e) => e.deleted)?.rev).toBe(2);
    const d = await w.store.db();
    expect(d.version).toBe(4);
    const hull = await d.get("exercises", "ex-test");
    expect(hull.events).toBeUndefined();
    expect(hull.__rev).toBe(1);
    expect(await d.count("events")).toBe(3);
    // zweites Laden: kein erneuter Umzug, gleich viele Meldungen
    const r2 = await (await openWindow()).store.loadExerciseFull("ex-test");
    expect(r2!.legacy).toBe(0);
    expect(r2!.ex.events).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- Zwei Fenster

describe("Zwei Fenster (BroadcastChannel)", () => {
  async function two() {
    const a = await openWindow();
    const ex = exercise();
    await a.persist.persister.writeAll(ex);
    await a.persist.persister.flush();
    const b = await openWindow();
    const rb = await b.persist.openStored("ex-test");
    const ra = await a.persist.openStored("ex-test");
    return { a, b, va: view(a, ra!.ex), vb: view(b, rb!.ex) };
  }

  it("beide sehen alles, abwechselnd schnell eingetragen – nichts überschrieben", async () => {
    const { a, b, va, vb } = await two();
    for (let i = 0; i < 6; i++) {
      const v = i % 2 ? vb : va;
      v.update((x) => { x.events = [...(x.events ?? []), ev(`H0${i + 1} Beo Stao bezogen AE${7 + i}`)]; return x; });
    }
    await a.persist.persister.flush(); await b.persist.persister.flush();
    await until(() => va.st.ex!.events!.length === 6 && vb.st.ex!.events!.length === 6);
    const db = await (await openWindow()).store.loadExerciseFull("ex-test");
    expect(db!.ex.events).toHaveLength(6);
  });

  it("Hülle gleichzeitig: Raster gelöscht (A) + Name geändert (B) – beides bleibt, Raster taucht nicht wieder auf", async () => {
    const { a, b, va, vb } = await two();
    const gone = va.st.ex!.sheets[0]!.id;
    va.update((x) => { x.sheets = x.sheets.filter((s) => s.id !== gone); return x; });
    vb.update((x) => { x.name = "Umbenannt in B"; return x; });
    await a.persist.persister.flush(); await b.persist.persister.flush();
    await until(() => va.st.ex!.name === "Umbenannt in B" && !vb.st.ex!.sheets.some((s) => s.id === gone));
    const w = await openWindow();
    const db = (await w.store.loadExerciseFull("ex-test"))!.ex;
    expect(db.name).toBe("Umbenannt in B");
    expect(db.sheets.some((s) => s.id === gone)).toBe(false);
    expect(db.removed?.[gone]?.undone).toBeUndefined();
  });

  it("gelöschtes NAI mit Rückgängig wiederhergestellt: bleibt auch im anderen Fenster", async () => {
    const { a, b, va, vb } = await two();
    const nai = va.st.ex!.areas[0]!;
    va.update((x) => { x.areas = x.areas.filter((s) => s.id !== nai.id); return x; });
    await a.persist.persister.flush();
    await until(() => !vb.st.ex!.areas.some((s) => s.id === nai.id));
    va.update((x) => { x.areas = [nai, ...x.areas]; return x; });
    await a.persist.persister.flush();
    await until(() => vb.st.ex!.areas.some((s) => s.id === nai.id));
    expect(vb.st.ex!.removed?.[nai.id]?.undone).toBe(true);
    void b;
  });

  it("Konflikt beim Bearbeiten: anderes Fenster ändert/löscht → editConflict meldet es (eigene Änderungen nicht)", async () => {
    const { a, b, va, vb } = await two();
    const e1 = ev("H01 Beo Stao bezogen AE12");
    va.update((x) => { x.events = [e1]; return x; });
    await a.persist.persister.flush();
    await until(() => vb.st.ex!.events!.length === 1);
    // A und B öffnen die Bearbeitung (Fassung merken)
    const baseA = va.st.ex!.events![0]!, baseB = vb.st.ex!.events![0]!;
    // eigene Änderung in A (z. B. Strasse nachgeführt) ist kein Konflikt
    va.update((x) => { x.events = x.events!.map((e) => revise(e, { angle: 90 })); return x; });
    expect(a.persist.editConflict("ex-test", baseA, va.st.ex!.events![0])).toBeNull();
    await a.persist.persister.flush();
    await until(() => vb.st.ex!.events![0]!.rev === 2);
    // B sieht: in einem anderen Fenster geändert
    expect(b.persist.editConflict("ex-test", baseB, vb.st.ex!.events![0])).toBe("geaendert");
    // A löscht; B (Bearbeitung noch offen) sieht «gelöscht»
    va.update((x) => { x.events = x.events!.map((e) => revise(e, { deleted: true })); return x; });
    await a.persist.persister.flush();
    await until(() => !!vb.st.ex!.events![0]!.deleted);
    expect(b.persist.editConflict("ex-test", baseB, vb.st.ex!.events![0])).toBe("geloescht");
    // «Trotzdem speichern» in B: neue Revision, nicht gelöscht – gilt dann überall
    vb.update((x) => { x.events = x.events!.map((e) => revise(e, { deleted: false, text: "H01 Beo Stao bezogen AE20 (B)" })); return x; });
    await b.persist.persister.flush();
    await until(() => va.st.ex!.events![0]!.text.endsWith("(B)") && !va.st.ex!.events![0]!.deleted);
    const db = (await (await openWindow()).store.loadExerciseFull("ex-test"))!.ex;
    expect(db.events![0]!.rev).toBe(4);
    expect(db.events![0]!.deleted).toBe(false);
  });

  it("ältere Fassung überschreibt nie eine neuere Meldung in der Datenbank", async () => {
    const { a, b, va, vb } = await two();
    const e1 = ev("H01 Beo Stao bezogen AE7");
    va.update((x) => { x.events = [e1]; return x; });
    await a.persist.persister.flush();
    await until(() => vb.st.ex!.events!.length === 1);
    vb.update((x) => { x.events = x.events!.map((e) => revise(e, { text: "korrigiert in B" })); return x; });
    await b.persist.persister.flush();
    // A hat die Nachricht noch nicht verarbeitet und schreibt seine (ältere) Fassung erneut
    a.persist.persister.adopt({ ...va.st.ex!, events: [] }, "stored", a.persist.persister.rev("ex-test"));
    a.persist.persister.save({ ...va.st.ex!, events: [e1] });
    await a.persist.persister.flush();
    const db = (await (await openWindow()).store.loadExerciseFull("ex-test"))!.ex;
    expect(db.events![0]!.text).toBe("korrigiert in B");
  });
});

// ---------------------------------------------------------------- Zusammenführen (sync.ts)

describe("Zusammenführen", () => {
  it("ältere Datei: gelöschtes NAI/Raster taucht nicht wieder auf, Meldungen bleiben", () => {
    const file = exercise();
    file.events = [ev("H01 Beo Stao bezogen AE7")];
    let here = structuredClone(file);
    const nai = here.areas[0]!.id, sheet = here.sheets[0]!.id;
    here = markRemovals(here, { ...here, areas: here.areas.slice(1), sheets: here.sheets.slice(1) });
    here.events = [...here.events!, ev("H02 Beo Stao bezogen AF7")];
    const { ex, report } = mergeExercise(here, file);
    expect(ex.areas.some((a) => a.id === nai)).toBe(false);
    expect(ex.sheets.some((s) => s.id === sheet)).toBe(false);
    expect(ex.events).toHaveLength(2);
    expect(report.areas + report.sheets).toBe(0);
    // auch umgekehrt (Datei hat die Löschmarke, hier noch vorhanden)
    const back = mergeExercise(file, here).ex;
    expect(back.areas.some((a) => a.id === nai)).toBe(false);
  });

  it("Rückgängig nach dem Löschen: spätere Marke gilt", () => {
    const a = exercise();
    const nai = a.areas[0]!;
    const del = markRemovals(a, { ...a, areas: a.areas.slice(1) }, new Date("2030-06-01T08:00:00Z"));
    const und = markRemovals(del, { ...del, areas: [nai, ...del.areas] }, new Date("2030-06-01T08:00:05Z"));
    expect(und.removed![nai.id]).toEqual({ at: "2030-06-01T08:00:05.000Z", undone: true });
    // anderes Fenster kennt nur das Löschen: zusammengeführt bleibt es da
    expect(mergeHull(del, und).ex.areas.some((x) => x.id === nai.id)).toBe(true);
    expect(mergeHull(und, del).ex.areas.some((x) => x.id === nai.id)).toBe(true);
    // ohne Änderung keine neue Übung
    expect(markRemovals(und, und)).toBe(und);
  });

  it("andere Raster-/NAI-Version: einzeln wählbar, Meldungen bleiben", () => {
    const here = exercise();
    here.events = [ev("H01 2 Fz AK7", { cells: ["AK7"] })];
    const file = structuredClone(here);
    file.events = [];
    file.sheets[0] = { ...file.sheets[0]!, name: "BERN NEU" };
    file.areas[0] = { ...file.areas[0]!, ring: file.areas[0]!.ring.map((q) => ({ e: q.e + 1000, n: q.n })) };
    const { ex, report } = mergeExercise(here, file);
    expect(report.abweichend).toBe(2);
    expect(report.diffs.map((d) => [d.kind, d.name, d.theirsName])).toEqual([["sheets", here.sheets[0]!.name, "BERN NEU"], ["areas", here.areas[0]!.name, here.areas[0]!.name]]);
    expect(mergeReportText(report)).toContain("2 abweichend");
    // Raster aus der Datei übernehmen, NAI hiesig behalten
    const taken = takeHullItems(ex, file, [report.diffs[0]!]);
    expect(taken.sheets[0]!.name).toBe("BERN NEU");
    expect(taken.areas[0]).toEqual(here.areas[0]);
    expect(taken.events).toEqual(ex.events);
    // zurück auf hiesige
    expect(takeHullItems(taken, here, [report.diffs[0]!]).sheets[0]!.name).toBe(here.sheets[0]!.name);
  });
});

// ---------------------------------------------------------------- Entwurf pro Fenster, Rückgängig-Stapel, Tag

describe("Entwurf pro Fenster", () => {
  it("zwei Fenster mit derselben Übung löschen sich den Entwurf nicht", async () => {
    const a = await openWindow();
    a.draft.saveDraftText("ex-test", "H04 2 Fz AK7");
    const sa = a.session;
    const b = await openWindow();
    expect(b.draft.loadDraftText("ex-test")).toBe("");
    b.draft.saveDraftText("ex-test", "H05 1 Pers");
    b.draft.saveDraftText("ex-test", ""); // B trägt ein → leert nur seinen Entwurf
    const a2 = await openWindow(sa); // A neu geladen
    expect(a2.draft.loadDraftText("ex-test")).toBe("H04 2 Fz AK7");
  });
  it("alter Entwurf (ein Schlüssel für alle) wird einmal übernommen; alte Entwürfe aufgeräumt", async () => {
    local.setItem("lage-tools.entwurf.ex-alt", "H01 Beo");
    const a = await openWindow();
    expect(a.draft.loadDraftText("ex-alt")).toBe("H01 Beo");
    expect(local.getItem("lage-tools.entwurf.ex-alt")).toBeNull();
    expect((await openWindow()).draft.loadDraftText("ex-alt")).toBe("");
    expect(a.draft.pruneDrafts(Date.now() + a.draft.DRAFT_KEEP_MS + 1000)).toBe(1);
  });
});

describe("Rückgängig mehrstufig", () => {
  it("Stapel: Ctrl+Z wiederholt stellt in umgekehrter Reihenfolge wieder her", async () => {
    const { UndoStack } = await import("../src/undo");
    const done: string[] = [];
    let shown = 0;
    const s = new UndoStack((l) => { shown = l.length; });
    s.push("«NAI 1» gelöscht", () => done.push("NAI 1"));
    s.push("«NAI 2» gelöscht", () => done.push("NAI 2"));
    expect(shown).toBe(2);
    expect(s.pop()).toBe(true);
    expect(s.pop()).toBe(true);
    expect(s.pop()).toBe(false);
    expect(done).toEqual(["NAI 2", "NAI 1"]);
  });
});

describe("Tag folgt der Uhr (clockDay)", () => {
  const at = (iso: string) => new Date(iso);
  it("heute Übungstag oder letzter Tag gestern → heute, folgt der Uhr", () => {
    expect(clockDay(["2026-10-28"], at("2026-10-28T10:00"))).toEqual({ day: "2026-10-28", follow: true });
    expect(clockDay(["2026-10-28"], at("2026-10-29T00:15"))).toEqual({ day: "2026-10-29", follow: true });
    expect(clockDay([], at("2026-10-29T00:15"))).toEqual({ day: "2026-10-29", follow: true });
  });
  it("Beispiel 2030 / Vorbereitungstage: kein heutiges T1 davor", () => {
    expect(clockDay(["2030-06-01", "2030-06-02"], at("2026-10-28T10:00"))).toEqual({ day: "2030-06-01", follow: false });
  });
  it("Übung längst vorbei: letzter Übungstag, folgt nicht der Uhr", () => {
    expect(clockDay(["2026-10-20", "2026-10-21"], at("2026-10-28T10:00"))).toEqual({ day: "2026-10-21", follow: false });
  });
});
