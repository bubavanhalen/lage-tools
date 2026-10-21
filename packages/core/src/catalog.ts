/**
 * Vollständiger Zeichenkatalog (APP-6 / MIL-STD-2525C, Buchstaben-SIDC mit 15 Stellen) – GERÜST, wird ausgebaut.
 *
 * SIDC-Vorlage: Stelle 2 = «?» (Zugehörigkeit), Stelle 4 = «P» (wird durch Status ersetzt),
 * Stellen 11–12 = «--» (werden durch die Stufe ersetzt, nur bei Einheiten).
 */
import type { Affiliation } from "./symbols";

export type CatalogKind = "einheit" | "geraet" | "anlage" | "taetigkeit" | "ereignis" | "grafik";
export type Placement = "strasse" | "frei";
/** Stufe (Schweizer Armee) */
export type Echelon = "trp" | "gr" | "hz" | "zug" | "kp" | "bat" | "rgt" | "br" | "div";
export type Status = "present" | "anticipated";

export interface CatalogEntry {
  key: string;
  /** Anzeigename Deutsch, z. B. «Infanterie», «Kampfpanzer», «IED» */
  name: string;
  /** Kategorie für die Auswahl, z. B. «Kampftruppen», «Fahrzeuge», «Hindernisse» */
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
  /** eigene Zeichnung statt milsymbol (z. B. Dreieck Beob Posten) */
  triangle?: boolean;
  /** Tätigkeit/Ereignis am Ort (nicht das Element selbst) */
  activity?: boolean;
}

export const ECHELONS: Array<{ key: Echelon; name: string; code: string; aliases: string[] }> = [
  { key: "trp", name: "Trupp", code: "A", aliases: ["trp", "trupp"] },
  { key: "gr", name: "Gruppe", code: "B", aliases: ["gr", "gruppe"] },
  { key: "hz", name: "Halbzug", code: "C", aliases: ["hz", "halbzug"] },
  { key: "zug", name: "Zug", code: "D", aliases: ["zug", "z"] },
  { key: "kp", name: "Kompanie", code: "E", aliases: ["kp", "kompanie", "bttr", "batterie"] },
  { key: "bat", name: "Bataillon", code: "F", aliases: ["bat", "bataillon", "abt", "abteilung"] },
  { key: "rgt", name: "Regiment", code: "G", aliases: ["rgt", "regiment"] },
  { key: "br", name: "Brigade", code: "H", aliases: ["br", "brigade", "brig"] },
  { key: "div", name: "Division", code: "I", aliases: ["div", "division"] },
];

export const CATALOG: CatalogEntry[] = [
  { key: "einheit", name: "Einheit (allg.)", category: "Allgemein", sidc: "S?GPU----------", aliases: ["einheit", "element", "truppe"], kind: "einheit", echelonable: true },
  { key: "inf", name: "Infanterie", category: "Kampftruppen", sidc: "S?GPUCI--------", aliases: ["inf", "infanterie"], kind: "einheit", echelonable: true },
];

const byKey = new Map(CATALOG.map((e) => [e.key, e]));
export function catalogEntry(key: string): CatalogEntry | undefined {
  return byKey.get(key);
}

/** Suche für die Zeichen-Auswahl (Name, Kürzel, Kategorie). */
export function searchCatalog(q: string, limit = 40): CatalogEntry[] {
  const s = q.trim().toLowerCase();
  if (!s) return CATALOG.slice(0, limit);
  return CATALOG.filter((e) => e.name.toLowerCase().includes(s) || e.aliases.some((a) => a.includes(s)) || e.category.toLowerCase().includes(s)).slice(0, limit);
}

/** Vollständigen SIDC bilden: Zugehörigkeit, Status (vermutet = gestrichelt), Stufe. */
export function buildSidc(e: CatalogEntry, aff: Affiliation, o: { echelon?: Echelon; status?: Status } = {}): string {
  const c = e.sidc.split("");
  c[1] = aff;
  c[3] = o.status === "anticipated" ? "A" : "P";
  if (o.echelon && e.echelonable && c[0] === "S") {
    const ech = ECHELONS.find((x) => x.key === o.echelon);
    if (ech) { c[10] = "-"; c[11] = ech.code; }
  }
  return c.join("");
}

/** Ergebnis der Erkennung taktischer Begriffe in einem Meldungstext */
export interface TacticalReading {
  key: string;
  sidc: string;
  echelon?: Echelon;
  count?: number;
  /** aus dem Text erkannte Zugehörigkeit (gn → H, eig → F, vermutlich/mögliche → U), sonst null */
  aff: Affiliation | null;
  status: Status;
  /** ausgeschriebener Sinn, z. B. «1 gegnerischer Halbzug Infanterie» */
  description: string;
}

/** Erkennt das taktische Zeichen inkl. Stufe, Anzahl, Zugehörigkeit – GERÜST (liefert noch nichts). */
export function readTactical(_text: string): TacticalReading | null {
  return null;
}
