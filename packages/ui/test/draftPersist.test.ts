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
