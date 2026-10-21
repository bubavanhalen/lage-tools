import ms from "milsymbol";
import { describe, expect, it } from "vitest";
import {
  CATALOG,
  buildSidc,
  catalogEntry,
  demoExercise,
  describeTactical,
  eventFromDraft,
  lastPosition,
  parseMeldung,
  readTactical,
  searchTactical,
  situationAt,
  type Draft,
  type JournalContext,
  type WhereKind,
} from "../src";

// Tabellentest: Meldungen, wie sie im LVZ mitgeschrieben werden – nur fiktive Daten (Beispiel Bern, Raster BERN AA–AU).
// Erwartet: Zeichen, Einordnung, Stufe, Status, Anzahl, Ort-Art, Herkunft, Strassenart, Sinn, SIDC.
const ex = demoExercise();
const ctx = (): JournalContext => ({
  sheets: ex.sheets, areas: ex.areas, units: ex.units, days: ex.days, day: ex.days[1]!, now: new Date(2030, 4, 15, 8, 0),
  lastPos: (u, s) => lastPosition(ex.events!, s, u),
});

interface Row {
  sym: string;
  kind: Draft["kind"];
  ech?: string;
  status?: string;
  count?: number;
  wo: WhereKind | null;
  from?: number;
  road?: string;
  q?: string;
  desc: string | null;
  sidc: string;
}

const ROWS: Array<[string, Row]> = [
  ["1 gn hz inf", { sym: "inf", kind: "feind", ech: "hz", count: 1, wo: null, desc: "1 gegnerischer Halbzug Infanterie", sidc: "SHGPUCI----C---" }],
  ["mögliche IED in AF13", { sym: "ied", kind: "feind", status: "anticipated", wo: "raster", desc: "mögliche IED", sidc: "SHGAEXI--------" }],
  ["gn Sperre in AG13", { sym: "sperre", kind: "feind", wo: "raster", desc: "gegnerische Sperre", sidc: "GHOPPR----****X" }],
  ["2 Spz Rtg W", { sym: "spz", kind: "feind", count: 2, wo: null, desc: "2 gegnerische Schützenpanzer", sidc: "SHGPEVAI--MQ---" }],
  ["3 gn Pers mit Stgw", { sym: "inf_trp", kind: "feind", count: 3, wo: null, desc: "3 gegnerische Personen mit Sturmgewehr", sidc: "SHGPUCI----A---" }],
  ["Mg Stellung", { sym: "mg", kind: "feind", wo: null, desc: "gegnerisches Maschinengewehr in Stellung", sidc: "SHGPEWRL-------" }],
  ["Beo Posten", { sym: "beob_aufkl", kind: "unklar", wo: null, desc: "Beobachtungsposten", sidc: "GUGPDPOR--****X" }],
  ["gn Pzaw Trupp", { sym: "pzj", kind: "feind", ech: "trp", wo: null, desc: "gegnerischer Trupp Panzerjäger", sidc: "SHGPUCAA---A---" }],
  ["Drohne über NAI 2", { sym: "drohne", kind: "feind", wo: "nai", desc: "gegnerische Drohne", sidc: "SHAPMFQ--------" }],
  ["Schuss gehört aus Rtg O", { sym: "kontakt", kind: "feind", wo: null, from: 90, desc: "Schuss gehört", sidc: "EHIPBF---------" }],
  ["Explosion AK7", { sym: "explosion", kind: "unklar", wo: "raster", desc: "Explosion", sidc: "OUVPE----------" }],
  ["1 Verletzter", { sym: "verletzte", kind: "unklar", count: 1, wo: null, desc: "1 Verletzter", sidc: "OUOPC----------" }],
  ["gn Zug Pz Gren", { sym: "pz_gren", kind: "feind", ech: "zug", wo: null, desc: "gegnerischer Zug Panzergrenadiere", sidc: "SHGPUCIZ---D---" }],
  ["Kp Gfs", { sym: "kdo_po", kind: "unklar", ech: "kp", wo: null, desc: "Kommandoposten (Kompanie)", sidc: "SUGPU-----AE---" }],
  ["Verkehrsunfall", { sym: "unfall", kind: "unklar", wo: null, desc: "Unfall", sidc: "OUOPCB---------" }],
  ["Barrikade", { sym: "sperre", kind: "feind", wo: null, desc: "Sperre", sidc: "GHOPPR----****X" }],
  ["Panzersperre", { sym: "panzersperre", kind: "feind", wo: null, desc: "Panzersperre", sidc: "GHMPOAOF--****X" }],
  ["vermutete Minen", { sym: "minensperre", kind: "feind", status: "anticipated", wo: null, desc: "vermutete Minensperre", sidc: "GHMAOFS---****X" }],
  ["Hinterhalt", { sym: "hinterhalt", kind: "feind", wo: null, desc: "Hinterhalt", sidc: "GHOPVU----****X" }],
  ["2 gn Lastw", { sym: "lw", kind: "feind", count: 2, wo: null, desc: "2 gegnerische Lastwagen", sidc: "SHGPEVUL-------" }],
  ["Pw verdächtig", { sym: "fz", kind: "unklar", wo: null, desc: "verdächtiger Personenwagen", sidc: "SUGPEVU--------" }],
  ["Fz-Kolonne 5 Fz", { sym: "kolonne", kind: "feind", count: 5, wo: null, desc: "5 gegnerische Fahrzeuge (Kolonne)", sidc: "SHGPEVU--------" }],
  ["Strassensperre auf Hauptstrasse", { sym: "strassensperre", kind: "feind", wo: null, road: "haupt", desc: "Strassensperre", sidc: "GHOPPR----****X" }],
  ["Checkpoint besetzt", { sym: "kontrollposten", kind: "feind", wo: null, desc: "Checkpoint", sidc: "GHGPGPPK--****X" }],
  ["H04: 1 gn Gr Inf AH12 Rtg N", { sym: "inf", kind: "feind", ech: "gr", count: 1, wo: "raster", desc: "1 gegnerische Gruppe Infanterie", sidc: "SHGPUCI----B---" }],
  ["H02 2 Radschützenpanzer AK9 Rtg SO", { sym: "spz_rad", kind: "feind", count: 2, wo: "raster", desc: "2 gegnerische Radschützenpanzer", sidc: "SHGPEVAI--MP---" }],
  ["H03 gn Mw Stellung AN6", { sym: "mw", kind: "feind", wo: "raster", desc: "gegnerischer Minenwerfer in Stellung", sidc: "SHGPUCFM-------" }],
  ["H01 Scharfschütze vermutet AD7", { sym: "scharfschuetze", kind: "feind", status: "anticipated", wo: "raster", desc: "vermuteter gegnerischer Scharfschütze", sidc: "OHVAS----------" }],
  ["H05 4 gn Sdt bewaffnet in AR10", { sym: "inf_trp", kind: "feind", count: 4, wo: "raster", desc: "4 gegnerische Soldaten", sidc: "SHGPUCI----A---" }],
  ["H04 Schüsse aus Rtg W", { sym: "kontakt", kind: "feind", wo: "melder", from: 270, desc: "Schüsse", sidc: "EHIPBF---------" }],
  ["H02 Kontakt mit gn Gr, 1 Verletzter", { sym: "kontakt", kind: "feind", wo: "melder", desc: "Kontakt mit gegnerischer Gruppe (1 Verletzter)", sidc: "EHIPBF---------" }],
  ["H03 gn Kp Pz in Bereitstellung AP5", { sym: "pz", kind: "feind", ech: "kp", wo: "raster", desc: "gegnerische Kompanie Panzer in Bereitstellung", sidc: "SHGPUCA----E---" }],
  ["H01 Rak Rohr Trupp AE6", { sym: "pzj", kind: "feind", ech: "trp", wo: "raster", desc: "gegnerischer Trupp Panzerjäger", sidc: "SHGPUCAA---A---" }],
  ["H05 gn Spz Rad AS12", { sym: "spz_rad", kind: "feind", wo: "raster", desc: "gegnerischer Radschützenpanzer", sidc: "SHGPEVAI--MP---" }],
  ["H04 Fahrzeugkolonne 3 Lastw 2 Pw Rtg Bern", { sym: "kolonne", kind: "feind", count: 5, wo: "melder", desc: "5 gegnerische Fahrzeuge (Kolonne: 3 Lastwagen, 2 Personenwagen)", sidc: "SHGPEVU--------" }],
  ["H02 Beo Stao bezogen AK9 B", { sym: "beob_aufkl", kind: "eigen", wo: "raster", desc: "Beobachtungsposten", sidc: "GFGPDPOR--****X" }],
  ["H03 verschiebt nach AM7", { sym: "einheit", kind: "eigen", wo: "raster", desc: "Verschiebung", sidc: "SFGPU----------" }],
  ["H01 Drohne gesichtet Rtg N", { sym: "drohne", kind: "feind", wo: "melder", desc: "gegnerische Drohne", sidc: "SHAPMFQ--------" }],
  ["H04 2 Kpz zerstört", { sym: "kpz", kind: "feind", status: "destroyed", count: 2, wo: "melder", desc: "2 zerstörte gegnerische Kampfpanzer", sidc: "SHGXEVATH-MQ---" }],
  ["H05 Minenfeld AQ12", { sym: "minensperre", kind: "feind", wo: "raster", desc: "Minensperre", sidc: "GHMPOFS---****X" }],
  ["H02 Stacheldraht AH5", { sym: "stacheldraht", kind: "feind", wo: "raster", desc: "Drahthindernis", sidc: "GHGPGPP---****X" }],
  ["H03 gn Art Feuer auf AN6", { sym: "beschuss", kind: "feind", wo: "raster", desc: "gegnerischer Beschuss", sidc: "GHOPVI----****X" }],
  ["H04 Einschläge AF12", { sym: "beschuss", kind: "feind", wo: "raster", desc: "Beschuss", sidc: "GHOPVI----****X" }],
  ["H01 gn San Fz", { sym: "san_fz", kind: "feind", wo: "melder", desc: "gegnerisches Sanitätsfahrzeug", sidc: "SHGPEVUA-------" }],
  ["H02 Brücke gesprengt AK10", { sym: "sprengung", kind: "feind", wo: "raster", desc: "Sprengung", sidc: "EHIPBC---------" }],
  ["H03 Gn Aufkl Fz Eagle AO7 Rtg S", { sym: "aufkl_fz", kind: "feind", wo: "raster", desc: "gegnerisches Aufklärungsfahrzeug", sidc: "SHGPUCRVA------" }],
  ["H04 ziv Pw mit 3 Pers AG8", { sym: "ziv_fz", kind: "unklar", wo: "raster", desc: "Ziviles Fahrzeug mit 3 Personen", sidc: "SUGPEVCA-------" }],
  ["H05 Menschenmenge AR11", { sym: "menge", kind: "unklar", wo: "raster", desc: "Menschenmenge", sidc: "EUIPA----------" }],
  ["H02 gn Gfs AJ7", { sym: "kdo_po", kind: "feind", wo: "raster", desc: "gegnerischer Kommandoposten", sidc: "SHGPU-----A----" }],
  ["H01 eig Gr Beo", { sym: "beob_aufkl", kind: "eigen", wo: "zuletzt", desc: "eigener Beobachtungsposten (Gruppe)", sidc: "GFGPDPOR--****X" }],
  ["H03 1 gn Pz Gren Zug mit 3 Spz AN6 Rtg W", { sym: "pz_gren", kind: "feind", ech: "zug", count: 1, wo: "raster", desc: "1 gegnerischer Zug Panzergrenadiere mit 3 Schützenpanzern", sidc: "SHGPUCIZ---D---" }],
  ["H04 gn Hz Pzj AF10", { sym: "pzj", kind: "feind", ech: "hz", wo: "raster", desc: "gegnerischer Halbzug Panzerjäger", sidc: "SHGPUCAA---C---" }],
  ["H02 Heli Rtg O", { sym: "heli", kind: "feind", wo: "melder", desc: "gegnerischer Helikopter", sidc: "SHAPMH---------" }],
  ["H05 vermutl gn Trp in Wald AS9", { sym: "einheit", kind: "feind", ech: "trp", status: "anticipated", wo: "raster", desc: "vermuteter gegnerischer Trupp", sidc: "SHGAU------A---" }],
  ["H01 Sanitätsposten AE4", { sym: "san_hist", kind: "unklar", wo: "raster", desc: "Sanitätshilfsstelle", sidc: "SUGPIXH--------" }],
  ["H03 Log Pt AN3", { sym: "log_pt", kind: "unklar", wo: "raster", desc: "Logistikpunkt", sidc: "GUSPPL----****X" }],
  ["H04 Halt Fz AG12", { sym: "fz", kind: "feind", wo: "raster", desc: "gegnerisches Fahrzeug (Halt)", sidc: "SHGPEVU--------" }],
  ["H02 Angriff gn Zug auf H02", { sym: "einheit", kind: "feind", ech: "zug", wo: "melder", desc: "gegnerischer Zug (Angriff)", sidc: "SHGPU------D---" }],
  ["H05 IED detoniert AQ13", { sym: "ied", kind: "feind", wo: "raster", desc: "IED", sidc: "SHGPEXI--------" }],
  ["H01 gn Pat 3 Pers AC6 Rtg N", { sym: "patrouille", kind: "feind", count: 3, wo: "raster", desc: "gegnerische Patrouille (3 Personen)", sidc: "GHOPPT----****X" }],
  ["H03 Gn Kp Inf", { sym: "inf", kind: "feind", ech: "kp", wo: "melder", desc: "gegnerische Kompanie Infanterie", sidc: "SHGPUCI----E---" }],
  ["H04 Spz rollt Rtg W", { sym: "spz", kind: "feind", wo: "melder", desc: "gegnerischer Schützenpanzer", sidc: "SHGPEVAI--MQ---" }],
  ["H02 2 x Mw Rohr AK8", { sym: "mw_geraet", kind: "feind", count: 2, wo: "raster", desc: "2 gegnerische Minenwerfer", sidc: "SHGPEWOM-------" }],
  ["H05 gn Flab AR7", { sym: "flab", kind: "feind", wo: "raster", desc: "gegnerische Fliegerabwehr", sidc: "SHGPUCD--------" }],
  ["T2 0230 H05 Drohne über AR10", { sym: "drohne", kind: "feind", wo: "raster", desc: "gegnerische Drohne", sidc: "SHAPMFQ--------" }],
  ["H03 Drohne AN6", { sym: "drohne", kind: "feind", wo: "raster", desc: "gegnerische Drohne", sidc: "SHAPMFQ--------" }],
  ["H05 Lastwagen AR10", { sym: "lw", kind: "feind", wo: "raster", desc: "gegnerischer Lastwagen", sidc: "SHGPEVUL-------" }],
  ["H02 2 Verletzte", { sym: "verletzte", kind: "unklar", count: 2, wo: "melder", desc: "2 Verletzte", sidc: "OUOPC----------" }],
  ["H02 1 Toter", { sym: "verletzte", kind: "unklar", count: 1, wo: "melder", desc: "1 Toter", sidc: "OUOPC----------" }],
  ["H04 Zivilist verletzt", { sym: "verletzte", kind: "unklar", wo: "melder", desc: "Verletzter (Zivilperson)", sidc: "OUOPC----------" }],
  ["H03 Infanteriezug AN6", { sym: "inf", kind: "feind", ech: "zug", wo: "raster", desc: "gegnerischer Zug Infanterie", sidc: "SHGPUCI----D---" }],
  ["H03 gn Füs Zug", { sym: "inf", kind: "feind", ech: "zug", wo: "melder", desc: "gegnerischer Zug Infanterie", sidc: "SHGPUCI----D---" }],
  ["H01 gn Gr mit 2 Mg", { sym: "inf", kind: "feind", ech: "gr", wo: "melder", desc: "gegnerische Gruppe Infanterie mit 2 Maschinengewehren", sidc: "SHGPUCI----B---" }],
  ["H02 2 gn Sdt mit Pzf", { sym: "inf_trp", kind: "feind", count: 2, wo: "melder", desc: "2 gegnerische Soldaten mit Panzerfaust", sidc: "SHGPUCI----A---" }],
  ["H04 gn Sprengobjekt Brücke AK10", { sym: "sprengobjekt", kind: "feind", wo: "raster", desc: "gegnerisches Sprengobjekt", sidc: "OHVPB----------" }],
  ["H01 Verschiebung Rtg N", { sym: "einheit", kind: "eigen", wo: "zuletzt", desc: "Verschiebung", sidc: "SFGPU----------" }],
  ["H02 Rückzug gn Rtg O", { sym: "einheit", kind: "feind", wo: "melder", desc: "gegnerischer Rückzug", sidc: "SHGPU----------" }],
  ["H03 Kdo Po AN4", { sym: "kdo_po", kind: "unklar", wo: "raster", desc: "Kommandoposten", sidc: "SUGPU-----A----" }],
  ["H04 gn KP AG11", { sym: "kdo_po", kind: "feind", wo: "raster", desc: "gegnerischer Kommandoposten", sidc: "SHGPU-----A----" }],
  ["H05 Fahrzeugkontrolle AR9", { sym: "kontrollposten", kind: "feind", wo: "raster", desc: "Checkpoint", sidc: "GHGPGPPK--****X" }],
  ["H02 Rauch AK8", { sym: "brand", kind: "unklar", wo: "raster", desc: "Brand", sidc: "EUIPC----------" }],
  ["H04 Sperre auf Autobahn", { sym: "sperre", kind: "feind", wo: "melder", road: "autobahn", desc: "Sperre", sidc: "GHOPPR----****X" }],
  ["H03 gn Pz Hb Stellung", { sym: "pz_hb", kind: "feind", wo: "melder", desc: "gegnerische Panzerhaubitze in Stellung", sidc: "SHGPEWHMS------" }],
  ["H01 gn Mw Feuer AD6", { sym: "beschuss", kind: "feind", wo: "raster", desc: "gegnerischer Beschuss", sidc: "GHOPVI----****X" }],
  ["H03 1 gn Hz", { sym: "einheit", kind: "feind", ech: "hz", count: 1, wo: "melder", desc: "1 gegnerischer Halbzug", sidc: "SHGPU------C---" }],
  ["H02 gn Gren Hz", { sym: "spez", kind: "feind", ech: "hz", wo: "melder", desc: "gegnerischer Halbzug Spezialkräfte", sidc: "SHFPG------C---" }],
  ["H04 eig Patr AG10", { sym: "patrouille", kind: "eigen", wo: "raster", desc: "eigene Patrouille", sidc: "GFOPPT----****X" }],
  ["H05 gn Hz in Hinterhalt AQ9", { sym: "hinterhalt", kind: "feind", wo: "raster", desc: "gegnerischer Hinterhalt (Halbzug)", sidc: "GHOPVU----****X" }],
  ["H01 gn Pz Gren Hz mit 2 Piranha", { sym: "pz_gren", kind: "feind", ech: "hz", wo: "melder", desc: "gegnerischer Halbzug Panzergrenadiere mit 2 Radschützenpanzern", sidc: "SHGPUCIZ---C---" }],
  ["H02 IED gefunden AK10", { sym: "ied", kind: "feind", wo: "raster", desc: "IED", sidc: "SHGPEXI--------" }],
  ["H03 Spreng Obj AN8", { sym: "sprengobjekt", kind: "feind", wo: "raster", desc: "Sprengobjekt", sidc: "OHVPB----------" }],
  ["H02 Schuss", { sym: "kontakt", kind: "feind", wo: "melder", desc: "Schuss", sidc: "EHIPBF---------" }],
  ["H04 Schusswechsel AF11", { sym: "kontakt", kind: "feind", wo: "raster", desc: "Kontakt", sidc: "EHIPBF---------" }],
  ["H03 vmtl gn Gr AN5", { sym: "einheit", kind: "feind", ech: "gr", status: "anticipated", wo: "raster", desc: "vermutete gegnerische Gruppe", sidc: "SHGAU------B---" }],
  ["H05 Funkstörung", { sym: "ekf", kind: "feind", wo: "melder", desc: "gegnerische elektronische Kriegsführung", sidc: "SHGPUUMSE------" }],
  ["H01 Störsender", { sym: "ekf", kind: "feind", wo: "melder", desc: "gegnerische elektronische Kriegsführung", sidc: "SHGPUUMSE------" }],
  ["H02 Beobachtung gn Pat", { sym: "patrouille", kind: "feind", wo: "melder", desc: "gegnerische Patrouille (Beobachtung)", sidc: "GHOPPT----****X" }],
  ["H03 Grenadier Trp", { sym: "spez", kind: "feind", ech: "trp", wo: "melder", desc: "gegnerischer Trupp Spezialkräfte", sidc: "SHFPG------A---" }],
  ["H04 gn Kpz beschädigt", { sym: "kpz", kind: "feind", status: "damaged", wo: "melder", desc: "beschädigter gegnerischer Kampfpanzer", sidc: "SHGDEVATH-MQ---" }],
  ["H02 2 gn Mtw", { sym: "mtw", kind: "feind", count: 2, wo: "melder", desc: "2 gegnerische Mannschaftstransportwagen", sidc: "SHGPEVAA-------" }],
  ["H05 Dorfeingang Wabern Sperre", { sym: "sperre", kind: "feind", wo: "melder", q: "Wabern", desc: "Sperre", sidc: "GHOPPR----****X" }],
  ["H03 mögl gn Beo Po AM4", { sym: "beob_aufkl", kind: "feind", status: "anticipated", wo: "raster", desc: "möglicher gegnerischer Beobachtungsposten", sidc: "GHGADPOR--****X" }],
  ["H02 gn UAV", { sym: "drohne", kind: "feind", wo: "melder", desc: "gegnerische Drohne", sidc: "SHAPMFQ--------" }],
  ["H01 Kolonne 4 Duro", { sym: "kolonne", kind: "feind", count: 4, wo: "melder", desc: "4 gegnerische Lastwagen (Kolonne)", sidc: "SHGPEVUL-------" }],
  ["Rot Det 2 Patrouille AH10 Rtg N", { sym: "patrouille", kind: "feind", wo: "raster", desc: "Patrouille", sidc: "GHOPPT----****X" }],
  ["H03: Det 1 Checkpoint", { sym: "kontrollposten", kind: "feind", wo: "zuletzt", desc: "Checkpoint", sidc: "GHGPGPPK--****X" }],
  ["H02 Det 2 2 Pers AJ8", { sym: "inf_trp", kind: "feind", count: 2, wo: "raster", desc: "2 gegnerische Personen", sidc: "SHGPUCI----A---" }],
  ["Zug 1 Rtg N AE6", { sym: "einheit", kind: "eigen", wo: "raster", desc: null, sidc: "SFGPU----------" }],
  ["Gr 3 bezieht Stellung AF7", { sym: "stellung", kind: "eigen", wo: "raster", desc: "Stellung", sidc: "GFMPSF----****X" }],
  ["H04 Kp Gfs AG11", { sym: "kdo_po", kind: "unklar", ech: "kp", wo: "raster", desc: "Kommandoposten (Kompanie)", sidc: "SUGPU-----AE---" }],
  ["H02 Explosion AS2", { sym: "explosion", kind: "unklar", wo: "raster", desc: "Explosion", sidc: "OUVPE----------" }],
  ["H02 Brand AT1", { sym: "brand", kind: "unklar", wo: "raster", desc: "Brand", sidc: "EUIPC----------" }],
  ["Kontakt mit gn Gr, 1 Verletzter", { sym: "kontakt", kind: "feind", wo: null, desc: "Kontakt mit gegnerischer Gruppe (1 Verletzter)", sidc: "EHIPBF---------" }],
  ["Schüsse aus Richtung Wabern", { sym: "kontakt", kind: "feind", wo: null, desc: "Schüsse", sidc: "EHIPBF---------" }],
  ["Sperre auf A1 Rtg Bern", { sym: "sperre", kind: "feind", wo: null, road: "autobahn", desc: "Sperre", sidc: "GHOPPR----****X" }],
  ["Lastwagenkolonne Rtg S", { sym: "kolonne", kind: "feind", wo: null, desc: "gegnerischer Lastwagen (Kolonne)", sidc: "SHGPEVUL-------" }],
  ["H01 eig Verletzte", { sym: "verletzte", kind: "eigen", wo: "zuletzt", desc: "Verletzte", sidc: "OFOPC----------" }],
  ["H05 Sperre zerstört", { sym: "sperre", kind: "feind", wo: "melder", desc: "zerstörte Sperre", sidc: "GHOPPR----****X" }],
  ["H03 gn Hz Inf vernichtet AN6", { sym: "inf", kind: "feind", ech: "hz", status: "destroyed", wo: "raster", desc: "zerstörter gegnerischer Halbzug Infanterie", sidc: "SHGXUCI----C---" }],
  ["Pw verdächtig AK8", { sym: "fz", kind: "unklar", wo: "raster", desc: "verdächtiger Personenwagen", sidc: "SUGPEVU--------" }],
  ["H02 2 Kpz von N", { sym: "kpz", kind: "feind", count: 2, wo: "melder", from: 0, desc: "2 gegnerische Kampfpanzer", sidc: "SHGPEVATH-MQ---" }],
];

describe("Meldungen lesen (Tabelle)", () => {
  it("genügend Meldungen in der Tabelle", () => expect(ROWS.length).toBeGreaterThanOrEqual(60));
  it.each(ROWS)("%s", (text, r) => {
    const d = parseMeldung(text, ctx());
    expect(d.sym, "Zeichen").toBe(r.sym);
    expect(d.kind, "Einordnung").toBe(r.kind);
    expect(d.echelon, "Stufe").toBe(r.ech);
    expect(d.status, "Status").toBe(r.status ?? "present");
    expect(d.count, "Anzahl").toBe(r.count);
    expect(d.where?.kind ?? null, "Ort").toBe(r.wo);
    expect(d.from, "Herkunft").toBe(r.from);
    expect(d.roadHint, "Strassenart").toBe(r.road);
    expect(d.placeQuery, "Ortssuche").toBe(r.q);
    expect(d.desc ?? null, "Sinn").toBe(r.desc);
    expect(d.sidc, "SIDC").toBe(r.sidc);
    expect(new ms.Symbol(d.sidc, { size: 30 }).isValid(), "milsymbol").toBe(true);
    // Doktrin: gestrichelt nur bei «möglich/vermutet», nie bei «unklar»/«verdächtig»
    if (/unklar|verdächtig/i.test(text)) expect(d.status).toBe("present");
  });
});

describe("Element- und Meldernummern sind keine Anzahl", () => {
  it.each([
    ["H05 Drohne über AR10", "drohne"],
    ["Det 2 Patrouille AH10", "patrouille"],
    ["H03: Det 1 Checkpoint", "kontrollposten"],
    ["H03 Drohne AN6", "drohne"],
    ["H05 Lastwagen AR10", "lw"],
    ["Zug 1 Beo Stao AE5", "beob_aufkl"],
    ["Gr 3 Stellung AF7", "stellung"],
  ])("%s", (text, sym) => {
    const d = parseMeldung(text, ctx());
    expect(d.sym).toBe(sym);
    expect(d.count).toBeUndefined();
    expect(eventFromDraft(d, "dev").label).toBeUndefined();
  });
  it("aber «Pat 3 Pers» = Patrouille mit 3 Personen, «Det 1 2 Fz» = 2 Fahrzeuge", () => {
    expect(parseMeldung("H01 gn Pat 3 Pers AC6", ctx()).count).toBe(3);
    expect(parseMeldung("H03: Det 1 2 Fz AN6", ctx()).count).toBe(2);
  });
  it("Demo: keine falschen Anzahlen", () => {
    for (const e of ex.events!) {
      if (e.count === undefined) continue;
      // jede Anzahl steht im Text direkt vor einem Zeichen (nicht in «H05», «Det 2»)
      expect(e.text, e.text).toMatch(new RegExp(`(^|[\\s:])${e.count}\\s+(x\\s+)?(gn\\s+)?\\p{L}`, "u"));
    }
    const byText = (t: string) => ex.events!.find((e) => e.text.includes(t))!;
    expect(byText("Drohne über AR10").count).toBeUndefined();
    expect(byText("Det 2 Patrouille").count).toBeUndefined();
    expect(byText("Det 1 Checkpoint").count).toBeUndefined();
    expect(byText("mögliche IED").status).toBe("anticipated");
    expect(byText("mögliche IED").aff).toBe("H");
  });
});

describe("Lage: eigene Meldungen mit Tätigkeit/Ereignis verschieben den Melder nicht", () => {
  it("«H02 Explosion AS2», «H02 Brand AT1», «H02 eig Verletzte AT2»: H02 bleibt, Ereignisse am Ort", () => {
    const events = [...ex.events!];
    const c = { ...ctx(), lastPos: (u: string, s: Draft["side"]) => lastPosition(events, s, u) };
    const before = situationAt(events, "2030-05-15T08:00").units.find((u) => u.unit === "H02")!;
    for (const l of ["T2 0750 H02 Explosion AS2", "T2 0751 H02 Brand AT1", "T2 0752 H02 eig Verletzte AT2", "T2 0753 H04 Kp Gfs AG11"]) {
      events.push(eventFromDraft(parseMeldung(l, c), "dev"));
    }
    const s = situationAt(events, "2030-05-15T08:00");
    const after = s.units.find((u) => u.unit === "H02")!;
    expect(after.pos).toEqual(before.pos);
    expect(after.event.sym).toBe("beob_aufkl");
    expect(s.units.find((u) => u.unit === "H04")!.event.sym).not.toBe("kdo_po");
    for (const sym of ["explosion", "brand", "verletzte", "kdo_po"]) expect(s.loose.some((e) => e.sym === sym), sym).toBe(true);
  });
  it("Einheiten-Meldung mit Ort verschiebt weiterhin («H01 verschiebt nach AC6 B»)", () => {
    const h01 = situationAt(ex.events!, "2030-05-15T08:00").units.find((u) => u.unit === "H01")!;
    expect(h01.track.length).toBeGreaterThan(1);
  });
  it("eigene Lage mit Stellung verschiebt («Zug 2 bezieht Stellung»)", () => {
    const d = parseMeldung("T2 0800 Zug 2 bezieht Stellung AE6", ctx());
    expect(d.kind).toBe("eigen");
    const s = situationAt([eventFromDraft(d, "dev")], "2030-05-15T08:00");
    expect(s.units[0]!.unit).toBe("Zug 2");
  });
});

describe("Gemeinsamer Vertrag: Herkunft, Strassenart, Status", () => {
  it("«aus Rtg O» ist Herkunft, keine Bewegungsrichtung", () => {
    const d = parseMeldung("H04 Schüsse aus Rtg O", ctx());
    expect(d.from).toBe(90);
    expect(d.dir).toBeUndefined();
    const e = eventFromDraft(d, "dev");
    expect(e.from).toBe(90);
    expect(e.dir).toBeUndefined();
    const b = parseMeldung("Schüsse aus Richtung Wabern, gn Fz Rtg N", ctx());
    expect(b.fromLabel).toBe("aus Rtg Wabern");
    expect(b.dir).toBe(0);
  });
  it("«auf Hauptstrasse» / «auf Autobahn» / «auf A1» → roadHint, nicht in die Ortssuche", () => {
    for (const [t, h] of [["Strassensperre auf Hauptstrasse", "haupt"], ["Sperre auf der HS", "haupt"], ["Sperre auf Autobahn", "autobahn"], ["Checkpoint auf A6", "autobahn"], ["IED auf A12 bei Wabern", "autobahn"]] as const) {
      const d = parseMeldung(t, ctx());
      expect(d.roadHint, t).toBe(h);
      expect(d.placeQuery ?? "", t).not.toMatch(/haupt|autobahn|^a\d/i);
      expect(eventFromDraft(d, "dev").roadHint, t).toBe(h);
    }
    expect(parseMeldung("IED auf A12 bei Wabern", ctx()).placeQuery).toBe("Wabern");
  });
  it("zerstört / beschädigt: SIDC Stelle 4 = X / D, im Eintrag übernommen", () => {
    const x = parseMeldung("H04 2 Kpz zerstört", ctx());
    expect(x.sidc[3]).toBe("X");
    expect(eventFromDraft(x, "dev").status).toBe("destroyed");
    const dmg = parseMeldung("H04 gn Kpz beschädigt", ctx());
    expect(dmg.sidc[3]).toBe("D");
    // Grafiken kennen den Status nicht: bleibt P, Sinn sagt es
    const s = parseMeldung("H05 Sperre zerstört", ctx());
    expect(s.sidc[3]).toBe("P");
    expect(s.desc).toBe("zerstörte Sperre");
  });
});

describe("Katalog-Korrekturen", () => {
  it("Stacheldraht nicht mehr «bewegliche Tetraeder», Bereitstellungsraum nicht «Start Point»", () => {
    expect(catalogEntry("stacheldraht")!.sidc).not.toContain("OAOP");
    expect(catalogEntry("sammelraum")!.sidc).not.toContain("GPPS");
    expect(catalogEntry("stacheldraht")!.tag).toBe("Draht");
    expect(catalogEntry("sammelraum")!.tag).toBe("BR");
  });
  it("Kurzbeschriftung wird von milsymbol im Zeichen gezeigt", () => {
    for (const e of CATALOG.filter((x) => x.tag && x.sidc.startsWith("G?GPGPP"))) {
      const svg = new ms.Symbol(buildSidc(e, "H"), { size: 30, uniqueDesignation: e.tag }).asSVG();
      expect(svg, e.key).toContain(e.tag);
    }
  });
  it("mun_lager heisst wie in alten Übungen", () => {
    expect(catalogEntry("mun_lager")!.name).toBe("Übergabe / Munitionslager");
    expect(readTactical("Übergabe / Munitionslager")!.key).toBe("mun_lager");
  });
  it("verborgene Einträge sind gekennzeichnet und nie in der Suche", () => {
    expect(catalogEntry("inf_gr")!.hidden).toBe(true);
    for (const q of ["Inf Gruppe", "inf", "", "Gruppe", "gr inf"]) {
      expect(searchTactical(q).entries.some((e) => e.hidden), q).toBe(false);
    }
  });
});

describe("Zeichen-Suche mit Stufe (searchTactical)", () => {
  it.each([
    ["hz inf", "inf", { echelon: "hz" }],
    ["1 gn hz inf", "inf", { echelon: "hz", aff: "H" }],
    ["Halbzug", "inf", { echelon: "hz" }],
    ["hz", "inf", { echelon: "hz" }],
    ["Zug", "inf", { echelon: "zug" }],
    ["gn Zug Pz Gren", "pz_gren", { echelon: "zug", aff: "H" }],
    ["vermutete IED", "ied", { status: "anticipated" }],
    ["mögliche Minen", "minensperre", { status: "anticipated" }],
    ["Spz Zug", "pz_gren", { echelon: "zug" }],
    ["Kp Gfs", "kdo_po", { echelon: "kp" }],
    ["Infanteriezug", "inf", { echelon: "zug" }],
    ["eig Gr Inf", "inf", { echelon: "gr", aff: "F" }],
    ["neutral Polizei", "polizei", { aff: "N" }],
    ["zerstörter Kpz", "kpz", { status: "destroyed" }],
    ["Stgw", "stgw", {}],
    ["Log Pt", "log_pt", {}],
    ["Kolonne", "kolonne", {}],
  ])("%s", (q, first, more) => {
    const r = searchTactical(q);
    expect(r.entries[0]?.key, q).toBe(first);
    for (const [k, v] of Object.entries(more)) expect(r[k as keyof typeof r], k).toBe(v);
  });
  it("mit Stufe nur Zeichen, die eine Stufe haben; Kampftruppen zuerst", () => {
    const r = searchTactical("Halbzug");
    expect(r.entries.length).toBeGreaterThan(10);
    expect(r.entries.every((e) => e.echelonable)).toBe(true);
    expect(r.entries[0]!.category).toBe("Kampftruppen");
  });
});

describe("Sinn ausschreiben (describeTactical, auch für die Auswahl)", () => {
  it.each([
    [{ key: "inf", echelon: "hz", count: 1 }, "H", "1 gegnerischer Halbzug Infanterie"],
    [{ key: "kpz", count: 2, status: "destroyed" }, "H", "2 zerstörte gegnerische Kampfpanzer"],
    [{ key: "ied", status: "anticipated" }, "H", "vermutete gegnerische IED"],
    [{ key: "ied", status: "anticipated" }, null, "vermutete IED"],
    [{ key: "ekf" }, "H", "gegnerische elektronische Kriegsführung"],
    [{ key: "ekf" }, null, "Elektronische Kriegsführung"],
    [{ key: "verletzte", count: 1, word: "verletzter" }, null, "1 Verletzter"],
    [{ key: "verletzte", count: 3, word: "toter" }, null, "3 Tote"],
    [{ key: "kolonne", count: 5, of: "fz" }, "H", "5 gegnerische Fahrzeuge (Kolonne)"],
    [{ key: "kdo_po", echelon: "bat" }, "H", "gegnerischer Kommandoposten (Bataillon)"],
    [{ key: "patrouille", count: 3, persons: 3 }, "H", "gegnerische Patrouille (3 Personen)"],
    [{ key: "einheit", echelon: "zug", action: "Angriff" }, "H", "gegnerischer Zug (Angriff)"],
    [{ key: "inf_trp", count: 1, word: "sdt" }, "H", "1 gegnerischer Soldat"],
  ] as const)("%j", (r, aff, want) => {
    expect(describeTactical(r as Parameters<typeof describeTactical>[0], aff)).toBe(want);
  });
});
