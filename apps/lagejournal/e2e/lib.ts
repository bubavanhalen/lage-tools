/**
 * Gemeinsames für die Abnahmetests (Spez. MVP 1, Kap. 7). Läuft unter Node (Typen werden beim Laden entfernt,
 * Node ≥ 22.18) – nur «löschbares» TypeScript verwenden (keine enum, keine namespace, keine Parameter-Properties).
 * Playwright kommt vom Runner (run.mjs), nicht aus dem Projekt; Typen deshalb bewusst locker (`any`).
 *
 * Grundsatz Kap. 7.1: Aktionen nur über sichtbaren Klartext (getByRole/getByText/getByPlaceholder). Prüfen darf
 * zusätzlich die stabilen Testhaken `data-zaehl`, `data-zustand`, `data-lagezeit` und Strukturklassen lesen.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Page = any;

export type Geraet = "laptop" | "tablet";

export interface OpenOptions {
  /** Adresse relativ zur App, z. B. «?beispiel» oder «?beispiel=leer» */
  query?: string;
  geraet?: Geraet;
  dunkel?: boolean;
  /** Uhr der Seite (Playwright clock.install), z. B. «2030-05-15T07:30:00+02:00» (T2 im Beispiel Bern) */
  uhr?: string;
  /** vor dem Laden in localStorage["lage-tools.arbeitsweise"] */
  arbeitsweise?: { modus: "lage" | "vorbereiten"; experte: boolean };
  /** zusätzliches CSS vor dem ersten Zeichnen, z. B. «:root{--hit:48px}» */
  css?: string;
  /** Offline-Status: Standard «bereit» über den Testhaken `window.__ltOfflineBereit`; «echt» = wirklich prüfen */
  offline?: "bereit" | "echt";
}

export interface Session {
  page: Page;
  geraet: Geraet;
  /** Seitenfehler und console.error */
  fehler: string[];
  /** Datei-Downloads (dürfen bei Korrektur nie vorkommen) */
  downloads: string[];
  close(): Promise<void>;
}

export interface Harness {
  /** Basisadresse der App, z. B. http://localhost:9050/lagejournal/ */
  base: string;
  /** Ausgabeordner e2e/out/ */
  out: string;
  open(o?: OpenOptions): Promise<Session>;
  /** Screenshot nach e2e/out/<name>.png */
  shot(page: Page, name: string): Promise<void>;
  log(...a: unknown[]): void;
}

export interface TestResult {
  name: string;
  geraet?: Geraet;
  ok: boolean;
  fehler?: string;
  /** frei: Aktionen, KLM, Antwortzeiten, Zählungen … */
  werte?: Record<string, unknown>;
}

export interface Spec {
  name: string;
  run(h: Harness): Promise<TestResult[]>;
}

/** Uhr für das Beispiel Bern: T2 07:30 (Tage 2030-05-14/15, Sommerzeit) */
export const UHR_T2_0730 = "2030-05-15T07:30:00+02:00";

export const VIEWPORT: Record<Geraet, { width: number; height: number }> = {
  laptop: { width: 1440, height: 900 },
  tablet: { width: 1024, height: 768 },
};

// ---------- KLM (Keystroke-Level Model): Zeigen 1.1 s, Tippen 0.4 s/Zeichen, Entscheid 1.35 s ----------
export class Klm {
  aktionen = 0;
  sekunden = 0;
  zeigen(n = 1): void { this.aktionen += n; this.sekunden += 1.1 * n; }
  tippen(text: string): void { this.aktionen += 1; this.sekunden += 0.4 * text.length; }
  taste(): void { this.aktionen += 1; this.sekunden += 0.4; }
  entscheid(n = 1): void { this.sekunden += 1.35 * n; }
  werte(): { aktionen: number; klm_s: number } { return { aktionen: this.aktionen, klm_s: Math.round(this.sekunden * 10) / 10 }; }
}

/** Fehler mit Klartext, wenn Bedingung nicht erfüllt */
export function soll(cond: unknown, text: string): void {
  if (!cond) throw new Error(text);
}

/** Tippen bzw. Klicken je nach Gerät */
export async function antippen(s: Session, loc: any): Promise<void> {
  if (s.geraet === "tablet") await loc.tap();
  else await loc.click();
}

/** Zeit in ms bis `pruef()` wahr ist (Abfrage alle 10 ms, höchstens `max` ms) – sonst Infinity */
export async function antwortzeit(pruef: () => Promise<boolean>, max = 3000): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    if (await pruef().catch(() => false)) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 10));
  }
  return Infinity;
}

/** Eine Teilaufgabe ausführen und als Ergebnis festhalten (Fehler werden Text, nie Abbruch des Laufs) */
export async function aufgabe(name: string, geraet: Geraet | undefined, fn: (werte: Record<string, unknown>) => Promise<void>): Promise<TestResult> {
  const werte: Record<string, unknown> = {};
  try {
    await fn(werte);
    return { name, geraet, ok: true, werte };
  } catch (e) {
    return { name, geraet, ok: false, fehler: String((e as Error)?.message ?? e).split("\n")[0]!.slice(0, 400), werte };
  }
}

// ---------- Funktionen für page.evaluate (müssen für sich allein lauffähig sein) ----------

/**
 * Inventar Kap. 7.2: sichtbare Bedienelemente ohne Listenzeilen und Karten-Panes; gleiche nächste `data-zaehl`-Gruppe
 * zählt 1. Gibt Liste mit Name, Grösse und Gruppe zurück.
 */
export function inventarImBrowser(): Array<{ name: string; tag: string; w: number; h: number; gruppe: string | null }> {
  const SEL = "button, a[href], input, textarea, select, [role=button], [role=tab], [role=switch], [role=slider], [role=combobox], [role=menuitem], [role=checkbox], [role=radio]";
  const AUS = ".jlist li, .leaflet-marker-pane, .leaflet-overlay-pane, .leaflet-shadow-pane, .leaflet-tooltip-pane, .leaflet-popup-pane, .leaflet-control-attribution";
  const sichtbar = (e: Element) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    if (e.closest("[aria-hidden=true], [hidden], [inert]")) return false;
    const s = getComputedStyle(e);
    if (s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) return false;
    if ((e as HTMLInputElement).type === "hidden") return false;
    return true;
  };
  const seen = new Set<string>();
  const out: Array<{ name: string; tag: string; w: number; h: number; gruppe: string | null }> = [];
  const all = [...document.querySelectorAll(SEL)].filter((e) => !e.closest(AUS) && sichtbar(e));
  // verschachtelte Bedienelemente (Knopf in role=button) nur einmal
  const top = all.filter((e) => !all.some((o) => o !== e && o.contains(e)));
  for (const e of top) {
    const g = e.closest("[data-zaehl]");
    const gruppe = g ? g.getAttribute("data-zaehl") : null;
    if (g) { const key = "g:" + gruppe + ":" + [...document.querySelectorAll("[data-zaehl]")].indexOf(g); if (seen.has(key)) continue; seen.add(key); }
    const r = (g ?? e).getBoundingClientRect();
    const name = (e.getAttribute("aria-label") || (e as HTMLElement).innerText || (e as HTMLInputElement).placeholder || e.getAttribute("title") || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
    out.push({ name: gruppe ? `[${gruppe}] ${name}` : name, tag: e.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), gruppe });
  }
  return out;
}

/** Horizontaler Überlauf (Seite, Kinder von .app und deren Kinder) */
export function ueberlaufImBrowser(): string[] {
  const out: string[] = [];
  const chk = (e: Element, n: string) => { if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== "visible" || (e === document.documentElement && e.scrollWidth > e.clientWidth + 1)) out.push(`${n}: ${e.scrollWidth} > ${e.clientWidth}`); };
  chk(document.documentElement, "Seite");
  const app = document.querySelector(".app");
  if (app) for (const c of app.children) { chk(c, "." + ((c as HTMLElement).className || c.tagName).toString().split(" ")[0]); for (const d of c.children) chk(d, "." + ((d as HTMLElement).className || d.tagName).toString().split(" ")[0]); }
  return out;
}

/**
 * DOM-Audit Kap. 7.3.2: Textkontrast gegen wirksamen Hintergrund (≥ 4.5, gross ≥ 3), Rahmen von Bedienelementen ≥ 3,
 * Schrift ≥ 12 px und aus {12, 14, 16, 20, 28}. Karten-Panes ausgenommen (Halo statt Hintergrund).
 */
export function kontrastImBrowser(): { text: string[]; rahmen: string[]; klein: string[]; skala: string[]; geprueft: number; unbestimmt: number } {
  type RGBA = [number, number, number, number];
  const parse = (c: string): RGBA => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return [0, 0, 0, 0];
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1];
  };
  const over = (top: RGBA, bot: RGBA): RGBA => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const lum = (c: RGBA) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a: RGBA, b: RGBA) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  let unbestimmt = 0;
  /** wirksamer Hintergrund: Ebenen von innen nach aussen zusammensetzen; null bei Bild/Verlauf */
  const bgOf = (e: Element | null): RGBA | null => {
    const layers: RGBA[] = [];
    for (let x = e; x; x = x.parentElement) {
      const s = getComputedStyle(x);
      if (s.backgroundImage !== "none" && !x.classList.contains("leaflet-container")) return null;
      const c = parse(s.backgroundColor);
      if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let acc: RGBA = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i]!, acc);
    return acc;
  };
  const AUS = ".leaflet-pane, .leaflet-control-attribution, [aria-hidden=true]";
  const sichtbar = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.visibility !== "hidden" && +s.opacity > 0; };
  const name = (e: Element) => `${e.tagName.toLowerCase()}${(e as HTMLElement).className && typeof (e as HTMLElement).className === "string" ? "." + (e as HTMLElement).className.split(" ")[0] : ""} «${((e as HTMLElement).innerText || "").trim().slice(0, 24)}»`;
  const text: string[] = [], rahmen: string[] = [], klein: string[] = [], skala: string[] = [];
  let geprueft = 0;
  const SKALA = new Set([12, 14, 16, 20, 28]);
  for (const e of document.querySelectorAll("body *")) {
    if (e.closest(AUS) || !sichtbar(e)) continue;
    const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    const s = getComputedStyle(e);
    if (hasText) {
      geprueft++;
      const fs = parseFloat(s.fontSize);
      if (fs < 12) klein.push(`${fs}px ${name(e)}`);
      if (!SKALA.has(Math.round(fs * 10) / 10)) skala.push(`${fs}px ${name(e)}`);
      const bg = bgOf(e);
      if (!bg) { unbestimmt++; continue; }
      const fg = over(parse(s.color), bg);
      const gross = fs >= 24 || (fs >= 18.66 && +s.fontWeight >= 700);
      const r = ratio(fg, bg);
      if (r < (gross ? 3 : 4.5)) text.push(`${r.toFixed(2)} ${name(e)}`);
    }
    if (e.matches("button, input, select, textarea, [role=button], [role=tab], [role=switch], [role=combobox]")) {
      const bw = parseFloat(s.borderTopWidth);
      if (bw > 0 && s.borderTopStyle !== "none") {
        const outer = bgOf(e.parentElement);
        if (!outer) { unbestimmt++; continue; }
        const r = ratio(over(parse(s.borderTopColor), outer), outer);
        if (r < 3) rahmen.push(`${r.toFixed(2)} ${name(e)}`);
      }
    }
  }
  const uniq = (a: string[]) => [...new Set(a)];
  return { text: uniq(text), rahmen: uniq(rahmen), klein: uniq(klein), skala: uniq(skala), geprueft, unbestimmt };
}

/** Fokus sichtbar? (Outline ≥ 2 px oder Box-Shadow am fokussierten Element) */
export function fokusImBrowser(): { name: string; sichtbar: boolean } | null {
  const e = document.activeElement as HTMLElement | null;
  if (!e || e === document.body) return null;
  const s = getComputedStyle(e);
  const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
  const shadow = s.boxShadow && s.boxShadow !== "none";
  return { name: (e.getAttribute("aria-label") || e.innerText || (e as HTMLInputElement).placeholder || e.tagName).trim().slice(0, 30), sichtbar: !!(outline || shadow) };
}

// =====================================================================================================================
// MVP 3 «LVZ-Betrieb» (Spez. MVP 3, Kap. 8) – gemeinsame Hilfen der neuen Specs
// =====================================================================================================================

/** Uhr für `?beispiel=lang`: T4 07:30 (Tage 2030-05-15 bis 2030-05-18, Sommerzeit) */
export const UHR_T4_0730 = "2030-05-18T07:30:00+02:00";

/** Standorte der Trupps im Beispiel Bern um T2 07:30 (Kap. 8.1) */
export const STANDORTE_T2_0730: Record<string, string> = { H01: "AC6 B", H02: "AL9 A", H03: "AP4 D", H04: "AF12 A", H05: "AQ11 C" };

/** Wochentag deutsch zum ISO-Datum («2030-05-18» → «Samstag») – nicht von Hand in die Specs schreiben */
export function wochentag(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("de-CH", { weekday: "long", timeZone: "UTC" });
}

export const feldVon = (s: Session) => s.page.getByPlaceholder("Was wurde gemeldet?");
export const zeilenVon = (s: Session) => s.page.locator(".jlist li");
export const markerVon = (s: Session) => s.page.locator(".leaflet-marker-pane > *").count();
export const zustandVon = async (s: Session): Promise<string | null> => s.page.locator("[data-zustand]").first().getAttribute("data-zustand").catch(() => null);
export const knopfVon = (s: Session, name: string | RegExp) => s.page.getByRole("button", { name, exact: typeof name === "string" });

/**
 * Text ins Meldungsfeld und eintragen (Laptop: Enter, gelb: zweites Enter; Tablet: «Eintragen» bzw. «Trotzdem
 * eintragen»). Gibt den Zustand vor dem ersten Enter zurück und wartet, bis die Liste eine Zeile mehr hat.
 */
export async function eintragenText(s: Session, text: string, o: { zweimal?: boolean } = {}): Promise<{ zustand: string | null; zeilen: number }> {
  const n0 = await zeilenVon(s).count();
  if (s.geraet === "tablet") await feldVon(s).tap();
  await feldVon(s).fill(text);
  await s.page.waitForTimeout(150);
  const zustand = await zustandVon(s);
  const enter = async () => {
    if (s.geraet === "tablet") await antippen(s, knopfVon(s, /^(Eintragen|Trotzdem eintragen)/).first());
    else await feldVon(s).press("Enter");
  };
  await enter();
  if (zustand === "pruefen" || o.zweimal) { await s.page.waitForTimeout(120); if ((await zeilenVon(s).count()) === n0) await enter(); }
  await antwortzeit(async () => (await zeilenVon(s).count()) > n0, 2000);
  return { zustand, zeilen: await zeilenVon(s).count() };
}

/** Standort eines Trupps über die Suche (Vorschlag «H01 – zuletzt … · AC6 B»); Suche danach leeren */
export async function standortVon(s: Session, trupp: string): Promise<string> {
  const q = s.page.getByPlaceholder(/^Suchen: Trupp/);
  await q.fill(trupp);
  const opt = s.page.getByRole("option", { name: new RegExp(`^${trupp}\\b`) }).first();
  const text = (await opt.innerText({ timeout: 1500 }).catch(() => "")).replace(/\s+/g, " ");
  await q.fill("");
  return text;
}

/** Spaltenansicht wählen («Journal», «Offen», «Was Rot») */
export async function ansicht(s: Session, name: "Journal" | "Offen" | "Was Rot"): Promise<void> {
  const re = name === "Was Rot" ? /Was Rot/ : new RegExp(`^${name}`);
  await antippen(s, s.page.getByRole("tab", { name: re }).first());
}

/** Menü ☰ öffnen und Eintrag wählen */
export async function menue(s: Session, eintrag: string | RegExp): Promise<void> {
  await antippen(s, s.page.getByRole("button", { name: "Menü" }).first());
  await antippen(s, s.page.getByRole("menuitem", { name: eintrag }).or(s.page.getByRole("button", { name: eintrag })).first());
}

/** `window.__ltPerf()` (P1) – im Browser */
export function perfImBrowser(): Record<string, unknown> | null {
  const f = (window as unknown as { __ltPerf?: () => Record<string, unknown> }).__ltPerf;
  return f ? f() : null;
}

/** `window.__ltPdfInfo` (letztes PDF) – im Browser */
export function pdfInfoImBrowser(): { seiten: number; format: string; quer?: boolean; zeilen: string[] } | null {
  return (window as unknown as { __ltPdfInfo?: { seiten: number; format: string; quer?: boolean; zeilen: string[] } }).__ltPdfInfo ?? null;
}

/** Wörter im sichtbaren Text eines Bereichs (Lesezeit Übergabe ≤ 900 Wörter) – im Browser, `sel` als Argument */
export function woerterImBrowser(sel: string): number {
  const e = document.querySelector(sel) as HTMLElement | null;
  return e ? (e.innerText.match(/[\p{L}\p{N}][\p{L}\p{N}'’.:-]*/gu) ?? []).length : -1;
}
