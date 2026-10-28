/**
 * Zusammenführen zweier Fassungen derselben Übung (Datei «Öffnen», zwei Fenster, zwei Geräte) – ohne Datenverlust:
 * - Meldungen pro ID nach Revision (`mergeEvents`); Löschen ist ein Eintrag mit `deleted` (Revision), geht also mit.
 * - Raster, Flächen, Bilder, Anhänge: Vereinigung nach ID; bei gleicher ID gilt die lokale Fassung
 *   (Anhänge: fehlende Angaben wie ein Transkript werden ergänzt).
 * - Entscheide zu Hinweisen: pro Hinweis der spätere Entscheid.
 * - Tage, Elemente, Orte: Vereinigung. Name und Einstellungen: lokal (fehlt lokal etwas, aus der anderen Fassung).
 * «Ersetzen» (andere Fassung gilt ganz) ist bewusst kein Teil davon – nur auf ausdrücklichen Wunsch.
 */
import { mergeEvents, type Exercise, type HintDecision, type LageEvent } from "./model";

export interface MergeReport {
  /** Meldungen nur in der anderen Fassung */
  neu: number;
  /** Meldungen, die dort neuer sind (höhere Revision) */
  aktualisiert: number;
  /** Meldungen gleich oder hier neuer (bleiben wie hier) */
  unveraendert: number;
  /** Meldungen nur hier (nicht in der anderen Fassung) – bleiben */
  nurHier: number;
  /** hinzugekommen: Raster, Flächen (NAI/AO), Bilder, Anhänge, Entscheide */
  sheets: number;
  areas: number;
  overlays: number;
  attachments: number;
  decisions: number;
  /** gleiche ID, anderer Inhalt (Raster, Fläche, Bild) – hiesige Fassung behalten */
  abweichend: number;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Vereinigung nach ID; lokal gewinnt. Zählt hinzugekommene und abweichende. */
function unionById<T extends { id: string }>(local: T[] | undefined, other: T[] | undefined, combine?: (l: T, o: T) => T): { list: T[]; added: number; differ: number } {
  const out = [...(local ?? [])];
  const idx = new Map(out.map((x, i) => [x.id, i]));
  let added = 0, differ = 0;
  for (const o of other ?? []) {
    const i = idx.get(o.id);
    if (i === undefined) { idx.set(o.id, out.length); out.push(o); added++; continue; }
    const l = out[i]!;
    if (combine) out[i] = combine(l, o);
    else if (!same(l, o)) differ++;
  }
  return { list: out, added, differ };
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
 * Hülle (alles ausser Meldungen) zusammenführen: `ours` gewinnt bei gleicher ID / bei Einstellungen.
 * Gibt die Hülle mit `ours.events` zurück.
 */
export function mergeHull(ours: Exercise, theirs: Exercise): { ex: Exercise; report: Omit<MergeReport, "neu" | "aktualisiert" | "unveraendert" | "nurHier"> } {
  const sheets = unionById(ours.sheets, theirs.sheets);
  const areas = unionById(ours.areas, theirs.areas);
  const overlays = unionById(ours.overlays, theirs.overlays);
  const attachments = unionById(ours.attachments, theirs.attachments, (l, o) => {
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
  if (overlays.list.length) ex.overlays = overlays.list;
  if (attachments.list.length) ex.attachments = attachments.list;
  if (dec.map) ex.hintDecisions = dec.map;
  return {
    ex,
    report: { sheets: sheets.added, areas: areas.added, overlays: overlays.added, attachments: attachments.added, decisions: dec.added, abweichend: sheets.differ + areas.differ + overlays.differ },
  };
}

/** Meldungen zusammenführen und zählen (andere Fassung `theirs` gegen hiesige `ours`) */
export function mergeEventsReport(ours: LageEvent[], theirs: LageEvent[]): { events: LageEvent[]; neu: number; aktualisiert: number; unveraendert: number; nurHier: number } {
  const mine = new Map(ours.map((e) => [e.id, e]));
  let neu = 0, aktualisiert = 0, unveraendert = 0;
  const seen = new Set<string>();
  for (const o of theirs) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const l = mine.get(o.id);
    if (!l) neu++;
    else if (mergeEvents([l], [o])[0] === o && !same(l, o)) aktualisiert++;
    else unveraendert++;
  }
  const nurHier = ours.filter((e) => !seen.has(e.id)).length;
  return { events: mergeEvents(ours, theirs), neu, aktualisiert, unveraendert, nurHier };
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
  return { ex: h.ex, report: { ...h.report, neu: ev.neu, aktualisiert: ev.aktualisiert, unveraendert: ev.unveraendert, nurHier: ev.nurHier } };
}

/** «3 neu · 1 aktualisiert · 0 unverändert» (+ «2 nur hier», «+1 NAI/Fläche» …) */
export function mergeReportText(r: MergeReport): string {
  const parts = [`${r.neu} neu`, `${r.aktualisiert} aktualisiert`, `${r.unveraendert} unverändert`];
  if (r.nurHier) parts.push(`${r.nurHier} nur hier`);
  const plus: string[] = [];
  if (r.sheets) plus.push(`${r.sheets} Raster`);
  if (r.areas) plus.push(`${r.areas} ${r.areas === 1 ? "Fläche" : "Flächen"}`);
  if (r.overlays) plus.push(`${r.overlays} ${r.overlays === 1 ? "Bild" : "Bilder"}`);
  if (r.attachments) plus.push(`${r.attachments} ${r.attachments === 1 ? "Anhang" : "Anhänge"}`);
  if (r.decisions) plus.push(`${r.decisions} ${r.decisions === 1 ? "Entscheid" : "Entscheide"}`);
  if (plus.length) parts.push(`+ ${plus.join(", ")}`);
  if (r.abweichend) parts.push(`${r.abweichend} abweichend (hiesige Fassung behalten)`);
  return parts.join(" · ");
}
