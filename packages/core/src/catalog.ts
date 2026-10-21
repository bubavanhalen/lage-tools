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
/**
 * Status (SIDC Stelle 4): present = vorhanden, anticipated = vermutet/geplant (gestrichelt),
 * destroyed = zerstört (X), damaged = beschädigt (D). milsymbol 3.0.4 zeichnet X/D bei 2525C als Balken unter dem Zeichen.
 */
export type Status = "present" | "anticipated" | "destroyed" | "damaged";
/** SIDC-Buchstabe (Stelle 4) je Status */
export const STATUS_CODE: Record<Status, string> = { present: "P", anticipated: "A", destroyed: "X", damaged: "D" };
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
  /**
   * nicht in der Auswahl und nicht in der Suche zeigen: alte Schlüssel, die es für gespeicherte Übungen weiter braucht
   * (heute nur «inf_gr»; neue Meldungen mit ≥ 8 Personen bekommen ihn weiterhin als Stufe Gruppe)
   */
  hidden?: boolean;
  /** inhärent feindlich (IED, Minen, Sperre, Hinterhalt …): «mögliche IED» bleibt Feind (rot gestrichelt) */
  hostile?: boolean;
  /** Zusatz, wenn der Begriff neben einem Element steht, z. B. Stellung → «in Stellung» */
  inPhrase?: string;
  /** Wortformen je Kürzel: [Einzahl, Mehrzahl, Geschlecht Einzahl, Kürzel ist Mehrzahl], z. B. «toter» → Toter / Tote */
  forms?: Record<string, [string, string, Genus, boolean?]>;
  /**
   * Kurzbeschriftung im Zeichen (milsymbol-Feld `uniqueDesignation`), wo das Punktzeichen allein nicht eindeutig ist,
   * z. B. «Draht», «BR». Darstellung: `new ms.Symbol(sidc, { uniqueDesignation: tag })`.
   */
  tag?: string;
}

export const ECHELONS: Array<{ key: Echelon; name: string; code: string; aliases: string[]; g: Genus; pl: string }> = [
  { key: "trp", name: "Trupp", code: "A", aliases: ["trp", "trupp"], g: "m", pl: "Trupps" },
  { key: "gr", name: "Gruppe", code: "B", aliases: ["gr", "gruppe"], g: "f", pl: "Gruppen" },
  { key: "hz", name: "Halbzug", code: "C", aliases: ["hz", "halbzug"], g: "m", pl: "Halbzüge" },
  { key: "zug", name: "Zug", code: "D", aliases: ["zug", "z"], g: "m", pl: "Züge" },
  { key: "kp", name: "Kompanie", code: "E", aliases: ["kp", "kompanie", "bttr", "batterie", "staffel"], g: "f", pl: "Kompanien" },
  { key: "bat", name: "Bataillon", code: "F", aliases: ["bat", "bataillon", "abt", "abteilung"], g: "n", pl: "Bataillone" },
  { key: "rgt", name: "Regiment", code: "G", aliases: ["rgt", "regiment"], g: "n", pl: "Regimenter" },
  { key: "br", name: "Brigade", code: "H", aliases: ["br", "brigade", "brig"], g: "f", pl: "Brigaden" },
  { key: "div", name: "Division", code: "I", aliases: ["div", "division"], g: "f", pl: "Divisionen" },
];

/** Bezeichnungen je nach Truppengattung: «Art Abt» = Abteilung, «Bttr» = Batterie */
const ECH_WORD: Record<string, { name: string; g: Genus; pl: string }> = {
  abt: { name: "Abteilung", g: "f", pl: "Abteilungen" },
  abteilung: { name: "Abteilung", g: "f", pl: "Abteilungen" },
  bttr: { name: "Batterie", g: "f", pl: "Batterien" },
  batterie: { name: "Batterie", g: "f", pl: "Batterien" },
  staffel: { name: "Staffel", g: "f", pl: "Staffeln" },
};

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
const OBST: Extra = { lean: "feind", hostile: true, activity: true, placement: "strasse", g: "f" };
const ACT: Extra = { lean: "feind", activity: true };
const EVT: Extra = { activity: true };
const SITE: Extra = { activity: true };

export const CATALOG: CatalogEntry[] = [
  // ---------- Kampftruppen
  E("inf", "Infanterie", "Kampftruppen", "S?GPUCI--------", ["inf", "infanterie", "füs", "füsiliere", "füsilier", "schützen"], "einheit", { ...UNIT, g: "f" }),
  E("pz_gren", "Panzergrenadiere (Inf mech)", "Kampftruppen", "S?GPUCIZ-------", ["pz gren", "panzergrenadiere", "panzergrenadier", "mech inf", "inf mech", "infanterie mechanisiert", "mechanisierte infanterie", "mech"], "einheit", { ...UNIT, noun: "Panzergrenadiere", g: "p", geraet: "spz" }),
  E("pz", "Panzer", "Kampftruppen", "S?GPUCA--------", ["pz", "panzer", "panzertruppen"], "einheit", { ...UNIT, g: "p", geraet: "kpz" }),
  E("pzj", "Panzerjäger / Panzerabwehr", "Kampftruppen", "S?GPUCAA-------", ["pzj", "panzerjäger", "pz jäger", "panzerabwehr", "pz abw"], "einheit", { ...UNIT, noun: "Panzerjäger", g: "p", geraet: "pzaw" }),
  E("aufkl", "Aufklärung", "Kampftruppen", "S?GPUCR--------", ["aufkl", "aufklärung", "aufklärer", "aufklärungstruppen"], "einheit", { ...UNIT, g: "f", geraet: "aufkl_fz" }),
  E("geb", "Gebirgstruppen", "Kampftruppen", "S?GPUCIO-------", ["geb", "gebirgstruppen", "gebirgsinfanterie", "geb inf", "gebirgsspezialisten", "geb spez"], "einheit", { ...UNIT, noun: "Gebirgsinfanterie", g: "f" }),
  E("fsch", "Fallschirmtruppen", "Kampftruppen", "S?GPUCIA-------", ["fsch", "fallschirm", "fallschirmjäger", "fallschirmaufklärer", "fsch aufkl", "luftlande", "luftlandetruppen"], "einheit", { ...UNIT, noun: "Fallschirmtruppen", g: "p" }),
  E("spez", "Spezialkräfte / Grenadiere", "Kampftruppen", "S?FPG----------", ["spez", "spezialkräfte", "spez kr", "sof", "kommando", "ksk", "gren", "grenadiere", "grenadier"], "einheit", { ...UNIT, noun: "Spezialkräfte", g: "p" }),
  E("scharfschuetze", "Scharfschütze", "Kampftruppen", "O?VPS----------", ["schaf", "scharfschütze", "scharfschützen", "sniper", "heckenschütze"], "einheit", { lean: "feind", hostile: true, pl: "Scharfschützen" }),
  E("inf_trp", "Personen / Inf Trupp", "Kampftruppen", "S?GPUCI--------", ["personen", "person", "pers", "soldaten", "soldat", "sdt", "mann", "angehörige", "zu fuss", "fussgänger", "bewaffnete"], "einheit", { ...UNIT, echelon: "trp", noun: "Personen", g: "p", prio: 1,
    forms: { person: ["Person", "Personen", "f"], personen: ["Person", "Personen", "f", true], pers: ["Person", "Personen", "f", true], soldat: ["Soldat", "Soldaten", "m"],
      soldaten: ["Soldat", "Soldaten", "m", true], sdt: ["Soldat", "Soldaten", "m", true], mann: ["Mann", "Mann", "m"], bewaffnete: ["Bewaffneter", "Bewaffnete", "m", true] } }),
  E("inf_gr", "Inf Gruppe", "Kampftruppen", "S?GPUCI--------", [], "einheit", { ...UNIT, echelon: "gr", noun: "Personen", g: "p", prio: 1, hidden: true }),

  // ---------- Unterstützung
  E("art", "Artillerie", "Unterstützung", "S?GPUCF--------", ["art", "artillerie"], "einheit", { ...UNIT, g: "f", geraet: "pz_hb" }),
  E("art_pz", "Panzerartillerie", "Unterstützung", "S?GPUCFHE------", ["pz art", "panzerartillerie"], "einheit", { ...UNIT, g: "f", geraet: "pz_hb" }),
  E("rak_art", "Raketenartillerie", "Unterstützung", "S?GPUCFRMS-----", ["rak art", "raketenartillerie", "rak"], "einheit", { ...UNIT, g: "f", geraet: "rak_werfer" }),
  E("mw", "Minenwerfer", "Unterstützung", "S?GPUCFM-------", ["mw", "minenwerfer", "mörser"], "einheit", { ...UNIT, geraet: "mw_geraet" }),
  E("genie", "Genie / Pioniere", "Unterstützung", "S?GPUCE--------", ["g", "gen", "genie", "genietruppen", "sap", "sappeure", "sappeur", "pioniere", "pionier", "pz sap", "panzersappeure"], "einheit", { ...UNIT, noun: "Genie", g: "f", geraet: "bagger" }),
  E("rettung", "Rettung / Katastrophenhilfe", "Unterstützung", "E?OPBC---------", ["rttg", "rettung", "rettungstruppen", "katastrophenhilfe", "kata hi", "katastrophenhilfe bereitschaft"], "einheit", { ...UNIT, lean: undefined, noun: "Rettungstruppen", g: "p" }),
  E("abc", "ABC-Abwehr", "Unterstützung", "S?GPUUA--------", ["abc", "abc abw", "abc abwehr", "atomar", "chemie abwehr"], "einheit", { ...UNIT, g: "f" }),
  E("flab", "Fliegerabwehr", "Unterstützung", "S?GPUCD--------", ["flab", "fliegerabwehr", "m flab", "l flab", "luftverteidigung", "bodluv"], "einheit", { ...UNIT, g: "f", geraet: "flab_kan" }),
  E("heli_einheit", "Lufttransport (Helikopter)", "Unterstützung", "S?GPUCVRU------", ["lufttransport", "lufttransportstaffel", "helikopterstaffel"], "einheit", { ...UNIT, noun: "Lufttransport", geraet: "heli" }),
  E("uav_einheit", "Drohnen (UAV-Einheit)", "Unterstützung", "S?GPUCVU-------", ["drohnenstaffel", "drohnen einheit", "uav einheit"], "einheit", { ...UNIT, noun: "Drohneneinheit", g: "f", geraet: "drohne" }),

  // ---------- Führung und Logistik
  E("hq", "Stab / Kommando", "Führung und Logistik", "S?GPU-----A----", ["stab", "kdo", "kommandoelement", "hq", "stabskp", "führungsstaffel", "fhr st"], "einheit", { ...UNIT, noun: "Stab" }),
  E("fu", "Führungsunterstützung / Übermittlung", "Führung und Logistik", "S?GPUUS--------", ["fu", "uem", "übermittlung", "übermittler", "führungsunterstützung", "fhr ustü", "funk trp"], "einheit", { ...UNIT, noun: "Führungsunterstützung", g: "f" }),
  E("ekf", "Elektronische Kriegsführung", "Führung und Logistik", "S?GPUUMSE------", ["ekf", "el kf", "elektronische kriegsführung", "ew", "funkaufklärung", "störer", "störsender", "funkstörung", "funkstörungen", "jamming", "störsignal"], "einheit", { ...UNIT, noun: "elektronische Kriegsführung", g: "f" }),
  E("san", "Sanität", "Führung und Logistik", "S?GPUSM--------", ["san", "sanität", "sanitäter", "sanitätstruppen", "sanitätsdienst"], "einheit", { ...UNIT, lean: undefined, g: "f" }),
  E("log", "Logistik", "Führung und Logistik", "S?GPUS---------", ["log", "logistik", "logistiktruppen"], "einheit", { ...UNIT, g: "f" }),
  E("vsg", "Versorgung", "Führung und Logistik", "S?GPUSS--------", ["vsg", "versorgung", "nachschub", "verpflegung"], "einheit", { ...UNIT, g: "f" }),
  E("ih", "Instandhaltung", "Führung und Logistik", "S?GPUSX--------", ["ih", "instandhaltung", "unterhalt", "reparatur", "reparaturtrupp", "bergung"], "einheit", { ...UNIT, g: "f" }),
  E("trsp", "Transport", "Führung und Logistik", "S?GPUST--------", ["trsp", "transport", "transporttruppen"], "einheit", { ...UNIT }),
  E("mp", "Militärpolizei", "Führung und Logistik", "S?GPUULM-------", ["mp", "mil pol", "militärpolizei", "mil sich"], "einheit", { ...UNIT, lean: undefined, g: "f" }),

  // ---------- Zivile und Irreguläre
  E("polizei", "Polizei", "Zivile und Irreguläre", "S?GPUULC-------", ["polizei", "pol", "kapo", "kantonspolizei", "stapo", "polizisten"], "einheit", { ...UNIT, lean: "unklar", g: "f" }),
  E("zivilschutz", "Zivilschutz", "Zivile und Irreguläre", "E?OPBJ---------", ["zivilschutz", "zs", "zso", "bevölkerungsschutz"], "einheit", { ...UNIT, lean: "unklar" }),
  E("feuerwehr", "Feuerwehr", "Zivile und Irreguläre", "E?OPCE---------", ["feuerwehr", "fw", "pompiers"], "einheit", { ...UNIT, lean: "unklar", g: "f" }),
  E("zivil", "Zivile Person", "Zivile und Irreguläre", "O?PP-----------", ["zivilist", "zivilisten", "zivilperson", "zivile", "ziv", "passant", "passanten", "spaziergänger", "jogger"], "einheit", { lean: "unklar", noun: "Zivilperson", g: "f", pl: "Zivilpersonen" }),
  E("menge", "Menschenmenge", "Zivile und Irreguläre", "E?IPA----------", ["menschenmenge", "menge", "ansammlung", "menschenansammlung", "schaulustige"], "einheit", { lean: "unklar", g: "f", pl: "Menschenmengen" }),
  E("fluechtlinge", "Flüchtlinge", "Zivile und Irreguläre", "O?GPA----------", ["flüchtlinge", "flüchtling", "vertriebene", "evakuierte", "flüchtlingsstrom", "migranten"], "einheit", { lean: "unklar", g: "p" }),
  E("irregulaer", "Irreguläre Kräfte / Bewaffnete", "Zivile und Irreguläre", "O?GP-----------", ["irreguläre", "irreguläre kräfte", "miliz", "milizen", "freischärler", "aufständische", "rebellen", "partisanen", "bewaffnete gruppe", "kämpfer", "insurgenten"], "einheit", { lean: "feind", noun: "irreguläre Kräfte", g: "p" }),

  // ---------- Fahrzeuge
  E("kpz", "Kampfpanzer", "Fahrzeuge", "S?GPEVATH-MQ---", ["kpz", "kampfpanzer", "pz 87", "leopard", "leo", "t 72", "t72"], "geraet", { ...DEV, unit: "pz", prio: 4 }),
  E("spz", "Schützenpanzer (Raupe)", "Fahrzeuge", "S?GPEVAI--MQ---", ["spz", "schützenpanzer", "spz 2000", "cv90", "bmp", "raupen spz"], "geraet", { ...DEV, noun: "Schützenpanzer", unit: "pz_gren", prio: 4 }),
  E("spz_rad", "Schützenpanzer (Rad)", "Fahrzeuge", "S?GPEVAI--MP---", ["spz rad", "rad spz", "radschützenpanzer", "piranha", "btr"], "geraet", { ...DEV, noun: "Radschützenpanzer", unit: "pz_gren", prio: 4 }),
  E("mtw", "Mannschaftstransportwagen", "Fahrzeuge", "S?GPEVAA-------", ["mtw", "mannschaftstransportwagen", "m113", "gmtf", "pz mtw", "schützenpanzerwagen"], "geraet", { ...DEV, unit: "pz_gren", prio: 4 }),
  E("aufkl_fz", "Aufklärungsfahrzeug", "Fahrzeuge", "S?GPUCRVA------", ["aufkl fz", "aufklärungsfahrzeug", "eagle", "spähpanzer", "aufkl pz"], "geraet", { ...DEV, noun: "Aufklärungsfahrzeug", g: "n", pl: "Aufklärungsfahrzeuge", unit: "aufkl", prio: 4 }),
  E("gw", "Geländewagen", "Fahrzeuge", "S?GPEVUX-------", ["gw", "geländewagen", "gelände pw", "jeep", "pinzgauer", "mowag", "pickup", "pick up"], "geraet", { ...DEV, prio: 4 }),
  E("fz", "Fahrzeug (allg.)", "Fahrzeuge", "S?GPEVU--------", ["fahrzeug", "fz", "pw", "auto", "personenwagen", "g klasse", "g wagen", "puch", "wagen"], "geraet", { ...DEV, noun: "Fahrzeug", g: "n", pl: "Fahrzeuge", prio: 3,
    forms: { pw: ["Personenwagen", "Personenwagen", "m"], personenwagen: ["Personenwagen", "Personenwagen", "m"], auto: ["Auto", "Autos", "n"] } }),
  E("ziv_fz", "Ziviles Fahrzeug", "Fahrzeuge", "S?GPEVCA-------", ["ziv fz", "ziv pw", "ziv fahrzeug", "zivil fz", "zivilfahrzeug", "privatauto", "privat pw", "ziviles fahrzeug", "zivil pw", "zivilauto"], "geraet", { lean: "unklar", noun: "ziviles Fahrzeug", g: "n", pl: "zivile Fahrzeuge", prio: 4 }),
  E("lw", "Lastwagen", "Fahrzeuge", "S?GPEVUL-------", ["lastwagen", "lkw", "lw", "duro", "camion", "lastw", "laster"], "geraet", { ...DEV, prio: 4 }),
  E("motorrad", "Motorrad", "Fahrzeuge", "S?GPEVCAL------", ["motorrad", "motorräder", "töff", "mrd", "quad", "motorradfahrer"], "geraet", { ...DEV, g: "n", pl: "Motorräder", prio: 4 }),
  E("kolonne", "Fahrzeugkolonne", "Fahrzeuge", "S?GPEVU--------", ["kolonne", "kolonnen", "fz kolonne", "fahrzeugkolonne", "konvoi", "marschkolonne", "lastwagenkolonne", "lw kolonne", "pw kolonne"], "geraet", { ...DEV, noun: "Fahrzeug", g: "n", pl: "Fahrzeuge", placement: "strasse", prio: 6 }),
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
  E("panzerfaust", "Panzerfaust", "Waffen", "S?GPEWTL-------", ["pzf", "panzerfaust", "pz faust", "rpg", "nlaw", "rakrohr", "raketenrohr"], "geraet", { ...DEV, g: "f", pl: "Panzerfäuste", unit: "pzj", prio: 4 }),
  E("stgw", "Sturmgewehr", "Waffen", "S?GPEWRR-------", ["stgw", "sturmgewehr", "sturmgewehre", "stgw 90", "stgw 57", "gewehr", "gewehre", "kalaschnikow", "ak 47"], "geraet", { ...DEV, g: "n", pl: "Sturmgewehre", prio: 3 }),
  E("schaf_gewehr", "Scharfschützengewehr", "Waffen", "S?GPEWRR-------", ["schaf gew", "scharfschützengewehr", "ssg", "präzisionsgewehr"], "geraet", { ...DEV, g: "n", pl: "Scharfschützengewehre", prio: 4 }),
  E("flab_kan", "Flab-Kanone", "Waffen", "S?GPEWAM-------", ["flab kan", "flabkanone", "flab kanone", "35 mm flab", "m flab kan", "fliegerabwehrkanone"], "geraet", { ...DEV, g: "f", pl: "Flab-Kanonen", unit: "flab", prio: 4 }),
  E("flab_lwf", "Flab-Lenkwaffe", "Waffen", "S?GPEWMAS------", ["flab lwf", "flablenkwaffe", "flab lenkwaffe", "stinger", "rapier", "manpads", "fl lwf"], "geraet", { ...DEV, g: "f", pl: "Flab-Lenkwaffen", unit: "flab", prio: 4 }),

  // ---------- Luftfahrzeuge
  E("heli", "Helikopter", "Luftfahrzeuge", "S?APMH---------", ["heli", "helikopter", "hubschrauber", "super puma", "cougar", "ec635", "ec 635"], "geraet", { ...DEV, unit: "heli_einheit", prio: 4 }),
  E("drohne", "Drohne", "Luftfahrzeuge", "S?APMFQ--------", ["drohne", "uav", "quadrocopter", "quadkopter", "multikopter", "fpv", "ads 15"], "geraet", { ...DEV, g: "f", pl: "Drohnen", unit: "uav_einheit", prio: 4 }),
  E("flugzeug", "Flugzeug / Kampfjet", "Luftfahrzeuge", "S?APMF---------", ["flugzeug", "kampfjet", "kampfflugzeug", "jet", "fa 18", "f 35"], "geraet", { ...DEV, noun: "Flugzeug", g: "n", pl: "Flugzeuge", prio: 4 }),

  // ---------- Anlagen und Orte
  // «KP» (gross geschrieben) = Kommandoposten, «Kp» = Kompanie; «Kp Gfs» = Kommandoposten der Kompanie (Stufe Kp)
  E("kdo_po", "Kommandoposten", "Anlagen und Orte", "S?GPU-----A----", ["kdo po", "kommandoposten", "gefechtsstand", "gfs", "gef st", "kp stao", "führungsstandort", "cp kdo"], "anlage", { ...SITE, echelonable: true, pl: "Kommandoposten" }),
  E("beob_aufkl", "Beob Posten / Späher", "Anlagen und Orte", "G?GPDPOR--****X", ["beob po", "beo po", "beo posten", "beob posten", "beobachtungsposten", "beob stao", "beo stao", "beob", "beo", "späher", "spähtrupp", "beobachter"], "anlage", { triangle: true, lean: "eigen", noun: "Beobachtungsposten", pl: "Beobachtungsposten" }),
  E("stellung", "Stellung / Stützpunkt", "Anlagen und Orte", "G?MPSF----****X", ["stellung", "stel", "stützpunkt", "stp", "feldbefestigung", "schützenloch", "kampfstellung", "verteidigungsstellung", "stellungsraum"], "anlage", { ...SITE, lean: "eigen", inPhrase: "in Stellung", noun: "Stellung", g: "f", pl: "Stellungen", prio: 1 }),
  E("kontrollposten", "Checkpoint / Kontrollposten", "Anlagen und Orte", "G?GPGPPK--****X", ["checkpoint", "kontrollposten", "kontrollpunkt", "cp", "ckp", "kontr po", "chp", "check point", "fahrzeugkontrolle", "fz kontrolle", "personenkontrolle"], "anlage", { ...SITE, lean: "feind", placement: "strasse", noun: "Checkpoint", pl: "Checkpoints", prio: 3, tag: "Kontr" }),
  E("verkehrsposten", "Verkehrsposten", "Anlagen und Orte", "G?SPPO----****X", ["verkehrsposten", "verkehrskontrolle", "verkehrsregelung", "tcp", "vrk po", "verkehrsregler"], "anlage", { ...SITE, placement: "strasse", pl: "Verkehrsposten", prio: 3, tag: "Vrk" }),
  E("lager", "Lager / Depot", "Anlagen und Orte", "G?SPPSZ---****X", ["lager", "depot", "materiallager", "mat lager", "magazin", "vsg pl", "versorgungsplatz"], "anlage", { ...SITE, noun: "Lager", g: "n", tag: "Mat" }),
  // alter Schlüssel: Name wie in früheren Übungen («Übergabe / Munitionslager»)
  E("mun_lager", "Übergabe / Munitionslager", "Anlagen und Orte", "G?SPPAS---****X", ["munitionslager", "mun lager", "munition", "mun", "mun dep", "mun pl", "munitionsdepot", "übergabe munitionslager", "munitionsübergabe", "mun übergabe"], "anlage", { ...SITE, noun: "Munitionslager", g: "n", prio: 3, tag: "Mun" }),
  E("treibstoff", "Treibstoff", "Anlagen und Orte", "G?SPPSC---****X", ["treibstoff", "betriebsstoff", "tankstelle", "treibstofflager", "diesel", "bst pl", "benzin"], "anlage", { ...SITE, noun: "Treibstofflager", g: "n", tag: "Bst" }),
  E("log_pt", "Logistikpunkt", "Anlagen und Orte", "G?SPPL----****X", ["log pt", "log punkt", "log pkt", "logistikpunkt", "abgabestelle", "abgabepunkt", "versorgungspunkt"], "anlage", { ...SITE, pl: "Logistikpunkte", tag: "Log" }),
  E("san_hist", "Sanitätshilfsstelle / Spital", "Anlagen und Orte", "S?GPIXH--------", ["san hist", "sanitätshilfsstelle", "spital", "lazarett", "san po", "sanitätsposten", "mil spital", "notfallstation"], "anlage", { ...SITE, noun: "Sanitätshilfsstelle", g: "f", pl: "Sanitätshilfsstellen" }),
  E("verwundetennest", "Verwundetennest", "Anlagen und Orte", "G?SPPY----****X", ["verwundetennest", "vw nest", "verw nest", "patientensammelstelle", "verwundetensammelstelle"], "anlage", { ...SITE, g: "n", tag: "Verw" }),
  E("landeplatz", "Landeplatz", "Anlagen und Orte", "E?FPLF---------", ["landeplatz", "lz", "heli landeplatz", "helikopterlandeplatz", "landezone", "lde pl"], "anlage", { ...SITE, pl: "Landeplätze" }),
  E("bruecke", "Brücke", "Anlagen und Orte", "S?GPIMNB-------", ["brücke", "brücken", "übergang", "steg", "viadukt"], "anlage", { ...SITE, g: "f", pl: "Brücken", prio: 1 }),
  E("sammelplatz", "Sammelplatz", "Anlagen und Orte", "G?GPGPPR--****X", ["sammelplatz", "sammel pl", "sammelpunkt", "smpl", "treffpunkt", "sammelort"], "anlage", { ...SITE, tag: "Smpl" }),
  // 2525C kennt den Bereitstellungsraum nur als Fläche (G*G*GAA…), milsymbol zeichnet nur Punkte: allgemeiner
  // Aktionspunkt (G*G*GPP) mit Beschriftung «BR» statt «Start Point» (GPPS)
  E("sammelraum", "Bereitstellungsraum / Sammelraum", "Anlagen und Orte", "G?GPGPP---****X", ["bereitstellungsraum", "bereitstellung", "ber raum", "bereitschaftsraum", "sammelraum", "warteraum"], "anlage", { ...SITE, noun: "Bereitstellungsraum", pl: "Bereitstellungsräume", inPhrase: "in Bereitstellung", tag: "BR" }),

  // ---------- Hindernisse
  E("sperre", "Sperre (allg.)", "Hindernisse", "G?OPPR----****X", ["sperre", "hindernis", "spr", "barrikade", "absperrung", "gesperrt"], "grafik", { ...OBST, noun: "Sperre", pl: "Sperren" }),
  E("strassensperre", "Strassensperre", "Hindernisse", "G?OPPR----****X", ["strassensperre", "str sperre", "strassenblockade", "strassenblockierung", "roadblock", "road block"], "grafik", { ...OBST, pl: "Strassensperren" }),
  E("panzersperre", "Panzersperre", "Hindernisse", "G?MPOAOF--****X", ["panzersperre", "pz sperre", "höcker", "panzerhindernis", "pz hindernis", "tankfalle", "panzergraben"], "grafik", { ...OBST, pl: "Panzersperren" }),
  E("minensperre", "Minensperre / Minenfeld", "Hindernisse", "G?MPOFS---****X", ["minensperre", "minenfeld", "min sperre", "mi sperre", "minen", "verminung", "vermint"], "grafik", { ...OBST, noun: "Minensperre", pl: "Minensperren" }),
  E("mine", "Einzelmine", "Hindernisse", "G?MPOMU---****X", ["mine", "einzelmine", "landmine"], "grafik", { ...OBST, placement: "frei", noun: "Mine", pl: "Minen" }),
  E("pz_mine", "Panzermine", "Hindernisse", "G?MPOMT---****X", ["pz mine", "panzermine", "at mine"], "grafik", { ...OBST, placement: "frei", pl: "Panzerminen" }),
  E("pers_mine", "Personenmine", "Hindernisse", "G?MPOMP---****X", ["pers mine", "personenmine", "ap mine", "springmine"], "grafik", { ...OBST, placement: "frei", pl: "Personenminen" }),
  E("sprengobjekt", "Sprengobjekt (vorbereitete Sprengung)", "Hindernisse", "O?VPB----------", ["sprengobjekt", "spr obj", "spreng obj", "vorbereitete sprengung", "sprengladung", "sprengsatz geladen", "geladene brücke"], "grafik", { ...OBST, noun: "Sprengobjekt", g: "n", pl: "Sprengobjekte" }),
  // 2525C kennt Drahthindernisse nur als Linie (G*M*OW…), milsymbol zeichnet nur Punkte; OAOP wäre «bewegliche
  // Tetraeder» (Panzerhindernis) und damit falsch. Deshalb allgemeiner Punkt (G*G*GPP) mit Beschriftung «Draht».
  E("stacheldraht", "Stacheldraht / Drahthindernis", "Hindernisse", "G?GPGPP---****X", ["stacheldraht", "draht", "drahthindernis", "drahtsperre", "nato draht", "concertina", "s draht"], "grafik", { ...OBST, placement: "frei", noun: "Drahthindernis", g: "n", pl: "Drahthindernisse", tag: "Draht" }),
  E("ied", "IED (Sprengfalle)", "Hindernisse", "S?GPEXI--------", ["ied", "ueid", "sprengsatz", "improvisierter sprengsatz", "usbv", "rohrbombe", "bombe"], "grafik", { ...OBST, noun: "IED", pl: "IEDs" }),
  E("vbied", "Fahrzeug-IED (VBIED)", "Hindernisse", "S?GPEXI---MO---", ["vbied", "fahrzeug ied", "autobombe", "fz ied", "fahrzeugbombe"], "grafik", { ...OBST, noun: "Fahrzeug-IED", pl: "Fahrzeug-IEDs", prio: 5 }),
  E("sprengfalle", "Sprengfalle", "Hindernisse", "G?MPOB----****X", ["sprengfalle", "booby trap", "stolperdraht", "stolperfalle"], "grafik", { ...OBST, placement: "frei", pl: "Sprengfallen" }),

  // ---------- Tätigkeiten
  E("patrouille", "Patrouille", "Tätigkeiten", "G?OPPT----****X", ["patrouille", "patr", "pat", "streife", "patrouillieren", "patrouilliert"], "taetigkeit", { lean: "feind", g: "f", pl: "Patrouillen", prio: 3 }),
  E("hinterhalt", "Hinterhalt", "Tätigkeiten", "G?OPVU----****X", ["hinterhalt", "überfall", "hinterhalte", "auflauern"], "taetigkeit", { ...ACT, hostile: true, placement: "strasse", pl: "Hinterhalte" }),
  E("kontakt", "Kontakt / Feuerkontakt", "Tätigkeiten", "E?IPBF---------", ["kontakt", "feuerkontakt", "feuergefecht", "gefecht", "schusswechsel", "schuss", "schüsse", "schuss gehört", "schüsse gehört", "schussabgabe", "schussabgaben", "schiesserei", "beschossen", "entdeckt", "feuer eröffnet"], "taetigkeit", { ...ACT, noun: "Kontakt",
    forms: { schuss: ["Schuss", "Schüsse", "m"], "schuss gehört": ["Schuss gehört", "Schüsse gehört", "m"], schüsse: ["Schuss", "Schüsse", "m", true], "schüsse gehört": ["Schuss gehört", "Schüsse gehört", "m", true] } }),
  E("beschuss", "Beschuss / Einschlag", "Tätigkeiten", "G?OPVI----****X", ["beschuss", "einschlag", "einschläge", "art feuer", "mw feuer", "granateinschlag", "steilfeuer", "indirektes feuer", "artilleriefeuer"], "taetigkeit", { ...ACT, hostile: true, noun: "Beschuss" }),
  E("zerstoerung", "Zerstörung", "Tätigkeiten", "G?TPD-----****X", ["zerstörung", "vernichtung"], "taetigkeit", { ...EVT, g: "f" }),
  E("sprengung", "Sprengung erfolgt", "Tätigkeiten", "E?IPBC---------", ["sprengung", "gesprengt", "sprengung erfolgt", "sprengungen", "detoniert"], "taetigkeit", { ...ACT, noun: "Sprengung", g: "f", pl: "Sprengungen" }),
  E("durchsuchung", "Durchsuchung", "Tätigkeiten", "O?OPF----------", ["durchsuchung", "durchsucht", "durchsuchen", "absuchen", "razzia"], "taetigkeit", { ...ACT, g: "f", pl: "Durchsuchungen" }),
  E("minenlegen", "Minen verlegen", "Tätigkeiten", "O?OPM----------", ["minen verlegen", "minenverlegung", "minen legen", "verlegt minen", "minenleger"], "taetigkeit", { ...ACT, hostile: true, noun: "Minenverlegung", g: "f", prio: 5 }),
  E("festnahme", "Festnahme", "Tätigkeiten", "O?OPA----------", ["festnahme", "festgenommen", "verhaftung", "verhaftet", "arretiert", "gefangennahme", "gefangen genommen"], "taetigkeit", { ...EVT, g: "f", pl: "Festnahmen" }),
  E("gefangene", "Gefangene", "Tätigkeiten", "G?SPPE----****X", ["gefangene", "gefangener", "kgf", "kriegsgefangene", "gefangenensammelstelle", "inhaftierte"], "taetigkeit", { ...EVT, g: "p", dat: "Gefangenen", tag: "Gef" }),
  E("uebergabe", "Übergabe / Verbindungspunkt", "Tätigkeiten", "G?GPGPPL--****X", ["übergabe", "übergabepunkt", "gefangenenübergabe", "materialübergabe", "kontaktpunkt", "übergeben", "verbindungspunkt", "verbindungsaufnahme"], "taetigkeit", { ...EVT, noun: "Übergabe", g: "f", pl: "Übergaben", tag: "Überg" }),

  // ---------- Ereignisse
  E("explosion", "Explosion", "Ereignisse", "O?VPE----------", ["explosion", "detonation", "explodiert", "knall", "explosionen"], "ereignis", { ...EVT, g: "f", pl: "Explosionen" }),
  E("ied_anschlag", "IED-Anschlag", "Ereignisse", "O?VPEI---------", ["ied anschlag", "ied explosion", "anschlag", "sprengstoffanschlag", "bombenanschlag"], "ereignis", { ...EVT, hostile: true, placement: "strasse", prio: 5 }),
  E("brand", "Brand", "Ereignisse", "E?IPC----------", ["brand", "brennt", "brennend", "brennendes", "flammen", "waldbrand", "feuersbrunst", "rauch"], "ereignis", { ...EVT, pl: "Brände" }),
  E("unfall", "Unfall", "Ereignisse", "O?OPCB---------", ["unfall", "verkehrsunfall", "kollision", "zusammenstoss", "unfälle", "verunfallt"], "ereignis", { ...EVT, placement: "strasse", pl: "Unfälle" }),
  E("verletzte", "Verletzte / Verluste", "Ereignisse", "O?OPC----------", ["verletzte", "verletzter", "verwundete", "verwundeter", "verletzt", "verwundet", "tote", "toter", "gefallene", "gefallener", "verluste", "verlust"], "ereignis", { ...EVT, noun: "Verletzte", g: "p", dat: "Verletzten",
    forms: {
      verletzter: ["Verletzter", "Verletzte", "m"], verletzte: ["Verletzter", "Verletzte", "m", true], verletzt: ["Verletzter", "Verletzte", "m"],
      verwundeter: ["Verwundeter", "Verwundete", "m"], verwundete: ["Verwundeter", "Verwundete", "m", true], verwundet: ["Verwundeter", "Verwundete", "m"],
      toter: ["Toter", "Tote", "m"], tote: ["Toter", "Tote", "m", true], gefallener: ["Gefallener", "Gefallene", "m"], gefallene: ["Gefallener", "Gefallene", "m", true],
      verlust: ["Verlust", "Verluste", "m"], verluste: ["Verlust", "Verluste", "m", true],
    } }),
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
    if (score === 99 || e.hidden) return;
    scored.push([score, i, e]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((x) => x[2]);
}

/** Ergebnis der Zeichen-Suche mit Stufe/Zugehörigkeit/Status aus dem Suchtext */
export interface TacticalSearch {
  entries: CatalogEntry[];
  echelon?: Echelon;
  aff?: Affiliation;
  status?: Status;
  /** Suchtext ohne Stufe, Zugehörigkeit und Status (z. B. «inf» aus «1 gn hz inf») */
  rest: string;
}

/** Vollständigen SIDC bilden: Zugehörigkeit, Status (vermutet = gestrichelt), Stufe. */
export function buildSidc(e: CatalogEntry, aff: Affiliation, o: { echelon?: Echelon; status?: Status } = {}): string {
  const c = e.sidc.split("");
  c[1] = aff;
  // Tätigkeiten/Grafiken (G…, O…, E…) kennen nur P/A; zerstört/beschädigt nur bei Einheiten und Geräten (S…)
  const st = o.status ?? "present";
  c[3] = st === "anticipated" ? "A" : c[0] === "S" ? STATUS_CODE[st] : "P";
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
  /**
   * aus dem Text erkannte Zugehörigkeit (gn → H, eig → F, unklar/verdächtig → U), sonst null.
   * «möglich/vermutet» ohne «gn»: H bei inhärent feindlichen Zeichen (IED, Minen, Sperre, Hinterhalt …), sonst U.
   */
  aff: Affiliation | null;
  /** Zugehörigkeit steht ausdrücklich im Text («gn», «eig», «Feind»), nicht nur nach Doktrin abgeleitet */
  explicitAff?: boolean;
  status: Status;
  /** ausgeschriebener Sinn, z. B. «1 gegnerischer Halbzug Infanterie» */
  description: string;
  /** Adjektiv aus dem Text, z. B. «möglich», «vermutet», «zerstört», «verdächtig» (für `describeTactical`) */
  statusWord?: string;
  /** Zusatz, z. B. «in Stellung», «mit 3 Schützenpanzern», «mit Verletzten» */
  extra?: string;
  /** Wort für die Stufe aus dem Text, z. B. «abt» (→ «Abteilung» statt «Bataillon») */
  echelonWord?: string;
  /** gelesener Begriff (normalisiert), z. B. «verletzter» → richtige Einzahl/Mehrzahl im Sinn */
  word?: string;
  /** Tätigkeit des Elements, z. B. «Angriff», «Halt», «Verschiebung», «Rückzug», «Beobachtung» */
  action?: string;
  /** Kolonne: Fahrzeugart, wenn nur eine genannt ist (z. B. «lw» bei «Kolonne 4 Duro») */
  of?: string;
  /** Kolonne: Zusammensetzung bei mehreren Fahrzeugarten, z. B. «3 Lastwagen, 2 Personenwagen» */
  parts?: string;
  /** Stärke in Personen (z. B. «Pat 3 Pers»); dann ist `count` die Personenzahl, nicht die Anzahl Zeichen */
  persons?: number;
  /** Textstellen [Anfang, Ende), die als taktische Begriffe gelesen wurden (z. B. damit «Kp» in «1 Kp Pz» kein Melder ist) */
  spans: Array<[number, number]>;
}

export interface ReadOptions {
  /** Textstellen [Anfang, Ende), die nicht gelesen werden (Melder und Elementnamen wie «H05», «Det 2») */
  skip?: Array<[number, number]>;
}

interface StHit { adj?: string; st?: Status; unclear?: boolean }
type Hit =
  | { t: "e"; e: CatalogEntry; weak?: boolean }
  | { t: "ech"; ech: Echelon; weak?: boolean; word?: string }
  | { t: "aff"; aff: Affiliation }
  | ({ t: "st" } & StHit)
  | { t: "act"; word: string; g: Genus }
  | { t: "fill" };

const AFF_WORDS: Array<[string, Affiliation]> = [
  ["gn", "H"], ["gegn", "H"], ["gegner", "H"], ["gegnerisch", "H"], ["gegnerische", "H"], ["gegnerischer", "H"], ["gegnerisches", "H"],
  ["gegnerischen", "H"], ["fe", "H"], ["feind", "H"], ["feindl", "H"], ["feindlich", "H"], ["feindliche", "H"], ["feindlicher", "H"],
  ["feindliches", "H"], ["feindlichen", "H"], ["rot", "H"], ["seite rot", "H"],
  ["eig", "F"], ["eigen", "F"], ["eigene", "F"], ["eigener", "F"], ["eigenes", "F"], ["eigenen", "F"],
];
const ANT = (adj: string): StHit => ({ adj, st: "anticipated" });
const words = (list: string, h: StHit): Array<[string, StHit]> => list.split(" ").map((w) => [w, h]);
/**
 * Doktrin: «möglich/vermutet/vmtl/evtl» = Status vermutet (gestrichelt); «unklar/unbekannt» und «verdächtig» betreffen
 * nur die Zugehörigkeit (U, nicht gestrichelt); «zerstört»/«beschädigt» = Status X/D.
 */
const STATUS_WORDS: Array<[string, StHit]> = [
  ...words("mögl möglich mögliche möglicher mögliches möglichen möglicherweise evtl eventuell allenfalls", ANT("möglich")),
  ...words("vermutlich verm vmtl vermutl vermutet vermutete vermuteter vermutetes vermuteten mutmasslich mutmassliche mutmasslicher mutmassliches wahrscheinlich wahrsch", ANT("vermutet")),
  ...words("geplant geplante geplanter geplantes", ANT("geplant")),
  ...words("verdacht verdächtig verdächtige verdächtiger verdächtiges verdächtigen", { adj: "verdächtig", unclear: true }),
  ...words("unklar unklare unklarer unklares unbekannt unbekannte unbekannter unbekanntes", { unclear: true }),
  ...words("zerstört zerstörte zerstörter zerstörtes vernichtet ausgeschaltet abgeschossen ausgebrannt", { adj: "zerstört", st: "destroyed" }),
  ...words("beschädigt beschädigte beschädigter beschädigtes fahrunfähig bewegungsunfähig liegengeblieben", { adj: "beschädigt", st: "damaged" }),
];
/** Tätigkeiten eines Elements: Zeichen bleibt das Element, die Tätigkeit kommt in den Sinn */
const ACTIONS: Array<[string, string, Genus]> = [
  ["angriff", "Angriff", "m"], ["angriffe", "Angriff", "m"], ["greift an", "Angriff", "m"], ["greift", "Angriff", "m"], ["angreifen", "Angriff", "m"], ["griff an", "Angriff", "m"],
  ["halt", "Halt", "m"], ["hält", "Halt", "m"], ["angehalten", "Halt", "m"], ["stopp", "Halt", "m"], ["stoppt", "Halt", "m"], ["gestoppt", "Halt", "m"],
  ["verschiebung", "Verschiebung", "f"], ["verschiebt", "Verschiebung", "f"], ["verschieben", "Verschiebung", "f"], ["verschoben", "Verschiebung", "f"],
  ["rückzug", "Rückzug", "m"], ["zieht sich zurück", "Rückzug", "m"], ["zurückgezogen", "Rückzug", "m"], ["setzt sich ab", "Rückzug", "m"], ["absetzen", "Rückzug", "m"],
  ["beobachtung", "Beobachtung", "f"], ["beobachtet", "Beobachtung", "f"], ["beobachten", "Beobachtung", "f"],
];
const FILLERS = ["x", "ca", "circa", "etwa", "rund", "mind", "mindestens", "min", "ungefähr", "zirka"];

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
    if (n.length >= 6 && !n.includes(" ") && (e.kind === "einheit" || e.kind === "geraet")) LONG.push([n, e]);
  }
  put(e.name.replace(/\(.*?\)/g, ""), { t: "e", e });
}
for (const ech of ECHELONS) {
  for (const a of ech.aliases) put(a, { t: "ech", ech: ech.key, weak: a.length === 1, word: a });
  put(ech.pl, { t: "ech", ech: ech.key });
}
for (const [w, aff] of AFF_WORDS) put(w, { t: "aff", aff });
for (const [w, h] of STATUS_WORDS) put(w, { t: "st", ...h });
for (const [w, word, g] of ACTIONS) put(w, { t: "act", word, g });
for (const w of FILLERS) put(w, { t: "fill" });
LONG.sort((a, b) => b[0].length - a[0].length);
const ECH_WORDS = ECHELONS.flatMap((x) => x.aliases.filter((a) => a.length >= 3).map((a) => [a, x.key] as [string, Echelon])).sort((a, b) => b[0].length - a[0].length);
const SUFFIXES = ["ern", "en", "er", "es", "e", "n", "s"];

/**
 * Ist das Wort ein taktischer Begriff? `kinds` schränkt ein: «e» = Zeichen, «ech» = Stufe, «st» = Status …
 * (z. B. damit «Pat 3 Pers» als Patrouille mit 3 Personen gelesen wird und nicht als Element «Pat 3»).
 */
export function isTacticalWord(word: string, kinds: Array<Hit["t"]> = ["e"]): boolean {
  const n = normTerm(word);
  const hits = DICT.get(n) ?? DICT.get(umlautFree(n));
  return !!hits?.some((h) => kinds.includes(h.t));
}

/** Zählbarer Begriff (Einheit oder Gerät), z. B. «Pers», «Fz», «Kpz» – nach einer Zahl ist sie eine Anzahl */
export function isCountableWord(word: string): boolean {
  const n = normTerm(word);
  const hits = DICT.get(n) ?? DICT.get(umlautFree(n));
  return !!hits?.some((h) => h.t === "e" && (h.e.kind === "einheit" || h.e.kind === "geraet"));
}

/** Wort; `brk` = davor steht ein Satzzeichen (Komma, Strichpunkt), das Begriffe trennt */
interface Tok { s: string; a: number; b: number; num?: number; brk?: boolean }
const TOK_RE = /[\p{L}\d'’]+/gu;

function tokenize(text: string, skip: Array<[number, number]> = []): Tok[] {
  const out: Tok[] = [];
  let last = 0;
  for (const m of text.matchAll(TOK_RE)) {
    const raw = m[0];
    let s = raw.toLowerCase();
    const a = m.index!;
    const t: Tok = { s, a, b: a + s.length };
    if (/[,;]/.test(text.slice(last, a))) t.brk = true;
    last = t.b;
    if (skip.some(([x, y]) => a < y && t.b > x)) { t.s = "\u0000"; out.push(t); continue; }
    // «KP» (gross) = Kommandoposten, «Kp» = Kompanie
    if (raw === "KP") s = "kommandoposten";
    else if (/^\d{1,3}x?$/.test(s)) { t.num = parseInt(s, 10); if (s.endsWith("x")) s = s.slice(0, -1); }
    else if (/^x\d{1,3}$/.test(s)) t.num = parseInt(s.slice(1), 10);
    t.s = s;
    out.push(t);
  }
  return out;
}

interface Found { h: Hit; i: number; n: number; len: number; sub?: boolean; key: string }

function lookup(tokens: Tok[], i: number): Found | null {
  for (let n = Math.min(MAXW, tokens.length - i); n >= 1; n--) {
    const ws = tokens.slice(i, i + n).map((t) => t.s);
    if (ws.includes("\u0000")) continue;
    const key = ws.join(" ");
    let hits = DICT.get(key);
    if (!hits && n > 1) hits = DICT.get(ws.join(""));
    if (hits) return { h: hits[0]!, i, n, len: key.length, key };
  }
  const s = tokens[i]!.s;
  if (s.length >= 5 && !/\d/.test(s)) {
    for (const suf of SUFFIXES) {
      if (s.endsWith(suf) && s.length - suf.length >= 4) {
        const k = s.slice(0, -suf.length);
        const hits = DICT.get(k);
        if (hits && hits[0]!.t === "e") return { h: hits[0]!, i, n: 1, len: s.length - suf.length, key: k };
      }
    }
  }
  return null;
}

/** zusammengesetzte Wörter: «Infanteriezug» = Infanterie + Zug, «Lastwagenkolonne» enthält «lastwagen» */
function compound(tok: Tok): { e?: CatalogEntry; ech?: Echelon; len: number; head?: string } | null {
  const s = tok.s;
  if (s.length < 7 || /\d/.test(s)) return null;
  for (const [w, ech] of ECH_WORDS) {
    if (s.endsWith(w) && s.length > w.length + 2) {
      let head = s.slice(0, -w.length);
      let hits = DICT.get(head);
      if (!hits && head.endsWith("s")) { head = head.slice(0, -1); hits = DICT.get(head); }
      const h = hits?.find((x) => x.t === "e");
      if (h && h.t === "e") return { e: h.e, ech, len: s.length, head };
    }
  }
  for (const [w, e] of LONG) if (s.includes(w)) return { e, len: w.length };
  return null;
}

const ADJ_END: Record<Genus, string> = { m: "er", f: "e", n: "es", p: "e" };
/** starke Beugung nach Zahl / ohne Artikel: «gegnerischer Zug», «gegnerische Gruppe», «2 gegnerische Fahrzeuge» */
function inflect(adj: string, g: Genus): string {
  return adj + ADJ_END[g];
}
/** Dativ nach «mit»: «mit gegnerischem Zug», «mit gegnerischer Gruppe», «mit 2 gegnerischen Fahrzeugen» */
const DAT_END: Record<Genus, string> = { m: "em", f: "er", n: "em", p: "en" };
const datPl = (pl: string) => (/[ns]$/.test(pl) ? pl : pl + "n");
const capFirst = (s: string) => s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());

const STATUS_ADJ: Partial<Record<Status, string>> = { anticipated: "vermutet", destroyed: "zerstört", damaged: "beschädigt" };

/** Nomen (Einzahl/Mehrzahl, Geschlecht) für einen Eintrag; `word` wählt eine Form («Toter», «Verletzter», «Pw») */
function nounOf(e: CatalogEntry, many: boolean | undefined, word?: string): { s: string; g: Genus } {
  const f = word ? e.forms?.[word] : undefined;
  if (f) {
    const pl = many ?? f[3] ?? false;
    return { s: pl ? f[1] : f[0], g: pl ? "p" : f[2] };
  }
  const noun = e.noun ?? e.name.replace(/\s*\(.*?\)\s*/g, " ").split(" / ")[0]!.trim();
  if (many) return { s: e.pl ?? noun, g: "p" };
  return { s: noun, g: e.g ?? "m" };
}

/** Kopf des Sinns: Stufe + Truppengattung, z. B. «Halbzug Infanterie», «Kommandoposten (Kompanie)» */
function headOf(e: CatalogEntry, echelon: Echelon | undefined, echelonWord: string | undefined, many: boolean | undefined, word?: string): { s: string; g: Genus } {
  const ech0 = echelon && e.echelonable ? ECHELONS.find((x) => x.key === echelon) : undefined;
  const ech = ech0 && echelonWord && ECH_WORD[echelonWord] ? { ...ech0, ...ECH_WORD[echelonWord] } : ech0;
  if (ech && echelon !== e.echelon) {
    // Stab / Kommandoposten: Stufe in Klammern («Kommandoposten (Kompanie)»)
    if (e.sidc[10] === "A") { const n = nounOf(e, many, word); return { s: `${n.s} (${ech.name})`, g: n.g }; }
    if (e.key === "einheit") return { s: many ? ech.pl : ech.name, g: many ? "p" : ech.g };
    return { s: `${many ? ech.pl : ech.name} ${nounOf(e, false, word).s}`, g: many ? "p" : ech.g };
  }
  return nounOf(e, many, word);
}

export type DescribeInput = Pick<TacticalReading, "key"> &
  Partial<Pick<TacticalReading, "echelon" | "count" | "statusWord" | "extra" | "echelonWord" | "word" | "action" | "of" | "parts" | "persons" | "status">>;

/**
 * Ausgeschriebener Sinn, z. B. «1 gegnerischer Halbzug Infanterie», «mögliche IED», «2 zerstörte gegnerische Kampfpanzer»,
 * «5 gegnerische Fahrzeuge (Kolonne)», «gegnerischer Zug (Angriff)».
 * @param aff Zugehörigkeit für das Adjektiv (H → «gegnerisch», F → «eigen»), null = ohne
 */
export function describeTactical(r: DescribeInput, aff: Affiliation | null): string {
  const e = catalogEntry(r.key);
  if (!e) return "";
  const persons = r.persons !== undefined && r.count === r.persons && e.key !== "inf_trp";
  const many = persons ? false : r.count !== undefined ? r.count > 1 : undefined;
  const ofE = r.of ? catalogEntry(r.of) : undefined;
  const statusWord = r.statusWord ?? (r.status ? STATUS_ADJ[r.status] : undefined);
  // nur Tätigkeit, kein Element: «Verschiebung», «gegnerischer Rückzug»
  const actionOnly = e.key === "einheit" && !r.echelon && r.action && r.count === undefined;
  const head = actionOnly ? { s: r.action!, g: ACTIONS.find((a) => a[1] === r.action)?.[2] ?? "m" } : ofE ? nounOf(ofE, many ?? false) : headOf(e, r.echelon, r.echelonWord, many, r.word);
  const adjs: string[] = [];
  if (statusWord) adjs.push(inflect(statusWord, head.g));
  const adjAllowed = e.kind !== "ereignis" && e.key !== "kontakt" && e.lean !== "unklar";
  if (adjAllowed && aff === "H") adjs.push(inflect("gegnerisch", head.g));
  if (adjAllowed && aff === "F") adjs.push(inflect("eigen", head.g));
  const suffix: string[] = [];
  if (r.extra) suffix.push(r.extra);
  if (persons) suffix.push(`(${r.persons} ${r.persons === 1 ? "Person" : "Personen"})`);
  if (e.key === "kolonne") suffix.push(r.parts ? `(Kolonne: ${r.parts})` : "(Kolonne)");
  if (r.action && !actionOnly) suffix.push(`(${r.action})`);
  const parts = [r.count !== undefined && !persons ? String(r.count) : "", ...adjs, head.s, ...suffix].filter(Boolean);
  // Satzanfang gross («Elektronische Kriegsführung»), nach Adjektiv klein («gegnerische elektronische Kriegsführung»)
  return parts[0] === head.s ? capFirst(parts.join(" ")) : parts.join(" ");
}

const prioOf = (e: CatalogEntry) =>
  e.prio ?? (e.kind === "grafik" || e.kind === "taetigkeit" || e.kind === "ereignis" ? 4 : e.kind === "geraet" ? 4 : 2);

/** Erkennt das taktische Zeichen inkl. Stufe, Anzahl, Zugehörigkeit, Status und den ausgeschriebenen Sinn. */
export function readTactical(text: string, o: ReadOptions = {}): TacticalReading | null {
  const toks = tokenize(text, o.skip);
  if (!toks.length) return null;
  const found: Found[] = [];
  for (let i = 0; i < toks.length; ) {
    if (toks[i]!.s === "\u0000") { i++; continue; }
    const f = lookup(toks, i);
    if (f) { found.push(f); i += f.n; continue; }
    const c = compound(toks[i]!);
    if (c) {
      if (c.e) found.push({ h: { t: "e", e: c.e }, i, n: 1, len: c.len, sub: true, key: c.head ?? toks[i]!.s });
      if (c.ech) found.push({ h: { t: "ech", ech: c.ech }, i, n: 1, len: 0, sub: true, key: toks[i]!.s });
    }
    i++;
  }
  if (!found.length) return null;
  const isNum = (i: number) => toks[i]?.num !== undefined && !/['’]/.test(toks[i]!.s);
  const near = (f: Found, pred: (g: Found) => boolean) => found.some((g) => g !== f && Math.abs(g.i - f.i) <= 2 && pred(g));
  const ent = (f: Found) => (f.h as { e: CatalogEntry }).e;
  /** Zahl direkt nach dem Begriff ohne Komma dazwischen («Zug 2», «Gr 5») */
  const numAfter = (i: number) => isNum(i) && !toks[i]!.brk;

  // Stufen: «Zug 2», «Kp 3» sind Namen, keine Stufe; «z» nur neben einer Truppengattung
  const echs0 = found.filter((f) => f.h.t === "ech" && !numAfter(f.i + f.n) && (!(f.h as { weak?: boolean }).weak || near(f, (g) => g.h.t === "e")));
  const ents0 = found.filter((f) => f.h.t === "e" && (!f.h.weak || near(f, (g) => g.h.t === "ech")));
  const affs = found.filter((f) => f.h.t === "aff");
  const sts = found.filter((f) => f.h.t === "st");
  const acts = found.filter((f) => f.h.t === "act");
  const skipKinds = new Set(found.filter((f) => f.h.t === "aff" || f.h.t === "st" || f.h.t === "ech" || f.h.t === "fill").map((f) => f.i));
  /** Zahl direkt vor dem Begriff (dazwischen nur gn, mögliche, Stufe, «x», «ca.») */
  const numBefore = (i: number, stop = -1): number | undefined => {
    for (let j = i - 1; j > stop && j >= i - 4; j--) {
      if (toks[j + 1]!.brk) return undefined;
      if (isNum(j)) { const n = toks[j]!.num!; return n > 0 && n < 1000 ? n : undefined; }
      if (!skipKinds.has(j)) return undefined;
    }
    return undefined;
  };

  // «mit»: Begriffe danach sind Ausrüstung / Begleitung, wenn davor schon ein Element oder eine Stufe steht
  // («mit»-Teil endet beim nächsten Komma)
  const mitIdx = toks.findIndex((t) => t.s === "mit");
  const mitEnd = mitIdx < 0 ? -1 : (() => { const k = toks.findIndex((t, j) => j > mitIdx && t.brk); return k < 0 ? toks.length : k; })();
  const hasBefore = mitIdx > 0 && [...ents0, ...echs0].some((f) => f.i < mitIdx);
  const before = (f: Found) => !hasBefore || f.i < mitIdx || f.i >= mitEnd;
  const ents = ents0.filter(before);
  const echs = echs0.filter(before);
  const mitEnts = ents0.filter((f) => !before(f));
  const mitEchs = echs0.filter((f) => !before(f));

  let primary: Found | undefined;
  for (const f of ents) {
    if (!primary) { primary = f; continue; }
    // höherer Rang gewinnt, dann ganzes Wort vor Wortteil, dann der frühere Begriff
    const d = prioOf(ent(f)) - prioOf(ent(primary)) || (primary.sub ? 1 : 0) - (f.sub ? 1 : 0);
    if (d > 0) primary = f;
  }
  const destroyedWord = sts.some((f) => (f.h as StHit).st === "destroyed");
  let entry: CatalogEntry;
  if (primary) entry = ent(primary);
  else if (echs.length || acts.length) entry = catalogEntry("einheit")!;
  else if (destroyedWord) entry = catalogEntry("zerstoerung")!;
  else return null;
  const anchor = primary ?? echs[0] ?? acts[0] ?? sts[0]!;
  let word = primary?.key;

  // Stufe: nächste gültige Stufe bei der Truppengattung
  let echelon: Echelon | undefined;
  let echelonWord: string | undefined;
  let echFound: Found | undefined;
  for (const f of echs) {
    if (Math.abs(f.i - anchor.i) <= 2 && (!echFound || Math.abs(f.i - anchor.i) < Math.abs(echFound.i - anchor.i))) echFound = f;
  }
  let droppedEch: Echelon | undefined;
  if (echFound) {
    echelon = (echFound.h as { ech: Echelon }).ech;
    echelonWord = (echFound.h as { word?: string }).word;
    if (!entry.echelonable && entry.unit) { entry = catalogEntry(entry.unit) ?? entry; word = undefined; }
    if (!entry.echelonable) { droppedEch = echelon; echelon = undefined; echFound = undefined; }
  }
  // Anzahl: Zahl direkt vor dem Begriff
  const first = Math.min(anchor.i, echFound?.i ?? Infinity);
  let count = numBefore(first);
  // Gerät statt Einheit: «3 Mw» = 3 Minenwerfer; Personen ab 8 = Gruppe
  if (count !== undefined && !echelon && entry.kind === "einheit" && entry.geraet && entry.key !== "inf_trp") { entry = catalogEntry(entry.geraet) ?? entry; word = undefined; }
  if (entry.key === "inf_trp" && count !== undefined && count >= 8) entry = catalogEntry("inf_gr")!;
  if (entry.key === "inf_trp" && echelon && echelon !== "trp") entry = catalogEntry("inf")!;
  // allgemeines Element mit Waffen («gn Gr mit 2 Mg») = Infanterie
  if (entry.key === "einheit" && echelon && mitEnts.some((f) => ent(f).category === "Waffen")) entry = catalogEntry("inf")!;

  // Zugehörigkeit und Status
  let aff: Affiliation | null = affs.length ? (affs[0]!.h as { aff: Affiliation }).aff : null;
  const explicitAff = aff !== null;
  let status: Status = "present";
  let statusWord: string | undefined;
  for (const f of sts) {
    const h = f.h as StHit;
    if (h.unclear) { if (!aff) aff = "U"; }
    if (h.st === "anticipated") status = "anticipated";
    else if (h.st && status === "present") status = h.st;
    if (h.adj) statusWord ??= h.adj;
  }
  // zerstört/beschädigt nur bei Einheiten, Geräten und Anlagen (SIDC S…); sonst bleibt es ein Adjektiv
  if ((status === "destroyed" || status === "damaged") && (entry.sidc[0] !== "S" || entry.key === "zerstoerung")) status = "present";
  if (entry.key === "zerstoerung") statusWord = undefined;
  // «möglich/vermutet» ohne «gn»: inhärent feindliche Zeichen bleiben Feind (rot gestrichelt), sonst unklar
  if (status === "anticipated" && !aff) aff = entry.hostile ? "H" : "U";

  // Zusätze
  const extras: string[] = [];
  const others = ents.filter((f) => f !== primary);
  for (const ot of others) {
    const oe = ent(ot);
    if (oe.inPhrase && entry.key !== oe.key && (entry.kind === "einheit" || entry.kind === "geraet") && !extras.includes(oe.inPhrase)) extras.push(oe.inPhrase);
  }
  // Tätigkeit eines Elements mit Stufe: «gn Hz in Hinterhalt» → «gegnerischer Hinterhalt (Halbzug)»
  if (droppedEch && !entry.unit) extras.push(`(${ECHELONS.find((x) => x.key === droppedEch)!.name})`);
  // «mit»: «mit 3 Schützenpanzern», «mit gegnerischer Gruppe», «mit Verletzten» – Gegenstand = erster Begriff nach «mit»,
  // dazu eine Stufe/Truppengattung direkt daneben («mit gn Gr», «mit 2 Pz Gren Zügen»)
  const mitFirst = [...mitEnts, ...mitEchs].sort((a, b) => a.i - b.i)[0];
  const mitE = mitEnts.find((f) => mitFirst && Math.abs(f.i - mitFirst.i) <= 2);
  const mitEch = mitEchs.find((f) => mitFirst && Math.abs(f.i - mitFirst.i) <= 2);
  if (mitE || mitEch) {
    const me = mitE ? ent(mitE) : catalogEntry("einheit")!;
    const mi = Math.min(mitE?.i ?? Infinity, mitEch?.i ?? Infinity);
    const n = numBefore(mi, mitIdx);
    const ech = mitEch && me.echelonable ? (mitEch.h as { ech: Echelon }).ech : undefined;
    const adjAff = affs.find((f) => f.i > mitIdx);
    let phrase: string;
    if (!n && !ech && me.dat) phrase = me.dat;
    else {
      const h = headOf(me, ech, undefined, n !== undefined ? n > 1 : undefined, mitE?.key);
      const noun = h.g === "p" ? (me.dat && !ech ? me.dat : datPl(h.s)) : h.s;
      const adj = adjAff && (adjAff.h as { aff: Affiliation }).aff === "H" ? "gegnerisch" + DAT_END[h.g] : "";
      phrase = [n !== undefined ? String(n) : "", adj, noun].filter(Boolean).join(" ");
    }
    extras.push(`mit ${phrase}`);
  }
  // Stärke in Personen: «Pat 3 Pers»
  let persons: number | undefined;
  if (entry.key !== "inf_trp" && entry.key !== "inf_gr" && entry.key !== "kolonne") {
    const p = others.find((f) => ent(f).key === "inf_trp");
    const n = p ? numBefore(p.i) : undefined;
    if (n !== undefined && count === undefined) { count = n; persons = n; }
  }
  // Verluste neben dem Hauptbegriff: «Kontakt mit gn Gr, 1 Verletzter» → «(1 Verletzter)»
  if (entry.key !== "verletzte") {
    const v = ents0.find((f) => f !== mitE && ent(f).key === "verletzte");
    if (v) {
      const n = numBefore(v.i);
      extras.push(`(${describeTactical({ key: "verletzte", count: n, word: v.key }, null)})`);
    }
  }
  // verletzte Zivilperson
  if (entry.key === "verletzte" && others.some((f) => ent(f).key === "zivil")) extras.push("(Zivilperson)");
  // Kolonne: Anzahl aus den Fahrzeugen («Fz-Kolonne 5 Fz», «Kolonne 3 Lastw 2 Pw»)
  let of: string | undefined;
  let parts: string | undefined;
  if (entry.key === "kolonne") {
    const sum = new Map<string, { e: CatalogEntry; n: number; word?: string }>();
    for (const f of others) {
      const fe = ent(f);
      if (fe.kind !== "geraet" || fe.category !== "Fahrzeuge") continue;
      const n = numBefore(f.i) ?? 1;
      const cur = sum.get(fe.key);
      if (cur) cur.n += n; else sum.set(fe.key, { e: fe, n, word: f.key });
    }
    if (sum.size) {
      count = [...sum.values()].reduce((a, b) => a + b.n, 0);
      if (sum.size === 1) of = [...sum.keys()][0];
      else parts = [...sum.values()].map((x) => `${x.n} ${nounOf(x.e, x.n > 1, x.word).s}`).join(", ");
    } else {
      // «Lastwagenkolonne»: Fahrzeugart im Wort
      const k = primary?.key ?? "";
      of = LONG.find(([w, e]) => e.category === "Fahrzeuge" && e.key !== "kolonne" && k !== w && k.includes(w))?.[1].key;
    }
  }
  const action = acts.length ? (acts[0]!.h as { word: string }).word : undefined;
  const extra = extras.length ? extras.join(" ") : undefined;

  const spans: Array<[number, number]> = [];
  for (const f of [primary, echFound, mitE, mitEch, ...affs, ...sts, ...acts, ...others].filter(Boolean) as Found[]) spans.push([toks[f.i]!.a, toks[f.i + f.n - 1]!.b]);
  if (word && !entry.forms?.[word]) word = undefined;
  const base: DescribeInput = { key: entry.key, echelon, count, statusWord, extra, echelonWord, word, action, of, parts, persons };
  const sidcEntry = of ? catalogEntry(of)! : entry;
  return {
    ...base,
    sidc: buildSidc(sidcEntry, aff ?? "U", { echelon, status }),
    aff,
    explicitAff,
    status,
    description: describeTactical(base, explicitAff ? aff : null),
    spans,
  } as TacticalReading;
}

// ---------- Zeichen-Suche mit Stufe / Zugehörigkeit / Status

const SEARCH_AFF: Record<string, Affiliation> = { neutral: "N", neutrale: "N", neutraler: "N", neutrales: "N", ntr: "N" };

/**
 * Suche für die Zeichen-Auswahl, die auch Stufe, Zugehörigkeit und Status aus dem Suchtext liest:
 * «hz inf» → Infanterie, Halbzug; «Halbzug» → alle Zeichen mit Stufe (Kampftruppen zuerst);
 * «gn Zug Pz Gren» → Panzergrenadiere, Zug, Feind; «vermutete IED» → IED, vermutet. Verborgene Einträge nie.
 */
export function searchTactical(q: string, limit = 40): TacticalSearch {
  const toks = tokenize(q);
  let echelon: Echelon | undefined;
  let aff: Affiliation | undefined;
  let status: Status | undefined;
  const restWords: string[] = [];
  for (let i = 0; i < toks.length; ) {
    const t = toks[i]!;
    if (t.num !== undefined) { i++; continue; }
    if (SEARCH_AFF[t.s]) { aff = SEARCH_AFF[t.s]; i++; continue; }
    // mehrteilige Zeichenbegriffe zuerst («pz gren» ist ein Zeichen)
    const f = lookup(toks, i);
    if (f && f.h.t !== "e") {
      const h = f.h;
      // «z» nur als Stufe, wenn noch etwas anderes dasteht
      if (h.t === "ech" && !(h.weak && toks.length === 1)) { echelon = h.ech; i += f.n; continue; }
      if (h.t === "aff") { aff = h.aff; i += f.n; continue; }
      if (h.t === "st") {
        if (h.st) status = h.st;
        if (h.unclear) aff = "U";
        i += f.n; continue;
      }
      if (h.t === "fill") { i += f.n; continue; }
    }
    // Stufe als Wortteil: «Infanteriezug», «Füsilierhalbzug»
    const c = compound(t);
    if (c?.ech && c.e && c.head) { echelon ??= c.ech; restWords.push(c.head); i++; continue; }
    restWords.push(t.s);
    i++;
  }
  const rest = restWords.join(" ").trim();
  let entries: CatalogEntry[];
  if (rest) {
    entries = searchCatalog(rest, limit * 2);
    if (!entries.length) {
      const r = readTactical(q);
      const e = r ? catalogEntry(r.key) : undefined;
      if (e && !e.hidden && e.key !== "einheit") entries = [e];
      if (r?.echelon) echelon ??= r.echelon;
    }
  } else {
    entries = CATALOG.filter((e) => !e.hidden);
  }
  if (echelon) {
    // mit Stufe: Gerät → zugehörige Einheit («Spz Zug» = Zug Panzergrenadiere), nur Zeichen mit Stufe
    const seen = new Set<string>();
    const out: CatalogEntry[] = [];
    for (const e of entries) {
      const u = e.echelonable ? e : e.unit ? catalogEntry(e.unit) : undefined;
      if (u && !u.hidden && !seen.has(u.key)) { seen.add(u.key); out.push(u); }
    }
    entries = out;
  }
  return { entries: entries.slice(0, limit), echelon, aff, status, rest };
}
