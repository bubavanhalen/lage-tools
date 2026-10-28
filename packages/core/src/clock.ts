/**
 * Uhr und Übungstage: alles in Lokalzeit des Geräts (nie `toISOString()` für Tage – das wäre UTC und um 00:30
 * noch der Vortag). Ereigniszeit `t` und Eingang `tReported` sind lokale ISO-Zeiten ohne Offset («2026-10-28T10:40»);
 * die Zeitzone der Übung (IANA + Offset beim Anlegen) steht in `Exercise.tz`, der genaue Zeitpunkt in `createdAt` (UTC).
 */

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
  if (a.tOffset && b.tOffset && a.t !== b.t) {
    const d = Date.parse(`${a.t.slice(0, 16)}:00${a.tOffset}`) - Date.parse(`${b.t.slice(0, 16)}:00${b.tOffset}`);
    if (d) return d;
  }
  return a.t.localeCompare(b.t) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);
}
