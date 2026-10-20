/**
 * Schweizer Landeskoordinaten LV95 (EPSG:2056) und WGS84.
 * Näherungsformeln von swisstopo (Genauigkeit ca. 1 m), ohne Abhängigkeiten – offline nutzbar.
 */

export interface LV95 {
  /** Ost-Koordinate, z. B. 2'600'465 */
  e: number;
  /** Nord-Koordinate, z. B. 1'199'000 */
  n: number;
}

export interface WGS84 {
  lat: number;
  lon: number;
}

/** WGS84 (Grad) → LV95 (Meter). */
export function wgs84ToLv95({ lat, lon }: WGS84): LV95 {
  const phi = (lat * 3600 - 169028.66) / 10000;
  const lam = (lon * 3600 - 26782.5) / 10000;
  const e =
    2600072.37 +
    211455.93 * lam -
    10938.51 * lam * phi -
    0.36 * lam * phi * phi -
    44.54 * lam * lam * lam;
  const n =
    1200147.07 +
    308807.95 * phi +
    3745.25 * lam * lam +
    76.63 * phi * phi -
    194.56 * lam * lam * phi +
    119.79 * phi * phi * phi;
  return { e, n };
}

/** LV95 (Meter) → WGS84 (Grad). */
export function lv95ToWgs84({ e, n }: LV95): WGS84 {
  const y = (e - 2600000) / 1e6;
  const x = (n - 1200000) / 1e6;
  const lam = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
  const phi =
    16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x * x * x;
  return { lat: (phi * 100) / 36, lon: (lam * 100) / 36 };
}

/** Prüft, ob eine Koordinate in der Schweiz (grob, inkl. Rand) liegt. */
export function isInSwitzerland({ e, n }: LV95): boolean {
  return e > 2480000 && e < 2840000 && n > 1070000 && n < 1300000;
}

/** Formatiert LV95 wie auf der Karte: 2'600'465 / 1'200'243 */
export function formatLv95({ e, n }: LV95): string {
  const f = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${f(e)} / ${f(n)}`;
}

export interface FoundCoordinate {
  lv95: LV95;
  /** Gefundener Text */
  raw: string;
  index: number;
  kind: "lv95" | "lv03" | "wgs84" | "link";
}

// Tausendertrenner, wie sie in Meldungen vorkommen: ' ’ ‘ ` ´ sowie (schmale) Leerzeichen
const SEP = "['’‘`´\\u2009\\u202f ]";

/** Entfernt Tausendertrenner innerhalb von Zahlen, ohne die Textlänge zu verändern (Ersatz durch \u0000). */
function stripGroupSeparators(text: string): string {
  return text.replace(new RegExp(`(\\d)${SEP}(?=\\d{3}(?!\\d))`, "g"), "$1\u0000");
}

/**
 * Findet Koordinaten in einem Freitext:
 * - LV95: «2'600'465, 1'200'243», «2600721 / 1200853», «2‘601‘708/1‘199‘709», «2600 721 / 1200 853»
 * - LV03: «600'175 / 199'101»
 * - Links: swisstopo.app (?lat=..&lon=..), map.geo.admin.ch (center=E,N oder E=..&N=..)
 * - WGS84 dezimal: «47.29674, 9.27155»
 */
export function findCoordinates(text: string): FoundCoordinate[] {
  const out: FoundCoordinate[] = [];
  const taken: Array<[number, number]> = [];
  const free = (i: number, len: number) => !taken.some(([a, b]) => i < b && i + len > a);
  const push = (c: FoundCoordinate) => {
    if (!free(c.index, c.raw.length)) return;
    taken.push([c.index, c.index + c.raw.length]);
    out.push(c);
  };

  // Links zuerst (enthalten Zahlen, die sonst falsch gelesen würden)
  const linkRe = /https?:\/\/\S+/g;
  for (const m of text.matchAll(linkRe)) {
    const url = m[0];
    const lat = /[?&](?:lat)=([0-9.]+)/.exec(url);
    const lon = /[?&](?:lon|lng)=([0-9.]+)/.exec(url);
    const center = /[?&]center=([0-9.]+)(?:,|%2C)([0-9.]+)/i.exec(url);
    const eq = /[?&]E=([0-9.]+)/.exec(url);
    const nq = /[?&]N=([0-9.]+)/.exec(url);
    let lv: LV95 | null = null;
    if (lat && lon) lv = wgs84ToLv95({ lat: +lat[1]!, lon: +lon[1]! });
    else if (center) lv = normaliseEN(+center[1]!, +center[2]!);
    else if (eq && nq) lv = normaliseEN(+eq[1]!, +nq[1]!);
    if (lv) push({ lv95: lv, raw: url, index: m.index!, kind: "link" });
  }

  const s = stripGroupSeparators(text);
  const num = (v: string) => +v.replace(/\u0000/g, "");
  const lv95Re = /(?<![\d.])(2\u0000?\d{3}\u0000?\d{3}(?:\.\d+)?)\s*[,/;]?\s*(1\u0000?\d{3}\u0000?\d{3}(?:\.\d+)?)(?![\d])/g;
  for (const m of s.matchAll(lv95Re)) {
    const e = num(m[1]!);
    const n = num(m[2]!);
    push({ lv95: { e, n }, raw: text.slice(m.index!, m.index! + m[0].length), index: m.index!, kind: "lv95" });
  }
  const lv03Re = /(?<![\d.])([4-8]\d{2}\u0000?\d{3}(?:\.\d+)?)\s*[,/;]\s*([0-3]\d{2}\u0000?\d{3}(?:\.\d+)?)(?![\d])/g;
  for (const m of s.matchAll(lv03Re)) {
    const a = num(m[1]!);
    const b = num(m[2]!);
    if (a < 480000 || a > 840000 || b < 70000 || b > 300000) continue;
    push({ lv95: { e: a + 2000000, n: b + 1000000 }, raw: text.slice(m.index!, m.index! + m[0].length), index: m.index!, kind: "lv03" });
  }
  const wgsRe = /(?<![\d.])(4[5-7]\.\d{3,})\s*[,/; ]\s*(([5-9]|10)\.\d{3,})(?![\d])/g;
  for (const m of text.matchAll(wgsRe)) {
    push({ lv95: wgs84ToLv95({ lat: +m[1]!, lon: +m[2]! }), raw: m[0], index: m.index!, kind: "wgs84" });
  }
  return out.sort((a, b) => a.index - b.index);
}

function normaliseEN(a: number, b: number): LV95 {
  // LV03-Werte (6-stellig) auf LV95 anheben
  const e = a < 1e6 ? a + 2000000 : a;
  const n = b < 1e6 ? b + 1000000 : b;
  return { e, n };
}
