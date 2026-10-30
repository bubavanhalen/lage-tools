/**
 * Strassen-Abruf: ein geteilter Abruf je Kachel darf nicht am Abbruchsignal des ersten Aufrufers hängen,
 * und fehlende Kacheln (offline/Fehler) werden als «unvollständig» gemeldet (→ später neu versuchen).
 * Ohne IndexedDB (Node): der Speicher fällt still weg, der Abruf läuft über das (nachgebildete) Netz.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// fiktive Strasse quer durch eine Kachel im Raum Bern
const ROAD = { results: [{ id: 1, properties: { objektart: 9, strassenname: "Teststrasse", verkehrsbedeutung: 300 }, geometry: { type: "LineString", coordinates: [[2600100, 1199500], [2600900, 1199500]] } }] };
const CELL = { minE: 2600400, maxE: 2600600, minN: 1199400, maxN: 1199600 };

function slowFetch(ok = true, ms = 30) {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const t = setTimeout(() => resolve(ok ? new Response(JSON.stringify(ROAD), { status: 200 }) : new Response("", { status: 500 })), ms);
    init?.signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("abgebrochen", "AbortError")); });
  }));
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

/** MVP 3.5 (Entscheid K2): Strassen nur, wenn die Übung den Dienst ausdrücklich einschaltet */
async function mitStrassen() {
  const p = await import("../src/onlinePolicy");
  p.setOnlinePolicy({ strassen: true });
  return import("../src/roadsource");
}

describe("roadsource", () => {
  it("MVP 3.5 (K2): ohne Einschalten keine Anfrage ans Netz", async () => {
    const f = slowFetch();
    vi.stubGlobal("fetch", f);
    const rs = await import("../src/roadsource");
    const r = await rs.placeOnRoadTry(CELL);
    expect(r.pl).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("Abbruch des ersten Aufrufers trifft den zweiten nicht (geteilter Abruf)", async () => {
    const f = slowFetch();
    vi.stubGlobal("fetch", f);
    const rs = await mitStrassen();
    const ctl = new AbortController();
    const first = rs.placeOnRoadTry(CELL, undefined, { signal: ctl.signal });
    const second = rs.placeOnRoadTry(CELL);
    ctl.abort();
    const [a, b] = await Promise.all([first, second]);
    expect(a.pl).toBeNull();
    expect(b.pl?.road).toBe("Teststrasse");
    expect(b.complete).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("Netzfehler: kein Ergebnis und unvollständig (später erneut versuchen)", async () => {
    vi.stubGlobal("fetch", slowFetch(false, 1));
    const rs = await mitStrassen();
    const r = await rs.placeOnRoadTry(CELL);
    expect(r).toEqual({ pl: null, complete: false });
  });

  it("Hinweis «autobahn» wertet die Autobahn normal", async () => {
    const both = { results: [
      ROAD.results[0],
      { id: 2, properties: { objektart: 2, strassenname: "A1" }, geometry: { type: "LineString", coordinates: [[2600100, 1199450], [2600900, 1199450]] } },
    ] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(both), { status: 200 })));
    const rs = await mitStrassen();
    expect((await rs.placeOnRoadTry(CELL)).pl?.road).toBe("Teststrasse");
    expect((await rs.placeOnRoadTry(CELL, undefined, { hint: "autobahn" })).pl?.road).toBe("A1");
  });

  it("Strassenname im Text: genannte Strasse knapp ausserhalb gewinnt, Kandidaten dabei", async () => {
    const two = { results: [
      ROAD.results[0],
      { id: 3, properties: { objektart: 10, strassenname: "Bärenmattweg" }, geometry: { type: "LineString", coordinates: [[2600100, 1199700], [2600900, 1199700]] } },
    ] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(two), { status: 200 })));
    const rs = await mitStrassen();
    const auto = (await rs.placeOnRoadTry(CELL)).pl!;
    expect(auto.road).toBe("Teststrasse");
    const r = (await rs.placeOnRoadTry(CELL, undefined, { text: "H04: gn Sperre Baerenmattweg" })).pl!;
    expect(r).toMatchObject({ road: "Bärenmattweg", named: "text" });
    expect(r.pos.n).toBeCloseTo(1199700, 0);
    expect(r.candidates!.map((c) => c.road)).toEqual(["Bärenmattweg", "Teststrasse"]);
  });
});
