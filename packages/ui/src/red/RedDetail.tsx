/**
 * Detail in «Was Rot vorhaben könnte» (Spez. MVP 1, Kap. 2.7, 3.6): ersetzt die Liste. Hinweis mit «Warum», «Jetzt prüfen»,
 * Auslösern und Entscheid; Möglichkeit Rot mit Anzeichen, Weg von Rot und «Jetzt prüfen». Codes und Quellen nur unter
 * «Woher kommt das?» (eingeklappt).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hintHeadline, hintOrigin, hintRule, type CoaIndicator, type Exercise, type Hint, type LageEvent, type RedCoa } from "@lage/core";
import { decisionOf, decisionRec, type DecisionState } from "../hintsData";
import { KiCoaExplain, KiHintExplain } from "../ki/KiFeatures";
import { COA_KICKER, coaLine, coaWhen, eventLine, hintMeta, indicatorGroups, indicatorLine, sideMark } from "./redText";

interface Common {
  ex: Exercise;
  t: string;
  experte: boolean;
  /** Beschriftung des Zurück-Knopfs, z. B. «Zurück zur Liste» */
  backLabel: string;
  onBack: () => void;
  /** Fokus auf den Titel setzen (nur, wenn das Detail aus der Liste geöffnet wurde) */
  focus: boolean;
}

function Back({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <button className="red-back" onClick={onBack}>
      <span aria-hidden="true">‹</span> {label}
    </button>
  );
}

/** «Woher kommt das?» – eingeklappt; Inhalt nur, wenn aufgeklappt (Grundansicht ohne Codes) */
function Origin({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="red-origin">
      <button className="red-origin-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="red-chev" aria-hidden="true">▸</span> Woher kommt das?
      </button>
      {open && <div className="red-origin-body">{children}</div>}
    </div>
  );
}

function useTitleFocus(focus: boolean, key: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focus) ref.current?.focus({ preventScroll: true }); }, [focus, key]);
  return ref;
}

export function RedHintDetail({ h, ex, t, experte, backLabel, onBack, focus, onDecide, onMap, onEvent }: Common & {
  h: Hint;
  onDecide: (s: DecisionState) => void;
  onMap: () => void;
  onEvent: (id: string) => void;
}) {
  const title = useTitleFocus(focus, h.id);
  const state = decisionOf(ex, h);
  const dec = decisionRec(ex, h);
  const evById = useMemo(() => new Map((ex.events ?? []).map((e) => [e.id, e] as const)), [ex.events]);
  const evs = h.events.map((id) => evById.get(id)).filter((e): e is LageEvent => !!e && !e.deleted).sort((a, b) => b.t.localeCompare(a.t));
  const [all, setAll] = useState(false);
  const shown = all || evs.length <= 4 ? evs : evs.slice(0, 3);
  const o = hintOrigin(h);
  const canMap = !!(h.pos || h.cells?.length || h.nai || evs.some((e) => e.pos));
  return (
    <div className={"red-detail l-" + h.level}>
      <Back label={backLabel} onBack={onBack} />
      <h3 className="red-d-title" tabIndex={-1} ref={title}>
        {hintHeadline(h)}
        {experte && <span className="red-code">{h.rule}</span>}
      </h3>
      <p className="red-d-meta">{hintMeta(h, ex, t)}</p>
      <p className="red-d-p"><b>Warum:</b> {h.text}</p>
      {h.todo && <p className="red-d-p red-todo"><b>Jetzt prüfen:</b> {h.todo}</p>}
      {evs.length > 0 && (
        <div className="red-d-sec">
          <p className="red-d-h">Ausgelöst durch:</p>
          <ul className="red-evs">
            {shown.map((e) => {
              const m = sideMark(e);
              return (
                <li key={e.id}>
                  <button className="red-ev" onClick={() => onEvent(e.id)}>
                    <span className="red-ev-t">{e.t.slice(11, 16)}</span>
                    <span className={"red-side " + m.cls} aria-label={m.label}>{m.mark}</span>
                    <span className="red-ev-x">{eventLine(e)}</span>
                    <span className="red-ev-go">Meldung zeigen</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {evs.length > shown.length && <button className="red-link" onClick={() => setAll(true)}>{evs.length - shown.length} weitere Meldungen zeigen</button>}
        </div>
      )}
      <div className="red-actions">
        {h.level !== "info" && (state === "neu" ? (
          <>
            <button className="red-btn primary" onClick={() => onDecide("bestaetigt")}>Trifft zu</button>
            <button className="red-btn" onClick={() => onDecide("verworfen")}>Trifft nicht zu</button>
          </>
        ) : (
          <>
            <span className="red-decided">{state === "bestaetigt" ? "✓ Trifft zu" : "Trifft nicht zu"}{dec?.at ? ` · ${dec.at.slice(11, 16)}` : ""}</span>
            <button className="red-btn" onClick={() => onDecide("neu")}>Rückgängig</button>
          </>
        ))}
        {canMap && <button className="red-btn" onClick={onMap}>Auf Karte zeigen</button>}
      </div>
      <KiHintExplain h={h} />
      <Origin>
        <p className="red-o-code"><b>{o.code}</b>{o.name ? ` · ${o.name}` : ""}{o.source ? <> · <span className="mono">{o.source}</span></> : null}</p>
        {o.rule && <p>{o.rule}</p>}
        <p className="red-o-note">Regel in eigenen Worten, Quelle als Reglement und Ziffer. Ein Hinweis ist eine Vermutung – du entscheidest.</p>
      </Origin>
    </div>
  );
}

export function RedCoaDetail({ c, ex, t, experte, backLabel, onBack, focus, onMap, onIndicator }: Common & {
  c: RedCoa;
  onMap: () => void;
  onIndicator: (i: CoaIndicator) => void;
}) {
  const title = useTitleFocus(focus, c.id);
  const when = coaWhen(c, ex, t);
  const g = indicatorGroups(c, experte);
  const canMap = !!(c.target || c.approach?.length);
  const codes = [...new Set(c.indicators.map((i) => i.rule).filter((r): r is string => !!r && /^[A-E][1-6]$/.test(r)))];
  const ind = (i: CoaIndicator, sign: string, cls: string, k: number) => {
    const act = !!(i.hintId || i.events?.length);
    const body = (
      <>
        <span className={"red-tick " + cls} aria-hidden="true">{sign}</span>
        <span>{indicatorLine(i)}{experte && i.weight !== undefined && <span className="red-w"> · Gewicht {i.weight.toFixed(2).replace(".", ",")}</span>}</span>
      </>
    );
    return <li key={k}>{act && i.met ? <button className="red-ind" onClick={() => onIndicator(i)}>{body}</button> : <span className="red-ind">{body}</span>}</li>;
  };
  return (
    <div className={"red-detail k-" + c.label}>
      <Back label={backLabel} onBack={onBack} />
      <p className="red-d-kick"><span className="red-kick">{COA_KICKER[c.label]}</span>{when && <span className={"red-when w-" + when.state}>{when.text}</span>}</p>
      <h3 className="red-d-title" tabIndex={-1} ref={title}>{coaLine(c)}</h3>
      {g.pro.length > 0 && <div className="red-d-sec"><p className="red-d-h">Anzeichen dafür</p><ul className="red-inds">{g.pro.map((i, k) => ind(i, "✓", "pro", k))}</ul></div>}
      {g.open.length > 0 && <div className="red-d-sec"><p className="red-d-h">Noch offen</p><ul className="red-inds">{g.open.map((i, k) => ind(i, "○", "open", k))}</ul></div>}
      {g.contra.length > 0 && <div className="red-d-sec"><p className="red-d-h">Spricht dagegen</p><ul className="red-inds">{g.contra.map((i, k) => ind(i, "✗", "contra", k))}</ul></div>}
      {c.approachText && <p className="red-d-p"><b>Weg von Rot:</b> {c.approachText}</p>}
      {c.check.length > 0 && (
        <div className="red-d-sec">
          <p className="red-d-h">Jetzt prüfen:</p>
          <ul className="red-checks">{c.check.map((x, k) => <li key={k}>{x}</li>)}</ul>
        </div>
      )}
      {canMap && <div className="red-actions"><button className="red-btn" onClick={onMap}>Auf Karte zeigen</button></div>}
      <KiCoaExplain c={c} />
      <Origin>
        <p>Eine Vermutung entsteht erst aus mindestens zwei Anzeichen aus verschiedenen Meldungen. Je mehr Anzeichen zutreffen, desto wahrscheinlicher; was dagegen spricht, senkt sie.</p>
        {codes.length > 0 && (
          <ul className="red-o-list">
            {codes.map((r) => { const x = hintRule(r); return <li key={r}><b>{r}</b>{x ? ` · ${x.name}` : ""}{x?.source ? <> · <span className="mono">{x.source}</span></> : null}</li>; })}
          </ul>
        )}
      </Origin>
    </div>
  );
}
