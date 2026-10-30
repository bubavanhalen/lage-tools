/**
 * Uhr und Übungstage: alles in Lokalzeit des Geräts (nie `toISOString()` für Tage – das wäre UTC und um 00:30
 * noch der Vortag). Ereigniszeit `t` und Eingang `tReported` sind lokale ISO-Zeiten ohne Offset («2026-10-28T10:40»);
 * die Zeitzone der Übung (IANA + Offset beim Anlegen) steht in `Exercise.tz`, der genaue Zeitpunkt in `createdAt` (UTC).
 *
 * MVP 3.5 (Spez. MVP 3.5, Kap. 3.3 «Zeit-Kern», 3.6, 5.2): **Lagezeiten** dürfen den UTC-Offset als Endung tragen
 * («2030-10-27T02:10+01:00»), `LageEvent.t` bleibt immer 16 Zeichen (Offset in `tOffset`). Zeiten vergleichen nur über
 * `zeitCmp`/`zeitBis`/`zeitMax` (doppelte Stunde bei der Rückstellung); fehlt der Offset einer alten Meldung, leitet
 * ihn `offsetOf` ab – geschrieben wird nie etwas. `zone` fehlt → Zone des Geräts; Tests geben sie immer an.
 */
import { LIVE_TOLERANZ_MIN } from "./entscheide";

const pad = (n: number) => String(n).padStart(2, "0");

/** Kalendertag in Lokalzeit, z. B. «2026-10-29» */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lokale ISO-Zeit auf die Minute, z. B. «2026-10-29T00:15» (Format von `LageEvent.t`) */
export function localIso(d: Date): string {
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Lokale ISO-Zeit («2026-10-29T00:15») als Datum (Lokalzeit) */
export function parseLocalIso(t: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(t);
  if (!m) return new Date(NaN);
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

/** Tag ± n Kalendertage (über Monats-/Jahresgrenzen, unabhängig von Sommerzeit) */
export function addDays(day: string, n: number): string {
  const d = parseLocalIso(day);
  d.setHours(12);
  d.setDate(d.getDate() + n);
  return localDay(d);
}

/** Tage von `a` bis `b` (b − a) */
export function dayDiff(a: string, b: string): number {
  return Math.round((parseLocalIso(b + "T12:00").getTime() - parseLocalIso(a + "T12:00").getTime()) / 86400000);
}

/** Übungstage mit `day` (sortiert, ohne Doppel) */
export function withDay(days: string[], day: string): string[] {
  return days.includes(day) ? days : [...days, day].sort();
}

/**
 * Tag fürs Meldungsfeld, wenn er nicht von Hand gewählt ist («Tag folgt der Uhr»): heute, wenn die Übung heute läuft
 * (heute ist Übungstag, die Übung hat noch keinen Tag oder der letzte Übungstag war gestern – dann wird heute als
 * nächster Tag angelegt). Sonst folgt der Tag nicht der Uhr und kein heutiger Tag wird eingeschoben (Beispiel 2030,
 * Vorbereitung vor der Übung, Übung längst vorbei): der erste Übungstag, wenn alle Tage in der Zukunft liegen, sonst der
 * letzte. `follow` = Tag folgt der Uhr (nach Mitternacht automatisch der nächste).
 */
export function clockDay(days: string[], now: Date): { day: string; follow: boolean } {
  const today = localDay(now);
  if (!days.length || days.includes(today)) return { day: today, follow: true };
  const sorted = [...days].sort();
  const last = sorted[sorted.length - 1]!;
  if (addDays(last, 1) === today) return { day: today, follow: true };
  return { day: sorted[0]! > today ? sorted[0]! : last, follow: false };
}

/** Zeitzone des Geräts */
export interface ZoneInfo {
  /** IANA-Name, z. B. «Europe/Zurich» (leer, wenn der Browser ihn nicht kennt) */
  zone: string;
  /** UTC-Offset zum Zeitpunkt, z. B. «+01:00» (Winterzeit) bzw. «+02:00» (Sommerzeit) */
  offset: string;
}

/** «+01:00», «-04:30» aus Minuten östlich von UTC */
export function offsetText(minutesEast: number): string {
  const s = minutesEast < 0 ? "-" : "+";
  const m = Math.abs(minutesEast);
  return `${s}${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Zeitzone des Geräts zum Zeitpunkt `d` */
export function zoneOf(d = new Date()): ZoneInfo {
  let zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""; } catch { /* alter Browser */ }
  return { zone, offset: offsetText(-d.getTimezoneOffset()) };
}

/**
 * Gerät in einer anderen Zeitzone als die Übung? Dann wären «jetzt»-Zeiten verschoben. Gibt einen Klartext zurück
 * (für einen Hinweis) oder null. Ohne gespeicherte Zone (ältere Übung) → null.
 */
export function zoneMismatch(tz: ZoneInfo | undefined, now = new Date()): string | null {
  if (!tz?.zone) return null;
  const dev = zoneOf(now);
  if (!dev.zone || dev.zone === tz.zone) return null;
  return `Gerät in Zeitzone ${dev.zone} (${dev.offset}), Übung in ${tz.zone} – Zeiten «jetzt» prüfen`;
}

/** Höchstens so weit darf eine getippte Zeit ohne Tag in der Zukunft liegen, sonst gilt der Vortag (00:15 «2355» → gestern) */
export const FUTURE_LIMIT_MS = 12 * 3600000;

/**
 * Tag zu einer getippten Uhrzeit ohne Tagesangabe, wenn der Tag der Uhr folgt: der heutige Tag, ausser die Zeit läge
 * mehr als `FUTURE_LIMIT_MS` nach jetzt – dann der Vortag (Nachtrag kurz nach Mitternacht).
 */
export function nearestDay(today: string, minutes: number, now: Date): string {
  const t = parseLocalIso(today);
  t.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return t.getTime() - now.getTime() > FUTURE_LIMIT_MS ? addDays(today, -1) : today;
}

// ---------------------------------------------------------------------------------------------------------------
// Reihenfolge der Meldungen (Sommerzeit)

/**
 * UTC-Offset, der zur lokalen Ereigniszeit `t` gehört («+02:00» Sommerzeit, «+01:00» Winterzeit). In der doppelten
 * Stunde bei der Rückstellung (02:00–02:59 gibt es zweimal) gilt der Offset von `now`, wenn er zur Zeit passt –
 * «0210» um 02:20 Winterzeit ist 02:10 Winterzeit, nicht 70 Minuten früher.
 */
export function offsetFor(t: string, now = new Date()): string {
  const own = offsetText(-now.getTimezoneOffset());
  const asNow = new Date(Date.parse(`${t.slice(0, 16)}:00${own}`));
  if (!Number.isNaN(asNow.getTime()) && localIso(asNow) === t.slice(0, 16)) return own;
  const d = parseLocalIso(t);
  return Number.isNaN(d.getTime()) ? own : offsetText(-d.getTimezoneOffset());
}

/** Felder für die Reihenfolge (Teil von `LageEvent`) */
export interface EventOrderKey {
  id: string;
  t: string;
  tOffset?: string;
  createdAt?: string;
}

/**
 * Zentrale Reihenfolge der Meldungen (älteste zuerst): Ereigniszeit; haben beide den Offset (`tOffset`), zählt der
 * genaue Zeitpunkt – so bleibt die Reihenfolge bei der Sommerzeit-Rückstellung richtig (02:50 Sommerzeit vor 02:10
 * Winterzeit). Bei gleicher Zeit entscheidet der Eingang (`createdAt`), dann die ID (deterministisch).
 */
export function compareEvents(a: EventOrderKey, b: EventOrderKey): number {
  // MVP 3.5: Zeit über `zeitCmp` (Schnellweg Zeichenvergleich; doppelte Stunde über den Zeitpunkt, fehlender Offset
  // abgeleitet) – bei gleicher Zeit wie bisher Eingang, dann ID
  return zeitCmp(a, b) || cmpStr(a.createdAt ?? "", b.createdAt ?? "") || a.id.localeCompare(b.id);
}

const cmpStr = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/** genauer Zeitpunkt (ms) zu lokaler Zeit + Offset – zwischengespeichert (Sortieren vieler Meldungen) */
const INSTANT = new Map<string, number>();
function instantOf(t: string, off: string): number {
  const k = t.slice(0, 16) + off;
  let v = INSTANT.get(k);
  if (v === undefined) {
    if (INSTANT.size > 20000) INSTANT.clear();
    v = Date.parse(`${t.slice(0, 16)}:00${off}`);
    INSTANT.set(k, v);
  }
  return v;
}

// ---------------------------------------------------------------------------------------------------------------
// MVP 3.5: Zeit mit UTC-Offset (Spez. MVP 3.5, Kap. 3.3, 3.6, 5.2) – Phase 0 fertig, Test `test/zeit35.test.ts`

/** Lagezeit «YYYY-MM-DDTHH:MM» oder mit Offset «YYYY-MM-DDTHH:MM+01:00»; `LageEvent.t` bleibt immer 16 Zeichen */
export type Lagezeit = string;
export interface ZeitTeile { t: string /* 16 Zeichen */; off?: string /* «+01:00» */ }
/** Meldung (oder Teil davon) für Zeitvergleiche – entspricht `Pick<LageEvent, "t" | "tOffset" | "createdAt">` */
export interface ZeitEreignis { t: string; tOffset?: string; createdAt?: string }
export type ZeitArg = Lagezeit | ZeitEreignis;

const OFF_RE = /^([+-])(\d{2}):?(\d{2})$/;
const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const MIN = 60000;
const normOff = (o: string | undefined): string | undefined => {
  if (!o) return undefined;
  if (o === "Z") return "+00:00";
  const m = OFF_RE.exec(o);
  return m ? `${m[1]}${m[2]}:${m[3]}` : undefined;
};

/** Lagezeit in Zeit (16 Zeichen) und Offset zerlegen; Sekunden und «Z» werden toleriert */
export function zeitTeile(z: Lagezeit): ZeitTeile {
  const t = z.slice(0, 16);
  const off = normOff(z.slice(16).replace(/^:\d{2}(?:\.\d+)?/, ""));
  return off ? { t, off } : { t };
}

/** Lagezeit mit Offset («2030-10-27T02:10» + «+01:00»); ungültiger Offset → ohne Endung */
export function mitOffset(t: string, off: string): Lagezeit {
  const o = normOff(off);
  return o ? t.slice(0, 16) + o : t.slice(0, 16);
}

// ---------- Zonen (Intl), alles gemerkt ----------

let geraet: { zone: string | null; bis: number } | null = null;
/** IANA-Zone des Geräts (eine Minute gemerkt), null ohne Intl */
function geraeteZone(): string | null {
  const now = Date.now();
  if (geraet && now < geraet.bis) return geraet.zone;
  let z: string | null = null;
  try { z = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { /* alter Browser */ }
  geraet = { zone: z, bis: now + MIN };
  return z;
}
const zoneOder = (zone?: string): string | null => zone || geraeteZone();

const FMT = new Map<string, Intl.DateTimeFormat | null>();
function fmtOf(zone: string): Intl.DateTimeFormat | null {
  let f = FMT.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { f = null; }
    FMT.set(zone, f);
  }
  return f;
}

/** Wanduhr in der Zone zum Zeitpunkt `ms`, als «UTC-ms» (Minute); ohne Zone: Lokalzeit des Geräts */
function wandMs(ms: number, zone: string | null): number {
  const f = zone ? fmtOf(zone) : null;
  if (!f) { const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()); }
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(ms)) if (x.type !== "literal") p[x.type] = +x.value;
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!);
}
/** Offset (Minuten östlich von UTC) zum Zeitpunkt `ms` in der Zone */
function offMin(ms: number, zone: string | null): number {
  return Math.round((wandMs(ms, zone) - Math.floor(ms / MIN) * MIN) / MIN);
}
/** «2030-10-27T02:10» als «UTC-ms» der Wanduhr; NaN wenn kein Lagezeit-Format */
function wand(t: string): number {
  const m = WALL_RE.exec(t);
  return m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) : NaN;
}
const isoAus = (w: number): string => new Date(w).toISOString().slice(0, 16);

const OFFS = new Map<string, string[]>();
/**
 * mögliche UTC-Offsets einer lokalen Zeit in der Zone, frühester Zeitpunkt zuerst: [] = gibt es nicht (Vorstellen),
 * 2 Werte = doppelte Stunde («2030-10-27T02:30» in Europe/Zurich → ["+02:00", "+01:00"]). Gemerkt je Zone und Minute.
 */
export function offsetsAt(t: string, zone?: string): string[] {
  const z = zoneOder(zone);
  const key = `${z ?? ""}|${t.slice(0, 16)}`;
  const hit = OFFS.get(key);
  if (hit) return hit;
  const w = wand(t);
  let out: string[] = [];
  if (Number.isFinite(w)) {
    const kand = [...new Set([offMin(w - 26 * 3600000, z), offMin(w, z), offMin(w + 26 * 3600000, z)])];
    out = kand.filter((o) => wandMs(w - o * MIN, z) === w).sort((a, b) => b - a).map(offsetText);
  }
  if (OFFS.size > 50000) OFFS.clear();
  OFFS.set(key, out);
  return out;
}

const TAGE = new Map<string, Set<string>>();
/** zuletzt gefragt (Schnellweg für `zeitCmp` über viele Meldungen desselben Jahres, ohne Schlüssel-Zeichenkette) */
let tageZuletzt: { z: string | null; jahr: number; s: Set<string> } | null = null;
function umstellSet(z: string | null, jahr: number): Set<string> {
  if (tageZuletzt && tageZuletzt.z === z && tageZuletzt.jahr === jahr) return tageZuletzt.s;
  const key = `${z ?? ""}|${jahr}`;
  let s = TAGE.get(key);
  if (s) { tageZuletzt = { z, jahr, s }; return s; }
  s = new Set<string>();
  const t0 = Date.UTC(jahr, 0, 1) - 2 * 86400000;
  let prev = offMin(t0, z);
  for (let i = 1; i <= 370; i++) {
    const ms = t0 + i * 86400000;
    const o = offMin(ms, z);
    if (o === prev) continue;
    // Umstellung zwischen ms − 1 Tag und ms: auf die Minute genau suchen
    let lo = ms - 86400000, hi = ms;
    while (hi - lo > MIN) { const mid = Math.floor((lo + hi) / 2 / MIN) * MIN; if (offMin(mid, z) === prev) lo = mid; else hi = mid; }
    for (const x of [hi - MIN, hi]) { const d = isoAus(wandMs(x, z)).slice(0, 10); if (+d.slice(0, 4) === jahr) s.add(d); }
    prev = o;
  }
  if (TAGE.size > 200) TAGE.clear();
  TAGE.set(key, s);
  tageZuletzt = { z, jahr, s };
  return s;
}
/** Kalendertage der Umstellungen eines Jahres in der Zone (gemerkt), z. B. Europe/Zurich 2030 → ["2030-03-31", "2030-10-27"] */
export function umstellTage(zone: string, jahr: number): string[] {
  return [...umstellSet(zone || geraeteZone(), jahr)].sort();
}
const istUmstellTag = (t: string, z: string | null): boolean => umstellSet(z, +t.slice(0, 4)).has(t.slice(0, 10));

/**
 * Offset einer Meldung: `tOffset`, sonst abgeleitet – eindeutig → dieser; doppelte Stunde → der Offset, dessen Zeitpunkt
 * höchstens `LIVE_TOLERANZ_MIN` nach `createdAt` liegt und ihm am nächsten ist (ohne `createdAt`: der erste =
 * Sommerzeit); Zeit gibt es nicht (Vorstellen) → Offset vor der Umstellung. **Nie geschrieben.**
 */
export function offsetOf(e: ZeitEreignis, zone?: string): string {
  const own = normOff(e.tOffset);
  if (own) return own;
  const offs = offsetsAt(e.t, zone);
  if (offs.length === 1) return offs[0]!;
  if (offs.length > 1) {
    const c = e.createdAt ? Date.parse(e.createdAt) : NaN;
    if (!Number.isFinite(c)) return offs[0]!;
    const lim = c + LIVE_TOLERANZ_MIN * MIN;
    let best: string | null = null, bestMs = -Infinity;
    for (const o of offs) { const ms = instantOf(e.t, o); if (ms <= lim && ms > bestMs) { best = o; bestMs = ms; } }
    return best ?? offs[0]!;
  }
  const w = wand(e.t);
  return offsetText(Number.isFinite(w) ? offMin(w - 12 * 3600000, zoneOder(zone)) : -new Date().getTimezoneOffset());
}

/** Zeitpunkt in ms (UTC) einer Lagezeit (mit oder ohne Offset) oder Meldung; NaN bei ungültiger Zeit */
export function zeitMs(x: ZeitArg, zone?: string): number {
  if (typeof x === "string") {
    const p = zeitTeile(x);
    return instantOf(p.t, p.off ?? offsetOf({ t: p.t }, zone));
  }
  return instantOf(x.t, offsetOf(x, zone));
}

/**
 * Reihenfolge zweier Lagezeiten/Meldungen (< 0: a früher). Schnellweg Zeichenvergleich, wenn beide denselben Offset
 * tragen oder keiner der beiden Tage ein Umstellungstag der Zone ist; sonst über den Zeitpunkt (fehlender Offset
 * abgeleitet, `offsetOf`). Tragen beide verschiedene Offsets, zählt immer der Zeitpunkt.
 */
export function zeitCmp(a: ZeitArg, b: ZeitArg, zone?: string): number {
  const sa = typeof a === "string", sb = typeof b === "string";
  const ta = (sa ? a : a.t).slice(0, 16), tb = (sb ? b : b.t).slice(0, 16);
  const oa = sa ? zeitTeile(a).off : normOff(a.tOffset);
  const ob = sb ? zeitTeile(b).off : normOff(b.tOffset);
  if (oa && ob) {
    if (oa === ob) return cmpStr(ta, tb);
    const d = instantOf(ta, oa) - instantOf(tb, ob);
    return d < 0 ? -1 : d > 0 ? 1 : 0;
  }
  const z = zoneOder(zone);
  if (!istUmstellTag(ta, z) && !istUmstellTag(tb, z)) return cmpStr(ta, tb);
  const d = zeitMs(a, zone) - zeitMs(b, zone);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}
/** a ≤ b (über `zeitCmp`) */
export const zeitBis = (a: ZeitArg, b: ZeitArg, zone?: string): boolean => zeitCmp(a, b, zone) <= 0;
/** spätere der beiden Lagezeiten (bei gleicher: a) */
export function zeitMax(a: Lagezeit, b: Lagezeit, zone?: string): Lagezeit {
  return zeitCmp(b, a, zone) > 0 ? b : a;
}

/** Lagezeit ± Minuten über den Zeitpunkt (Umstellung richtig); mit Offset bleibt mit Offset, sonst ohne */
export function addMinuten(z: Lagezeit, min: number, zone?: string): Lagezeit {
  const p = zeitTeile(z);
  const ms = zeitMs(z, zone) + min * MIN;
  if (!Number.isFinite(ms)) return z;
  const zz = zoneOder(zone);
  const t = isoAus(wandMs(ms, zz));
  return p.off ? mitOffset(t, offsetText(offMin(ms, zz))) : t;
}

/** Lagezeit des Geräts jetzt, mit Offset («2030-05-15T07:31+02:00») */
export function jetztLagezeit(now = new Date()): Lagezeit {
  return localIso(now) + offsetText(-now.getTimezoneOffset());
}

export interface Lesart {
  /** Lagezeit ohne Offset (16 Zeichen) */
  t: string;
  /** gewählter Offset; null, wenn es die Zeit nicht gibt */
  off: string | null;
  /** doppelte Stunde (zwei Lesarten möglich) */
  mehrdeutig: boolean;
  /** Zeit gibt es an diesem Tag nicht (Uhr vorgestellt) → rot `zeit-fehlt` */
  fehlt: boolean;
  /** nur bei `fehlt`: Vorschlag «03:30» (nach der Umstellung) */
  vorschlag?: string;
}

/**
 * Lesart einer getippten Uhrzeit (`minuten` seit Mitternacht) am Tag `tag` für die Erkennung: doppelte Stunde → die
 * Lesart, die höchstens `toleranzMin` nach `now` liegt (sind beide möglich: die spätere; keine: die frühere);
 * fehlende Stunde → `fehlt` mit Vorschlag um die Umstellung später.
 */
export function lesart(tag: string, minuten: number, now: Date, zone?: string, toleranzMin = LIVE_TOLERANZ_MIN): Lesart {
  const t = `${tag}T${pad(Math.floor(minuten / 60))}:${pad(minuten % 60)}`;
  const offs = offsetsAt(t, zone);
  if (!offs.length) {
    const w = wand(t), z = zoneOder(zone);
    const sprung = Number.isFinite(w) ? offMin(w + 12 * 3600000, z) - offMin(w - 12 * 3600000, z) : 60;
    const v = (minuten + (sprung > 0 ? sprung : 60)) % 1440;
    return { t, off: null, mehrdeutig: false, fehlt: true, vorschlag: `${pad(Math.floor(v / 60))}:${pad(v % 60)}` };
  }
  if (offs.length === 1) return { t, off: offs[0]!, mehrdeutig: false, fehlt: false };
  const lim = now.getTime() + toleranzMin * MIN;
  let off = offs[0]!, best = -Infinity;
  for (const o of offs) { const ms = instantOf(t, o); if (ms <= lim && ms > best) { best = ms; off = o; } }
  return { t, off, mehrdeutig: true, fehlt: false };
}

/**
 * Anzeige «02:50»; am Umstellungstag in der doppelten Stunde mit Zone «02:50 MESZ»/«02:10 MEZ» (Mitteleuropa, sonst der
 * Offset «02:50 +02:00»). `o.tage` = Umstellungstage, wenn schon bekannt (sonst `umstellTage`).
 */
export function zeitText(x: ZeitArg, o: { zone?: string; tage?: string[] } = {}): string {
  const t = (typeof x === "string" ? x : x.t).slice(0, 16);
  const hm = t.slice(11, 16);
  const tage = o.tage ?? umstellTage(o.zone ?? "", +t.slice(0, 4));
  if (!tage.includes(t.slice(0, 10))) return hm;
  const offs = offsetsAt(t, o.zone);
  if (offs.length < 2) return hm;
  const off = typeof x === "string" ? zeitTeile(x).off ?? offsetOf({ t }, o.zone) : offsetOf(x, o.zone);
  const mez = offs[0] === "+02:00" && offs[1] === "+01:00";
  return `${hm} ${mez ? (off === "+02:00" ? "MESZ" : "MEZ") : off}`;
}
