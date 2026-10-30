/**
 * Tippen springt ins Meldungsfeld (Spez. MVP 3.5, E2, S21) – Entscheid ohne Browser (`umleiten`) und das Anhängen ans
 * Feld (`anhaengen`, über das `input`-Ereignis wie getippt); dazu Alt+L (`isLiveKey`). Kap. 7: Leerschlag auf Knöpfen,
 * Tasten in Dialogen und Eingabefeldern bleiben, wo sie sind.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { anhaengen, istEingabe, umleiten } from "../src/entry/useTypeToField";
import { isLiveKey } from "../src/time/useLageZeit";

const el = (tagName: string, o: Partial<{ isContentEditable: boolean }> = {}) => ({ tagName, isContentEditable: !!o.isContentEditable }) as unknown as HTMLElement;
const AN = { aktiv: true, offen: false };

describe("umleiten (E2)", () => {
  it("Buchstabe, Ziffer, Satzzeichen ausserhalb eines Felds → ins Meldungsfeld", () => {
    for (const key of ["H", "l", "u", "0", "7", ":", "/", "ä"]) expect(umleiten({ key, target: el("LI") }, AN), key).toBe(true);
    expect(umleiten({ key: "H", target: el("BUTTON") }, AN)).toBe(true);
    expect(umleiten({ key: "H", target: el("DIV") }, AN)).toBe(true); // Karte (Leaflet-Behälter)
    expect(umleiten({ key: "H", target: null }, AN)).toBe(true);
  });
  it("Leerschlag (Knöpfe), Enter/Pfeile/Esc, Kürzel mit Ctrl/⌘/Alt bleiben", () => {
    expect(umleiten({ key: " ", target: el("BUTTON") }, AN)).toBe(false);
    for (const key of ["Enter", "ArrowDown", "Escape", "Tab", "Delete", "F5", "Dead"]) expect(umleiten({ key, target: el("LI") }, AN), key).toBe(false);
    expect(umleiten({ key: "k", ctrlKey: true, target: el("LI") }, AN)).toBe(false);
    expect(umleiten({ key: "z", metaKey: true, target: el("LI") }, AN)).toBe(false);
    expect(umleiten({ key: "l", altKey: true, target: el("LI") }, AN)).toBe(false);
  });
  it("in Eingabefeldern, bei offenem Dialog/Menü, ausserhalb «Lage führen» und während der Komposition nie", () => {
    for (const t of ["INPUT", "TEXTAREA", "SELECT"]) expect(umleiten({ key: "H", target: el(t) }, AN), t).toBe(false);
    expect(umleiten({ key: "H", target: el("DIV", { isContentEditable: true }) }, AN)).toBe(false);
    expect(umleiten({ key: "H", target: el("LI") }, { aktiv: true, offen: true })).toBe(false);
    expect(umleiten({ key: "H", target: el("LI") }, { aktiv: false, offen: false })).toBe(false);
    expect(umleiten({ key: "H", isComposing: true, target: el("LI") }, AN)).toBe(false);
    expect(umleiten({ key: "H", defaultPrevented: true, target: el("LI") }, AN)).toBe(false);
  });
  it("istEingabe", () => {
    expect(istEingabe(el("TEXTAREA"))).toBe(true);
    expect(istEingabe(el("LI"))).toBe(false);
    expect(istEingabe(null)).toBe(false);
  });
});

describe("anhaengen", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("hängt das Zeichen ans Ende, meldet `input` wie getippt, Fokus und Schreibmarke am Ende", () => {
    class Feld {
      private v = "";
      focused = false;
      sel: [number, number] = [0, 0];
      events: string[] = [];
      get value() { return this.v; }
      set value(x: string) { this.v = x; }
      focus() { this.focused = true; }
      dispatchEvent(e: { type: string }) { this.events.push(e.type); return true; }
      setSelectionRange(a: number, b: number) { this.sel = [a, b]; }
    }
    vi.stubGlobal("Event", class { constructor(public type: string, public init?: unknown) {} });
    const f = new Feld();
    f.value = "H0";
    anhaengen(f as unknown as HTMLTextAreaElement, "2");
    expect(f.value).toBe("H02");
    expect(f.focused).toBe(true);
    expect(f.events).toEqual(["input"]);
    expect(f.sel).toEqual([3, 3]);
  });
});

describe("Alt+L (E2)", () => {
  it("nur Alt+L über `code` (macOS: Option liefert «¬»), nie die Einzeltaste L", () => {
    expect(isLiveKey({ altKey: true, ctrlKey: false, metaKey: false, code: "KeyL" })).toBe(true);
    expect(isLiveKey({ altKey: false, ctrlKey: false, metaKey: false, code: "KeyL" })).toBe(false);
    expect(isLiveKey({ altKey: true, ctrlKey: true, metaKey: false, code: "KeyL" })).toBe(false);
    expect(isLiveKey({ altKey: true, ctrlKey: false, metaKey: false, code: "KeyU" })).toBe(false);
  });
});
