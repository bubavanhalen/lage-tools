/**
 * Zeitangaben aus Meldungen: «0531», «05:31», «05.31 Uhr», «Wann: 0600», «A: vor 5min», «00:14-05:35».
 */

export interface FoundTime {
  /** Minuten seit Mitternacht */
  minutes: number;
  raw: string;
  index: number;
  /** Ende eines Zeitraums (Minuten), falls «von–bis» */
  until?: number;
  relative?: boolean;
}

const HHMM = String.raw`([01]?\d|2[0-3])[:.h]?([0-5]\d)`;

/**
 * Findet Uhrzeiten. 4-stellige Zahlen ohne Trenner (0531) werden nur als Zeit gelesen,
 * wenn sie nicht Teil einer Koordinate oder längeren Zahl sind.
 * @param reportedMinutes Meldezeit (für «vor 5 min»)
 */
export function findTimes(text: string, reportedMinutes?: number): FoundTime[] {
  const out: FoundTime[] = [];
  const re = new RegExp(String.raw`(?<![\d'’.:/])${HHMM}(?:\s*(?:uhr|h)\b)?(?:\s*[-–]\s*${HHMM})?(?![\d'’]|\s*%|\s*m\b|\s*pers)`, "gi");
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    // Reine vierstellige Zahl nur akzeptieren, wenn sie wie eine Zeit aussieht (0000–2359) und nicht Planquadrat-/Mengenkontext
    const minutes = +m[1]! * 60 + +m[2]!;
    const until = m[3] ? +m[3] * 60 + +m[4]! : undefined;
    if (!/[:.h]/.test(raw) && raw.replace(/\D/g, "").length !== 4) continue;
    out.push({ minutes, raw, index: m.index!, until });
  }
  if (reportedMinutes !== undefined) {
    const rel = /vor\s+(\d{1,3})\s*(?:min|minuten|')/gi;
    for (const m of text.matchAll(rel)) {
      out.push({ minutes: (reportedMinutes - +m[1]! + 1440) % 1440, raw: m[0], index: m.index!, relative: true });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export function formatHHMM(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
