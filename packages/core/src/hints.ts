/**
 * Hinweise zu Rot: Regeln über das Lagejournal (offline, ohne KI).
 * Das Lagejournal gibt Hinweise, keine Fakten – jeder Hinweis nennt Auslöser (Meldungen), Regel und Quelle.
 * Regeln in eigenen Worten; Quelle nur als Reglement-Nummer und Ziffer.
 *
 * Grundsätze der Berechnung:
 * - nur Meldungen bis zur Lagezeit `t` (Abspielen zeigt die Hinweise, wie sie damals erschienen wären);
 * - gelöschte Meldungen zählen nicht, bei mehreren Revisionen gilt die aktuelle (wie `mergeEvents`);
 * - «Rot» = Sichtungen (Art feind, bei Bewegungen/Fahrzeugen/Personen auch unklar), «Blau» = eigene Elemente;
 * - Nachbarschaft über das Führungsraster (8 Nachbarfelder), Abstände in m über LV95.
 *
 * Hinweis-IDs (stabil über Neuberechnungen, damit Entscheide haften) – Schlüssel je Regel:
 *   A1 `A1:<NAI>` · A2 `A2:<NAI>:<erste abweichende Meldung>` · A3 `A3:<NAI>:<letzte Meldung vor der Ruhe>`
 *   B1 `B1:<Präsenz-Meldung>` · B2/B3 `B2|B3:<erste Meldung des Checkpoints>`
 *   C1/C3/C4/C5 `Cx:<erste Meldung der Häufung>` (C3/C4 mit Art bzw. PQ) · C2 `C2:<Element/Fz>:<Ort A>~<Ort B>` · C6 `C6:<Meldung>`
 *   D1 `D1:<eigenes Element>:<Meldung des Stao>` · D2 `D2:<eigenes Element>:<erste Meldung Rot-Stao>`
 *   D3 `D3:<NAI>:<letzte Meldung des Trupps>` bzw. `D3:<NAI>:ohne:<erste Rot-Meldung>`
 *   E3 `E3:<Meldung a>:<Meldung b>` · E4 `E4:<Meldung>`
 * Kommen zur gleichen Situation neue Auslöser hinzu (z. B. eine weitere Durchfahrt), bleibt die ID gleich.
 */
import { catalogEntry, type CatalogEntry, type Echelon } from "./catalog";
import { pointInRing } from "./geo";
import {
  angleDiff, baseCellAt, bearing, centroid, dist, distToRing, sameCell, sameOrNeighbor, type BaseCell,
} from "./hintgeo";
import { areaCenter } from "./journal";
import type { LV95 } from "./lv95";
import type { Area, Exercise, LageEvent } from "./model";

export { baseCellAt, sameOrNeighbor, distToRing, type BaseCell } from "./hintgeo";

// ---------------------------------------------------------------------------------------------
// Schwellen (alle Zeiten in Minuten, Abstände in m)
// ---------------------------------------------------------------------------------------------
export const HINT_THRESHOLDS = {
  /** A1: Lernzeit der Normallage ab erster Meldung der Übung */
  A1_LEARN_MIN: 120,
  /** A1: mindestens so viele Rot-Meldungen im NAI während der Lernzeit, sonst keine Normallage */
  A1_MIN_EVENTS: 3,
  /** A2: gleitendes Fenster für den Vergleich mit der Normallage */
  A2_WINDOW_MIN: 60,
  /** A2: Abweichung ab dem Mehrfachen der Normallage … */
  A2_FACTOR: 2,
  /** … und mindestens so vielen Fz bzw. Personen im Fenster */
  A2_MIN_FZ: 3,
  A2_MIN_PERS: 4,
  /** A2: neue Richtung, wenn sie von allen bekannten Richtungen um mehr als so viele Grad abweicht */
  A2_DIR_DEG: 45,
  /** A3: so lange ohne Rot-Meldung im NAI mit Normallage = auffällige Ruhe */
  A3_QUIET_MIN: 60,
  /** A3: nur wenn in dieser Zeit nach Normallage mindestens so viele Meldungen zu erwarten wären */
  A3_MIN_EXPECTED: 1,
  /** B1: Rot-Bewegung bis so lange nach dem Abzug der eigenen Patrouille */
  B1_AFTER_MIN: 30,
  /** B2: Checkpoint steht länger als … */
  B2_STAND_MIN: 25,
  /** B2: ohne neue Meldung gilt ein Checkpoint höchstens so lange als bestehend */
  B2_MAX_MIN: 180,
  /** B3: Fz entfernt sich vom eigenen Checkpoint (Richtung weg vom CP ± Grad, innerhalb Abstand) */
  B3_AWAY_DEG: 45,
  B3_DIST_M: 1000,
  /** C1: mindestens 2 haltende Fz im gleichen/benachbarten PQ innert … */
  C1_WINDOW_MIN: 10,
  C1_MIN_FZ: 2,
  /** C1: Auslöser im gleichen Raum innert … zusammenfassen */
  C1_GROUP_MIN: 30,
  /** C2: gleiche Strecke (Ort A ↔ Ort B) mindestens so oft befahren */
  C2_MIN_PASSES: 3,
  /** C3: Drohne bzw. dasselbe einzelne Fz mindestens 2× im gleichen/benachbarten PQ innert … */
  C3_WINDOW_MIN: 60,
  C3_MIN_SIGHTINGS: 2,
  /** C4: im gleichen PQ innert … mindestens … Fz oder … Personen (stehend) */
  C4_WINDOW_MIN: 30,
  C4_MIN_FZ: 3,
  C4_MIN_PERS: 6,
  /** C5: Hindernisse im gleichen Raum innert … zusammenfassen */
  C5_GROUP_MIN: 60,
  /** D1: verdächtige Tätigkeit so nahe am eigenen Stao */
  D1_DIST_M: 500,
  /** D2: Rot-Element gilt als Stao, wenn es so lange am gleichen Ort gemeldet ist */
  D2_STAO_MIN: 30,
  /** D3: Trupp gilt als stumm nach … ; Rot «in der Nähe» bis … vom NAI; Rot-Tätigkeit zählt so lange */
  D3_SILENT_MIN: 60,
  D3_NEAR_M: 1000,
  D3_RECENT_MIN: 60,
  /** E1: zweiter Melder innert … mit gleichem Zeichen-Typ im gleichen/benachbarten PQ = bestätigt */
  E1_WINDOW_MIN: 30,
  /** E3: Richtwerte Tempo (km/h) und Ortsunschärfe (m) je Meldung (Planquadrat; NAI zusätzlich) */
  E3_FOOT_KMH: 6,
  E3_FZ_KMH: 90,
  E3_TOL_M: 500,
  E3_NAI_TOL_M: 500,
  /** Flut vermeiden: höchstens so viele Hinweise je Regel (neueste) */
  MAX_PER_RULE: 12,
} as const;

/** Personen je Stufe (Schätzung für «1 Hz Inf» u. ä.) */
const ECHELON_PERS: Record<Echelon, number> = { trp: 4, gr: 8, hz: 15, zug: 30, kp: 100, bat: 500, rgt: 1500, br: 4000, div: 10000 };

const T = HINT_THRESHOLDS;
const MIN = 60000;

// ---------------------------------------------------------------------------------------------
// Vertrag
// ---------------------------------------------------------------------------------------------

/** Regelgruppe */
export type HintGroup = "normallage" | "praesenz" | "absicht" | "rotsiehtblau" | "qualitaet";

/** Wichtigkeit: hoch = Handeln prüfen, mittel = beobachten, info = Referenz */
export type HintLevel = "hoch" | "mittel" | "info";

export interface HintRule {
  /** z. B. «C1» */
  id: string;
  group: HintGroup;
  /** Kurzname, z. B. «Übergabe / Zusammenschluss» */
  name: string;
  /** Regel in eigenen Worten (ein Satz) */
  rule: string;
  /** Quelle als Reglement-Nummer und Ziffer, z. B. «53.005.25 Ziff 184» */
  source?: string;
}

export interface Hint {
  /** stabil über Neuberechnungen: Regel + Ort/Element + Anker-Meldung (siehe Kopf der Datei) */
  id: string;
  rule: string;
  level: HintLevel;
  /** Titel, z. B. «Mögliche Übergabe in AK9» */
  title: string;
  /** Begründung in einem bis zwei Sätzen, mit Zeiten/Orten */
  text: string;
  /** Meldungen, die den Hinweis auslösen (IDs), älteste zuerst */
  events: string[];
  /** Zeitpunkt, ab dem der Hinweis gilt (ISO lokal «YYYY-MM-DDTHH:MM») */
  t: string;
  /** letzte Auslösung bzw. Aktualisierung (ISO lokal), ≥ t – z. B. letzte Durchfahrt eines Pendels */
  last?: string;
  /** Situation vorbei (ISO lokal), z. B. Ruhe durch neue Meldung beendet, Checkpoint abgebaut */
  until?: string;
  /** Ort für Karte (Schwerpunkt der Auslöser; bei D1 der eigene Stao) */
  pos?: LV95;
  /** Planquadrate der Auslöser (Grundfeld, z. B. «AK9») */
  cells?: string[];
  nai?: string;
  /** betroffenes eigenes Element, z. B. «H03» */
  unit?: string;
  /** Prognose, z. B. nächste Durchfahrt (ISO lokal) */
  next?: string;
  /** Radius in m um `pos` für die Karte (D1: Abstand zum Stao) */
  radius?: number;
}

/** Qualität einer einzelnen Meldung (E1/E2) – an der Meldung anzeigen, nicht als Hinweis */
export interface EventQuality {
  /** E1: bestätigt durch zweite Quelle (IDs der bestätigenden Meldungen, älteste zuerst) */
  confirmedBy?: string[];
  /** E1: nur bei Sichtungen (Feind/Unklar): bestätigt oder unbestätigt */
  status?: "bestaetigt" | "unbestaetigt";
  /** E2: fehlende Angaben, z. B. ["Ort", "Melder"] (Rückfrage nach AEIOU) */
  missing?: string[];
}

export interface HintOptions {
  /** Lagezeit (ISO): nur Meldungen bis dahin, Hinweise wie sie zu diesem Zeitpunkt erschienen wären */
  t: string;
  /** Regeln abschalten (IDs) */
  disabled?: string[];
  /** Fehler einer Regel weitergeben (Tests); sonst wird eine fehlerhafte Regel übersprungen */
  strict?: boolean;
}

export const HINT_RULES: HintRule[] = [
  { id: "A1", group: "normallage", name: "Normallage", rule: "In den ersten zwei Stunden wird je NAI gelernt, wie viel Verkehr und welche Richtungen normal sind.", source: "53.005.21 Ziff 123, 159–160" },
  { id: "A2", group: "normallage", name: "Abweichung", rule: "Mehr als doppelt so viel Verkehr wie normal, ein neuer Fz-Typ oder eine neue Richtung deuten auf Bewegung oder Zusammenzug.", source: "53.005.21 Ziff 159–160" },
  { id: "A3", group: "normallage", name: "Plötzliche Ruhe", rule: "Bleibt ein sonst belebtes NAI über eine Stunde ohne Meldung, kann Rot etwas vorbereiten – oder die Sicht ist verloren.", source: "53.005.21 Ziff 159" },
  { id: "B1", group: "praesenz", name: "Reaktion nach Patrouille", rule: "Bewegt sich Rot kurz nachdem die eigene Patrouille einen Raum verlassen hat, reagiert es verzögert (Warnung, Umladen, Material wegbringen).", source: "53.005.23 Ziff 167–172" },
  { id: "B2", group: "praesenz", name: "Checkpoint verbraucht", rule: "Ein Checkpoint, der länger als etwa eine halbe Stunde steht, ist bekannt; der Verkehr weicht aus.", source: "53.005.23 Ziff 178–179; 53.005.25 Ziff 152" },
  { id: "B3", group: "praesenz", name: "Ausweichen vor Checkpoint", rule: "Fahrzeuge, die vor oder neben einem Checkpoint wenden oder abbiegen, sind die eigentlich verdächtigen.", source: "53.005.25 Ziff 184, 195, 202–205" },
  { id: "C1", group: "absicht", name: "Übergabe / Zusammenschluss", rule: "Mehrere kurz haltende Fz am gleichen Ort oder Umladen deuten auf Übergabe oder Zusammenschluss.", source: "TF 17 Ziff 7101; GS 17 Ziff 99" },
  { id: "C2", group: "absicht", name: "Wiederkehrende Route", rule: "Fährt dasselbe Element oder Fz mehrmals dieselbe Strecke, ist es Pendelverkehr – die nächste Durchfahrt lässt sich abschätzen.", source: "TF 17 Ziff 6084" },
  { id: "C3", group: "absicht", name: "Aufklärung vor Aktion", rule: "Taucht eine Drohne oder dasselbe einzelne Fz innert einer Stunde mehrmals im gleichen Raum auf, wird er aufgeklärt.", source: "TF 17 Ziff 5068, 3057, 7187–7189" },
  { id: "C4", group: "absicht", name: "Schwergewicht / Bereitstellung", rule: "Viele stehende Fz oder Personen in einem PQ – besonders wenn es anderswo ruhiger wird – zeigen ein Schwergewicht an.", source: "TF 17 Ziff 5011–5012, 5166–5169" },
  { id: "C5", group: "absicht", name: "Hinterhalt-Gefahr", rule: "Ein Hindernis oder Halt in einem Engnis bzw. eine gemeldete Blockade kann einen Hinterhalt vorbereiten.", source: "53.005.25 Ziff 62, 120–123, 963–964; TF 17 Ziff 7181–7183" },
  { id: "C6", group: "absicht", name: "Formation", rule: "Die Formation verrät die Absicht: Kolonne = Verschiebung, Linie oder Y = Kontakt erwartet, Igel = Halt.", source: "GS 17 Ziff 173" },
  { id: "D1", group: "rotsiehtblau", name: "Eigener Stao aufgeklärt?", rule: "Drohne, haltendes Fz oder Beobachter nahe beim eigenen Stao: Rot hat ihn womöglich entdeckt.", source: "GS 17 Ziff 207–213; TF 17 Ziff 3057" },
  { id: "D2", group: "rotsiehtblau", name: "Stao zu nahe an Rot", rule: "Liegt ein eigener Stao im gleichen oder benachbarten PQ wie ein Rot-Stao, ist das Entdeckungsrisiko hoch.", source: "GS 17 (Stellungswahl)" },
  { id: "D3", group: "rotsiehtblau", name: "Lücke in der Überwachung", rule: "Ein NAI ohne Trupp oder mit stummem Trupp, während Rot in der Nähe aktiv ist, bleibt unbeobachtet.", source: "TF 17 Ziff 7174, 7234" },
  { id: "E1", group: "qualitaet", name: "Bestätigt / unbestätigt", rule: "Eine Sichtung gilt als bestätigt, wenn ein zweiter Melder dasselbe in der Nähe innert 30 Min meldet.", source: "53.005.25" },
  { id: "E2", group: "qualitaet", name: "Unvollständig", rule: "Fehlen Wer, Wo, Wann oder Melder, nachfragen (AEIOU, QUIZ).", source: "GS 17 Ziff 55" },
  { id: "E3", group: "qualitaet", name: "Plausibilität", rule: "Das gleiche Element kann nicht schneller sein als zu Fuss bzw. mit Fz im Gelände möglich – Zeit oder Ort prüfen.", source: "TF 17 Anhang 8" },
  { id: "E4", group: "qualitaet", name: "Fehlinformation", rule: "Dringende, nicht überprüfbare Hinweise ohne Bestätigung können Täuschung sein.", source: "53.005.21 Ziff 163–164" },
];

/** Regel zu einer ID */
export function hintRule(id: string): HintRule | undefined {
  return HINT_RULES.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------------------------
// Erkennung im Text und im Zeichen
// ---------------------------------------------------------------------------------------------
const L = String.raw`\p{L}`;
const word = (alt: string, flags = "iu") => new RegExp(`(?<!${L})(?:${alt})(?!${L})`, flags);

const HALT_RE = word("hält|halten|halt|hielt|hielten|steht|stehen|stand|stoppt|stoppen|parkiert|parkieren|angehalten");
const MOVE_RE = word("fährt|fahren|rollt|rollen|verschiebt|verschieben|bewegt|bewegen|marschiert|marschieren|rtg|richtung");
const TURN_RE = word("wendet|wenden|wendete|dreht ab|drehen ab|biegt ab|biegen ab|kehrt um|kehren um|weicht aus|weichen aus|umfährt|umfahren");
const HANDOVER_RE = /(kofferraum|umlad|lädt\s+\S+\s+um|laden\s+\S+(?:\s+\S+)?\s+um\b|übergabe|übergeben|übergibt|steig(?:t|en)\s+um|umsteig)/iu;
const BLOCK_RE = word("blockiert|blockieren|blockade|hindernis|hindernisse|barrikade|baumstamm|baumstämme|baumstämmen|umgestürzt");
const SPOT_RE = /(handy|telefon|fotograf|filmt|filmen|feldstecher|fernglas|beobacht|späht|spähen|kundschaft|ausspäh)/iu;
const CP_RE = word("checkpoint|checkpoints|kontrollposten|cp|strassenkontrolle");
const REMOVE_RE = word("abgebaut|aufgehoben|aufgelöst|geräumt|abgezogen|weg|nicht mehr|verlassen|verlässt|beendet");
const PRESENCE_RE = word("pat|patr|patrouille|patrouilliert|präsenz|kontrolle|kontrolliert|durchsuchung|durchsucht");
const DEPART_RE = word("zurück|retour|rückt ab|rücken ab|verlässt|verlassen|beendet|abgeschlossen|rückkehr");
const STAO_RE = word("stellung|stao|standort|biwak|unterkunft|lager|bezieht|beziehen|eingerichtet|verschanzt");
const DECEPTION_RE = word("sofort|dringend|dringende|zivilperson|zivilist|angeblich|angebliche|gerücht|anonym|hörensagen|soll\\s+angeblich");
const PERS_RE = word("pers|personen|person|mann|sdt|soldaten|bewaffnete|bewaffneter|ag");
const VEH_RE = word("fz|fahrzeug|fahrzeuge|auto|lieferwagen|kastenwagen|transporter|pw|personenwagen|lw|lastwagen|lkw|bus|kleinbus|motorrad|töff|quad|traktor|pick-?up|suv|limousine|kombi|jeep|duro|g-klasse|van");
const FOOT_RE = word("zu fuss|zu fuß|fusspatrouille|marschiert|marschieren");
const FORMATIONS: Array<{ re: RegExp; name: string; level: HintLevel; meaning: string }> = [
  { re: word("kolonne"), name: "Kolonne", level: "mittel", meaning: "vermutlich Verschiebung" },
  { re: word("linie|in linie|schützenlinie"), name: "Linie", level: "hoch", meaning: "Kontakt erwartet" },
  { re: /(?<![\p{L}\d])Y(?:-formation)?(?![\p{L}\d])/u, name: "Y", level: "hoch", meaning: "Kontakt erwartet" },
  { re: word("igel"), name: "Igel", level: "mittel", meaning: "Halt mit Rundumsicherung" },
];

const COLOR_RE = new RegExp(`(?<!${L})(weiss|weiß|schwarz|grau|silber|silbern|blau|grün|gelb|orange|braun|beige|rot|dunkel|hell)(e[rsnm]?|en)?(?!${L})`, "iu");
const VEH_NOUN_RE = word("lieferwagen|kastenwagen|transporter|pw|personenwagen|lw|lastwagen|lkw|bus|kleinbus|motorrad|töff|quad|traktor|pick-?up|suv|limousine|kombi|jeep|duro|g-klasse|van");
const PLATE_RE = /(?<![\p{L}\d])(AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH)\s?(\d{3,6})(?!\d)/u;

const DRONE_SYMS = new Set(["drohne", "uav_einheit"]);
const AIR_SYMS = new Set(["drohne", "uav_einheit", "heli", "heli_einheit", "flugzeug"]);
const CP_SYMS = new Set(["kontrollposten", "verkehrsposten"]);
const OBSERVER_SYMS = new Set(["beob_aufkl", "aufkl", "aufkl_fz", "scharfschuetze", "schaf_gewehr"]);
const STAO_SYMS = new Set(["stellung", "kdo_po", "hq", "lager", "mun_lager", "treibstoff", "log_pt", "sammelraum"]);
const GENERIC_FZ = new Set(["fz", "ziv_fz", "einheit"]);
const PERS_CATS = new Set(["Kampftruppen", "Zivile und Irreguläre"]);

const SECTORS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const dirName = (d: number) => SECTORS[Math.round((((d % 360) + 360) % 360) / 45) % 8]!;

/** Elementnamen vergleichbar machen: «H 04» = «H4», «Det. 2» = «Det2» */
const nk = (s: string) => s.toLowerCase().replace(/[\s.\-_]/g, "").replace(/(\D)0+(\d)/g, "$1$2");

// ---------------------------------------------------------------------------------------------
// Aufbereitung
// ---------------------------------------------------------------------------------------------
interface Ev {
  e: LageEvent;
  id: string;
  ms: number;
  pos?: LV95;
  cell: BaseCell | null;
  /** Ort ausdrücklich gemeldet (nicht «bei H04» / «letzter Standort») */
  precise: boolean;
  /** Ort nur über NAI (Mittelpunkt der Fläche) */
  naiOnly: boolean;
  nais: string[];
  cat?: CatalogEntry;
  /** Sichtung (Feind oder unklar) */
  rot: boolean;
  feind: boolean;
  blau: boolean;
  isFz: boolean;
  isPers: boolean;
  isDrone: boolean;
  isAir: boolean;
  isCp: boolean;
  obstacle: boolean;
  halt: boolean;
  moving: boolean;
  fz: number;
  pers: number;
  /** `side:element` oder leer */
  unitKey: string;
  melder: string;
  /** Erkennungsmerkmal eines Fz ohne Element (Farbe + Typ, Kennzeichen) */
  sig?: { key: string; label: string };
}

interface Ctx {
  ex: Exercise;
  tMs: number;
  evs: Ev[];
  start: number;
  nais: Area[];
  /** Standorte eigener Elemente (Schlüssel `nk(Element)`), älteste zuerst */
  blauPos: Map<string, Ev[]>;
  /** alle Meldungen eines eigenen Elements (als Element oder Melder), Zeiten in ms */
  reports: Map<string, Ev[]>;
  blauName: Map<string, string>;
  quality: Map<string, EventQuality>;
  cache: Map<string, unknown>;
}

const parseMs = (t: string | undefined) => {
  const ms = t ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : NaN;
};
const pad = (n: number) => String(n).padStart(2, "0");
/** ISO lokal ohne Sekunden (wie `LageEvent.t`) */
function iso(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const hm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dur = (min: number) => { const m = Math.round(min); return m < 60 ? `${m} Min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} Min` : `${m / 60} h`; };
const num = (v: number) => (v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1).replace(".", ","));
const quote = (s: string) => { const x = s.replace(/\s+/g, " ").trim(); return `«${x.length > 70 ? x.slice(0, 68) + "…" : x}»`; };
const uniq = <X>(xs: X[]) => [...new Set(xs)];

/** aktuelle Revision je ID (höhere Revision, dann spätere Änderung, dann Gerät – wie `mergeEvents`) */
function currentEvents(events: LageEvent[]): LageEvent[] {
  const map = new Map<string, LageEvent>();
  for (const e of events) {
    const c = map.get(e.id);
    if (!c || e.rev > c.rev || (e.rev === c.rev && (e.updatedAt > c.updatedAt || (e.updatedAt === c.updatedAt && e.device > c.device)))) map.set(e.id, e);
  }
  return [...map.values()];
}

function vehicleSig(text: string): Ev["sig"] {
  const plate = PLATE_RE.exec(text);
  if (plate) return { key: `kz:${plate[1]}${plate[2]}`, label: `Fz ${plate[1]} ${plate[2]}` };
  const noun = VEH_NOUN_RE.exec(text);
  if (!noun) return undefined;
  const c = COLOR_RE.exec(text);
  if (!c) return undefined;
  const base = c[1]!.toLowerCase().replace("ß", "ss");
  // «Rot», «Blau» ohne Endung sind Seiten, keine Farben
  if ((base === "rot" || base === "blau") && !c[2]) return undefined;
  const n = noun[0].toLowerCase();
  return { key: `fz:${base.replace(/^silbern$/, "silber")}-${n === "personenwagen" ? "pw" : n === "lastwagen" || n === "lkw" ? "lw" : n}`, label: `${c[0]} ${noun[0]}` };
}

function toEv(e: LageEvent, ex: Pick<Exercise, "sheets" | "areas">, nais: Area[]): Ev | null {
  const ms = parseMs(e.t);
  if (!Number.isFinite(ms)) return null;
  const cat = catalogEntry(e.sym);
  const text = e.text ?? "";
  const where = e.where ?? "";
  const precise = !!e.pos && where !== "letzter Standort" && !/^bei\s/i.test(where);
  const cell = e.pos ? baseCellAt(ex.sheets ?? [], e.pos) : null;
  const inNai = (a: Area) => e.nai === a.name || (precise && !!e.pos && a.ring.length >= 3 && pointInRing({ x: e.pos.e, y: e.pos.n }, a.ring.map((p) => ({ x: p.e, y: p.n }))));
  const naiNames = nais.filter(inNai).map((a) => a.name);
  const isAir = AIR_SYMS.has(e.sym);
  const isDrone = DRONE_SYMS.has(e.sym) || /drohne/i.test(text);
  const isFz = !isAir && !isDrone && (cat?.category === "Fahrzeuge" || (cat?.kind !== "einheit" || e.sym === "einheit") && VEH_RE.test(text) && !CP_SYMS.has(e.sym));
  const isPers = !isFz && !isAir && (e.sym === "patrouille" || (cat?.kind === "einheit" && (PERS_CATS.has(cat.category) || e.sym === "einheit" && PERS_RE.test(text))));
  let pers = 0;
  if (isPers) {
    const est = e.echelon ? ECHELON_PERS[e.echelon] : undefined;
    pers = est ? (e.count ?? 1) * est : e.count ?? 1;
  }
  const rot = e.side === "rot";
  return {
    e, id: e.id, ms, pos: e.pos, cell, precise, naiOnly: !!e.nai && where === e.nai, nais: naiNames, cat,
    rot, feind: rot && e.aff !== "U", blau: e.side === "blau",
    isFz, isPers, isDrone, isAir,
    isCp: CP_SYMS.has(e.sym) || CP_RE.test(text),
    obstacle: cat?.category === "Hindernisse" || BLOCK_RE.test(text),
    halt: HALT_RE.test(text),
    moving: e.dir !== undefined || MOVE_RE.test(text),
    fz: isFz ? e.count ?? 1 : 0,
    pers,
    unitKey: e.unit ? `${e.side}:${nk(e.unit)}` : "",
    melder: e.melder ? nk(e.melder) : "",
    sig: rot && !e.unit ? vehicleSig(text) : undefined,
  };
}

function prepareEvents(events: LageEvent[], ex: Pick<Exercise, "sheets" | "areas">, tMs: number): Ev[] {
  const nais = (ex.areas ?? []).filter((a) => a.kind === "nai");
  const out: Ev[] = [];
  for (const e of currentEvents(events)) {
    if (e.deleted) continue;
    const ev = toEv(e, ex, nais);
    if (ev && ev.ms <= tMs) out.push(ev);
  }
  return out.sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id));
}

function prepare(ex: Exercise, tMs: number): Ctx {
  const evs = prepareEvents(ex.events ?? [], ex, tMs);
  const blauPos = new Map<string, Ev[]>();
  const reports = new Map<string, Ev[]>();
  const blauName = new Map<string, string>();
  const push = addTo;
  for (const v of evs) {
    if (v.blau && v.e.unit) {
      const k = nk(v.e.unit);
      blauName.set(k, v.e.unit);
      push(reports, k, v);
      // wie `situationAt`: Tätigkeiten/Räume verschieben den Melder nicht
      const cat = v.cat;
      const activityOnly = cat?.activity && (cat.lean !== "eigen" || (cat.geometry && cat.geometry !== "punkt"));
      if (v.pos && !activityOnly) push(blauPos, k, v);
    } else if (v.melder) {
      push(reports, v.melder, v);
      if (v.e.melder) blauName.set(v.melder, blauName.get(v.melder) ?? v.e.melder);
    }
  }
  return {
    ex, tMs, evs, start: evs[0]?.ms ?? tMs, nais: (ex.areas ?? []).filter((a) => a.kind === "nai"),
    blauPos, reports, blauName, quality: qualityOf(evs), cache: new Map(),
  };
}

/** Meldungen mit Zeit in [from, to] (binäre Suche in den zeitlich sortierten Meldungen) */
function between(c: Ctx, from: number, to: number): Ev[] {
  let lo = 0, hi = c.evs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c.evs[mid]!.ms < from) lo = mid + 1; else hi = mid; }
  const out: Ev[] = [];
  for (let i = lo; i < c.evs.length && c.evs[i]!.ms <= to; i++) out.push(c.evs[i]!);
  return out;
}

const addTo = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };

/** Standort des eigenen Elements zum Zeitpunkt (letzte Standortmeldung ≤ ms) */
function posAt(list: Ev[] | undefined, ms: number): Ev | undefined {
  if (!list) return undefined;
  let lo = 0, hi = list.length - 1, best: Ev | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.ms <= ms) { best = list[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

const placeOf = (v: Ev) => v.nais[0] ?? (v.precise ? v.e.cells?.[0] ?? v.cell?.label : undefined) ?? v.e.where ?? "unbekanntem Ort";

function mk(rule: string, key: string, level: HintLevel, title: string, text: string, trig: Ev[], at: number, x: Partial<Hint> = {}): Hint {
  const evs = uniq(trig).sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id));
  const lastMs = Math.max(at, ...evs.map((v) => v.ms));
  const h: Hint = {
    id: `${rule}:${key}`, rule, level, title, text, events: evs.map((v) => v.id), t: iso(at), last: iso(lastMs),
    pos: centroid(evs.filter((v) => v.pos && v.precise).map((v) => v.pos!)) ?? centroid(evs.filter((v) => v.pos).map((v) => v.pos!)),
    cells: uniq(evs.filter((v) => v.precise && v.cell).map((v) => v.cell!.label)),
  };
  if (!h.cells!.length) delete h.cells;
  if (!h.pos) delete h.pos;
  for (const [k, v] of Object.entries(x)) if (v !== undefined) (h as unknown as Record<string, unknown>)[k] = v;
  return h;
}

/** Ereignisse zu Gruppen zusammenfassen: gleicher/benachbarter Ort und höchstens `gapMin` nach einem Mitglied */
function cluster(list: Ev[], gapMin: number, near: (a: Ev, b: Ev) => boolean = sameOrNeighbor): Ev[][] {
  const groups: Ev[][] = [];
  for (const v of list) {
    const g = groups.find((gr) => gr.some((m) => v.ms - m.ms <= gapMin * MIN && near(m, v)));
    if (g) g.push(v);
    else groups.push([v]);
  }
  return groups;
}

// ---------------------------------------------------------------------------------------------
// E1 / E2 – Qualität je Meldung
// ---------------------------------------------------------------------------------------------
/** Kategorien, in denen verwandte Zeichen einander bestätigen (z. B. Kpz und Spz); sonst nur gleiches Zeichen */
const CONFIRM_CATS = new Set(["Kampftruppen", "Fahrzeuge", "Luftfahrzeuge", "Zivile und Irreguläre", "Waffen"]);

function sameType(a: Ev, b: Ev): boolean {
  if (a.e.sym === b.e.sym) return true;
  if ((a.isDrone && b.isDrone) || (a.isFz && b.isFz) || (a.isPers && b.isPers)) return true;
  return !!a.cat && !!b.cat && a.cat.category === b.cat.category && CONFIRM_CATS.has(a.cat.category);
}

function qualityOf(evs: Ev[]): Map<string, EventQuality> {
  const out = new Map<string, EventQuality>();
  const rot = evs.filter((v) => v.rot);
  const w = T.E1_WINDOW_MIN * MIN;
  let lo = 0;
  for (let i = 0; i < rot.length; i++) {
    const a = rot[i]!;
    while (rot[lo]!.ms < a.ms - w) lo++;
    const conf: Ev[] = [];
    if (a.melder && (a.pos || a.nais.length)) {
      for (let j = lo; j < rot.length && rot[j]!.ms <= a.ms + w; j++) {
        const b = rot[j]!;
        if (b === a || !b.melder || b.melder === a.melder || !sameType(a, b)) continue;
        const near = (a.nais.length && a.nais.some((n) => b.nais.includes(n))) || (a.precise && b.precise && sameOrNeighbor(a, b));
        if (near) conf.push(b);
      }
    }
    const missing: string[] = [];
    if (a.e.sym === "einheit" && !a.e.unit && a.e.count === undefined) missing.push("Wer");
    if (!a.precise && !a.nais.length) missing.push("Ort");
    if (!/T\d\d:\d\d/.test(a.e.t)) missing.push("Zeit");
    if (!a.melder) missing.push("Melder");
    const q: EventQuality = { status: conf.length ? "bestaetigt" : "unbestaetigt" };
    if (conf.length) q.confirmedBy = conf.map((v) => v.id);
    if (missing.length) q.missing = missing;
    out.set(a.id, q);
  }
  for (const v of evs) {
    if (v.e.side !== "ul" || out.has(v.id)) continue;
    if (!v.pos && !v.e.nai) out.set(v.id, { missing: ["Ort"] });
  }
  return out;
}

/** Qualität je Meldung (E1 bestätigt/unbestätigt, E2 unvollständig) bis zur Lagezeit */
export function eventQuality(events: LageEvent[], t: string, ex?: Exercise): Map<string, EventQuality> {
  const tMs = parseMs(t);
  const evs = prepareEvents(events, { sheets: ex?.sheets ?? [], areas: ex?.areas ?? [] }, Number.isFinite(tMs) ? tMs : Infinity);
  return qualityOf(evs);
}

// ---------------------------------------------------------------------------------------------
// A – Normallage und Abweichung
// ---------------------------------------------------------------------------------------------
interface Baseline {
  a: Area;
  /** Rot-Meldungen im NAI, älteste zuerst */
  evs: Ev[];
  base: Ev[];
  start: number;
  end: number;
  fzRate: number;
  persRate: number;
  evRate: number;
  dirs: number[];
  types: Set<string>;
}

function baselines(c: Ctx): Baseline[] {
  const hit = c.cache.get("baselines") as Baseline[] | undefined;
  if (hit) return hit;
  const out: Baseline[] = [];
  const start = c.start, end = start + T.A1_LEARN_MIN * MIN;
  if (c.tMs >= end) {
    for (const a of c.nais) {
      const evs = c.evs.filter((v) => v.rot && v.nais.includes(a.name));
      const base = evs.filter((v) => v.ms < end);
      if (base.length < T.A1_MIN_EVENTS) continue;
      const h = T.A1_LEARN_MIN / 60;
      out.push({
        a, evs, base, start, end,
        fzRate: base.reduce((s, v) => s + v.fz, 0) / h,
        persRate: base.reduce((s, v) => s + v.pers, 0) / h,
        evRate: base.length / h,
        dirs: base.filter((v) => v.e.dir !== undefined).map((v) => v.e.dir!),
        types: new Set(base.filter((v) => v.isFz && !GENERIC_FZ.has(v.e.sym)).map((v) => v.e.sym)),
      });
    }
  }
  c.cache.set("baselines", out);
  return out;
}

function dirText(dirs: number[]): string {
  const count = new Map<string, number>();
  for (const d of dirs) count.set(dirName(d), (count.get(dirName(d)) ?? 0) + 1);
  const names = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  if (names.length === 2) {
    const [x, y] = names.map((n) => SECTORS.indexOf(n));
    if (Math.abs(x! - y!) === 4) return names.sort((p, q) => SECTORS.indexOf(p) - SECTORS.indexOf(q)).join("↔");
  }
  return names.join(", ");
}

function ruleA1(c: Ctx): Hint[] {
  return baselines(c).map((b) => {
    const parts = [`~${num(b.fzRate)} Fz/Std`];
    if (b.persRate > 0) parts.push(`~${num(b.persRate)} Pers/Std`);
    if (b.dirs.length) parts.push(`Richtungen ${dirText(b.dirs)}`);
    return mk("A1", b.a.name, "info", `Normallage ${b.a.name}`,
      `${parts.join(", ")} (Basis ${hm(b.start)}–${hm(b.end)}, ${b.base.length} Meldungen). Vergleichswert für Abweichung und Ruhe.`,
      b.base, b.end, { nai: b.a.name, pos: areaCenter(b.a), unit: b.a.trupp });
  });
}

function ruleA2(c: Ctx): Hint[] {
  const out: Hint[] = [];
  for (const b of baselines(c)) {
    const after = b.evs.filter((v) => v.ms >= b.end);
    type Dev = { v: Ev; reasons: Map<string, string>; trig: Ev[] };
    const devs: Dev[] = [];
    let lo = 0;
    for (let i = 0; i < after.length; i++) {
      const v = after[i]!;
      while (after[lo]!.ms <= v.ms - T.A2_WINDOW_MIN * MIN) lo++;
      const win = after.slice(lo, i + 1);
      const reasons = new Map<string, string>();
      const trig: Ev[] = [v];
      const fzW = win.reduce((s, x) => s + x.fz, 0);
      const persW = win.reduce((s, x) => s + x.pers, 0);
      const perWin = T.A2_WINDOW_MIN / 60;
      if (v.fz && fzW > T.A2_FACTOR * b.fzRate * perWin && fzW >= T.A2_MIN_FZ) {
        reasons.set("fz", `${fzW} Fz innert ${T.A2_WINDOW_MIN} Min (normal ~${num(b.fzRate * perWin)})`);
        trig.push(...win.filter((x) => x.fz));
      }
      if (v.pers && persW > T.A2_FACTOR * b.persRate * perWin && persW >= T.A2_MIN_PERS) {
        reasons.set("pers", `${persW} Pers innert ${T.A2_WINDOW_MIN} Min (normal ~${num(b.persRate * perWin)})`);
        trig.push(...win.filter((x) => x.pers));
      }
      if (v.isFz && !GENERIC_FZ.has(v.e.sym) && !b.types.has(v.e.sym)) reasons.set(`typ:${v.e.sym}`, `neuer Fz-Typ ${v.cat?.name ?? v.e.sym}`);
      if (v.e.dir !== undefined && b.dirs.length && b.dirs.every((d) => angleDiff(d, v.e.dir!) > T.A2_DIR_DEG)) {
        reasons.set(`dir:${dirName(v.e.dir)}`, `neue Richtung ${dirName(v.e.dir)}`);
      }
      if (reasons.size) devs.push({ v, reasons, trig });
    }
    // zusammenhängende Abweichungen = eine Situation
    let ep: Dev[] = [];
    const flush = () => {
      if (!ep.length) return;
      const first = ep[0]!, reasons = new Map<string, string>();
      for (const d of ep) for (const [k, r] of d.reasons) reasons.set(k, r);
      const onlyVolume = [...reasons.keys()].every((k) => k === "fz" || k === "pers");
      out.push(mk("A2", `${b.a.name}:${first.v.id}`, "mittel",
        onlyVolume ? `Ungewöhnlich viel Verkehr in ${b.a.name}` : `Abweichung von der Normallage in ${b.a.name}`,
        `Seit ${hm(first.v.ms)}: ${[...reasons.values()].join("; ")}. Bewegung oder Zusammenzug von Rot?`,
        ep.flatMap((d) => d.trig), first.v.ms, { nai: b.a.name, unit: b.a.trupp }));
      ep = [];
    };
    for (const d of devs) {
      if (ep.length && d.v.ms - ep[ep.length - 1]!.v.ms > T.A2_WINDOW_MIN * MIN) flush();
      ep.push(d);
    }
    flush();
  }
  return out;
}

function ruleA3(c: Ctx): Hint[] {
  const out: Hint[] = [];
  for (const b of baselines(c)) {
    const expected = (min: number) => (b.evRate * min) / 60;
    for (let i = 0; i < b.evs.length; i++) {
      const v = b.evs[i]!, next = b.evs[i + 1];
      const endMs = next ? next.ms : c.tMs;
      const at = Math.max(v.ms + T.A3_QUIET_MIN * MIN, b.end);
      if (at > c.tMs || endMs - v.ms <= T.A3_QUIET_MIN * MIN || at >= endMs) continue;
      if (expected(T.A3_QUIET_MIN) < T.A3_MIN_EXPECTED) continue;
      const quiet = (endMs - v.ms) / MIN;
      const exp = Math.round(expected(quiet));
      const text = next
        ? `Ruhe ${hm(v.ms)}–${hm(next.ms)} (${dur(quiet)}) ohne Rot-Meldung aus ${b.a.name}, normal wären ~${exp}. Vorbereitung von Rot oder Sicht verloren?`
        : `Seit ${hm(v.ms)} (${dur(quiet)}) keine Rot-Meldung aus ${b.a.name}, normal wären ~${exp}. Vorbereitung von Rot oder Sicht verloren?`;
      out.push(mk("A3", `${b.a.name}:${v.id}`, "mittel", `Auffällige Ruhe in ${b.a.name}`, text, [v], at,
        { nai: b.a.name, pos: areaCenter(b.a), unit: b.a.trupp, until: next ? iso(next.ms) : undefined, last: iso(next ? next.ms : c.tMs) }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// B – Reaktion auf eigene Präsenz
// ---------------------------------------------------------------------------------------------
function ruleB1(c: Ctx): Hint[] {
  const out: Hint[] = [];
  for (const [k, list] of c.reports) {
    const own = list.filter((v) => v.blau && v.pos);
    for (let i = 0; i < own.length; i++) {
      const p = own[i]!;
      const presence = p.e.sym === "patrouille" || CP_SYMS.has(p.e.sym) || p.e.sym === "durchsuchung" || PRESENCE_RE.test(p.e.text);
      if (!presence || !p.precise) continue;
      // Abzug: nächste eigene Meldung an einem anderen Ort oder «zurück», «verlässt» …
      let dep: Ev | undefined;
      for (let j = i + 1; j < own.length; j++) {
        const q = own[j]!;
        if ((q.precise && !sameOrNeighbor(p, q)) || DEPART_RE.test(q.e.text)) { dep = q; break; }
      }
      if (!dep) continue;
      const react = between(c, dep.ms + 1, dep.ms + T.B1_AFTER_MIN * MIN).filter((v) => v.rot && v.precise && sameOrNeighbor(p, v));
      if (!react.length) continue;
      const name = c.blauName.get(k) ?? p.e.unit;
      const r0 = react[0]!;
      out.push(mk("B1", p.id, "mittel", `Rot reagiert nach Patrouille ${name} in ${placeOf(p)}`,
        `${name} hat ${placeOf(p)} um ${hm(dep.ms)} verlassen; ${Math.round((r0.ms - dep.ms) / MIN)} Min später ${hm(r0.ms)} ${quote(r0.e.text)}. Rot reagiert verzögert – Warnung, Umladen oder Wegbringen von Material?`,
        [p, dep, ...react], r0.ms, { unit: name, pos: p.pos, cells: uniq([p, ...react].filter((v) => v.cell).map((v) => v.cell!.label)) }));
    }
  }
  return out;
}

interface Checkpoint { first: Ev; evs: Ev[]; lastSeen: number; end?: Ev; own: boolean }

function checkpoints(c: Ctx): Checkpoint[] {
  const hit = c.cache.get("cps") as Checkpoint[] | undefined;
  if (hit) return hit;
  const cps: Checkpoint[] = [];
  for (const v of c.evs) {
    if (!v.pos || (!v.isCp && !(CP_RE.test(v.e.text)))) continue;
    const open = cps.filter((p) => !p.end && sameOrNeighbor(p.first, v) && v.ms <= p.lastSeen + T.B2_MAX_MIN * MIN);
    if (REMOVE_RE.test(v.e.text)) {
      const p = open[open.length - 1];
      if (p) { p.end = v; p.evs.push(v); }
      continue;
    }
    if (!v.isCp) continue;
    const p = open.find((x) => x.own === v.blau);
    if (p) { p.evs.push(v); p.lastSeen = v.ms; }
    else cps.push({ first: v, evs: [v], lastSeen: v.ms, own: v.blau });
  }
  c.cache.set("cps", cps);
  return cps;
}

const cpEnd = (p: Checkpoint) => (p.end ? p.end.ms : p.lastSeen + T.B2_MAX_MIN * MIN);
const cpWho = (p: Checkpoint) => (p.own ? `eigener Checkpoint ${p.first.e.unit}`.trim() : p.first.e.unit ? `Checkpoint ${p.first.e.unit}` : "Checkpoint Rot");

function ruleB2(c: Ctx): Hint[] {
  const out: Hint[] = [];
  for (const p of checkpoints(c)) {
    const at = p.first.ms + T.B2_STAND_MIN * MIN;
    if (at > c.tMs || cpEnd(p) < at) continue;
    const who = cpWho(p);
    const advice = p.own ? "Rot kennt ihn – verschieben oder Ausweichrouten überwachen." : "die Wirkung nimmt ab; Ausweichrouten beobachten.";
    const endTxt = p.end ? ` bis ${hm(p.end.ms)}` : "";
    out.push(mk("B2", p.first.id, "mittel", `${who[0]!.toUpperCase()}${who.slice(1)} in ${placeOf(p.first)} steht seit ${hm(p.first.ms)}`,
      `Steht seit ${hm(p.first.ms)}${endTxt} (über ${T.B2_STAND_MIN} Min) – ${advice}`,
      p.evs, at, { until: p.end ? iso(p.end.ms) : undefined, pos: p.first.pos, nai: p.first.nais[0] }));
  }
  return out;
}

function ruleB3(c: Ctx): Hint[] {
  const out: Hint[] = [];
  for (const p of checkpoints(c)) {
    const end = cpEnd(p);
    const evaders = between(c, p.first.ms, Math.min(end, c.tMs)).filter((v) => {
      if (!v.rot || !v.isFz || !v.pos || p.evs.includes(v)) return false;
      const near = sameOrNeighbor(p.first, v) || dist(p.first.pos!, v.pos) <= T.B3_DIST_M;
      if (!near) return false;
      if (TURN_RE.test(v.e.text)) return true;
      // eigener Checkpoint: Fz bewegt sich in der Nähe vom CP weg
      if (p.own && v.e.dir !== undefined && v.precise) {
        const d = dist(p.first.pos!, v.pos);
        return d > 50 && d <= T.B3_DIST_M && angleDiff(bearing(p.first.pos!, v.pos), v.e.dir) <= T.B3_AWAY_DEG;
      }
      return false;
    });
    if (!evaders.length) continue;
    const v0 = evaders[0]!;
    out.push(mk("B3", p.first.id, "hoch", `Fz weicht ${p.own ? "eigenem " : ""}Checkpoint aus (${placeOf(p.first)})`,
      `${hm(v0.ms)} ${quote(v0.e.text)}${evaders.length > 1 ? ` und ${evaders.length - 1} weitere` : ""} beim ${cpWho(p)} (seit ${hm(p.first.ms)}). Ausweichende Fz sind die eigentlich Verdächtigen – verfolgen und melden.`,
      [p.first, ...evaders], v0.ms, { pos: p.first.pos }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// C – Absicht von Rot erkennen
// ---------------------------------------------------------------------------------------------
function ruleC1(c: Ctx): Hint[] {
  const textHits = c.evs.filter((v) => v.rot && v.pos && (v.e.sym === "uebergabe" || HANDOVER_RE.test(v.e.text)));
  const halts = c.evs.filter((v) => v.rot && v.isFz && v.halt && v.pos);
  const ok = new Set<Ev>(textHits);
  const met = new Map<Ev, number>();
  // haltende Fz aus mindestens zwei Meldungen (Fz kommen zusammen); eine einzelne Meldung «3 Fz stehen» ist C4
  for (const v of halts) {
    const partners = halts.filter((w) => w !== v && Math.abs(w.ms - v.ms) <= T.C1_WINDOW_MIN * MIN && sameOrNeighbor(v, w));
    if (partners.length && partners.reduce((s, w) => s + w.fz, v.fz) >= T.C1_MIN_FZ) {
      ok.add(v);
      met.set(v, Math.max(v.ms, Math.min(...partners.map((w) => w.ms))));
    }
  }
  const list = [...ok].sort((a, b) => a.ms - b.ms);
  return cluster(list, T.C1_GROUP_MIN).map((g) => {
    const at = Math.min(...g.map((v) => (textHits.includes(v) ? v.ms : met.get(v) ?? v.ms)));
    const v0 = g[0]!;
    const fz = g.reduce((s, v) => s + v.fz, 0);
    const why = g.some((v) => textHits.includes(v)) ? quote(g.find((v) => textHits.includes(v))!.e.text) : `${fz} Fz halten im gleichen Raum`;
    return mk("C1", v0.id, "hoch", `Mögliche Übergabe in ${placeOf(v0)}`,
      `${hm(v0.ms)} ${why}${g.length > 1 ? ` (${g.length} Meldungen)` : ""}. Mögliche Übergabe oder Zusammenschluss bewaffneter Gruppen.`,
      g, at);
  });
}

interface Pendel { key: string; label: string; zones: [string, string]; passes: Ev[]; arrivals: number[]; trig: Ev[] }

function pendels(c: Ctx): Pendel[] {
  const hit = c.cache.get("pendels") as Pendel[] | undefined;
  if (hit) return hit;
  const tracks = new Map<string, { label: string; evs: Ev[] }>();
  for (const v of c.evs) {
    if (!v.rot || !v.pos || !v.precise && !v.naiOnly) continue;
    const key = v.unitKey || (v.sig ? v.sig.key : "");
    if (!key) continue;
    const t = tracks.get(key) ?? { label: v.e.unit || v.sig!.label, evs: [] };
    t.evs.push(v);
    tracks.set(key, t);
  }
  const out: Pendel[] = [];
  for (const [key, tr] of tracks) {
    // Orte: Meldungen im gleichen/benachbarten PQ (bzw. gleichen NAI) gehören zum gleichen Ort
    const zones: Array<{ label: string; anchor: Ev }> = [];
    const zoneOf = (v: Ev) => {
      let i = zones.findIndex((z) => (z.anchor.nais.length && z.anchor.nais.some((n) => v.nais.includes(n))) || sameOrNeighbor(z.anchor, v));
      if (i < 0) { zones.push({ label: placeOf(v), anchor: v }); i = zones.length - 1; }
      return i;
    };
    const moves: Array<{ a: number; b: number; from: Ev; to: Ev }> = [];
    let prevZone = -1, prevEv: Ev | undefined;
    for (const v of tr.evs) {
      const z = zoneOf(v);
      if (prevEv && z !== prevZone) moves.push({ a: prevZone, b: z, from: prevEv, to: v });
      prevZone = z; prevEv = v;
    }
    const byPair = new Map<string, typeof moves>();
    for (const m of moves) {
      const k = [m.a, m.b].sort((x, y) => x - y).join("~");
      addTo(byPair, k, m);
    }
    for (const [, ms] of byPair) {
      if (ms.length < T.C2_MIN_PASSES) continue;
      const labels = [zones[ms[0]!.a]!.label, zones[ms[0]!.b]!.label].sort() as [string, string];
      out.push({
        key, label: tr.label, zones: labels, passes: ms.map((m) => m.to), arrivals: ms.map((m) => m.to.ms),
        trig: uniq(ms.flatMap((m) => [m.from, m.to])),
      });
    }
  }
  c.cache.set("pendels", out);
  return out;
}

function ruleC2(c: Ctx): Hint[] {
  return pendels(c).map((p) => {
    const gaps = p.arrivals.slice(1).map((x, i) => x - p.arrivals[i]!).sort((a, b) => a - b);
    const takt = gaps[Math.floor(gaps.length / 2)] ?? 0;
    const lastMs = p.arrivals[p.arrivals.length - 1]!;
    const next = takt > 0 ? lastMs + takt : undefined;
    const at = p.arrivals[T.C2_MIN_PASSES - 1]!;
    const nextTxt = next ? ` – nächste Durchfahrt ca. ${hm(next)}` : "";
    return mk("C2", `${p.key}:${p.zones.join("~")}`, "mittel", `Pendelverkehr ${p.label} zwischen ${p.zones[0]} und ${p.zones[1]}`,
      `${p.arrivals.length} Durchfahrten seit ${hm(p.trig[0]!.ms)}, Takt ca. ${dur(takt / MIN)}${nextTxt}.`,
      p.trig, at, { next: next ? iso(next) : undefined });
  });
}

function ruleC3(c: Ctx): Hint[] {
  const inPendel = new Set(pendels(c).flatMap((p) => p.trig));
  const groups = new Map<string, { label: string; evs: Ev[] }>();
  for (const v of c.evs) {
    if (!v.rot || !v.pos) continue;
    let key = "", label = "";
    if (v.isDrone) { key = "drohne"; label = "Drohne"; }
    else if (v.isFz && v.fz <= 1 && (v.unitKey || v.sig)) { key = `fz:${v.unitKey || v.sig!.key}`; label = v.e.unit || v.sig!.label; }
    if (!key) continue;
    const g = groups.get(key) ?? { label, evs: [] };
    g.evs.push(v);
    groups.set(key, g);
  }
  const out: Hint[] = [];
  for (const [key, g] of groups) {
    for (const cl of cluster(g.evs, T.C3_WINDOW_MIN)) {
      if (cl.length < T.C3_MIN_SIGHTINGS || cl.every((v) => inPendel.has(v))) continue;
      const places = uniq(cl.map(placeOf));
      const span = (cl[cl.length - 1]!.ms - cl[0]!.ms) / MIN;
      out.push(mk("C3", `${key}:${cl[0]!.id}`, "mittel", `Raum ${places.join("/")} wird aufgeklärt`,
        `${g.label} ${cl.length}× innert ${dur(span)} (${cl.map((v) => `${hm(v.ms)} ${placeOf(v)}`).join(", ")}). Aktion dort wahrscheinlich.`,
        cl, cl[T.C3_MIN_SIGHTINGS - 1]!.ms));
    }
  }
  return out;
}

function ruleC4(c: Ctx): Hint[] {
  const stand = c.evs.filter((v) => v.feind && v.cell && (v.fz || v.pers) && (!v.moving || v.halt));
  const byCell = new Map<string, Ev[]>();
  for (const v of stand) {
    const k = `${v.cell!.sheetId}:${v.cell!.label}`;
    addTo(byCell, k, v);
  }
  const out: Hint[] = [];
  for (const [, list] of byCell) {
    let ep: Ev[] = [];
    let at = 0;
    const flush = () => {
      if (at && ep.length) {
        const v0 = ep[0]!;
        const fz = ep.reduce((s, v) => s + v.fz, 0), pers = ep.reduce((s, v) => s + v.pers, 0);
        // Abnahme anderswo: weniger Rot-Meldungen ausserhalb in der Stunde vor `at` als in der Stunde davor
        const outside = between(c, at - 120 * MIN, at - 1).filter((v) => v.rot && v.cell && !sameOrNeighbor(v, v0));
        const now = outside.filter((v) => v.ms >= at - 60 * MIN).length;
        const before = outside.length - now;
        const drop = before > 0 && now < before;
        const what = [fz ? `${fz} Fz` : "", pers ? `~${pers} Pers` : ""].filter(Boolean).join(" und ");
        out.push(mk("C4", `${v0.cell!.label}:${v0.id}`, drop ? "hoch" : "mittel", `Schwergewicht Rot in ${v0.cell!.label}`,
          `${what} stehend in ${v0.cell!.label} seit ${hm(v0.ms)}${drop ? `; anderswo weniger Meldungen (${now} statt ${before} je Stunde)` : ""}. Bereitstellung – Aktion steht evtl. unmittelbar bevor.`,
          ep, at));
      }
      ep = []; at = 0;
    };
    for (let i = 0; i < list.length; i++) {
      const v = list[i]!;
      if (ep.length && v.ms - ep[ep.length - 1]!.ms > T.C4_WINDOW_MIN * MIN) flush();
      ep.push(v);
      const win = ep.filter((x) => x.ms > v.ms - T.C4_WINDOW_MIN * MIN);
      const fz = win.reduce((s, x) => s + x.fz, 0), pers = win.reduce((s, x) => s + x.pers, 0);
      if (!at && (fz >= T.C4_MIN_FZ || pers >= T.C4_MIN_PERS)) at = v.ms;
    }
    flush();
  }
  return out;
}

function ruleC5(c: Ctx): Hint[] {
  const engnis = new Set(c.nais.filter((a) => a.typ === "engnis").map((a) => a.name));
  const hits = c.evs.filter((v) => {
    if (!v.rot || !v.pos) return false;
    if (v.e.sym === "hinterhalt" || BLOCK_RE.test(v.e.text)) return true;
    return v.nais.some((n) => engnis.has(n)) && (v.obstacle || (v.isFz && v.halt));
  });
  return cluster(hits, T.C5_GROUP_MIN).map((g) => {
    const v0 = g[0]!;
    const nai = g.flatMap((v) => v.nais).find((n) => engnis.has(n));
    const where = nai ? `${nai} (Engnis)` : placeOf(v0);
    return mk("C5", v0.id, "hoch", `Hinterhalt-Gefahr in ${nai ?? placeOf(v0)}`,
      `${hm(v0.ms)} ${quote(v0.e.text)} in ${where}. Hindernis in der Geländekammer – möglicher Hinterhalt; Umgehung prüfen.`,
      g, v0.ms, { nai });
  });
}

function ruleC6(c: Ctx): Hint[] {
  const out: Hint[] = [];
  for (const v of c.evs) {
    if (!v.rot) continue;
    const f = v.e.sym === "kolonne" ? FORMATIONS[0]! : FORMATIONS.find((x) => x.re.test(v.e.text));
    if (!f) continue;
    out.push(mk("C6", v.id, f.level, `Formation ${f.name} in ${placeOf(v)}`,
      `${hm(v.ms)} ${quote(v.e.text)}: ${f.name} – ${f.meaning}.`, [v], v.ms));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// D – Rot sieht Blau
// ---------------------------------------------------------------------------------------------
function ruleD1(c: Ctx): Hint[] {
  const groups = new Map<string, { unit: string; stao: Ev; trig: Ev[]; at: number; best: number; kinds: string[] }>();
  for (const v of c.evs) {
    if (!v.rot || !v.pos) continue;
    const kind = v.isDrone ? "Drohne" : OBSERVER_SYMS.has(v.e.sym) || SPOT_RE.test(v.e.text) ? "Beobachter" : v.isFz && v.halt ? "haltendes Fz" : "";
    if (!kind || (kind === "haltendes Fz" && !v.precise)) continue;
    for (const [k, list] of c.blauPos) {
      const s = posAt(list, v.ms);
      if (!s?.pos) continue;
      const d = dist(s.pos, v.pos);
      if (d > T.D1_DIST_M) continue;
      const key = `${c.blauName.get(k) ?? k}:${s.id}`;
      const g = groups.get(key) ?? { unit: c.blauName.get(k) ?? k, stao: s, trig: [], at: v.ms, best: d, kinds: [] };
      g.trig.push(v);
      g.best = Math.min(g.best, d);
      g.kinds.push(`${hm(v.ms)} ${kind}${v.precise ? ` ${placeOf(v)}` : ""}${v.precise ? ` (ca. ${Math.round(d / 10) * 10} m)` : ""}`);
      groups.set(key, g);
    }
  }
  return [...groups.entries()].map(([key, g]) => mk("D1", key, "hoch", `Stao ${g.unit} möglicherweise aufgeklärt`,
    `${uniq(g.kinds).join(", ")} beim Stao ${g.unit} (${placeOf(g.stao)}). Stellungswechsel prüfen.`,
    [g.stao, ...g.trig], g.at, { unit: g.unit, pos: g.stao.pos, radius: T.D1_DIST_M, cells: g.stao.cell ? [g.stao.cell.label] : undefined }));
}

interface RotStao { anchor: Ev; label: string; from: number; to: number; evs: Ev[] }

function rotStaos(c: Ctx): RotStao[] {
  const out: RotStao[] = [];
  const isStatic = (v: Ev) => STAO_SYMS.has(v.e.sym) || STAO_RE.test(v.e.text);
  const byUnit = new Map<string, Ev[]>();
  for (const v of c.evs) {
    if (!v.feind || !v.pos || !v.precise) continue;
    if (v.unitKey) addTo(byUnit, v.unitKey, v);
    else if (isStatic(v)) out.push({ anchor: v, label: placeOf(v), from: v.ms, to: Infinity, evs: [v] });
  }
  for (const [, list] of byUnit) {
    let i = 0;
    while (i < list.length) {
      const first = list[i]!;
      let j = i + 1;
      while (j < list.length && sameOrNeighbor(first, list[j]!)) j++;
      const run = list.slice(i, j);
      const to = list[j]?.ms ?? Infinity;
      const st = run.find(isStatic);
      const long = run.find((v) => v.ms - first.ms >= T.D2_STAO_MIN * MIN);
      const from = Math.min(st?.ms ?? Infinity, long?.ms ?? Infinity);
      if (Number.isFinite(from)) out.push({ anchor: first, label: `${first.e.unit} (${placeOf(first)})`, from, to, evs: run });
      i = j;
    }
  }
  return out;
}

function ruleD2(c: Ctx): Hint[] {
  const staos = rotStaos(c);
  const groups = new Map<string, { unit: string; own: Ev[]; s: RotStao; at: number }>();
  for (const [k, list] of c.blauPos) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i]!;
      if (!p.precise) continue;
      const pEnd = list[i + 1]?.ms ?? Infinity;
      for (const s of staos) {
        const a = Math.max(p.ms, s.from), b = Math.min(pEnd, s.to, c.tMs);
        if (a > b || !sameOrNeighbor(p, s.anchor)) continue;
        const name = c.blauName.get(k) ?? k;
        const key = `${name}:${s.anchor.id}`;
        const g = groups.get(key) ?? { unit: name, own: [], s, at: a };
        g.own.push(p);
        g.at = Math.min(g.at, a);
        groups.set(key, g);
      }
    }
  }
  return [...groups.entries()].map(([key, g]) => {
    const p = g.own[g.own.length - 1]!;
    const rel = sameCell(p, g.s.anchor) ? "im PQ" : "im Nachbar-PQ";
    return mk("D2", key, "hoch", `${g.unit} zu nahe am Rot-Stao`,
      `${g.unit} (${placeOf(p)}) liegt ${rel} des Rot-Stao ${g.s.label}, seit ${hm(g.s.from)}. Hohes Entdeckungsrisiko – Stellungswechsel prüfen.`,
      [...g.own, ...g.s.evs], g.at, { unit: g.unit, pos: p.pos });
  });
}

function ruleD3(c: Ctx): Hint[] {
  const out: Hint[] = [];
  const anyTrupp = c.nais.some((a) => a.trupp);
  for (const a of c.nais) {
    const near = c.evs.filter((v) => v.rot && ((v.precise && v.pos && distToRing(v.pos, a.ring) <= T.D3_NEAR_M) || v.nais.includes(a.name)));
    if (!near.length) continue;
    if (!a.trupp) {
      if (!anyTrupp) continue; // Trupps werden in dieser Übung nicht zugeteilt
      for (const g of cluster(near, T.D3_RECENT_MIN, () => true)) {
        out.push(mk("D3", `${a.name}:ohne:${g[0]!.id}`, "hoch", `${a.name} nicht überwacht`,
          `Kein Trupp zugeteilt, Rot in der Nähe aktiv (${g.map((v) => `${hm(v.ms)} ${placeOf(v)}`).slice(0, 3).join(", ")}). Infiltration oder unbeobachtete Aktion möglich.`,
          g, g[0]!.ms, { nai: a.name, pos: areaCenter(a) }));
      }
      continue;
    }
    const reps = c.reports.get(nk(a.trupp)) ?? [];
    const groups = new Map<string, { last?: Ev; trig: Ev[]; at: number }>();
    for (const r of near) {
      const last = posAt(reps, r.ms);
      const lastMs = last?.ms ?? c.start;
      if (last && lastMs >= r.ms) continue;
      const at = Math.max(r.ms, lastMs + T.D3_SILENT_MIN * MIN);
      if (at > c.tMs || at > r.ms + T.D3_RECENT_MIN * MIN) continue;
      const nextRep = reps.find((x) => x.ms > lastMs);
      if (nextRep && nextRep.ms <= at) continue;
      const key = last ? last.id : "start";
      const g = groups.get(key) ?? { last, trig: [], at };
      g.trig.push(r);
      g.at = Math.min(g.at, at);
      groups.set(key, g);
    }
    for (const [key, g] of groups) {
      const since = g.last ? `seit ${hm(g.last.ms)} ohne Meldung` : "noch ohne Meldung";
      out.push(mk("D3", `${a.name}:${key}`, "hoch", `${a.name} nicht überwacht`,
        `${a.trupp} ${since}, Rot in der Nähe aktiv (${g.trig.map((v) => `${hm(v.ms)} ${placeOf(v)}`).slice(0, 3).join(", ")}). Infiltration oder unbeobachtete Aktion möglich – ${a.trupp} abfragen.`,
        [...(g.last ? [g.last] : []), ...g.trig], g.at, { nai: a.name, unit: a.trupp, pos: areaCenter(a) }));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// E – Qualität (als Hinweis)
// ---------------------------------------------------------------------------------------------
function ruleE3(c: Ctx): Hint[] {
  const tracks = new Map<string, Ev[]>();
  for (const [k, list] of c.blauPos) tracks.set(`blau:${k}`, list.filter((v) => v.precise));
  for (const v of c.evs) if (v.rot && v.unitKey && v.precise && v.pos) addTo(tracks, v.unitKey, v);
  const out: Hint[] = [];
  for (const [, list] of tracks) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1]!, b = list[i]!;
      if (a.isAir || b.isAir || !a.pos || !b.pos) continue;
      const tol = 2 * T.E3_TOL_M + (a.naiOnly ? T.E3_NAI_TOL_M : 0) + (b.naiOnly ? T.E3_NAI_TOL_M : 0);
      const d = dist(a.pos, b.pos);
      if (d <= tol) continue;
      const foot = (a.isPers || b.isPers || FOOT_RE.test(a.e.text) || FOOT_RE.test(b.e.text)) && !a.isFz && !b.isFz && !VEH_RE.test(a.e.text + " " + b.e.text);
      const limit = foot ? T.E3_FOOT_KMH : T.E3_FZ_KMH;
      const h = (b.ms - a.ms) / 3600000;
      const kmh = h > 0 ? (d - tol / 2) / 1000 / h : Infinity;
      if (kmh <= limit) continue;
      const name = b.e.unit || a.e.unit;
      const speed = Number.isFinite(kmh) ? `≈ ${Math.round(kmh)} km/h` : "gleichzeitig";
      out.push(mk("E3", `${a.id}:${b.id}`, "mittel", `${name}: Zeit oder Ort prüfen`,
        `${placeOf(a)} (${hm(a.ms)}) → ${placeOf(b)} (${hm(b.ms)}): ${num(d / 1000)} km in ${dur((b.ms - a.ms) / MIN)} ${speed} – zu schnell ${foot ? `zu Fuss (Richtwert ${T.E3_FOOT_KMH} km/h)` : `für Fz im Gelände (Richtwert ${T.E3_FZ_KMH} km/h)`}.`,
        [a, b], b.ms, { unit: a.blau ? name : undefined }));
    }
  }
  return out;
}

function ruleE4(c: Ctx): Hint[] {
  const out: Hint[] = [];
  for (const v of c.evs) {
    if (!(v.rot || v.e.side === "ul") || !DECEPTION_RE.test(v.e.text)) continue;
    if (c.quality.get(v.id)?.status === "bestaetigt") continue;
    out.push(mk("E4", v.id, "mittel", `Plausibilität prüfen (${placeOf(v)})`,
      `${hm(v.ms)} ${quote(v.e.text)} – dringend oder nicht überprüfbar und unbestätigt. Mögliche Täuschung; vor dem Handeln bestätigen lassen.`,
      [v], v.ms));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Berechnung
// ---------------------------------------------------------------------------------------------
const RULE_FNS: Array<[string, (c: Ctx) => Hint[]]> = [
  ["A1", ruleA1], ["A2", ruleA2], ["A3", ruleA3],
  ["B1", ruleB1], ["B2", ruleB2], ["B3", ruleB3],
  ["C1", ruleC1], ["C2", ruleC2], ["C3", ruleC3], ["C4", ruleC4], ["C5", ruleC5], ["C6", ruleC6],
  ["D1", ruleD1], ["D2", ruleD2], ["D3", ruleD3],
  ["E3", ruleE3], ["E4", ruleE4],
];

const LEVEL_RANK: Record<HintLevel, number> = { hoch: 0, mittel: 1, info: 2 };

/** Sortierung: hoch > mittel > info, dann neueste zuerst */
export function compareHints(a: Hint, b: Hint): number {
  return LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.t.localeCompare(a.t) || a.id.localeCompare(b.id);
}

/** Alle Hinweise zur Lagezeit, wichtigste zuerst, dann neueste */
export function computeHints(ex: Exercise, o: HintOptions): Hint[] {
  const tMs = parseMs(o.t);
  const c = prepare(ex, Number.isFinite(tMs) ? tMs : Infinity);
  if (!c.evs.length) return [];
  if (!Number.isFinite(c.tMs)) c.tMs = c.evs[c.evs.length - 1]!.ms;
  const off = new Set(o.disabled ?? []);
  const byId = new Map<string, Hint>();
  for (const [id, fn] of RULE_FNS) {
    if (off.has(id)) continue;
    let list: Hint[];
    try {
      list = fn(c);
    } catch (err) {
      if (o.strict) throw err;
      continue; // eine fehlerhafte Regel darf das Journal nie stören
    }
    // Flut vermeiden: je Regel die neuesten
    list.sort((a, b) => b.t.localeCompare(a.t));
    for (const h of list.slice(0, T.MAX_PER_RULE)) {
      const cur = byId.get(h.id);
      if (cur) cur.events = uniq([...cur.events, ...h.events]);
      else byId.set(h.id, h);
    }
  }
  return [...byId.values()].sort(compareHints);
}
