/**
 * Umfang eines Ausdrucks (Journal-PDF, Dialog «Journal drucken …», Spez. MVP 3, Kap. 2.8/3.9): Tage mit Wochentag,
 * Zeitspannen «T2 06:00–07:31», Einträge im Umfang, Kopftext, Eingabe «T2 0731». Rein, ohne jsPDF (der Dialog lädt
 * jsPDF erst beim Erstellen).
 */
import { compareEvents, schichtenIm, type Exercise, type LageEvent, type SchichtWechsel } from "@lage/core";
import type { JournalDruck } from "../shell/contracts";

const WOCHENTAG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
/** «Mittwoch» zu «2030-05-15» (Kalender, unabhängig von der Zeitzone des Geräts) */
export function wochentagOf(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return WOCHENTAG[new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay()]!;
}
export const datum = (date: string) => date.slice(0, 10).split("-").reverse().join(".");
/** «T2» bzw. «15.05.» ausserhalb der Übungstage */
export function tagKurz(t: string, days: string[]): string {
  const i = days.indexOf(t.slice(0, 10));
  return i >= 0 ? `T${i + 1}` : `${t.slice(8, 10)}.${t.slice(5, 7)}.`;
}
/** Tageszeile «T2 · Mittwoch 15.05.2030» */
export function tagZeile(date: string, days: string[]): string {
  const i = days.indexOf(date.slice(0, 10));
  return `${i >= 0 ? `T${i + 1} · ` : ""}${wochentagOf(date)} ${datum(date)}`;
}
/** «T2 06:00» */
export const tz = (t: string, days: string[]) => `${tagKurz(t, days)} ${t.slice(11, 16)}`;
/** «T2 06:00–07:31» bzw. «T1 18:00–T2 07:31» */
export function spanne(from: string, to: string, days: string[]): string {
  return `${tz(from, days)}–${from.slice(0, 10) === to.slice(0, 10) ? to.slice(11, 16) : tz(to, days)}`;
}
/** «hh:mm» lokal zu einem Zeitpunkt (ISO UTC) */
export const localHhmm = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };


export type JournalUmfang = JournalDruck["umfang"];

/** erste und letzte Lagezeit der Übung (Einträge), sonst Übungstage */
export function grenzen(ex: Exercise): { from: string; to: string } {
  const ts = (ex.events ?? []).map((e) => e.t.slice(0, 16)).sort();
  const d0 = ex.days[0], d1 = ex.days[ex.days.length - 1];
  return { from: ts[0] ?? (d0 ? `${d0}T00:00` : "0000-00-00T00:00"), to: ts[ts.length - 1] ?? (d1 ? `${d1}T23:59` : "9999-12-31T23:59") };
}

/** Schicht auf diesem Gerät bzw. jüngster Wechsel bis `to` – Beginn (Lagezeit) und Kürzel */
export function schichtAm(ex: Pick<Exercise, "schichten">, to: string): SchichtWechsel | null {
  const l = schichtenIm(ex, null, to);
  return l[l.length - 1] ?? null;
}

/** Kopftext des Umfangs: «Schicht BSP T2 06:00–07:31», «Tag T2 · Mittwoch 15.05.2030», «ganze Übung …», «Zeitraum …» */
export function umfangText(ex: Exercise, u: JournalUmfang): string {
  const from = u.from ?? grenzen(ex).from;
  switch (u.art) {
    case "schicht": {
      const s = schichtAm(ex, u.to);
      return `Schicht${s ? ` ${s.an}` : ""} ${spanne(from, u.to, ex.days)}`;
    }
    case "tag": return `Tag ${tagZeile(from, ex.days)}`;
    case "alles": return `ganze Übung ${spanne(from, u.to, ex.days)}`;
    default: return `Zeitraum ${spanne(from, u.to, ex.days)}`;
  }
}

/** Einträge im Umfang (Lagezeit `from ≤ t ≤ to`), chronologisch */
export function eintraegeIm(ex: Exercise, u: Pick<JournalUmfang, "from" | "to">, ohneGestrichene = false): LageEvent[] {
  return (ex.events ?? [])
    .filter((e) => (!u.from || e.t.slice(0, 16) >= u.from) && e.t.slice(0, 16) <= u.to && !(ohneGestrichene && e.deleted))
    .sort(compareEvents);
}

/** «T2 0731» / «T2 07:31» / «0731» (Tag von `ref`) → ISO lokal, sonst null */
export function parseTagZeit(s: string, days: string[], ref: string): string | null {
  const m = /^\s*(?:T(\d{1,2})\s*)?(\d{1,2})[:.]?(\d{2})\s*$/i.exec(s);
  if (!m) return null;
  const h = +m[2]!, mi = +m[3]!;
  if (h > 23 || mi > 59) return null;
  const d = m[1] ? days[+m[1] - 1] : ref.slice(0, 10);
  if (!d) return null;
  return `${d}T${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}
/** ISO lokal → «T2 0731» (Eingabefeld Zeitraum) */
export const tagZeitText = (t: string, days: string[]) => `${tagKurz(t, days)} ${t.slice(11, 13)}${t.slice(14, 16)}`;
