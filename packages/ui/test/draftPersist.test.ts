/**
 * Entwurf über Neustart (Spez. MVP 3.5, E7, S26): Lebenszeichen je Fenster; ein Fenster ohne eigenen Entwurf übernimmt
 * den jüngsten **verwaisten** Entwurf derselben Übung (Fenster > 30 s ohne Lebenszeichen) und schreibt ihn um; zwei
 * offene Fenster übernehmen nie den Entwurf des anderen. Nur fiktive Texte (Raum Bern).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function speicher(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } };
}
const T0 = Date.parse("2030-05-15T07:30:00+02:00");
const EX = "ex-beispiel-bern";
const entwurf = (win: string, t: string, at: number) => localStorage.setItem(`lage-tools.entwurf.${EX}.${win}`, JSON.stringify({ t, at }));
const lebt = (win: string, at: number) => localStorage.setItem(`lage-tools.fenster.lebt.${win}`, String(at));

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", speicher());
  const sess = speicher();
  sess.setItem("lage-tools.fenster", "neu1");
  vi.stubGlobal("sessionStorage", sess);
});
afterEach(() => vi.unstubAllGlobals());

describe("verwaisten Entwurf übernehmen (S26)", () => {
  it("Fenster ohne Lebenszeichen > 30 s: jüngster Entwurf wird übernommen und umgeschrieben", async () => {
    const { adoptOrphan, loadDraftText } = await import("../src/draftPersist");
    entwurf("alt1", "H03 2 Pers", T0);
    entwurf("alt2", "H01 1 Fz", T0 - 60000);
    lebt("alt1", T0 + 2000);
    const r = adoptOrphan(EX, T0 + 62000);
    expect(r?.t).toBe("H03 2 Pers");
    expect(r?.at).toBe(T0);
    expect(localStorage.getItem(`lage-tools.entwurf.${EX}.alt1`)).toBeNull();
    expect(loadDraftText(EX)).toBe("H03 2 Pers");
  });
  it("zwei offene Fenster: der Entwurf eines lebenden Fensters bleibt, wo er ist", async () => {
    const { adoptOrphan } = await import("../src/draftPersist");
    entwurf("offen", "H03 2 Pers", T0);
    lebt("offen", T0 + 25000);
    expect(adoptOrphan(EX, T0 + 30000)).toBeNull();
    expect(localStorage.getItem(`lage-tools.entwurf.${EX}.offen`)).not.toBeNull();
  });
  it("eigener Entwurf geht vor; andere Übung und leere Entwürfe zählen nicht", async () => {
    const { adoptOrphan } = await import("../src/draftPersist");
    entwurf("alt", "H03 2 Pers", T0);
    localStorage.setItem(`lage-tools.entwurf.ex-andere.alt9`, JSON.stringify({ t: "H05 1 Pers", at: T0 + 1 }));
    entwurf("leer", "  ", T0 + 5);
    entwurf("neu1", "H04 eigener", T0 - 1);
    expect(adoptOrphan(EX, T0 + 120000)).toBeNull();
    localStorage.removeItem(`lage-tools.entwurf.${EX}.neu1`);
    expect(adoptOrphan(EX, T0 + 120000)?.t).toBe("H03 2 Pers");
  });
  it("Lebenszeichen wird sofort geschrieben (unter der Kennung dieses Fensters)", async () => {
    vi.stubGlobal("window", { addEventListener() { /* egal */ } });
    const { startLebenszeichen, windowId, LEBT_KEY } = await import("../src/draftPersist");
    startLebenszeichen(() => T0);
    expect(localStorage.getItem(LEBT_KEY(windowId()))).toBe(String(T0));
  });
});

describe("Absturz und Neustart nach < 30 s (Review 6, Feld N)", () => {
  it("dauerhafter Spiegel (IndexedDB) und Web Locks: Entwurf eines toten Fensters wird übernommen, eines lebenden nie", async () => {
    const { IDBFactory } = await import("fake-indexeddb");
    vi.stubGlobal("indexedDB", new IDBFactory());
    const held = new Set<string>(["lage-tools.fenster.offen"]);
    vi.stubGlobal("navigator", { locks: { request: () => new Promise(() => {}), query: async () => ({ held: [...held].map((name) => ({ name })) }) } });
    const m = await import("../src/draftPersist");
    // ein abgestürztes Fenster «tot1» (Lebenszeichen vor 5 s – ohne Web Locks wäre es noch «lebendig») und ein offenes
    entwurf("tot1", "H03 2 Pers AK7", T0 - 5000);
    lebt("tot1", T0 - 5000);
    entwurf("offen", "H01 1 Fz", T0);
    lebt("offen", T0);
    const r = await m.wiederherstellen(EX, T0);
    expect(r?.v.t).toBe("H03 2 Pers AK7");
    expect(r?.eigen).toBe(false);
    expect(localStorage.getItem(`lage-tools.entwurf.${EX}.offen`)).not.toBeNull();
    expect(m.loadDraftText(EX)).toBe("H03 2 Pers AK7");
  });
  it("nur im Spiegel (localStorage hatte den Stand beim Absturz noch nicht): wird wiederhergestellt", async () => {
    const { IDBFactory } = await import("fake-indexeddb");
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("navigator", { locks: { request: () => new Promise(() => {}), query: async () => ({ held: [] }) } });
    vi.stubGlobal("document", { addEventListener() { /* egal */ }, visibilityState: "visible" });
    vi.stubGlobal("window", { addEventListener() { /* egal */ } });
    const m = await import("../src/draftPersist");
    m.saveDraftText(EX, "H05 Kontakt AQ11");
    await m.spiegelJetzt();
    // Absturz: localStorage verliert den letzten Stand, neues Fenster (andere Kennung)
    vi.stubGlobal("localStorage", speicher());
    vi.resetModules();
    const sess = speicher(); sess.setItem("lage-tools.fenster", "neu2"); vi.stubGlobal("sessionStorage", sess);
    const m2 = await import("../src/draftPersist");
    const r = await m2.wiederherstellen(EX, Date.now());
    expect(r?.v.t).toBe("H05 Kontakt AQ11");
  });
});
