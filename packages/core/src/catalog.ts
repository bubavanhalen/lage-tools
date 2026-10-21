/**
 * Zeichenkatalog nach Reglement «Taktische Zeichen» (angelehnt an APP-6 / MIL-STD-2525C).
 * Buchstaben-SIDC mit 15 Stellen, wie ihn milsymbol rendert.
 *
 * SIDC-Vorlage: Stelle 2 = «?» (Zugehörigkeit), Stelle 4 = «P» (wird durch den Status ersetzt: «A» = vermutet,
 * gestrichelt), Stellen 11–12 = «--» (werden bei Einheiten durch die Stufe ersetzt; Stelle 11 «A» = Stab/KP bleibt).
 * Wo 2525C kein Punktzeichen kennt (Strassensperre, Hinterhalt, indirektes Feuer), wird das APP-6-Punktzeichen
 * verwendet, das milsymbol ebenfalls kennt (G?O…).
 *
 * Dazu die Erkennung der Armee-Sprache in Meldungen: `readTactical("1 gn hz inf")` → Infanterie, Halbzug, 1, Feind,
 * «1 gegnerischer Halbzug Infanterie». Keine Laufzeit-Abhängigkeiten.
 */
import type { Affiliation } from "./symbols";

export type CatalogKind = "einheit" | "geraet" | "anlage" | "taetigkeit" | "ereignis" | "grafik";
export type Placement = "strasse" | "frei";
/** Stufe (Schweizer Armee) */
export type Echelon = "trp" | "gr" | "hz" | "zug" | "kp" | "bat" | "rgt" | "br" | "div";
export type Status = "present" | "anticipated";
/** grammatisches Geschlecht des Nomens (p = nur Mehrzahl, z. B. «Panzergrenadiere») */
export type Genus = "m" | "f" | "n" | "p";
/** typische Einordnung, wenn der Text nichts sagt: feind = Sichtung, eigen = eigene Lage (mit Melder), unklar */
export type Lean = "feind" | "eigen" | "unklar";

export interface CatalogEntry {
  key: string;
  /** Anzeigename Deutsch, z. B. «Infanterie», «Kampfpanzer», «IED» */
  name: string;
  /** Kategorie für die Auswahl, z. B. «Kampftruppen», «Fahrzeuge», «Hindernisse» (siehe `CATEGORIES`) */
  category: string;
  /** SIDC-Vorlage (siehe oben) */
  sidc: string;
  /** Suchbegriffe / Armee-Kürzel (klein, ohne Punkte), z. B. ["inf", "infanterie"] */
  aliases: string[];
  kind: CatalogKind;
  /** wo das Zeichen im Gelände liegt: «strasse» = auf die wahrscheinlichste Strasse legen (Sperre, Checkpoint, IED …) */
  placement?: Placement;
  /** Stufe möglich (nur Einheiten) */
  echelonable?: boolean;
  /** Stufe, die das Zeichen ohne Angabe hat (z. B. «Inf Gruppe») */
  echelon?: Echelon;
  /** eigene Zeichnung statt milsymbol (z. B. Dreieck Beob Posten) */
  triangle?: boolean;
  /** Tätigkeit/Ereignis am Ort (nicht das Element selbst) */
  activity?: boolean;
  /** Nomen für den ausgeschriebenen Sinn (sonst `name`), z. B. «Schützenpanzer» */
  noun?: string;
  /** Geschlecht von `noun` (Standard m) */
  g?: Genus;
  /** Mehrzahl von `noun` (Standard = `noun`) */
  pl?: string;
  /** Dativ Mehrzahl nach «mit», z. B. «Unfall mit Verletzten» */
  dat?: string;
  /** typische Einordnung (siehe `Lean`) */
  lean?: Lean;
  /** passendes Gerät zur Einheit (bei Anzahl ohne Stufe: «3 Mw» = 3 Minenwerfer) */
  geraet?: string;
  /** passende Einheit zum Gerät (bei Stufe: «Mw Zug») */
  unit?: string;
  /** Rang bei mehreren Treffern in einer Meldung (höher gewinnt); Standard je nach Art */
  prio?: number;
  /** nicht in der Auswahl zeigen (alte Schlüssel, die es für gespeicherte Übungen weiter braucht) */
  hidden?: boolean;
}

export const ECHELONS: Array<{ key: Echelon; name: string; code: string; aliases: string[]; g: Genus; pl: string }> = [
  { key: "trp", name: "Trupp", code: "A", aliases: ["trp", "trupp"], g: "m", pl: "Trupps" },
  { key: "gr", name: "Gruppe", code: "B", aliases: ["gr", "gruppe"], g: "f", pl: "Gruppen" },
  { key: "hz", name: "Halbzug", code: "C", aliases: ["hz", "halbzug"], g: "m", pl: "Halbzüge" },
  { key: "zug", name: "Zug", code: "D", aliases: ["zug", "z"], g: "m", pl: "Züge" },
  { key: "kp", name: "Kompanie", code: "E", aliases: ["kp", "kompanie", "bttr", "batterie", "st", "staffel"], g: "f", pl: "Kompanien" },
  { key: "bat", name: "Bataillon", code: "F", aliases: ["bat", "bataillon", "abt", "abteilung"], g: "n", pl: "Bataillone" },
  { key: "rgt", name: "Regiment", code: "G", aliases: ["rgt", "regiment"], g: "n", pl: "Regimenter" },
  { key: "br", name: "Brigade", code: "H", aliases: ["br", "brigade", "brig"], g: "f", pl: "Brigaden" },
  { key: "div", name: "Division", code: "I", aliases: ["div", "division"], g: "f", pl: "Divisionen" },
];

/** Kategorien in der Reihenfolge der Auswahl */
export const CATEGORIES = [
  "Kampftruppen",
  "Unterstützung",
  "Führung und Logistik",
  "Zivile und Irreguläre",
  "Fahrzeuge",
  "Waffen",
  "Luftfahrzeuge",
  "Anlagen und Orte",
  "Hindernisse",
  "Tätigkeiten",
  "Ereignisse",
  "Allgemein",
] as const;

type Extra = Partial<Omit<CatalogEntry, "key" | "name" | "category" | "sidc" | "aliases" | "kind">>;
const E = (key: string, name: string, category: (typeof CATEGORIES)[number], sidc: string, aliases: string[], kind: CatalogKind, x: Extra = {}): CatalogEntry =>
  ({ key, name, category, sidc, aliases, kind, ...x });

const UNIT: Extra = { echelonable: true, lean: "feind" };
const DEV: Extra = { lean: "feind" };
const OBST: Extra = { lean: "feind", activity: true, placement: "strasse", g: "f" };
const ACT: Extra = { lean: "feind", activity: true };
const EVT: Extra = { activity: true };
const SITE: Extra = { activity: true };

export const CATALOG: CatalogEntry[] = [
  // ---------- Kampftruppen
  E("inf", "Infanterie", "Kampftruppen", "S?GPUCI--------", ["inf", "infanterie", "füs", "füsiliere", "füsilier", "schützen"], "einheit", { ...UNIT, g: "f" }),
  E("pz_gren", "Panzergrenadiere (Inf mech)", "Kampftruppen", "S?GPUCIZ-------", ["pz gren", "panzergrenadiere", "panzergrenadier", "mech inf", "inf mech", "infanterie mechanisiert", "mechanisierte infanterie", "mech"], "einheit", { ...UNIT, noun: "Panzergrenadiere", g: "p", geraet: "spz" }),
  E("pz", "Panzer", "Kampftruppen", "S?GPUCA--------", ["pz", "panzer", "panzertruppen", "pz trp"], "einheit", { ...UNIT, g: "p", geraet: "kpz" }),
  E("pzj", "Panzerjäger / Panzerabwehr", "Kampftruppen", "S?GPUCAA-------", ["pzj", "panzerjäger", "pz jäger", "panzerabwehr", "pz abw"], "einheit", { ...UNIT, noun: "Panzerjäger", g: "p", geraet: "pzaw" }),
  E("aufkl", "Aufklärung", "Kampftruppen", "S?GPUCR--------", ["aufkl", "aufklärung", "aufklärer", "aufkl trp", "aufklärungstruppen"], "einheit", { ...UNIT, g: "f", geraet: "aufkl_fz" }),
  E("geb", "Gebirgstruppen", "Kampftruppen", "S?GPUCIO-------", ["geb", "gebirgstruppen", "gebirgsinfanterie", "geb inf", "gebirgsspezialisten", "geb spez"], "einheit", { ...UNIT, noun: "Gebirgsinfanterie", g: "f" }),
  E("fsch", "Fallschirmtruppen", "Kampftruppen", "S?GPUCIA-------", ["fsch", "fallschirm", "fallschirmjäger", "fallschirmaufklärer", "fsch aufkl", "luftlande", "luftlandetruppen"], "einheit", { ...UNIT, noun: "Fallschirmtruppen", g: "p" }),
  E("spez", "Spezialkräfte / Grenadiere", "Kampftruppen", "S?FPG----------", ["spez", "spezialkräfte", "spez kr", "sof", "kommando", "ksk", "gren", "grenadiere", "grenadier"], "einheit", { ...UNIT, noun: "Spezialkräfte", g: "p" }),
  E("scharfschuetze", "Scharfschütze", "Kampftruppen", "O?VPS----------", ["schaf", "scharfschütze", "scharfschützen", "sniper", "heckenschütze"], "einheit", { lean: "feind", pl: "Scharfschützen" }),
  E("inf_trp", "Personen / Inf Trupp", "Kampftruppen", "S?GPUCI--------", ["personen", "person", "pers", "soldaten", "soldat", "sdt", "mann", "angehörige", "zu fuss", "fussgänger", "bewaffnete"], "einheit", { ...UNIT, echelon: "trp", noun: "Personen", g: "p", prio: 1 }),
  E("inf_gr", "Inf Gruppe", "Kampftruppen", "S?GPUCI--------", [], "einheit", { ...UNIT, echelon: "gr", noun: "Infanterie", g: "f", prio: 1, hidden: true }),

  // ---------- Unterstützung
  E("art", "Artillerie", "Unterstützung", "S?GPUCF--------", ["art", "artillerie", "art abt"], "einheit", { ...UNIT, g: "f", geraet: "pz_hb" }),
  E("art_pz", "Panzerartillerie", "Unterstützung", "S?GPUCFHE------", ["pz art", "panzerartillerie", "pz hb abt", "pz hb bttr"], "einheit", { ...UNIT, g: "f", geraet: "pz_hb" }),
  E("rak_art", "Raketenartillerie", "Unterstützung", "S?GPUCFRMS-----", ["rak art", "raketenartillerie", "rak"], "einheit", { ...UNIT, g: "f", geraet: "rak_werfer" }),
  E("mw", "Minenwerfer", "Unterstützung", "S?GPUCFM-------", ["mw", "minenwerfer", "mw z", "mörser"], "einheit", { ...UNIT, geraet: "mw_geraet" }),
  E("genie", "Genie / Pioniere", "Unterstützung", "S?GPUCE--------", ["g", "gen", "genie", "g trp", "genietruppen", "sap", "sappeure", "sappeur", "pioniere", "pionier", "pz sap", "panzersappeure"], "einheit", { ...UNIT, noun: "Genie", g: "f", geraet: "bagger" }),
  E("rettung", "Rettung / Katastrophenhilfe", "Unterstützung", "E?OPBC---------", ["rttg", "rettung", "rettungstruppen", "katastrophenhilfe", "kata hi", "katastrophenhilfe bereitschaft", "rttg trp"], "einheit", { ...UNIT, lean: undefined, noun: "Rettungstruppen", g: "p" }),
  E("abc", "ABC-Abwehr", "Unterstützung", "S?GPUUA--------", ["abc", "abc abw", "abc abwehr", "abc trp", "atomar", "chemie abwehr"], "einheit", { ...UNIT, g: "f" }),
  E("flab", "Fliegerabwehr", "Unterstützung", "S?GPUCD--------", ["flab", "fliegerabwehr", "m flab", "l flab", "luftverteidigung", "bodluv"], "einheit", { ...UNIT, g: "f", geraet: "flab_kan" }),
  E("heli_einheit", "Lufttransport (Helikopter)", "Unterstützung", "S?GPUCVRU------", ["lufttransport", "lufttransportstaffel", "lt st", "heli st", "helikopterstaffel"], "einheit", { ...UNIT, noun: "Lufttransport", geraet: "heli" }),
  E("uav_einheit", "Drohnen (UAV-Einheit)", "Unterstützung", "S?GPUCVU-------", ["drohnenstaffel", "drohnen einheit", "uav einheit", "ads st", "drohnen trp"], "einheit", { ...UNIT, noun: "Drohneneinheit", g: "f", geraet: "drohne" }),

  // ---------- Führung und Logistik
  E("hq", "Stab / Kommando", "Führung und Logistik", "S?GPU-----A----", ["stab", "kdo", "kommandoelement", "hq", "stabskp", "stab kp", "führungsstaffel", "fhr st"], "einheit", { ...UNIT, noun: "Stab" }),
  E("fu", "Führungsunterstützung / Übermittlung", "Führung und Logistik", "S?GPUUS--------", ["fu", "fu trp", "uem", "übermittlung", "übermittler", "führungsunterstützung", "fhr ustü", "funk trp", "tg"], "einheit", { ...UNIT, noun: "Führungsunterstützung", g: "f" }),
  E("ekf", "Elektronische Kriegsführung", "Führung und Logistik", "S?GPUUMSE------", ["ekf", "el kf", "elektronische kriegsführung", "ew", "funkaufklärung", "störer", "störsender"], "einheit", { ...UNIT, g: "f" }),
  E("san", "Sanität", "Führung und Logistik", "S?GPUSM--------", ["san", "sanität", "sanitäter", "san trp", "sanitätstruppen", "sanitätsdienst"], "einheit", { ...UNIT, lean: undefined, g: "f" }),
  E("log", "Logistik", "Führung und Logistik", "S?GPUS---------", ["log", "logistik", "log trp", "logistiktruppen"], "einheit", { ...UNIT, g: "f" }),
  E("vsg", "Versorgung", "Führung und Logistik", "S?GPUSS--------", ["vsg", "versorgung", "nachschub", "vsg trp", "verpflegung"], "einheit", { ...UNIT, g: "f" }),
  E("ih", "Instandhaltung", "Führung und Logistik", "S?GPUSX--------", ["ih", "instandhaltung", "unterhalt", "reparatur", "reparaturtrupp", "bergung"], "einheit", { ...UNIT, g: "f" }),
  E("trsp", "Transport", "Führung und Logistik", "S?GPUST--------", ["trsp", "transport", "transporttruppen", "trsp trp"], "einheit", { ...UNIT }),
  E("mp", "Militärpolizei", "Führung und Logistik", "S?GPUULM-------", ["mp", "mil pol", "militärpolizei", "mil sich"], "einheit", { ...UNIT, lean: undefined, g: "f" }),

  // ---------- Zivile und Irreguläre
  E("polizei", "Polizei", "Zivile und Irreguläre", "S?GPUULC-------", ["polizei", "pol", "kapo", "kantonspolizei", "stapo", "polizisten"], "einheit", { ...UNIT, lean: "unklar", g: "f" }),
  E("zivilschutz", "Zivilschutz", "Zivile und Irreguläre", "E?OPBJ---------", ["zivilschutz", "zs", "zso", "bevölkerungsschutz"], "einheit", { ...UNIT, lean: "unklar" }),
  E("feuerwehr", "Feuerwehr", "Zivile und Irreguläre", "E?OPCE---------", ["feuerwehr", "fw", "pompiers"], "einheit", { ...UNIT, lean: "unklar", g: "f" }),
  E("zivil", "Zivile Person", "Zivile und Irreguläre", "O?PP-----------", ["zivilist", "zivilisten", "zivilperson", "zivile", "ziv", "passant", "passanten", "spaziergänger", "jogger", "bauer"], "einheit", { lean: "unklar", noun: "Zivilperson", g: "f", pl: "Zivilpersonen" }),
  E("menge", "Menschenmenge", "Zivile und Irreguläre", "E?IPA----------", ["menschenmenge", "menge", "ansammlung", "menschenansammlung", "schaulustige", "mob"], "einheit", { lean: "unklar", g: "f", pl: "Menschenmengen" }),
  E("fluechtlinge", "Flüchtlinge", "Zivile und Irreguläre", "O?GPA----------", ["flüchtlinge", "flüchtling", "vertriebene", "evakuierte", "flüchtlingsstrom", "migranten"], "einheit", { lean: "unklar", g: "p" }),
  E("irregulaer", "Irreguläre Kräfte / Bewaffnete", "Zivile und Irreguläre", "O?GP-----------", ["irreguläre", "irreguläre kräfte", "miliz", "milizen", "freischärler", "aufständische", "rebellen", "partisanen", "bewaffnete gruppe", "kämpfer", "insurgenten"], "einheit", { lean: "feind", noun: "irreguläre Kräfte", g: "p" }),

  // ---------- Fahrzeuge
  E("kpz", "Kampfpanzer", "Fahrzeuge", "S?GPEVATH--MQ--", ["kpz", "kampfpanzer", "pz 87", "leopard", "leo", "t 72", "t72", "tank"], "geraet", { ...DEV, unit: "pz", prio: 4 }),
  E("spz", "Schützenpanzer (Raupe)", "Fahrzeuge", "S?GPEVAI---MQ--", ["spz", "schützenpanzer", "spz 2000", "cv90", "bmp", "raupen spz"], "geraet", { ...DEV, noun: "Schützenpanzer", unit: "pz_gren", prio: 4 }),
  E("spz_rad", "Schützenpanzer (Rad)", "Fahrzeuge", "S?GPEVAI---MP--", ["spz rad", "rad spz", "radschützenpanzer", "piranha", "btr"], "geraet", { ...DEV, noun: "Radschützenpanzer", unit: "pz_gren", prio: 4 }),
  E("mtw", "Mannschaftstransportwagen", "Fahrzeuge", "S?GPEVAA-------", ["mtw", "mannschaftstransportwagen", "m113", "gmtf", "pz mtw", "schützenpanzerwagen"], "geraet", { ...DEV, unit: "pz_gren", prio: 4 }),
  E("aufkl_fz", "Aufklärungsfahrzeug", "Fahrzeuge", "S?GPUCRVA------", ["aufkl fz", "aufklärungsfahrzeug", "eagle", "spähpanzer", "aufkl pz"], "geraet", { ...DEV, noun: "Aufklärungsfahrzeug", g: "n", pl: "Aufklärungsfahrzeuge", unit: "aufkl", prio: 4 }),
  E("gw", "Geländewagen", "Fahrzeuge", "S?GPEVCJ-------", ["gw", "geländewagen", "gelände pw", "jeep", "pinzgauer", "mowag", "pickup", "pick up"], "geraet", { ...DEV, prio: 4 }),
  E("fz", "Fahrzeug (allg.)", "Fahrzeuge", "S?GPEVU--------", ["fahrzeug", "fz", "pw", "auto", "personenwagen", "g klasse", "g wagen", "puch", "wagen"], "geraet", { ...DEV, noun: "Fahrzeug", g: "n", pl: "Fahrzeuge", prio: 3 }),
  E("ziv_fz", "Ziviles Fahrzeug", "Fahrzeuge", "S?GPEVCA-------", ["ziv fz", "zivilfahrzeug", "privatauto", "privat pw", "ziviles fahrzeug", "zivil pw"], "geraet", { lean: "unklar", noun: "ziviles Fahrzeug", g: "n", pl: "zivile Fahrzeuge", prio: 4 }),
  E("lw", "Lastwagen", "Fahrzeuge", "S?GPEVUL-------", ["lastwagen", "lkw", "lw", "duro", "camion", "lastw", "laster"], "geraet", { ...DEV, prio: 4 }),
  E("motorrad", "Motorrad", "Fahrzeuge", "S?GPEVCAL------", ["motorrad", "motorräder", "töff", "mrd", "quad", "motorradfahrer"], "geraet", { ...DEV, g: "n", pl: "Motorräder", prio: 4 }),
  E("bus", "Bus / Car", "Fahrzeuge", "S?GPEVUB-------", ["bus", "car", "reisecar", "kleinbus"], "geraet", { ...DEV, noun: "Bus", pl: "Busse", prio: 4 }),
  E("san_fz", "Sanitätsfahrzeug", "Fahrzeuge", "S?GPEVUA-------", ["san fz", "sanitätsfahrzeug", "ambulanz", "krankenwagen", "san pw", "rettungswagen", "sanitätspanzer"], "geraet", { noun: "Sanitätsfahrzeug", g: "n", pl: "Sanitätsfahrzeuge", prio: 4 }),
  E("bagger", "Bagger / Genie-Gerät", "Fahrzeuge", "S?GPEVEE-------", ["bagger", "genie fz", "geniegerät", "schaufellader", "pz bagger", "baumaschine"], "geraet", { ...DEV, noun: "Bagger", unit: "genie", prio: 4 }),
  E("dozer", "Dozer / Planierraupe", "Fahrzeuge", "S?GPEVED-------", ["dozer", "bulldozer", "planierraupe", "pz dozer"], "geraet", { ...DEV, noun: "Dozer", unit: "genie", prio: 4 }),
  E("brueckenleger", "Brückenlegepanzer", "Fahrzeuge", "S?GPEVEB-------", ["brü pz", "brückenlegepanzer", "brückenleger", "brlpz", "brü lpz", "brückenpanzer"], "geraet", { ...DEV, unit: "genie", prio: 4 }),
  E("pz_hb", "Panzerhaubitze", "Fahrzeuge", "S?GPEWHMS------", ["pz hb", "panzerhaubitze", "m109", "hb", "haubitze", "geschütz"], "geraet", { ...DEV, g: "f", pl: "Panzerhaubitzen", unit: "art_pz", prio: 4 }),

  // ---------- Waffen
  E("mw_geraet", "Minenwerfer (Waffe)", "Waffen", "S?GPEWOM-------", ["mw rohr", "mw geschütz", "8 1 cm mw", "12 cm mw", "granatwerfer"], "geraet", { ...DEV, noun: "Minenwerfer", unit: "mw", prio: 4 }),
  E("rak_werfer", "Raketenwerfer", "Waffen", "S?GPEWXM-------", ["raketenwerfer", "mehrfachraketenwerfer", "mlrs", "rak werfer", "grad"], "geraet", { ...DEV, unit: "rak_art", prio: 4 }),
  E("mg", "Maschinengewehr", "Waffen", "S?GPEWRL-------", ["mg", "maschinengewehr", "lmg", "mg 51", "mg stel"], "geraet", { ...DEV, g: "n", pl: "Maschinengewehre", prio: 4 }),
  E("smg", "Schweres Maschinengewehr", "Waffen", "S?GPEWRH-------", ["smg", "schweres mg", "schweres maschinengewehr", "mg 64", "12 7 mm mg", "überschweres mg"], "geraet", { ...DEV, noun: "schweres Maschinengewehr", g: "n", pl: "schwere Maschinengewehre", prio: 4 }),
  E("pzaw", "Panzerabwehrlenkwaffe", "Waffen", "S?GPEWMTL------", ["pzaw", "pzaw lwf", "panzerabwehrlenkwaffe", "panzerabwehrwaffe", "lenkwaffe", "tow", "atgm", "spike"], "geraet", { ...DEV, g: "f", pl: "Panzerabwehrlenkwaffen", unit: "pzj", prio: 4 }),
  E("panzerfaust", "Panzerfaust", "Waffen", "S?GPEWTL-------", ["pzf", "panzerfaust", "pz faust", "rpg", "nlaw", "rakrohr", "raketenrohr"], "geraet", { ...DEV, g: "f", pl: "Panzerfäuste", prio: 4 }),
  E("schaf_gewehr", "Scharfschützengewehr", "Waffen", "S?GPEWRR-------", ["schaf gew", "scharfschützengewehr", "ssg", "präzisionsgewehr", "gewehr"], "geraet", { ...DEV, g: "n", pl: "Scharfschützengewehre", prio: 4 }),
  E("flab_kan", "Flab-Kanone", "Waffen", "S?GPEWAM-------", ["flab kan", "flabkanone", "flab kanone", "35 mm flab", "m flab kan", "fliegerabwehrkanone"], "geraet", { ...DEV, g: "f", pl: "Flab-Kanonen", unit: "flab", prio: 4 }),
  E("flab_lwf", "Flab-Lenkwaffe", "Waffen", "S?GPEWMAS------", ["flab lwf", "flablenkwaffe", "flab lenkwaffe", "stinger", "rapier", "manpads", "fl lwf"], "geraet", { ...DEV, g: "f", pl: "Flab-Lenkwaffen", unit: "flab", prio: 4 }),

  // ---------- Luftfahrzeuge
  E("heli", "Helikopter", "Luftfahrzeuge", "S?APMH---------", ["heli", "helikopter", "hubschrauber", "super puma", "cougar", "ec635", "ec 635"], "geraet", { ...DEV, unit: "heli_einheit", prio: 4 }),
  E("drohne", "Drohne", "Luftfahrzeuge", "S?APMFQ--------", ["drohne", "uav", "quadrocopter", "quadkopter", "multikopter", "fpv", "ads 15"], "geraet", { ...DEV, g: "f", pl: "Drohnen", unit: "uav_einheit", prio: 4 }),
  E("flugzeug", "Flugzeug / Kampfjet", "Luftfahrzeuge", "S?APMF---------", ["flugzeug", "kampfjet", "kampfflugzeug", "jet", "fa 18", "f 35"], "geraet", { ...DEV, noun: "Flugzeug", g: "n", pl: "Flugzeuge", prio: 4 }),

  // ---------- Anlagen und Orte
  E("kdo_po", "Kommandoposten", "Anlagen und Orte", "S?GPU-----A----", ["kdo po", "kommandoposten", "gefechtsstand", "kp stao", "führungsstandort", "cp kdo"], "anlage", { ...SITE, echelonable: true, pl: "Kommandoposten" }),
  E("beob_aufkl", "Beob Posten / Späher", "Anlagen und Orte", "G?GPDPOR--****X", ["beob po", "beo po", "beobachtungsposten", "beob stao", "beo stao", "beob", "beo", "späher", "spähtrupp", "späher trp", "beobachter"], "anlage", { triangle: true, noun: "Beobachtungsposten", pl: "Beobachtungsposten" }),
  E("stellung", "Stellung", "Anlagen und Orte", "G?MPSE----****X", ["stellung", "stel", "feldbefestigung", "schützenloch", "kampfstellung", "verteidigungsstellung", "stellungsraum"], "anlage", { ...SITE, g: "f", pl: "Stellungen", prio: 1 }),
  E("kontrollposten", "Checkpoint / Kontrollposten", "Anlagen und Orte", "G?GPGPPK--****X", ["checkpoint", "kontrollposten", "kontrollpunkt", "cp", "ckp", "kontr po", "chp", "check point"], "anlage", { ...SITE, lean: "feind", placement: "strasse", noun: "Checkpoint", pl: "Checkpoints", prio: 3 }),
  E("verkehrsposten", "Verkehrsposten", "Anlagen und Orte", "G?SPPO----****X", ["verkehrsposten", "verkehrskontrolle", "verkehrsregelung", "tcp", "vrk po", "verkehrsregler"], "anlage", { ...SITE, placement: "strasse", pl: "Verkehrsposten", prio: 3 }),
  E("lager", "Lager / Depot", "Anlagen und Orte", "G?SPPSZ---****X", ["lager", "depot", "materiallager", "mat lager", "magazin", "vsg pl", "versorgungsplatz"], "anlage", { ...SITE, noun: "Lager", g: "n" }),
  E("mun_lager", "Munitionslager", "Anlagen und Orte", "G?SPPAS---****X", ["munitionslager", "mun lager", "munition", "mun", "mun dep", "mun pl", "munitionsdepot"], "anlage", { ...SITE, g: "n", prio: 3 }),
  E("treibstoff", "Treibstoff", "Anlagen und Orte", "G?SPPSC---****X", ["treibstoff", "betriebsstoff", "tankstelle", "treibstofflager", "diesel", "bst pl", "benzin"], "anlage", { ...SITE, noun: "Treibstofflager", g: "n" }),
  E("san_hist", "Sanitätshilfsstelle / Spital", "Anlagen und Orte", "S?GPIXH--------", ["san hist", "sanitätshilfsstelle", "spital", "lazarett", "san po", "sanitätsposten", "mil spital", "notfallstation"], "anlage", { ...SITE, noun: "Sanitätshilfsstelle", g: "f", pl: "Sanitätshilfsstellen" }),
  E("verwundetennest", "Verwundetennest", "Anlagen und Orte", "G?SPPY----****X", ["verwundetennest", "vw nest", "verw nest", "patientensammelstelle", "verwundetensammelstelle"], "anlage", { ...SITE, g: "n" }),
  E("landeplatz", "Landeplatz", "Anlagen und Orte", "E?FPLF---------", ["landeplatz", "lz", "heli landeplatz", "helikopterlandeplatz", "landezone", "lde pl"], "anlage", { ...SITE, pl: "Landeplätze" }),
  E("bruecke", "Brücke", "Anlagen und Orte", "S?GPIMNB-------", ["brücke", "brücken", "übergang", "steg", "viadukt"], "anlage", { ...SITE, g: "f", pl: "Brücken", prio: 1 }),
  E("sammelplatz", "Sammelplatz", "Anlagen und Orte", "G?GPGPPR--****X", ["sammelplatz", "sammel pl", "sammelpunkt", "smpl", "treffpunkt", "sammelort"], "anlage", { ...SITE }),
  E("sammelraum", "Bereitstellungsraum / Sammelraum", "Anlagen und Orte", "G?GPGPPS--****X", ["bereitstellungsraum", "bereitstellung", "ber raum", "bereitschaftsraum", "sammelraum", "warteraum"], "anlage", { ...SITE, noun: "Bereitstellungsraum", pl: "Bereitstellungsräume" }),

  // ---------- Hindernisse
  E("sperre", "Sperre (allg.)", "Hindernisse", "G?MPOAOM--****X", ["sperre", "hindernis", "spr", "barrikade", "absperrung", "gesperrt"], "grafik", { ...OBST, noun: "Sperre", pl: "Sperren" }),
  E("strassensperre", "Strassensperre", "Hindernisse", "G?OPPR----****X", ["strassensperre", "str sperre", "strassenblockade", "strassenblockierung", "roadblock", "road block"], "grafik", { ...OBST, pl: "Strassensperren" }),
  E("panzersperre", "Panzersperre", "Hindernisse", "G?MPOAOF--****X", ["panzersperre", "pz sperre", "höcker", "panzerhindernis", "pz hindernis", "tankfalle", "panzergraben"], "grafik", { ...OBST, pl: "Panzersperren" }),
  E("minensperre", "Minensperre / Minenfeld", "Hindernisse", "G?MPOFS---****X", ["minensperre", "minenfeld", "min sperre", "mi sperre", "minen", "verminung", "vermint"], "grafik", { ...OBST, noun: "Minensperre", pl: "Minensperren" }),
  E("mine", "Einzelmine", "Hindernisse", "G?MPOMU---****X", ["mine", "einzelmine", "landmine"], "grafik", { ...OBST, placement: "frei", noun: "Mine", pl: "Minen" }),
  E("pz_mine", "Panzermine", "Hindernisse", "G?MPOMT---****X", ["pz mine", "panzermine", "at mine"], "grafik", { ...OBST, placement: "frei", pl: "Panzerminen" }),
  E("pers_mine", "Personenmine", "Hindernisse", "G?MPOMP---****X", ["pers mine", "personenmine", "ap mine", "springmine"], "grafik", { ...OBST, placement: "frei", pl: "Personenminen" }),
  E("sprengobjekt", "Sprengobjekt (vorbereitete Sprengung)", "Hindernisse", "O?VPB----------", ["sprengobjekt", "spr obj", "vorbereitete sprengung", "sprengladung", "sprengsatz geladen", "geladene brücke"], "grafik", { ...OBST, noun: "Sprengobjekt", g: "n", pl: "Sprengobjekte" }),
  E("stacheldraht", "Stacheldraht / Drahthindernis", "Hindernisse", "G?MPOAOP--****X", ["stacheldraht", "draht", "drahthindernis", "drahtsperre", "nato draht", "concertina", "s draht"], "grafik", { ...OBST, placement: "frei", noun: "Drahthindernis", g: "n", pl: "Drahthindernisse" }),
  E("ied", "IED (Sprengfalle)", "Hindernisse", "S?GPEXI--------", ["ied", "ueid", "sprengsatz", "improvisierter sprengsatz", "usbv", "rohrbombe", "bombe"], "grafik", { ...OBST, noun: "IED", pl: "IEDs" }),
  E("vbied", "Fahrzeug-IED (VBIED)", "Hindernisse", "S?GPEXI---MO---", ["vbied", "fahrzeug ied", "autobombe", "fz ied", "fahrzeugbombe"], "grafik", { ...OBST, noun: "Fahrzeug-IED", pl: "Fahrzeug-IEDs", prio: 5 }),
  E("sprengfalle", "Sprengfalle", "Hindernisse", "G?MPOB----****X", ["sprengfalle", "booby trap", "stolperdraht", "stolperfalle"], "grafik", { ...OBST, placement: "frei", pl: "Sprengfallen" }),

  // ---------- Tätigkeiten
  E("patrouille", "Patrouille", "Tätigkeiten", "G?OPPT----****X", ["patrouille", "patr", "streife", "patrouillieren", "patrouilliert"], "taetigkeit", { lean: "feind", g: "f", pl: "Patrouillen", prio: 3 }),
  E("hinterhalt", "Hinterhalt", "Tätigkeiten", "G?OPVU----****X", ["hinterhalt", "überfall", "hinterhalte", "auflauern"], "taetigkeit", { ...ACT, placement: "strasse", pl: "Hinterhalte" }),
  E("kontakt", "Kontakt / Feuerkontakt", "Tätigkeiten", "E?IPBF---------", ["kontakt", "feuerkontakt", "feuergefecht", "gefecht", "schusswechsel", "schüsse", "schiesserei", "beschossen", "entdeckt", "feuer eröffnet"], "taetigkeit", { ...ACT, noun: "Kontakt" }),
  E("beschuss", "Beschuss / Einschlag", "Tätigkeiten", "G?OPVI----****X", ["beschuss", "einschlag", "einschläge", "art feuer", "mw feuer", "granateinschlag", "steilfeuer", "indirektes feuer", "artilleriefeuer"], "taetigkeit", { ...ACT, noun: "Beschuss" }),
  E("zerstoerung", "Zerstörung", "Tätigkeiten", "G?TPD-----****X", ["zerstörung", "zerstört", "vernichtet", "vernichtung", "ausgeschaltet"], "taetigkeit", { ...EVT, g: "f" }),
  E("sprengung", "Sprengung erfolgt", "Tätigkeiten", "E?IPBC---------", ["sprengung", "gesprengt", "sprengung erfolgt", "sprengungen", "detoniert"], "taetigkeit", { ...ACT, noun: "Sprengung", g: "f", pl: "Sprengungen" }),
  E("durchsuchung", "Durchsuchung", "Tätigkeiten", "O?OPF----------", ["durchsuchung", "durchsucht", "durchsuchen", "absuchen", "razzia", "suche"], "taetigkeit", { ...ACT, g: "f", pl: "Durchsuchungen" }),
  E("minenlegen", "Minen verlegen", "Tätigkeiten", "O?OPM----------", ["minen verlegen", "minenverlegung", "minen legen", "verlegt minen", "minenleger"], "taetigkeit", { ...ACT, noun: "Minenverlegung", g: "f", prio: 5 }),
  E("festnahme", "Festnahme", "Tätigkeiten", "O?OPA----------", ["festnahme", "festgenommen", "verhaftung", "verhaftet", "arretiert", "gefangennahme", "gefangen genommen"], "taetigkeit", { ...EVT, g: "f", pl: "Festnahmen" }),
  E("gefangene", "Gefangene", "Tätigkeiten", "G?SPPE----****X", ["gefangene", "gefangener", "kgf", "kriegsgefangene", "gefangenensammelstelle", "inhaftierte"], "taetigkeit", { ...EVT, g: "p", dat: "Gefangenen" }),
  E("uebergabe", "Übergabe", "Tätigkeiten", "G?GPGPPC--****X", ["übergabe", "übergabepunkt", "gefangenenübergabe", "materialübergabe", "kontaktpunkt", "übergeben"], "taetigkeit", { ...EVT, g: "f", pl: "Übergaben" }),

  // ---------- Ereignisse
  E("explosion", "Explosion", "Ereignisse", "O?VPE----------", ["explosion", "detonation", "explodiert", "knall", "explosionen"], "ereignis", { ...EVT, g: "f", pl: "Explosionen" }),
  E("ied_anschlag", "IED-Anschlag", "Ereignisse", "O?VPEI---------", ["ied anschlag", "ied explosion", "anschlag", "sprengstoffanschlag", "bombenanschlag"], "ereignis", { ...EVT, placement: "strasse", prio: 5 }),
  E("brand", "Brand", "Ereignisse", "E?IPC----------", ["brand", "brennt", "brennend", "brennendes", "flammen", "waldbrand", "feuersbrunst", "rauch"], "ereignis", { ...EVT, pl: "Brände" }),
  E("unfall", "Unfall", "Ereignisse", "O?OPCB---------", ["unfall", "verkehrsunfall", "kollision", "zusammenstoss", "unfälle", "verunfallt"], "ereignis", { ...EVT, placement: "strasse", pl: "Unfälle" }),
  E("verletzte", "Verletzte", "Ereignisse", "O?OPCA---------", ["verletzte", "verletzter", "verwundete", "verwundeter", "verletzt", "verwundet", "tote", "gefallene", "verluste"], "ereignis", { ...EVT, g: "p", dat: "Verletzten" }),
  E("demo", "Demonstration", "Ereignisse", "O?OPD----------", ["demo", "demonstration", "kundgebung", "demonstranten", "protest", "proteste"], "ereignis", { ...EVT, lean: "unklar", g: "f", pl: "Demonstrationen" }),
  E("unruhen", "Unruhen / Krawall", "Ereignisse", "E?IPAC---------", ["unruhe", "unruhen", "krawall", "krawalle", "ausschreitungen", "aufruhr", "randale"], "ereignis", { ...EVT, lean: "unklar", noun: "Unruhen", g: "p" }),
  E("pluenderung", "Plünderung", "Ereignisse", "O?IPV----------", ["plünderung", "plünderer", "plündern", "geplündert", "vandalismus", "sachbeschädigung"], "ereignis", { ...EVT, lean: "unklar", g: "f", pl: "Plünderungen" }),
  E("entfuehrung", "Entführung", "Ereignisse", "O?OPK----------", ["entführung", "entführt", "geiselnahme", "geisel", "geiseln", "verschleppt"], "ereignis", { ...EVT, lean: "feind", g: "f", pl: "Entführungen" }),

  // ---------- Allgemein
  E("einheit", "Einheit (allg.)", "Allgemein", "S?GPU----------", ["einheit", "element", "truppe", "verband"], "einheit", { echelonable: true, noun: "Element", g: "n", pl: "Elemente", prio: 0 }),
];

const byKey = new Map(CATALOG.map((e) => [e.key, e]));
export function catalogEntry(key: string): CatalogEntry | undefined {
  return byKey.get(key);
}

// ---------- Normalisierung / Suche

/** klein, Punkte/Bindestriche/Schrägstriche als Trenner, mehrfache Leerzeichen weg */
export function normTerm(s: string): string {
  return s.toLowerCase().replace(/[.\-_/,;:()]+/g, " ").replace(/\s+/g, " ").trim();
}
const umlautFree = (s: string) => s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

/** Suche für die Zeichen-Auswahl (Name, Kürzel, Kategorie). Treffer auf Kürzel zuerst. */
export function searchCatalog(q: string, limit = 40): CatalogEntry[] {
  const s = normTerm(q);
  const visible = CATALOG.filter((e) => !e.hidden);
  if (!s) return visible.slice(0, limit);
  const s2 = umlautFree(s);
  const scored: Array<[number, number, CatalogEntry]> = [];
  CATALOG.forEach((e, i) => {
    const name = normTerm(e.name);
    const al = e.aliases.map(normTerm);
    const alJoined = al.map((a) => a.replace(/ /g, ""));
    let score = 99;
    if (al.includes(s) || alJoined.includes(s.replace(/ /g, ""))) score = 0;
    else if (name === s) score = 0;
    else if (al.some((a) => a.startsWith(s))) score = 1;
    else if (name.startsWith(s) || name.split(" ").some((w) => w.startsWith(s))) score = 2;
    else if (name.includes(s) || umlautFree(name).includes(s2)) score = 3;
    else if (al.some((a) => a.includes(s) || umlautFree(a).includes(s2))) score = 4;
    else if (e.category.toLowerCase().includes(s)) score = 5;
    if (score === 99 || (e.hidden && score > 0)) return;
    scored.push([score, i, e]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((x) => x[2]);
}

/** Vollständigen SIDC bilden: Zugehörigkeit, Status (vermutet = gestrichelt), Stufe. */
export function buildSidc(e: CatalogEntry, aff: Affiliation, o: { echelon?: Echelon; status?: Status } = {}): string {
  const c = e.sidc.split("");
  c[1] = aff;
  c[3] = o.status === "anticipated" ? "A" : "P";
  const echKey = o.echelon ?? e.echelon;
  if (echKey && e.echelonable && (c[0] === "S" || c[0] === "E")) {
    const ech = ECHELONS.find((x) => x.key === echKey);
    if (ech) { c[10] = c[10] === "A" ? "A" : "-"; c[11] = ech.code; }
  }
  return c.join("");
}

// ---------- Erkennung der Armee-Sprache

/** Ergebnis der Erkennung taktischer Begriffe in einem Meldungstext */
export interface TacticalReading {
  key: string;
  sidc: string;
  echelon?: Echelon;
  count?: number;
  /** aus dem Text erkannte Zugehörigkeit (gn → H, eig → F, vermutlich/mögliche/unklar → U), sonst null */
  aff: Affiliation | null;
  status: Status;
  /** ausgeschriebener Sinn, z. B. «1 gegnerischer Halbzug Infanterie» */
  description: string;
  /** Wort für den Status, z. B. «möglich», «vermutet», «geplant» (für `describeTactical`) */
  statusWord?: string;
  /** Zusatz, z. B. «in Stellung» oder «mit Verletzten» */
  extra?: string;
  /** Textstellen [Anfang, Ende), die als taktische Begriffe gelesen wurden (z. B. damit «Kp» in «1 Kp Pz» kein Melder ist) */
  spans: Array<[number, number]>;
}

type Hit =
  | { t: "e"; e: CatalogEntry; weak?: boolean }
  | { t: "ech"; ech: Echelon; weak?: boolean }
  | { t: "aff"; aff: Affiliation }
  | { t: "st"; word: string; unclear?: boolean }
  | { t: "fill" };

const AFF_WORDS: Array<[string, Affiliation]> = [
  ["gn", "H"], ["gegn", "H"], ["gegner", "H"], ["gegnerisch", "H"], ["gegnerische", "H"], ["gegnerischer", "H"], ["gegnerisches", "H"],
  ["gegnerischen", "H"], ["fe", "H"], ["feind", "H"], ["feindl", "H"], ["feindlich", "H"], ["feindliche", "H"], ["feindlicher", "H"],
  ["feindliches", "H"], ["feindlichen", "H"], ["rot", "H"], ["seite rot", "H"],
  ["eig", "F"], ["eigen", "F"], ["eigene", "F"], ["eigener", "F"], ["eigenes", "F"], ["eigenen", "F"],
];
const STATUS_WORDS: Array<[string, string, boolean?]> = [
  ["mögl", "möglich"], ["möglich", "möglich"], ["mögliche", "möglich"], ["möglicher", "möglich"], ["mögliches", "möglich"], ["möglichen", "möglich"],
  ["möglicherweise", "möglich"], ["evtl", "möglich"], ["eventuell", "möglich"], ["allenfalls", "möglich"],
  ["vermutlich", "vermutet"], ["verm", "vermutet"], ["vermutet", "vermutet"], ["vermutete", "vermutet"], ["vermuteter", "vermutet"],
  ["vermutetes", "vermutet"], ["mutmasslich", "vermutet"], ["mutmassliche", "vermutet"], ["mutmasslicher", "vermutet"], ["wahrscheinlich", "vermutet"],
  ["verdacht", "vermutet"], ["verdächtig", "vermutet"], ["verdächtige", "vermutet"], ["verdächtiger", "vermutet"], ["verdächtiges", "vermutet"],
  ["geplant", "geplant"], ["geplante", "geplant"], ["geplanter", "geplant"], ["geplantes", "geplant"],
  ["unklar", "", true], ["unklare", "", true], ["unklarer", "", true], ["unklares", "", true], ["unbekannt", "", true], ["unbekannte", "", true], ["unbekannter", "", true],
];
const FILLERS = ["x", "ca", "circa", "etwa", "rund", "mind", "mindestens", "min", "rund", "ungefähr", "zirka"];

/** Wörterbuch: normalisierter Begriff (Wörter mit Leerzeichen) → Treffer */
const DICT = new Map<string, Hit[]>();
/** lange Begriffe (≥ 6 Zeichen, ein Wort) für Treffer in zusammengesetzten Wörtern («Lastwagenkolonne») */
const LONG: Array<[string, CatalogEntry]> = [];
let MAXW = 1;
function put(term: string, h: Hit) {
  const variants = new Set<string>();
  const n = normTerm(term);
  variants.add(n);
  variants.add(umlautFree(n));
  if (n.includes(" ")) { variants.add(n.replace(/ /g, "")); variants.add(umlautFree(n.replace(/ /g, ""))); }
  for (const v of variants) {
    if (!v) continue;
    MAXW = Math.max(MAXW, v.split(" ").length);
    const arr = DICT.get(v);
    if (arr) arr.push(h); else DICT.set(v, [h]);
  }
}
for (const e of CATALOG) {
  for (const a of e.aliases) {
    put(a, { t: "e", e, weak: normTerm(a).length === 1 });
    const n = normTerm(a);
    if (n.length >= 6 && !n.includes(" ")) LONG.push([n, e]);
  }
  put(e.name.replace(/\(.*?\)/g, ""), { t: "e", e });
}
for (const ech of ECHELONS) for (const a of ech.aliases) put(a, { t: "ech", ech: ech.key, weak: a.length === 1 });
for (const [w, aff] of AFF_WORDS) put(w, { t: "aff", aff });
for (const [w, word, unclear] of STATUS_WORDS) put(w, { t: "st", word, unclear });
for (const w of FILLERS) put(w, { t: "fill" });
LONG.sort((a, b) => b[0].length - a[0].length);
const ECH_WORDS = ECHELONS.flatMap((x) => x.aliases.filter((a) => a.length >= 3).map((a) => [a, x.key] as [string, Echelon])).sort((a, b) => b[0].length - a[0].length);
const SUFFIXES = ["ern", "en", "er", "es", "e", "n", "s"];

interface Tok { s: string; a: number; b: number; num?: number }
const TOK_RE = /[\p{L}\d'’]+/gu;

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.toLowerCase().matchAll(TOK_RE)) {
    let s = m[0];
    const a = m.index!;
    const t: Tok = { s, a, b: a + s.length };
    if (/^\d{1,3}x?$/.test(s)) { t.num = parseInt(s, 10); if (s.endsWith("x")) s = s.slice(0, -1); }
    else if (/^x\d{1,3}$/.test(s)) t.num = parseInt(s.slice(1), 10);
    t.s = s;
    out.push(t);
  }
  return out;
}

interface Found { h: Hit; i: number; n: number; len: number; sub?: boolean }

function lookup(tokens: Tok[], i: number): Found | null {
  for (let n = Math.min(MAXW, tokens.length - i); n >= 1; n--) {
    const words = tokens.slice(i, i + n).map((t) => t.s);
    const key = words.join(" ");
    let hits = DICT.get(key);
    if (!hits && n > 1) hits = DICT.get(words.join(""));
    if (hits) return { h: hits[0]!, i, n, len: key.length };
  }
  const s = tokens[i]!.s;
  if (s.length >= 5 && !/\d/.test(s)) {
    for (const suf of SUFFIXES) {
      if (s.endsWith(suf) && s.length - suf.length >= 4) {
        const hits = DICT.get(s.slice(0, -suf.length));
        if (hits && hits[0]!.t === "e") return { h: hits[0]!, i, n: 1, len: s.length - suf.length };
      }
    }
  }
  return null;
}

/** zusammengesetzte Wörter: «Infanteriezug» = Infanterie + Zug, «Lastwagenkolonne» enthält «lastwagen» */
function compound(tok: Tok): { e?: CatalogEntry; ech?: Echelon; len: number } | null {
  const s = tok.s;
  if (s.length < 7 || /\d/.test(s)) return null;
  for (const [w, ech] of ECH_WORDS) {
    if (s.endsWith(w) && s.length > w.length + 2) {
      let head = s.slice(0, -w.length);
      let hits = DICT.get(head);
      if (!hits && head.endsWith("s")) { head = head.slice(0, -1); hits = DICT.get(head); }
      const h = hits?.find((x) => x.t === "e");
      if (h && h.t === "e") return { e: h.e, ech, len: s.length };
    }
  }
  for (const [w, e] of LONG) if (s.includes(w)) return { e, len: w.length };
  return null;
}

const ADJ_END: Record<Genus, string> = { m: "er", f: "e", n: "es", p: "e" };
function inflect(adj: string, g: Genus): string {
  return adj + ADJ_END[g];
}

/**
 * Ausgeschriebener Sinn, z. B. «1 gegnerischer Halbzug Infanterie», «mögliche IED», «2 gegnerische Kampfpanzer».
 * @param aff Zugehörigkeit für das Adjektiv (H → «gegnerisch», F → «eigen»), null = ohne
 */
export function describeTactical(r: Pick<TacticalReading, "key" | "echelon" | "count" | "statusWord" | "extra">, aff: Affiliation | null): string {
  const e = catalogEntry(r.key);
  if (!e) return "";
  const many = (r.count ?? 1) > 1;
  let head: string;
  let g: Genus;
  const ech = r.echelon && e.echelonable ? ECHELONS.find((x) => x.key === r.echelon) : undefined;
  const noun = e.noun ?? e.name.replace(/\s*\(.*?\)\s*/g, " ").split(" / ")[0]!.trim();
  if (ech && (r.echelon !== e.echelon || e.key === "inf_gr")) {
    g = many ? "p" : ech.g;
    head = `${many ? ech.pl : ech.name} ${noun}`;
  } else {
    g = many ? "p" : e.g ?? "m";
    head = many ? e.pl ?? noun : noun;
  }
  const adjs: string[] = [];
  if (r.statusWord) adjs.push(inflect(r.statusWord, g));
  const adjAllowed = e.kind !== "ereignis" && e.key !== "kontakt" && e.lean !== "unklar";
  if (adjAllowed && aff === "H") adjs.push(inflect("gegnerisch", g));
  if (adjAllowed && aff === "F") adjs.push(inflect("eigen", g));
  // Nomen, die schon ein Adjektiv tragen («irreguläre Kräfte», «schweres Maschinengewehr»): Adjektive davor passen
  const parts = [r.count !== undefined ? String(r.count) : "", ...adjs, head, r.extra ?? ""].filter(Boolean);
  const out = parts.join(" ");
  return out.charAt(0).toUpperCase() === out.charAt(0) || /^\d/.test(out) ? out : out.charAt(0).toUpperCase() + out.slice(1);
}

const prioOf = (e: CatalogEntry) =>
  e.prio ?? (e.kind === "grafik" || e.kind === "taetigkeit" || e.kind === "ereignis" ? 4 : e.kind === "geraet" ? 4 : 2);

/** Erkennt das taktische Zeichen inkl. Stufe, Anzahl, Zugehörigkeit, Status und den ausgeschriebenen Sinn. */
export function readTactical(text: string): TacticalReading | null {
  const toks = tokenize(text);
  if (!toks.length) return null;
  const found: Found[] = [];
  for (let i = 0; i < toks.length; ) {
    const f = lookup(toks, i);
    if (f) { found.push(f); i += f.n; continue; }
    const c = compound(toks[i]!);
    if (c) {
      if (c.e) found.push({ h: { t: "e", e: c.e }, i, n: 1, len: c.len, sub: true });
      if (c.ech) found.push({ h: { t: "ech", ech: c.ech }, i, n: 1, len: 0, sub: true });
    }
    i++;
  }
  if (!found.length) return null;
  const isNum = (i: number) => toks[i]?.num !== undefined && !/['’]/.test(toks[i]!.s);
  const near = (f: Found, pred: (g: Found) => boolean) => found.some((g) => g !== f && Math.abs(g.i - f.i) <= 2 && pred(g));

  // Stufen: «Zug 2», «Kp 3» sind Namen, keine Stufe; «z» nur neben einer Truppengattung
  const echs = found.filter((f) => f.h.t === "ech" && !isNum(f.i + f.n) && (!(f.h as { weak?: boolean }).weak || near(f, (g) => g.h.t === "e")));
  const ents = found.filter((f) => f.h.t === "e" && (!f.h.weak || near(f, (g) => g.h.t === "ech")));
  const affs = found.filter((f) => f.h.t === "aff");
  const sts = found.filter((f) => f.h.t === "st");

  let primary: Found | undefined;
  for (const f of ents) {
    const e = (f.h as { e: CatalogEntry }).e;
    if (!primary) { primary = f; continue; }
    const p = (primary.h as { e: CatalogEntry }).e;
    const d = prioOf(e) - prioOf(p) || (primary.sub ? 1 : 0) - (f.sub ? 1 : 0) || f.len - primary.len;
    if (d > 0) primary = f;
  }
  if (!primary && !echs.length) return null;

  let entry = primary ? (primary.h as { e: CatalogEntry }).e : catalogEntry("einheit")!;
  const anchor = primary ?? echs[0]!;
  // Stufe: nächste gültige Stufe bei der Truppengattung
  let echelon: Echelon | undefined;
  let echFound: Found | undefined;
  for (const f of echs) {
    if (Math.abs(f.i - anchor.i) <= 2 && (!echFound || Math.abs(f.i - anchor.i) < Math.abs(echFound.i - anchor.i))) echFound = f;
  }
  if (echFound) {
    echelon = (echFound.h as { ech: Echelon }).ech;
    if (!entry.echelonable && entry.unit) entry = catalogEntry(entry.unit) ?? entry;
    if (!entry.echelonable) { echelon = undefined; echFound = undefined; }
  }
  // Anzahl: Zahl direkt vor dem Begriff (dazwischen nur gn, mögliche, Stufe, «x», «ca.»)
  let count: number | undefined;
  const first = Math.min(anchor.i, echFound?.i ?? Infinity);
  const skip = new Set(found.filter((f) => f.h.t === "aff" || f.h.t === "st" || f.h.t === "ech" || f.h.t === "fill").map((f) => f.i));
  for (let j = first - 1; j >= 0 && j >= first - 4; j--) {
    if (isNum(j)) { const n = toks[j]!.num!; if (n > 0 && n < 1000) count = n; break; }
    if (!skip.has(j)) break;
  }
  if (count === undefined && toks[first]?.num !== undefined && toks[first]!.s !== String(toks[first]!.num)) count = toks[first]!.num;
  // Gerät statt Einheit: «3 Mw» = 3 Minenwerfer; Personen ab 8 = Gruppe
  if (count !== undefined && !echelon && entry.kind === "einheit" && entry.geraet && entry.key !== "inf_trp") entry = catalogEntry(entry.geraet) ?? entry;
  if (entry.key === "inf_trp" && count !== undefined && count >= 8) entry = catalogEntry("inf_gr")!;
  if (entry.key === "inf_trp" && echelon && echelon !== "trp") entry = catalogEntry("inf")!;

  let aff: Affiliation | null = affs.length ? (affs[0]!.h as { aff: Affiliation }).aff : null;
  let status: Status = "present";
  let statusWord: string | undefined;
  for (const f of sts) {
    const h = f.h as { word: string; unclear?: boolean };
    if (h.word) { status = "anticipated"; statusWord ??= h.word; }
    if (!aff || h.word) aff = aff === "H" && h.word ? "H" : "U";
  }
  // Zusatz: «Mw Stel» → in Stellung; «Unfall mit Verletzten»
  let extra: string | undefined;
  const others = ents.filter((f) => f !== primary).map((f) => ({ f, e: (f.h as { e: CatalogEntry }).e }));
  if (entry.key !== "stellung" && others.some((o) => o.e.key === "stellung") && entry.kind !== "anlage") extra = "in Stellung";
  const withDat = others.find((o) => o.e.dat && toks[o.f.i - 1]?.s === "mit");
  if (withDat) extra = `mit ${withDat.e.dat}`;

  const spans: Array<[number, number]> = [];
  for (const f of [primary, echFound, ...affs, ...sts].filter(Boolean) as Found[]) spans.push([toks[f.i]!.a, toks[f.i + f.n - 1]!.b]);
  const base = { key: entry.key, echelon, count, statusWord, extra };
  return {
    key: entry.key,
    sidc: buildSidc(entry, aff ?? "U", { echelon, status }),
    echelon,
    count,
    aff,
    status,
    description: describeTactical(base, aff),
    statusWord,
    extra,
    spans,
  };
}
