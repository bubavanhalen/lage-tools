/**
 * Betrieb (Spez. MVP 3.5, Kap. 3.1, Paket A): Status-Ableitung und Texte des Offline-Popovers, Ampel «Karte» nur bei
 * 100 % mit vollständiger Prüfung (4xx zählt als vorhanden), Datei-Erinnerung, Schutzhinweis, Wake-Lock-Automat,
 * Online-Suche nur auf Klick, Raster «Feld» zu grob, Service-Worker-Zeitlimits aus `entscheide.ts`. Ohne Browser:
 * Cache, Navigator und Dokument sind kleine Attrappen. Nur fiktive Daten (Raum Bern).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @lage/map lädt Leaflet (braucht `window`) – für die Rechnungen genügen Auflösungen und Umrechnungen
vi.mock("@lage/map", () => ({
  RESOLUTIONS: [4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250, 1000, 750, 650, 500, 250, 100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1],
  toLv95: (p: { lat: number; lng: number }) => ({ e: p.lng, n: p.lat }),
  toLatLng: (p: { e: number; n: number }) => ({ lat: p.n, lng: p.e }),
  drawRect: async () => null,
  boundsAround: () => null, flashBounds: () => {}, flashPoint: () => {}, flashRing: () => {}, flyToBoundsSharp: () => {}, flyToCell: () => {},
  growBounds: (b: unknown) => b, NAV_MAX_ZOOM: { feld: 20 }, whenSettled: () => {},
}));
vi.mock("leaflet", () => ({ default: { marker: () => ({ addTo: () => ({ remove() {} }) }), divIcon: () => ({}) } }));

/** einfacher localStorage für Node */
function speicher(): Storage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, clear: () => m.clear(), getItem: (k) => m.get(k) ?? null, key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); } };
}

/** Cache-API-Attrappe: Name → Map(URL → Response) */
function cachesAttrappe() {
  const alle = new Map<string, Map<string, Response>>();
  const open = async (n: string) => {
    if (!alle.has(n)) alle.set(n, new Map());
    const m = alle.get(n)!;
    return { match: async (u: string) => m.get(u), put: async (u: string, r: Response) => { m.set(u, r); }, keys: async () => [...m.keys()].map((u) => ({ url: u })) };
  };
  return { alle, api: { open, has: async (n: string) => alle.has(n), delete: async (n: string) => alle.delete(n) } };
}

beforeEach(() => { vi.stubGlobal("localStorage", speicher()); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Ampel «Karte» (S8): vollständig geprüft, 4xx zählt als vorhanden", () => {
  const B = { minE: 2594000, maxE: 2608000, minN: 1192000, maxN: 1204000 };
  it("prüft alle Teile (keine Stichprobe) und zieht lt-tiles-fehlen ab", async () => {
    const c = cachesAttrappe();
    vi.stubGlobal("caches", c.api);
    const { areaTileCoverage, tileUrls, TILES_FEHLEN } = await import("../src/offline");
    const urls = tileUrls(B, 5, "lk");
    expect(urls.length).toBeGreaterThan(64); // mehrere Bündel
    const t = await c.api.open("lt-tiles-v1");
    // alle bis auf 5 vorhanden; davon 3 bei swisstopo nicht vorhanden (4xx)
    for (const u of urls.slice(5)) await t.put(u, new Response("x"));
    let r = await areaTileCoverage(B);
    expect(r).toMatchObject({ share: (urls.length - 5) / urls.length, total: urls.length, cached: urls.length - 5 });
    const f = await c.api.open(TILES_FEHLEN);
    for (const u of urls.slice(0, 3)) await f.put(u, new Response("", { headers: { "x-lt-fehlt": "1" } }));
    r = await areaTileCoverage(B);
    expect(r.cached).toBe(urls.length - 2);
    expect(r.share).toBeLessThan(1);
    for (const u of urls.slice(3, 5)) await t.put(u, new Response("x"));
    expect((await areaTileCoverage(B)).share).toBe(1);
  });
  it("Review 6 Feld H1: abgebrochen nach den groben Stufen → Übersicht ✓, Detail teilweise, feinste Stufe", async () => {
    const c = cachesAttrappe();
    vi.stubGlobal("caches", c.api);
    const { areaTileCoverage, tileUrls, OFFLINE_FEINSTE_M, UEBERSICHT_AB_M } = await import("../src/offline");
    const { RESOLUTIONS } = await import("@lage/map");
    const urls = tileUrls(B, OFFLINE_FEINSTE_M, "lk");
    const zOf = (u: string) => +u.split("/2056/")[1]!.split("/")[0]!;
    const grob = urls.filter((u) => RESOLUTIONS[zOf(u)]! >= UEBERSICHT_AB_M);
    // Laden lädt grob → fein: Abbruch nach den groben Stufen und einem Viertel von 5 m
    const z5 = urls.filter((u) => RESOLUTIONS[zOf(u)] === 5);
    const t = await c.api.open("lt-tiles-v1");
    for (const u of [...grob, ...z5.slice(0, Math.floor(z5.length / 4))]) await t.put(u, new Response("x"));
    const r = await areaTileCoverage(B, OFFLINE_FEINSTE_M);
    expect(r.share).toBeLessThan(1);
    expect(r.uebersicht).toEqual({ total: grob.length, cached: grob.length });
    expect(r.detail.total).toBe(urls.length - grob.length);
    expect(r.detail.cached).toBe(Math.floor(z5.length / 4));
    expect(RESOLUTIONS[r.feinsteZ!]).toBe(10);
    // die alte Prüfung (bis 5 m) hätte hier fast alles gesehen – die Ampel prüft bis zur Ladestufe
    const { karteText, betriebAus } = await import("../src/betrieb/status");
    const s = betriebAus({ offline: { ready: false, net: true, parts: { app: true, karte: false, speicher: true }, missing: [], abdeckung: { ...r, geprueft: true } },
      onlineDienste: undefined, installiert: false, install: "manuell", dateiGesichert: null, laden: null, ergebnis: { abgebrochen: true } });
    const k = karteText(s.karte);
    expect(k.ok).toBe(false);
    expect(k.text).toMatch(/^Übersicht ✓ · Detail \d+ %$/);
    expect(k.zusatz).toBe(`abgebrochen – ${r.cached.toLocaleString("de-CH")} von ${r.total.toLocaleString("de-CH")}`);
  });
  it("ohne Cache-API: nichts vorhanden", async () => {
    vi.stubGlobal("caches", undefined);
    const { areaTileCoverage } = await import("../src/offline");
    const r = await areaTileCoverage(B);
    expect(r.share).toBe(0);
    expect(r.total).toBeGreaterThan(0);
  });
  it("Vorladen: 4xx → lt-tiles-fehlen (erledigt), Netzfehler → fehlgeschlagen", async () => {
    const c = cachesAttrappe();
    vi.stubGlobal("caches", c.api);
    let n = 0;
    vi.stubGlobal("fetch", async () => { n++; if (n % 10 === 0) throw new Error("Netz"); if (n % 7 === 0) return new Response("", { status: 404 }); return new Response("kachel", { status: 200 }); });
    const { downloadTiles, areaTileCoverage, tileUrls, TILES_FEHLEN } = await import("../src/offline");
    const total = tileUrls(B, 5, "lk").length;
    const r = await downloadTiles(B, 5, "lk", () => {});
    expect(r.saved + r.failed + r.fehlen).toBe(total);
    expect(r.fehlen).toBeGreaterThan(0);
    expect(c.alle.get(TILES_FEHLEN)!.size).toBe(r.fehlen);
    const cov = await areaTileCoverage(B);
    expect(cov.cached).toBe(total - r.failed);
  });
});

describe("Status und Texte (Kap. 2.3, 4)", () => {
  const offline = (o: Partial<{ app: boolean; karte: boolean; speicher: boolean; net: boolean }> = {}) => ({
    ready: false, net: o.net ?? true, parts: { app: o.app ?? false, karte: o.karte ?? false, speicher: o.speicher ?? false }, missing: [],
  });
  it("betriebAus: Teilezahlen, installiert → fertig, Online-Dienste über onlineAllowed", async () => {
    const { betriebAus } = await import("../src/betrieb/status");
    const s = betriebAus({ offline: { ...offline(), abdeckung: { share: 933 / 971, total: 971, cached: 933, geprueft: true } }, onlineDienste: undefined,
      installiert: false, install: "ios", dateiGesichert: null, laden: { done: 42, total: 100, teil: "karte", teilDone: 42, teilTotal: 100 } });
    expect(s.karte).toEqual({ share: 933 / 971, total: 971, cached: 933, geprueft: true });
    expect(s.install).toBe("ios");
    expect(s.online).toEqual({ ortssuche: false, strassen: false });
    expect(s.laden).toEqual({ done: 42, total: 100 });
    const t = betriebAus({ offline: offline({ karte: true }), onlineDienste: { ortssuche: true }, installiert: true, install: "manuell", dateiGesichert: "2030-05-15T05:31:00.000Z", laden: null });
    expect(t.install).toBe("fertig");
    expect(t.online.ortssuche).toBe(true);
    expect(t.karte.share).toBe(1);
  });
  it("karteText: nie «100 %», solange etwas fehlt", async () => {
    const { karteText } = await import("../src/betrieb/status");
    expect(karteText({ share: 933 / 971, total: 971, cached: 933, geprueft: true })).toEqual({ ok: false, text: "96 % (933 von 971 Teilen)" });
    expect(karteText({ share: 970 / 971, total: 971, cached: 970, geprueft: true }).text).toBe("99 % (970 von 971 Teilen)");
    expect(karteText({ share: 1, total: 971, cached: 971, geprueft: true })).toEqual({ ok: true, text: "Raster-Gebiet vollständig" });
    expect(karteText({ share: 0, total: 971, cached: 0, geprueft: true })).toEqual({ ok: false, text: "noch nicht geladen" });
    expect(karteText({ share: 1, total: 0, cached: 0, geprueft: false }).ok).toBeNull();
  });
  it("ladenText: «Lädt 42 %», nie 100 % vor dem Ende", async () => {
    const { ladenText } = await import("../src/betrieb/status");
    expect(ladenText({ done: 42, total: 100 })).toBe("Lädt 42 %");
    expect(ladenText({ done: 100, total: 100 })).toBe("Lädt 99 %");
    expect(ladenText(null)).toBeNull();
  });
  it("Schutzhinweis nur ungeschützt ∧ nicht installiert ∧ nicht gesehen", async () => {
    const { schutzHinweisNoetig } = await import("../src/betrieb/status");
    expect(schutzHinweisNoetig({ speicher: false, installiert: false }, false)).toBe(true);
    expect(schutzHinweisNoetig({ speicher: true, installiert: false }, false)).toBe(false);
    expect(schutzHinweisNoetig({ speicher: false, installiert: true }, false)).toBe(false);
    expect(schutzHinweisNoetig({ speicher: false, installiert: false }, true)).toBe(false);
  });
});

describe("Datei sichern (S9)", () => {
  it("erinnern: nie oder älter als 120 min; Text «zuletzt 07:31» / «nie gesichert»", async () => {
    const { dateiErinnern, dateiText, markDateiGesichert, dateiGesichertAm } = await import("../src/betrieb/dateiSichern");
    const jetzt = new Date(2030, 4, 15, 7, 31);
    expect(dateiErinnern("ex-bern", jetzt)).toBe(true);
    markDateiGesichert("ex-bern", jetzt);
    expect(dateiGesichertAm("ex-bern")).toBe(jetzt.toISOString());
    expect(dateiErinnern("ex-bern", new Date(jetzt.getTime() + 10 * 60000))).toBe(false);
    expect(dateiErinnern("ex-bern", new Date(jetzt.getTime() + 121 * 60000))).toBe(true);
    expect(dateiText(jetzt.toISOString(), jetzt)).toBe("zuletzt 07:31");
    expect(dateiText(null)).toBe("nie gesichert");
  });
});

describe("Bildschirm bleibt an (S5): Automat", () => {
  function attrappe(o: { fehler?: boolean } = {}) {
    const z = { requests: 0, releases: 0 };
    const nav = { wakeLock: { request: async () => { z.requests++; if (o.fehler) throw new Error("Energiesparmodus"); const s = { released: false, release: async () => { if (!s.released) { s.released = true; z.releases++; } } }; return s; } } };
    const doc = { visibilityState: "visible" };
    return { z, nav, doc };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  it("anfordern in «Lage führen», nicht doppelt, frei bei Vorbereiten und Menü aus", async () => {
    const { WachSteuerung } = await import("../src/betrieb/wakeLock");
    const a = attrappe();
    const w = new WachSteuerung(a.nav, a.doc);
    w.setze({ aktiv: true, an: true });
    w.sync(); w.sync();
    await tick();
    expect(a.z.requests).toBe(1);
    expect(w.zustand.aktivJetzt).toBe(true);
    w.setze({ aktiv: false, an: true });
    expect(a.z.releases).toBe(1);
    w.setze({ aktiv: true, an: true });
    await tick();
    expect(a.z.requests).toBe(2);
    w.setze({ aktiv: true, an: false });
    expect(a.z.releases).toBe(2);
    expect(w.zustand.aktivJetzt).toBe(false);
  });
  it("verborgen → frei, sichtbar → neu angefordert", async () => {
    const { WachSteuerung } = await import("../src/betrieb/wakeLock");
    const a = attrappe();
    const w = new WachSteuerung(a.nav, a.doc);
    w.setze({ aktiv: true, an: true });
    await tick();
    a.doc.visibilityState = "hidden"; w.sichtbarkeit();
    expect(a.z.releases).toBe(1);
    a.doc.visibilityState = "visible"; w.sichtbarkeit();
    await tick();
    expect(a.z.requests).toBe(2);
  });
  it("Antwort nach dem Abwählen wird sofort freigegeben", async () => {
    const { WachSteuerung } = await import("../src/betrieb/wakeLock");
    const a = attrappe();
    const w = new WachSteuerung(a.nav, a.doc);
    w.setze({ aktiv: true, an: true });
    w.setze({ aktiv: false, an: true });
    await tick();
    expect(a.z.requests).toBe(1);
    expect(a.z.releases).toBe(1);
    expect(w.zustand.aktivJetzt).toBe(false);
  });
  it("Fehler: kein Toast, Menü «zurzeit nicht möglich»; ohne wakeLock: «geht in diesem Browser nicht»", async () => {
    const { WachSteuerung, wachHinweis } = await import("../src/betrieb/wakeLock");
    const a = attrappe({ fehler: true });
    const w = new WachSteuerung(a.nav, a.doc);
    w.setze({ aktiv: true, an: true });
    await tick(); await tick();
    expect(w.zustand.fehler).toBeTruthy();
    expect(wachHinweis({ unterstuetzt: true, an: true, fehler: w.zustand.fehler })).toBe("zurzeit nicht möglich");
    expect(wachHinweis({ unterstuetzt: false, an: true })).toMatch(/^geht in diesem Browser nicht/);
    expect(wachHinweis({ unterstuetzt: true, an: true, fehler: null })).toBeNull();
    const ohne = new WachSteuerung({}, a.doc);
    ohne.setze({ aktiv: true, an: true });
    expect(ohne.unterstuetzt).toBe(false);
  });
});

describe("Suche: Ortssuche nur auf Klick (S3)", () => {
  it("Vorschlag nur erlaubt, mit Netz, für Ortsnamen, nicht als Listenfilter", async () => {
    const { onlineMoeglich, swisstopoVorschlag } = await import("../src/journal/useSearch");
    const q = "Gasthof Bären";
    expect(onlineMoeglich({ erlaubt: true, netz: true, q, lokal: [] })).toBe(true);
    expect(onlineMoeglich({ erlaubt: false, netz: true, q, lokal: [] })).toBe(false);
    expect(onlineMoeglich({ erlaubt: true, netz: false, q, lokal: [] })).toBe(false);
    expect(onlineMoeglich({ erlaubt: true, netz: true, q, lokal: [], filtert: true })).toBe(false);
    expect(onlineMoeglich({ erlaubt: true, netz: true, q: "AK7", lokal: [] })).toBe(false);
    expect(swisstopoVorschlag(" Gasthof Bären ")).toBe("‹Gasthof Bären› bei swisstopo suchen");
  });
  it("useSearch hat keine automatische Abfrage mehr (kein Effekt mit lookupPlaces)", () => {
    const src = readFileSync(join(__dirname, "../src/journal/useSearch.ts"), "utf8");
    const aufrufe = [...src.matchAll(/lookupPlaces\(/g)].length;
    // Definition + genau ein Aufruf in `suchen()`
    expect(aufrufe).toBe(2);
    expect(src).not.toMatch(/setTimeout\([^)]*lookupPlaces/);
  });
});

describe("Service Worker (S4): Zeitlimits aus entscheide.ts", () => {
  it("Vorlage hat Platzhalter, entscheide.ts die Zahlen (assemble-site setzt ein)", () => {
    const sw = readFileSync(join(__dirname, "../../../scripts/sw.template.js"), "utf8");
    expect(sw).toContain("__NETZ_MS__");
    expect(sw).toContain("__KACHEL_MS__");
    expect(sw).toMatch(/mitZeitlimit\(fetch\(req\), NETZ_MS\)/);
    const ent = readFileSync(join(__dirname, "../../core/src/entscheide.ts"), "utf8");
    expect(/export const SW_NETZ_TIMEOUT_MS\s*=\s*([\d_]+)\s*;/.exec(ent)?.[1]).toBe("3000");
    expect(/export const SW_KACHEL_TIMEOUT_MS\s*=\s*([\d_]+)\s*;/.exec(ent)?.[1]).toBe("8000");
  });
});

describe("Raster «Feld» ohne Zoom (A6)", () => {
  it("Felder > 1000 m → warnen, sonst automatisch", async () => {
    const { feldVorschlag, FELD_MAX_M } = await import("../src/prepare/RasterPanel");
    expect(FELD_MAX_M).toBe(1000);
    // ganze Region Bern ohne Zoom (≈ 130 × 115 km)
    const gross = feldVorschlag({ minE: 2540000, maxE: 2670000, minN: 1140000, maxN: 1255000 });
    expect(gross.zuGross).toBe(true);
    expect(gross.size).toBe(4500);
    expect([gross.cols, gross.rows]).toEqual([29, 26]);
    // Kp-Raum 6 × 5 km
    const kp = feldVorschlag({ minE: 2598000, maxE: 2604000, minN: 1196000, maxN: 1201000 });
    expect(kp.zuGross).toBe(false);
    expect(kp.size).toBe(200);
  });
});
