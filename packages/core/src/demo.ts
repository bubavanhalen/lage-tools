/**
 * Beispielübung (fiktiv, Raum Bern) – zum Ausprobieren und für Tests. Keine Übungsdaten.
 * Die Meldungen sind so gewählt, dass die meisten Hinweise zu Rot (`hints.ts`) einmal auslösen:
 * Normallage/Ruhe/Abweichung in NAI 2, Checkpoint mit ausweichendem Fz, Pendel eines weissen Lieferwagens,
 * Drohne über dem Stao H05, Reaktion nach Patrouille, Übergabe, Rot-Stao neben H02, stummer Trupp in NAI 1 u. a.
 * Zur Demo-Endzeit (T2 07:25) zeigt «Lage Rot»: wahrscheinlichste Möglichkeit Überfall auf Stao H05 (Drohne über H05,
 * Schwergewicht in AP10 an der Seftigenstrasse, Formation Linie), gefährlichste Hinterhalt am Engnis NAI 3 (Sperre,
 * Drohne 2× über NAI 3), weitere Versorgung/Übergabe (Pendel schwarzer Pw AK9 ↔ AN6); Kräfte Rot gegenüber der
 * Feindannahme mit unerwarteten Kpz und den länger nicht mehr gemeldeten Det 1 und Det 2.
 */
import { areaFromRing, newExercise } from "./exercise";
import { eventFromDraft, lastPosition, parseMeldung } from "./journal";
import type { Exercise, LageEvent, NaiTyp } from "./model";
import { makeBlattSheet } from "./raster";

const LINES = [
  "T1 1830 H01 Beo Stao AE5 C",
  "T1 1840 H02 Beo Stao AK9 B",
  "T1 1845 H03 Beo Stao AP4 D",
  "T1 1850 H04 Beo Stao AF12 A",
  "T1 1855 H03: 1 Fz in NAI 2 Rtg N",
  "T1 1905 H05 rollt ab AS13",
  "T1 1920 H05 Beo Stao AQ11 C",
  "T1 1930 H03: 1 Fz in NAI 2 Rtg S",
  "T1 2010 H02: 1 Fz in NAI 2 Rtg S",
  "T1 2025 H03: Det 1 2 Fz AN6 Rtg SW",
  "T1 2050 H03: 1 Fz in NAI 2 Rtg N",
  "T1 2125 H03: 1 Fz in NAI 2 Rtg S",
  "T1 2140 H01 3 Pers bei NAI 1, Zugehörigkeit unklar",
  "T1 2215 H04 Kontakt mit Gegner",
  "T1 2330 Rot Det 2 Patrouille AH10 Rtg N",
  "T2 0020 H02 Det 2 2 Pers AJ8",
  "T2 0035 H02: Det 2 3 Pers AB6",
  "T2 0105 H03: Det 1 Checkpoint in NAI 2",
  "T2 0115 H02: Det 2 2 Pers AE8 Rtg W",
  "T2 0120 H03: 1 Fz wendet in NAI 2 Rtg N",
  "T2 0130 H03: 1 ziv Fz (weisser Lieferwagen) AN6 Rtg N",
  "T2 0155 H03: 1 ziv Fz (weisser Lieferwagen) in NAI 2",
  "T2 0225 H03: 1 ziv Fz (weisser Lieferwagen) AN6 Rtg S",
  "T2 0230 H05 Drohne über AR10",
  "T2 0250 H05: Drohne über AQ11",
  "T2 0255 H03: 1 ziv Fz (weisser Lieferwagen) in NAI 2",
  "T2 0300 H05 eig Pat AN10",
  "T2 0330 H05 zurück, Beo Stao AQ11 C",
  "T2 0345 H02: 2 Pers AN10 laden Kisten in Kofferraum",
  "T2 0410 H01 verschiebt nach AC6 B",
  "T2 0425 H03: 2 Fz halten AO5, Personen steigen um",
  "T2 0450 H02: Zivilperson meldet angeblich 3 Fz AT3 Rtg N",
  "T2 0515 H04: Det 2 1 Fz in NAI 3 Rtg O",
  "T2 0530 H02: Det 2 bezieht Stellung AM9",
  "T2 0535 H05: Drohne über NAI 3",
  "T2 0540 H02 Ablösung, Beo Stao AL9 A",
  "T2 0542 H02: 1 ziv Fz (schwarzer Pw) AK9 Rtg O",
  "T2 0545 H03: 3 Fz in NAI 2 Rtg O",
  "T2 0600 H03: 3 Fz in NAI 2 Rtg O",
  "T2 0605 Det 1 2 Fz AO7 Rtg W",
  "T2 0610 H05: Drohne über NAI 3 Rtg W",
  "T2 0610 H03: 1 ziv Fz (schwarzer Pw) AN6 Rtg N",
  "T2 0620 H05: Sperre aus Baumstämmen in NAI 3, Strasse blockiert",
  "T2 0630 H01 4 Pers AD7 unklar",
  "T2 0640 H05: 6 Pers AP10 am Waldrand",
  "T2 0640 H02: 1 ziv Fz (schwarzer Pw) AK9 Rtg W",
  "T2 0645 H05: 2 Fz AP10 an der Seftigenstrasse, stehen mit laufendem Motor",
  "T2 0650 H03: Sperre AM5",
  "T2 0655 H04: 1 gn Trp Inf AH12 Rtg N",
  "T2 0700 H05: mögliche IED in AF13",
  "T2 0705 H04: gn Sperre in AG13",
  "T2 0710 H02: 2 Kpz AK9 Rtg W",
  "T2 0710 H03: 1 ziv Fz (schwarzer Pw) AN6",
  "T2 0712 H05: 2 Kpz AJ9 Rtg W",
  "T2 0720 H03: 1 Fz in NAI 2 Rtg N",
  "T2 0725 H05: 4 Pers in Linie AP11",
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
  // NAI: Beob Trupp und Geländetyp (steuern die Hinweise, z. B. Engnis → Hinterhalt-Gefahr)
  const nai = (name: string, trupp: string, typ: NaiTyp) => {
    const a = ex.areas.find((x) => x.name === name)!;
    a.trupp = trupp;
    a.typ = typ;
  };
  nai("NAI 1", "H01", "siedlung");
  nai("NAI 2", "H03", "strasse");
  nai("NAI 3", "H05", "engnis");
  ex.units = { blau: ["H01", "H02", "H03", "H04", "H05"], rot: ["Det 1", "Det 2"], ul: [] };
  // Feindannahme (erwartete Stärke Rot) in Kurzschrift – Vergleich mit den erkannten Kräften im Reiter Hinweise
  ex.feindannahme = "2 Det, 14 Pers, 5 Fz, 1 Drohne";
  const events: LageEvent[] = [];
  const now = new Date(2030, 4, 15, 8, 0);
  for (const line of LINES) {
    const d = parseMeldung(line, {
      sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now,
      lastPos: (u, s) => lastPosition(events, s, u),
    });
    const ev = eventFromDraft(d, "dev-beispiel", now);
    ev.updatedAt = new Date(Date.parse(ev.t)).toISOString();
    // Eingang = Ereigniszeit (fiktive Übung, laufend mitgeschrieben)
    ev.createdAt = ev.updatedAt;
    ev.tReported = ev.t;
    events.push(ev);
  }
  ex.events = events;
  return ex;
}
