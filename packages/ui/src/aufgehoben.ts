/**
 * Aufgehobene Sperren, Checkpoints, Flächen und Linien (Spez. MVP 3, Kap. 3.5) für Karte, Legende und Lagekarte –
 * ohne Leaflet (auch in Tests und im Druck).
 */
import { liftMap, zeitBis, type LageEvent } from "@lage/core";

const OHNE = new WeakMap<LageEvent[], { lifts: Map<string, { t: string; by: string }>; byT: Map<string, LageEvent[]> }>();
/**
 * Meldungen ohne die zur Lagezeit `t` aufgehobenen (Sperre, Checkpoint, Fläche, Linie – Spez. MVP 3, Kap. 3.5;
 * `liftMap` aus dem Kern): Rückblick vor der Aufhebung zeigt das Zeichen noch. Gleiche Liste ohne Aufhebung → dieselbe
 * Liste (Identität bleibt, Memos greifen). Für Lageebene, Legende und Lagekarte.
 */
export function ohneAufgehobene(events: LageEvent[], t: string): LageEvent[] {
  let m = OHNE.get(events);
  if (!m) { m = { lifts: liftMap(events), byT: new Map() }; OHNE.set(events, m); }
  if (!m.lifts.size) return events;
  let out = m.byT.get(t);
  if (out) return out;
  const lifts = m.lifts;
  out = events.some((e) => { const l = lifts.get(e.id); return !!l && zeitBis(l.t, t); })
    ? events.filter((e) => { const l = lifts.get(e.id); return !l || !zeitBis(l.t, t); })
    : events;
  if (m.byT.size > 20) m.byT.clear();
  m.byT.set(t, out);
  return out;
}
