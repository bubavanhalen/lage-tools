/**
 * Eintrage-Weg des Lagejournals als Funktionen: Meldungstext → Journaleintrag → in die Übung.
 * Genau gleich für Enter im Meldungsfeld (`JournalPanel`) und für mehrere Meldungen auf einmal
 * (`BatchReview` nach Foto bzw. Sprachmemo).
 */
import {
  artOf,
  isLage,
  clockDay,
  localDay,
  cellAtAny,
  eventFromDraft,
  geometryOf,
  shapeCenter,
  lastPosition,
  nextNr,
  parseMeldung,
  type Attachment,
  type Affiliation,
  type Draft,
  type EventShape,
  type Exercise,
  type JournalContext,
  type Kind,
  type LageEvent,
  type LV95,
  type RoadPlacement,
  type Side,
  type Status,
  type Echelon,
  type EntryArt,
} from "@lage/core";
import { stateOf } from "./entry/stateOptions";
import { NR_KEY } from "./shell/contracts";

/**
 * Nächste laufende Nummer (Spez. MVP 3, Kap. 3.3, Entscheid 1): liest den Gerätezähler `localStorage[NR_KEY]`
 * (geteilt von allen Fenstern des Geräts), nimmt `nextNr` (höher als Zähler und als jede bekannte Nummer der Übung)
 * und schreibt sofort zurück – synchron im selben Task. Ohne Speicher (gesperrt): nur aus der Übung.
 */
export function takeNr(ex: Pick<Exercise, "id" | "events">): number {
  let z = 0;
  try { z = Number(localStorage.getItem(NR_KEY(ex.id)) ?? 0) || 0; } catch { /* Speicher gesperrt */ }
  const n = nextNr(ex, z);
  try { localStorage.setItem(NR_KEY(ex.id), String(n)); } catch { /* Speicher gesperrt */ }
  return n;
}

// gleich wie `shapeFits`/`shapePatch` in ShapeDraw.tsx (hier ohne Leaflet, damit der Eintrage-Weg ohne Browser testbar bleibt)
const shapeFits = (shape: EventShape, sym: string) => geometryOf(sym) === shape.kind;
function shapePatch(shape: EventShape, sheets: Exercise["sheets"]): Partial<LageEvent> {
  const c = shapeCenter(shape);
  const pos = { e: Math.round(c.e), n: Math.round(c.n) };
  const cell = cellAtAny(sheets, pos);
  return { shape, pos, where: "Karte", cells: cell ? [cell.label] : undefined, angle: undefined, road: undefined };
}

/**
 * Tag für Meldungen ohne Tagesangabe: wie im Meldungsfeld (`clockDay`) – der Kalendertag der Uhr, wenn die Übung
 * heute läuft (nach Mitternacht der nächste, wird beim Eintragen angelegt); sonst kein heutiger Tag vor der Übung.
 */
export function defaultDay(ex?: Exercise, now = new Date()): string {
  return ex ? clockDay(ex.days, now).day : localDay(now);
}

/**
 * Kontext für `parseMeldung` aus der Übung (gleich wie im Meldungsfeld). Ist `day` der heutige Tag, folgt der Tag
 * der Uhr («2355» kurz nach Mitternacht → Vortag).
 */
export function journalCtx(ex: Exercise, day: string, kind?: Kind, now = new Date()): JournalContext {
  const events = ex.events ?? [];
  return {
    sheets: ex.sheets, areas: ex.areas, units: ex.units, places: ex.places ?? [], kind, days: ex.days, day, now, dayFromClock: day === localDay(now),
    lastPos: (u: string, s: Side) => lastPosition(events, s, u),
    // MVP 3: Bezüge («zu 42», «Antwort …») und Aufhebungen brauchen die bisherigen Einträge
    events, ex,
  };
}

/** Von Hand gewählte Zeichen (Zeichenwahl im Meldungsfeld) */
export interface SymOverride { key: string; aff: Affiliation; sidc: string; echelon?: Echelon; status?: Status; desc?: string }

/** Was über den erkannten Entwurf hinaus gilt (alles optional; Stapel ohne Angaben = rein aus dem Text) */
export interface CommitOverrides {
  /** Ort (von Hand gesetzt, nachgeschlagen oder auf die Strasse gelegt) */
  pos?: LV95;
  where?: string;
  /** «karte» = von Hand auf der Karte gesetzt */
  whereKind?: "karte" | "ort";
  sym?: SymOverride;
  /** auf die Strasse gelegt */
  road?: RoadPlacement | null;
  /** Strasse liegt ausserhalb des gemeldeten Feldes: Feld nachführen */
  roadCell?: string;
  /** «Kein Strassenbezug» gewählt */
  roadNone?: boolean;
  /** von Hand gezeichnete Fläche/Linie */
  shape?: EventShape;
  /** Anhänge (IDs in `Exercise.attachments`) */
  attachments?: string[];
  /** Herkunft (Standard: Text) */
  source?: LageEvent["source"];
  /** Text stammt aus einem übernommenen KI-Vorschlag */
  via?: LageEvent["via"];
  /** (MVP 3) laufende Nummer (beim Erfassen vergeben, nie geändert) und Kürzel der Schicht («erfasst von») */
  nr?: number;
  kuerzel?: string | null;
}

const sideOfAff = (a: Affiliation): Side => (a === "F" ? "blau" : "rot");
/** Entwurf ist eine Meldung (zeichnet); alte Entwürfe ohne `art`: Notiz-Vorschlag = keine Meldung */
export const isLageDraft = (d: Pick<Draft, "art" | "kindHint">): boolean => (d.art ?? (d.kindHint === "notiz" ? "notiz" : "meldung")) === "meldung";

/**
 * Journaleintrag aus einem erkannten Entwurf (mit allfälligen Wahlen von Hand).
 * `opts.pos`/`opts.where` ersetzen den Ort des Entwurfs nur, wenn angegeben.
 */
export function buildEvent(draft: Draft, device: string, ex: Pick<Exercise, "sheets">, o: CommitOverrides = {}, now = new Date()): LageEvent {
  const pos = "pos" in o ? o.pos : draft.pos;
  const where = "where" in o ? o.where : draft.where?.label;
  const ev = eventFromDraft({ ...draft, pos, where: where ? { kind: o.whereKind === "karte" ? "karte" : "ort", label: where } : undefined }, device, now,
    { ...(o.nr !== undefined ? { nr: o.nr } : {}), ...(o.kuerzel ? { kuerzel: o.kuerzel } : {}) });
  // Invariante E3: Nicht-Meldungen haben nie Ort, Zeichen, Fläche – auch nicht von Hand gewählt
  if (draft.hebtAuf) {
    // Aufhebung (Kap. 3.5): zeichnet nie – Ort nur als Text in `orte`
    const ort = ev.where ?? ev.cells?.[0] ?? ev.nai;
    delete ev.pos; delete ev.cells; delete ev.nai; delete ev.shape; delete ev.where; delete ev.angle; delete ev.road;
    ev.unit = "";
    if (ort && !ev.orte?.length) ev.orte = [ort];
  } else if (isLageDraft(draft)) {
    const s = o.sym;
    if (s) {
      ev.sym = s.key; ev.aff = s.aff; ev.sidc = s.sidc; ev.echelon = s.echelon; ev.status = s.status; ev.desc = s.desc;
      // neutral = Zugehörigkeit N, Seite rot (Art «unklar»), nie «ul»
      ev.side = sideOfAff(s.aff);
      if (ev.side === "blau") ev.unit = ev.unit || ev.melder || "";
      else if (ev.unit && ev.unit === ev.melder) ev.unit = "";
    }
    if (draft.from !== undefined && ev.from === undefined) ev.from = draft.from;
    if (draft.fromLabel && !ev.fromLabel) ev.fromLabel = draft.fromLabel;
    if (draft.roadHint && !ev.roadHint) ev.roadHint = draft.roadHint;
    if (o.road) { ev.angle = o.road.angle; if (o.road.road) ev.road = o.road.road; }
    if (o.roadCell) ev.cells = [o.roadCell];
    if (o.roadNone) ev.roadNone = true;
    if (o.shape && shapeFits(o.shape, ev.sym)) Object.assign(ev, shapePatch(o.shape, ex.sheets));
  }
  if (o.attachments?.length) ev.attachments = [...o.attachments];
  if (o.source) ev.source = o.source;
  if (o.via) ev.via = o.via;
  return ev;
}

/**
 * Neue Einträge in die Übung (im `update`-Aufruf, auf der Kopie): Tage ergänzen, Melder und Elemente merken,
 * gefundenen Ortsnamen merken, Anhänge (Metadaten) ergänzen.
 */
export function addEvents(x: Exercise, evs: LageEvent[], extra: { place?: { name: string; pos: LV95 }; attachments?: Attachment[] } = {}): Exercise {
  x.events = [...(x.events ?? []), ...evs];
  const remember = (side: Side, u?: string) => { if (u && !x.units[side].some((v) => v.toLowerCase() === u.toLowerCase())) x.units[side] = [...x.units[side], u]; };
  for (const ev of evs) {
    if (!x.days.includes(ev.t.slice(0, 10))) x.days = [...x.days, ev.t.slice(0, 10)].sort();
    remember("blau", ev.melder);
    remember(ev.side, ev.unit);
  }
  const pl = extra.place;
  if (pl && !(x.places ?? []).some((p) => p.name === pl.name)) x.places = [...(x.places ?? []), { name: pl.name, pos: pl.pos }];
  for (const a of extra.attachments ?? []) {
    const list = x.attachments ?? [];
    x.attachments = list.some((y) => y.id === a.id) ? list.map((y) => (y.id === a.id ? { ...y, ...a } : y)) : [...list, a];
  }
  return x;
}

export interface CommitTextsOptions {
  ex: Exercise;
  device: string;
  update: (f: (x: Exercise) => Exercise) => void;
  /** Tag für Meldungen ohne Tagesangabe (Standard: wie im Meldungsfeld) */
  day?: string;
  /** an jede Meldung hängen (ID); mit `attachment` werden auch die Metadaten gespeichert */
  attachmentId?: string;
  attachment?: Attachment;
  /** Texte stammen aus einem KI-Vorschlag (Standard: wenn der Anhang von der KI gelesen wurde) */
  via?: LageEvent["via"];
  /** Texte mit Problem im Entwurf bzw. «geht nicht» (unbekannter Ort, ungültige Zeit, Zeit in der Zukunft) werden nie eingetragen – hier gemeldet */
  onSkipped?: (texts: string[]) => void;
  /** (MVP 3) laufende Nummer je Eintrag (Standard: `takeNr`) und Kürzel der Schicht */
  onNr?: () => number;
  kuerzel?: string | null;
  /** (MVP 3) Art je Text von Hand gewählt (Foto-/Sprach-Übersicht), Index wie `texts` */
  arten?: Array<EntryArt | null | undefined>;
}

/**
 * Mehrere Meldungstexte nacheinander eintragen – wie Enter im Meldungsfeld (Zeichen, Ort, Fläche aus dem Text;
 * Hindernisse & Co. legt die Lagekarte danach selbst auf die Strasse). Spätere Meldungen sehen die früheren
 * («zuletzt», neue Elemente). Gibt die neuen Einträge zurück (leer: nichts erkannt).
 */
export function commitTexts(texts: string[], o: CommitTextsOptions): LageEvent[] {
  const day = o.day ?? defaultDay(o.ex);
  const attId = o.attachmentId ?? o.attachment?.id;
  const src: LageEvent["source"] | undefined = o.attachment
    ? { kind: o.attachment.kind === "audio" ? "audio" : "image", ref: o.attachment.id }
    : attId ? { kind: "image", ref: attId } : undefined;
  // Arbeitskopie: Einheiten/Ereignisse der früheren Meldungen im Stapel gelten für die späteren
  let work: Exercise = { ...o.ex, units: { rot: [...o.ex.units.rot], blau: [...o.ex.units.blau], ul: [...o.ex.units.ul] }, events: [...(o.ex.events ?? [])], days: [...o.ex.days] };
  const via = o.via ?? (o.attachment?.engine === "ki" ? "ki" : undefined);
  const base = Date.now();
  const out: LageEvent[] = [];
  const skipped: string[] = [];
  texts.forEach((raw, i) => {
    const text = raw.replace(/\s*\n\s*/g, " ").trim();
    if (!text) return;
    const now = new Date(base + i);
    const art = o.arten?.[i] ?? undefined;
    const draft = parseMeldung(text, { ...journalCtx(work, day, undefined, now), ...(art ? { art } : {}) });
    // nie still falsch: mit Problem (z. B. «AK77» gibt es nicht) oder «geht nicht» nach denselben Regeln wie das
    // Meldungsfeld (z. B. Zeit in der Zukunft ohne Tagesangabe) nicht eintragen – nur nach Korrektur
    if (draft.problems?.length || stateOf(draft, work, { now }).level === "geht-nicht") { skipped.push(text); return; }
    const nr = o.onNr ? o.onNr() : takeNr(work);
    const ev = buildEvent(draft, o.device, work, { attachments: attId ? [attId] : undefined, source: src, via, nr, kuerzel: o.kuerzel }, now);
    out.push(ev);
    work = addEvents(work, [ev]);
  });
  if (skipped.length) o.onSkipped?.(skipped);
  if (!out.length && !o.attachment) return out;
  o.update((x) => addEvents(x, out, { attachments: o.attachment ? [o.attachment] : undefined }));
  return out;
}

// ---------- Korrektur (Spez. MVP 1, Kap. 3.3) ----------

/** Ort einer Meldung (bleibt bei einer Korrektur, wenn der neue Text keinen Ort nennt) */
const PLACE_KEYS = ["pos", "where", "cells", "nai", "angle", "road", "roadNone", "shape"] as const;
/** Zeichen und Einordnung (bleiben, solange der Text unverändert ist und nichts von Hand gewählt wurde) */
const SYMBOL_KEYS = ["side", "unit", "aff", "sym", "sidc", "echelon", "status", "desc", "count", "label"] as const;
/** übrige Inhalte, die der neu gelesene Text bestimmt (MVP 3: Art und ihre Felder) */
const TEXT_KEYS = ["melder", "text", "dir", "from", "fromLabel", "roadHint", "via",
  "art", "notiz", "an", "quelle", "frist", "vbk", "bezug", "bezugArt", "hebtAuf", "orte", "felder"] as const;

/**
 * Änderung für `correctEvent` aus der neu gelesenen Fassung `cand` (`buildEvent` aus dem Korrekturtext):
 * nur Felder, die sich gegenüber `base` wirklich ändern (leer = keine Änderung). `keepPlace`: Ort der Meldung bleibt
 * (Text nennt keinen Ort, Ort von Hand gesetzt); `keepSymbol`: Zeichen/Einordnung bleiben; `keepTime`: Zeit bleibt.
 */
export function correctionPatch(base: LageEvent, cand: LageEvent, o: { keepPlace: boolean; keepSymbol: boolean; keepTime: boolean }): Partial<LageEvent> {
  const out: Record<string, unknown> = {};
  // Art ändern ist eine Korrektur (Kap. 3.4): Nicht-Meldung bzw. Aufhebung hat nie Ort/Zeichen – alte Werte entfernen
  if (!isLage(cand) || artOf(cand) !== artOf(base) || !!cand.hebtAuf !== !!base.hebtAuf) o = { ...o, keepPlace: false, keepSymbol: false };
  const take = (keys: readonly (keyof LageEvent)[], from: LageEvent) => {
    for (const k of keys) if (JSON.stringify(from[k]) !== JSON.stringify(base[k])) out[k] = from[k];
  };
  take(TEXT_KEYS, cand);
  // Art immer ausdrücklich, wenn sie wechselt (auch «meldung»: eventFromDraft setzt `art` nur bei Nicht-Meldungen)
  if (artOf(cand) !== artOf(base)) { out.art = artOf(cand); if (artOf(cand) === "meldung" && base.notiz) out.notiz = undefined; }
  if (!o.keepPlace) take(PLACE_KEYS, cand);
  if (!o.keepSymbol) take(SYMBOL_KEYS, cand);
  if (!o.keepTime && cand.t !== base.t) out.t = cand.t;
  return out as Partial<LageEvent>;
}

/** Melder/Element einer korrigierten Meldung in der Übung merken (wie `addEvents`) */
export function rememberUnits(x: Exercise, ev: Pick<LageEvent, "melder" | "unit" | "side">): Exercise {
  const remember = (side: Side, u?: string) => { if (u && !x.units[side].some((v) => v.toLowerCase() === u.toLowerCase())) x.units = { ...x.units, [side]: [...x.units[side], u] }; };
  remember("blau", ev.melder);
  remember(ev.side, ev.unit);
  return x;
}
