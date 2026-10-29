/**
 * Kräfte Rot als Tabelle (Experte): gesehen ↔ erwartet (aus dem Befehl) ↔ Stand, «nicht mehr gesehen».
 * Aus `LageRotPanel` herausgelöst, damit `RedPanel` (Experte) und Präsentation dieselbe Tabelle zeigen.
 */
import type { Exercise, StrengthCompare } from "@lage/core";
import { hhmm } from "../hintsData";
import { durLabel, expectedLabel, foundLabel, inWindowLabel, MIND_BIS_TITLE, rowName, STATE_LABEL, type LageRotState } from "../lageRot";

/** Kräfte Rot: erkannt ↔ erwartet (Feindannahme) ↔ Stand; ohne Feindannahme nur «erkannt» (auch in RedPanel, Experte) */
export function ForceTable({ lage, ex, t, onEvent }: { lage: LageRotState; ex: Exercise; t: string; onEvent: (id: string) => void }) {
  const rows = lage.compare.filter((c) => c.found || c.expected !== undefined);
  const withSpec = !!lage.spec;
  const withWin = !!lage.from;
  const { notSeen } = lage.force;
  if (!rows.length && !notSeen.length) return <p className="lr-empty">Noch nichts erkannt.</p>;
  return (
    <div className={"lr-tab" + (withSpec ? " spec" : "") + (withWin ? " win" : "")} role="table" aria-label="Kräfte Rot">
      <div className="lr-tr lr-th" role="row">
        <span role="columnheader"><span className="sr">Art</span></span>
        <span role="columnheader" title={`ganzes Journal bis zur Lagezeit – ${MIND_BIS_TITLE}`}>erkannt</span>
        {withWin && <span role="columnheader" title={`nur Meldungen im Zeitfenster ab ${hhmm(lage.from!, ex.days, t)}`}><span className="lr-l">im Fenster</span><span className="lr-s">Fenster</span></span>}
        {withSpec && <><span role="columnheader" title="erwartet (Feindannahme)"><span className="lr-l">erwartet</span><span className="lr-s">erw.</span></span><span role="columnheader">Stand</span></>}
      </div>
      {rows.map((c) => {
        const f = foundLabel(c.found);
        const w = withWin ? inWindowLabel(c.found) : null;
        return (
          <div key={c.row.key} className={"lr-tr s-" + c.state + (c.row.parent ? " sub" : "") + (c.row.key === "unklar" ? " unk" : "")} role="row">
            <span className="lr-name" role="rowheader">{rowName(c)}</span>
            <span className={"lr-found" + (f.range ? " rng" : "")} role="cell" title={f.range ? MIND_BIS_TITLE : undefined}>{f.main}{f.sub && <small>{f.sub}</small>}</span>
            {w && <span className={"lr-found lr-inwin" + (w.range ? " rng" : "")} role="cell" title={w.range ? MIND_BIS_TITLE : "im Zeitfenster gemeldet"}>{w.main}{w.sub && <small>{w.sub}</small>}</span>}
            {withSpec && <><span className="lr-exp tnum" role="cell">{expectedLabel(c)}</span><span role="cell"><Stand c={c} /></span></>}
          </div>
        );
      })}
      {notSeen.length > 0 && (
        <div className="lr-tr lr-gone" role="row">
          <span className="lr-name" role="rowheader">Nicht mehr gesehen</span>
          <span className="lr-gonelist" role="cell">
            {notSeen.map((g) => (
              <button key={g.unit} className="lr-goneb" onClick={() => onEvent(g.event)} title={`Letzte Meldung ${g.unit} zeigen`}>
                <b>{g.unit}</b> seit <span className="tnum">{hhmm(g.since, ex.days, t)}</span> <span className="lr-dur tnum">({durLabel(g.minutes)})</span>
              </button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

function Stand({ c }: { c: StrengthCompare }) {
  const label = STATE_LABEL[c.state];
  if (c.state === "teilweise") {
    const pct = Math.round(Math.min(1, c.ratio ?? 0) * 100);
    return (
      <span className="lr-st teilweise" title={`${label}: ca. ${pct} % der Feindannahme erkannt`}>
        <span className="lr-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
        <span className="tnum">~{pct} %</span>
      </span>
    );
  }
  const sign = { vollstaendig: "✓", fehlt: "–", unerwartet: "!", mehr: "↑", offen: "", teilweise: "" }[c.state];
  return <span className={"lr-st " + c.state} title={label}><span className="lr-sign" aria-hidden="true">{sign}</span> <span className="lr-stl">{label}</span></span>;
}
