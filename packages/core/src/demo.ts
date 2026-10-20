/**
 * Beispielübung (fiktiv, Raum Bern) – zum Ausprobieren und für Tests. Keine Übungsdaten.
 */
import { areaFromRing, newExercise } from "./exercise";
import { eventFromDraft, lastPosition, parseMeldung } from "./journal";
import type { Exercise, LageEvent } from "./model";
import { makeBlattSheet } from "./raster";

const LINES = [
  "T1 1830 H01 Beo Stao AE5 C",
  "T1 1840 H02 Beo Stao AK9 B",
  "T1 1845 H03 Beo Stao AP4 D",
  "T1 1850 H04 Beo Stao AF12 A",
  "T1 1905 H05 rollt ab AS13",
  "T1 1920 H05 Beo Stao AQ11 C",
  "T1 2010 H02: 1 Fz in NAI 2 Rtg S",
  "T1 2025 H03: Det 1 2 Fz AN6 Rtg SW",
  "T1 2140 H01 3 Pers bei NAI 1, Zugehörigkeit unklar",
  "T1 2215 H04 Kontakt mit Gegner",
  "T1 2330 Rot Det 2 Patrouille AH10 Rtg N",
  "T2 0020 H02 Det 2 2 Pers AJ8",
  "T2 0105 H03: Det 1 Checkpoint in NAI 2",
  "T2 0230 H05 Drohne über AR10",
  "T2 0410 H01 verschiebt nach AC6 B",
  "T2 0515 H04: Det 2 1 Fz in NAI 3 Rtg O",
  "T2 0540 H02 Ablösung, Beo Stao AL9 A",
  "T2 0605 Det 1 2 Fz AO7 Rtg W",
  "T2 0630 H01 4 Pers AD7 unklar",
  "T2 0650 H03: Sperre AM5",
];

export function demoExercise(): Exercise {
  const ex = newExercise("Beispiel Bern (fiktiv)");
  ex.id = "ex-beispiel-bern";
  ex.days = ["2030-05-14", "2030-05-15"];
  ex.sheets.push(makeBlattSheet({ name: "BERN", prefix: "A", center: { e: 2600000, n: 1199000 }, cellSize: 500 }));
  ex.areas.push(
    areaFromRing("NAI 1", [{ e: 2595200, n: 1199900 }, { e: 2596300, n: 1199700 }, { e: 2596100, n: 1198800 }, { e: 2595000, n: 1199000 }], "nai", "#1f78d1"),
    areaFromRing("NAI 2", [{ e: 2601800, n: 1202300 }, { e: 2602900, n: 1202400 }, { e: 2603000, n: 1201300 }, { e: 2601900, n: 1201200 }], "nai", "#1f78d1"),
    areaFromRing("NAI 3", [{ e: 2600000, n: 1197300 }, { e: 2601100, n: 1197400 }, { e: 2601000, n: 1196400 }, { e: 2599900, n: 1196300 }], "nai", "#1f78d1"),
    areaFromRing("AO Aare", [{ e: 2595000, n: 1202500 }, { e: 2604500, n: 1202500 }, { e: 2604500, n: 1195600 }, { e: 2595000, n: 1195600 }], "ao", "#0b3d91"),
  );
  ex.units = { blau: ["H01", "H02", "H03", "H04", "H05"], rot: ["Det 1", "Det 2"], ul: [] };
  const events: LageEvent[] = [];
  const now = new Date(2030, 4, 15, 8, 0);
  for (const line of LINES) {
    const d = parseMeldung(line, {
      sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now,
      lastPos: (u, s) => lastPosition(events, s, u),
    });
    const ev = eventFromDraft(d, "dev-beispiel", now);
    ev.updatedAt = new Date(Date.parse(ev.t)).toISOString();
    events.push(ev);
  }
  ex.events = events;
  return ex;
}
