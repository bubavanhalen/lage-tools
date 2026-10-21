/**
 * Zeitfenster der Lagedarstellung: «alles» (nichts fällt weg), eine feste Dauer bis zur Lagezeit
 * (läuft mit Lagezeit, Live und Abspielen mit) oder ab einem festen Zeitpunkt.
 * Zeiten als ISO lokal «YYYY-MM-DDTHH:MM» (wie `LageEvent.t`).
 */
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
