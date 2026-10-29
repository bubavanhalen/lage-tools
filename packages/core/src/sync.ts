/**
 * Zusammenführen zweier Fassungen derselben Übung (Datei «Öffnen», zwei Fenster, zwei Geräte) – ohne Datenverlust:
 * - Meldungen pro ID nach Revision (`mergeEvents`); Löschen ist ein Eintrag mit `deleted` (Revision), geht also mit.
 * - Raster, Flächen, Bilder, Anhänge: Vereinigung nach ID; bei gleicher ID gilt die lokale Fassung
 *   (Anhänge: fehlende Angaben wie ein Transkript werden ergänzt). Abweichende Raster/Flächen/Bilder stehen einzeln
 *   im Bericht (`diffs`) und lassen sich mit `takeHullItems` aus der anderen Fassung übernehmen.
 * - Gelöschte Raster/Flächen/Bilder tragen eine Löschmarke (`Exercise.removed`, `markRemovals`) und tauchen beim
 *   Zusammenführen nicht wieder auf.
 * - Entscheide zu Hinweisen: pro Hinweis der spätere Entscheid.
 * - Tage, Elemente, Orte: Vereinigung. Name und Einstellungen: lokal (fehlt lokal etwas, aus der anderen Fassung).
 * - MVP 3: Schichten/Übergaben Vereinigung nach ID; Klassifizierung lokal; laufende Nummern ändern nie – doppelt
 *   vergebene werden gemeldet (`MergeReport.doppelt`, Kennzeichnung «12a/12b» in nummer.ts).
 * «Ersetzen» (andere Fassung gilt ganz) ist bewusst kein Teil davon – nur auf ausdrücklichen Wunsch.
 */
import { eventWins, mergeEventsDetailed, type Exercise, type HintDecision, type LageEvent } from "./model";
import { doppeltText, neueDoppelte, type NrDoppelt } from "./nummer";
import { mergeSchichten } from "./schicht";

export interface MergeReport {
  /** Meldungen nur in der anderen Fassung */
  neu: number;
  /** Meldungen, die dort neuer sind (höhere Revision) */
  aktualisiert: number;
  /** Meldungen gleich oder hier neuer (bleiben wie hier) */
  unveraendert: number;
  /** Meldungen nur hier (nicht in der anderen Fassung) – bleiben */
  nurHier: number;
  /**
   * Konflikte: gleiche Meldung auf beiden Geräten mit gleicher Revision, aber anderem Inhalt (z. B. beide korrigiert).
   * Die neuere Korrektur gilt, die andere Fassung steht in `history` (`conflict: true`). Zählt weder als aktualisiert
   * noch als unverändert.
   */
  conflicts: number;
  /** IDs der Meldungen mit Konflikt (für «1 Konflikt – ansehen») */
  conflictIds: string[];
  /** hinzugekommen: Raster, Flächen (NAI/AO), Bilder, Anhänge, Entscheide */
  sheets: number;
  areas: number;
  overlays: number;
  attachments: number;
  decisions: number;
  /** gleiche ID, anderer Inhalt (Raster, Fläche, Bild) – hiesige Fassung behalten */
  abweichend: number;
  /** die abweichenden Raster/Flächen/Bilder einzeln (zum Wählen «hiesige behalten / aus Datei übernehmen») */
  diffs: HullDiff[];
  /**
   * (MVP 3) Nummern, die durch dieses Zusammenführen doppelt sind (zwei Geräte offline, gleiche Nummer) – sie bleiben,
   * die Anzeige kennzeichnet sie «12a/12b»; Text: `doppeltText` («2 Nummern doppelt – als 12a/12b gekennzeichnet»)
   */
  doppelt?: NrDoppelt[];
}

/** Teile der Hülle mit ID, die beim Zusammenführen einzeln gewählt werden können */
export type HullKind = "sheets" | "areas" | "overlays";
const HULL_KINDS: HullKind[] = ["sheets", "areas", "overlays"];

/** Raster/Fläche/Bild mit gleicher ID, aber anderem Inhalt in beiden Fassungen */
export interface HullDiff {
  kind: HullKind;
  id: string;
  /** Name hier */
  name: string;
  /** Name in der anderen Fassung */
  theirsName: string;
}

type Marks = NonNullable<Exercise["removed"]>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Löschmarken vereinigen: pro ID gilt die spätere */
export function mergeMarks(a: Marks | undefined, b: Marks | undefined): Marks | undefined {
  if (!b || !Object.keys(b).length) return a;
  if (!a || !Object.keys(a).length) return b;
  const out: Marks = { ...a };
  for (const [id, m] of Object.entries(b)) { const cur = out[id]; if (!cur || m.at > cur.at) out[id] = m; }
  return out;
}

/** gilt die ID als gelöscht? */
export const isRemoved = (marks: Marks | undefined, id: string) => !!marks?.[id] && !marks[id]!.undone;

/**
 * Löschmarken nachführen (nach jeder Änderung der Übung): Raster/Flächen/Bilder, die in `after` fehlen, bekommen eine
 * Marke; wieder aufgetauchte (Rückgängig) werden als «undone» markiert. Ohne Änderung kommt `after` unverändert zurück.
 */
export function markRemovals(before: Exercise, after: Exercise, now = new Date()): Exercise {
  if (before.id !== after.id) return after;
  const at = now.toISOString();
  let removed = after.removed;
  const set = (id: string, v: { at: string; undone?: boolean }) => { removed = { ...(removed ?? {}), [id]: v }; };
  for (const k of HULL_KINDS) {
    const b = before[k] ?? [], a = after[k] ?? [];
    if (b === a) continue;
    const inA = new Set(a.map((x) => x.id)), inB = new Set(b.map((x) => x.id));
    for (const x of b) if (!inA.has(x.id)) set(x.id, { at });
    for (const x of a) if (!inB.has(x.id) && isRemoved(removed, x.id)) set(x.id, { at, undone: true });
  }
  return removed === after.removed ? after : { ...after, removed };
}

/** Vereinigung nach ID; lokal gewinnt; gelöschte (Marke) fallen weg. Zählt hinzugekommene und abweichende. */
function unionById<T extends { id: string }>(local: T[] | undefined, other: T[] | undefined, marks?: Marks, combine?: (l: T, o: T) => T): { list: T[]; added: number; differ: number; diffs: Array<{ l: T; o: T }> } {
  const out = (local ?? []).filter((x) => !isRemoved(marks, x.id));
  const idx = new Map(out.map((x, i) => [x.id, i]));
  let added = 0, differ = 0;
  const diffs: Array<{ l: T; o: T }> = [];
  for (const o of other ?? []) {
    if (isRemoved(marks, o.id)) continue;
    const i = idx.get(o.id);
    if (i === undefined) { idx.set(o.id, out.length); out.push(o); added++; continue; }
    const l = out[i]!;
    if (combine) out[i] = combine(l, o);
    else if (!same(l, o)) { differ++; diffs.push({ l, o }); }
  }
  return { list: out, added, differ, diffs };
}

function mergeDecisions(a: Record<string, HintDecision> | undefined, b: Record<string, HintDecision> | undefined): { map: Record<string, HintDecision> | undefined; added: number } {
  if (!b || !Object.keys(b).length) return { map: a, added: 0 };
  const out: Record<string, HintDecision> = { ...(a ?? {}) };
  let added = 0;
  for (const [k, d] of Object.entries(b)) {
    const cur = out[k];
    if (!cur) { out[k] = d; added++; } else if (d.at > cur.at) { out[k] = d; added++; }
  }
  return { map: out, added };
}

const unionCi = (a: string[] = [], b: string[] = []) => {
  const out = [...a];
  for (const u of b) if (!out.some((v) => v.toLowerCase() === u.toLowerCase())) out.push(u);
  return out;
};

/**
 * Hülle (alles ausser Meldungen) zusammenführen: `ours` gewinnt bei gleicher ID / bei Einstellungen. Was in einer
 * der Fassungen gelöscht wurde (Löschmarke, die spätere gilt), bleibt gelöscht. Gibt die Hülle mit `ours.events` zurück.
 */
export function mergeHull(ours: Exercise, theirs: Exercise): { ex: Exercise; report: Omit<MergeReport, "neu" | "aktualisiert" | "unveraendert" | "nurHier" | "conflicts" | "conflictIds"> } {
  const marks = mergeMarks(ours.removed, theirs.removed);
  const sheets = unionById(ours.sheets, theirs.sheets, marks);
  const areas = unionById(ours.areas, theirs.areas, marks);
  const overlays = unionById(ours.overlays, theirs.overlays, marks);
  const attachments = unionById(ours.attachments, theirs.attachments, undefined, (l, o) => {
    const m: Record<string, unknown> = { ...o };
    for (const [k, v] of Object.entries(l)) if (v !== undefined) m[k] = v;
    return m as unknown as typeof l;
  });
  const dec = mergeDecisions(ours.hintDecisions, theirs.hintDecisions);
  const places = [...(ours.places ?? [])];
  for (const p of theirs.places ?? []) if (!places.some((x) => x.name === p.name)) places.push(p);
  const ex: Exercise = {
    ...theirs,
    ...Object.fromEntries(Object.entries(ours).filter(([, v]) => v !== undefined)),
    days: [...new Set([...(ours.days ?? []), ...(theirs.days ?? [])])].sort(),
    sheets: sheets.list,
    areas: areas.list,
    units: {
      rot: unionCi(ours.units?.rot, theirs.units?.rot),
      blau: unionCi(ours.units?.blau, theirs.units?.blau),
      ul: unionCi(ours.units?.ul, theirs.units?.ul),
    },
    places,
    events: ours.events,
  } as Exercise;
  if (overlays.list.length || ex.overlays) ex.overlays = overlays.list;
  if (attachments.list.length) ex.attachments = attachments.list;
  if (dec.map) ex.hintDecisions = dec.map;
  if (marks) ex.removed = marks;
  const schichten = mergeSchichten(ours.schichten, theirs.schichten);
  if (schichten) ex.schichten = schichten;
  const diffs: HullDiff[] = [
    ...sheets.diffs.map(({ l, o }) => ({ kind: "sheets" as const, id: l.id, name: l.name, theirsName: o.name })),
    ...areas.diffs.map(({ l, o }) => ({ kind: "areas" as const, id: l.id, name: l.name, theirsName: o.name })),
    ...overlays.diffs.map(({ l, o }) => ({ kind: "overlays" as const, id: l.id, name: l.name, theirsName: o.name })),
  ];
  return {
    ex,
    report: { sheets: sheets.added, areas: areas.added, overlays: overlays.added, attachments: attachments.added, decisions: dec.added, abweichend: sheets.differ + areas.differ + overlays.differ, diffs },
  };
}

/**
 * Einzelne Raster/Flächen/Bilder aus einer anderen Fassung übernehmen («aus Datei übernehmen») bzw. zurück auf die
 * hiesige («hiesige behalten», `source` = hiesige Fassung vor dem Zusammenführen). Meldungen bleiben unberührt.
 */
export function takeHullItems(ex: Exercise, source: Exercise, picks: Array<Pick<HullDiff, "kind" | "id">>): Exercise {
  const out: Exercise = { ...ex };
  for (const k of HULL_KINDS) {
    const ids = new Set(picks.filter((p) => p.kind === k).map((p) => p.id));
    if (!ids.size) continue;
    const src = new Map(((source[k] ?? []) as Array<{ id: string }>).map((x) => [x.id, x]));
    (out as unknown as Record<HullKind, Array<{ id: string }>>)[k] = ((ex[k] ?? []) as Array<{ id: string }>).map((x) => (ids.has(x.id) && src.has(x.id) ? src.get(x.id)! : x));
  }
  return out;
}

/** Meldungen zusammenführen und zählen (andere Fassung `theirs` gegen hiesige `ours`) */
export function mergeEventsReport(ours: LageEvent[], theirs: LageEvent[]): { events: LageEvent[]; neu: number; aktualisiert: number; unveraendert: number; nurHier: number; conflicts: number; conflictIds: string[] } {
  const mine = new Map(ours.map((e) => [e.id, e]));
  const merged = mergeEventsDetailed(ours, theirs);
  const conflict = new Set(merged.conflicts);
  let neu = 0, aktualisiert = 0, unveraendert = 0;
  const seen = new Set<string>();
  for (const o of theirs) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const l = mine.get(o.id);
    if (!l) neu++;
    else if (conflict.has(o.id)) continue;
    else if (eventWins(o, l) && !same(l, o)) aktualisiert++;
    else unveraendert++;
  }
  const nurHier = ours.filter((e) => !seen.has(e.id)).length;
  return { events: merged.events, neu, aktualisiert, unveraendert, nurHier, conflicts: merged.conflicts.length, conflictIds: merged.conflicts };
}

/**
 * Zwei Fassungen derselben Übung zusammenführen (z. B. Datei von einem anderen Gerät öffnen): nichts geht verloren.
 * `ours` = hier (gewinnt bei gleicher ID ohne Revision), `theirs` = andere Fassung.
 */
export function mergeExercise(ours: Exercise, theirs: Exercise): { ex: Exercise; report: MergeReport } {
  const h = mergeHull(ours, theirs);
  const ev = mergeEventsReport(ours.events ?? [], theirs.events ?? []);
  h.ex.events = ev.events;
  // Tage der Meldungen sicher dabei
  for (const e of ev.events) { const d = e.t.slice(0, 10); if (!h.ex.days.includes(d)) h.ex.days = [...h.ex.days, d].sort(); }
  const doppelt = neueDoppelte(ours, h.ex);
  return { ex: h.ex, report: { ...h.report, neu: ev.neu, aktualisiert: ev.aktualisiert, unveraendert: ev.unveraendert, nurHier: ev.nurHier, conflicts: ev.conflicts, conflictIds: ev.conflictIds, ...(doppelt.length ? { doppelt } : {}) } };
}

/** «3 neu · 1 aktualisiert · 0 unverändert» (+ «1 Konflikt», «2 nur hier», «+1 NAI/Fläche» …) */
export function mergeReportText(r: MergeReport): string {
  const parts = [`${r.neu} neu`, `${r.aktualisiert} aktualisiert`, `${r.unveraendert} unverändert`];
  if (r.conflicts) parts.push(`${r.conflicts} ${r.conflicts === 1 ? "Konflikt" : "Konflikte"}`);
  if (r.nurHier) parts.push(`${r.nurHier} nur hier`);
  const plus: string[] = [];
  if (r.sheets) plus.push(`${r.sheets} Raster`);
  if (r.areas) plus.push(`${r.areas} ${r.areas === 1 ? "Fläche" : "Flächen"}`);
  if (r.overlays) plus.push(`${r.overlays} ${r.overlays === 1 ? "Bild" : "Bilder"}`);
  if (r.attachments) plus.push(`${r.attachments} ${r.attachments === 1 ? "Anhang" : "Anhänge"}`);
  if (r.decisions) plus.push(`${r.decisions} ${r.decisions === 1 ? "Entscheid" : "Entscheide"}`);
  if (plus.length) parts.push(`+ ${plus.join(", ")}`);
  if (r.abweichend) parts.push(`${r.abweichend} abweichend (hiesige Fassung behalten)`);
  if (r.doppelt?.length) parts.push(doppeltText(r.doppelt));
  return parts.join(" · ");
}
