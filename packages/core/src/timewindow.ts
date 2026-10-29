/**
 * Zeitfenster der Lagedarstellung: «alles» (nichts fällt weg), eine feste Dauer bis zur Lagezeit
 * (läuft mit Lagezeit, Live und Abspielen mit) oder ab einem festen Zeitpunkt.
 * Zeiten als ISO lokal «YYYY-MM-DDTHH:MM» (wie `LageEvent.t`).
 *
 * MVP 1 (Spez. Kap. 3.5): «Zeige letzte 30 min · 1 h · 2 h · alles» (nie gespeichert) und Texte für Live-Band und
 * Rückblick («RÜCKBLICK · Lage um T2 05:30 (vor 1 h 55 min)»), Eingabe «Lage um» («05:30», «T1 2300»).
 */
import { addDays, parseLocalIso } from "./clock";

export type TimeWindow = { mode: "alles" } | { mode: "dauer"; min: number } | { mode: "ab"; t: string };

export const WINDOW_ALL: TimeWindow = { mode: "alles" };
/** Schnellwahl in Minuten (0 = alles) */
export const WINDOW_PRESETS = [0, 30, 60, 120, 360] as const;

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO lokal ohne Sekunden */
function isoMinutes(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Anfang des Fensters zur Lagezeit `t` (ISO lokal), null = kein Anfang (alles) */
export function windowStart(w: TimeWindow | null | undefined, t: string): string | null {
  if (!w || w.mode === "alles") return null;
  if (w.mode === "dauer") {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? isoMinutes(ms - Math.max(1, w.min) * 60000) : null;
  }
  // fester Anfang nach der Lagezeit (z. B. Zeitstrahl zurückgestellt): ein leeres Fenster wäre verwirrend → alles zeigen
  return w.t > t.slice(0, 16) ? null : w.t;
}

/** Liegt die Zeit `t` im Fenster [from, to]? (from null = offen) */
export function inWindow(t: string, from: string | null, to: string): boolean {
  return (!from || t >= from) && t.slice(0, 16) <= to.slice(0, 16);
}

/** Text für die Schnellwahl bzw. Anzeige: «Alles», «30′», «1 h», «ab 07:10» */
export function windowLabel(w: TimeWindow): string {
  if (w.mode === "alles") return "Alles";
  if (w.mode === "dauer") return w.min < 60 ? `${w.min}′` : w.min % 60 ? `${Math.floor(w.min / 60)} h ${w.min % 60}′` : `${w.min / 60} h`;
  return `ab ${w.t.slice(11, 16)}`;
}

/** gespeicherten Wert prüfen (localStorage, Datei) */
export function parseWindow(v: unknown): TimeWindow {
  const o = v as Partial<{ mode: string; min: number; t: string }> | null;
  if (o && o.mode === "dauer" && typeof o.min === "number" && o.min > 0 && o.min <= 7 * 24 * 60) return { mode: "dauer", min: Math.round(o.min) };
  if (o && o.mode === "ab" && typeof o.t === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(o.t)) return { mode: "ab", t: o.t.slice(0, 16) };
  return WINDOW_ALL;
}

// ---------------------------------------------------------------------------------------------------------------
// «Zeige letzte» (MVP 1): nur Dauer bis zur Lagezeit, nie gespeichert

/** Wahl «Zeige letzte» in Minuten (ohne «alles» = null) */
export const SHOW_LAST_MIN = [30, 60, 120] as const;

/** «30 min», «1 h», «2 h»; null = «alles» */
export function showLastLabel(min: number | null): string {
  if (!min) return "alles";
  return min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`;
}

/** Anfang von «Zeige letzte» zur Lagezeit `t` (rechnet ab Lagezeit, R8), null = alles */
export function showLastStart(min: number | null, t: string): string | null {
  return min ? windowStart({ mode: "dauer", min }, t) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Texte zur Lagezeit

/** Übungstag einer Zeit: «T2», sonst Datum «15.05.» */
export function dayTag(t: string, days: string[]): string {
  const i = days.indexOf(t.slice(0, 10));
  return i >= 0 ? `T${i + 1}` : `${t.slice(8, 10)}.${t.slice(5, 7)}.`;
}

/** «T2 05:30» */
export function lageZeitText(t: string, days: string[]): string {
  return `${dayTag(t, days)} ${t.slice(11, 16)}`;
}

/** Dauer in Klartext: «1 h 55 min», «25 min», «2 h», «weniger als 1 min» */
export function dauerText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return "weniger als 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Abstand zweier lokaler ISO-Zeiten in ms (b − a) */
export function zeitAbstand(a: string, b: string): number {
  return parseLocalIso(b).getTime() - parseLocalIso(a).getTime();
}

/** Titel des Rückblick-Bands: «RÜCKBLICK · Lage um T2 05:30 (vor 1 h 55 min)» */
export function rueckblickTitel(t: string, tLive: string, days: string[]): string {
  return `RÜCKBLICK · Lage um ${lageZeitText(t, days)} (vor ${dauerText(zeitAbstand(t, tLive))})`;
}

/** Restzeit bis zur Rückkehr nach LIVE: «0:20», «1:05» */
export function countdownText(s: number): string {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** lokale ISO-Zeit ± Minuten */
export function shiftMinutes(t: string, min: number): string {
  const d = parseLocalIso(t);
  d.setMinutes(d.getMinutes() + min);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Eingabe «Lage um»: «05:30», «0530», «5.30», «T1 2300», «T1 23:00». Ohne Tag gilt der Tag der Bezugszeit `ctx.t`
 * (Rückblick: die gezeigte Zeit); läge die Zeit dann nach LIVE (`ctx.tLive`), gilt der Vortag. Ungültig → null.
 */
export function parseLageZeit(input: string, ctx: { days: string[]; t: string; tLive: string }): string | null {
  const m = /^\s*(?:t\s*(\d{1,2})\s*[,\s]\s*)?([01]?\d|2[0-3])\s*[:.h]?\s*([0-5]\d)\s*(?:uhr)?\s*$/i.exec(input);
  if (!m) return null;
  const hhmm = `${pad2(+m[2]!)}:${m[3]}`;
  if (m[1]) {
    const day = ctx.days[+m[1] - 1];
    return day ? `${day}T${hhmm}` : null;
  }
  const t = `${ctx.t.slice(0, 10)}T${hhmm}`;
  return t > ctx.tLive.slice(0, 16) ? `${addDays(ctx.t.slice(0, 10), -1)}T${hhmm}` : t;
}
