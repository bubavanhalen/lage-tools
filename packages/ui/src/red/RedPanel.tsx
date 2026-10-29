/**
 * «Was Rot vorhaben könnte» (Spez. MVP 1, Kap. 2.7, 3.6): Möglichkeiten Rot als Karten (höchstens drei), darunter die
 * offenen Hinweise, die Kräfte-Zeile und «Erledigte zeigen (n)». Klick öffnet das Detail an Stelle der Liste; Esc bzw.
 * «‹ Zurück zur Liste» bringt zurück, die Auswahl bleibt markiert. «Trifft zu»/«Trifft nicht zu» entscheiden (wie bisher
 * `decide`) mit «Rückgängig» (8 s, Ctrl+Z).
 *
 * Experte (Schalter, gleicher Ablauf): zusätzlich Code-Marke an jeder Zeile, Gruppen, Normalbild der NAI, Kräfte-Tabelle,
 * weitere Möglichkeiten, KI-Lagebericht (nur bei eingeschalteter KI).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CoaIndicator, Hint, HintGroup, RedCoa } from "@lage/core";
import { decide, GROUPS, groupOf, hhmm, isDone, isOpen, type DecisionState, type RedBadge } from "../hintsData";
import { KiLageberichtButton } from "../ki/KiFeatures";
import { ForceTable } from "./ForceTable";
import type { RedPanelProps } from "../shell/contracts";
import { RedCard, RedHintRow } from "./RedCard";
import { RedCoaDetail, RedHintDetail } from "./RedDetail";
import { coaLine, decidedText, EMPTY_COA, EMPTY_RED, forceLine, LEAD } from "./redText";
import "./red.css";

const UNDO_MS = 8000;

export function RedPanel(p: RedPanelProps) {
  const { ex, t, from, hints, lage, variant, selHint, selCoa, onSelectHint, onSelectCoa, onMapHint, onMapCoa, onEvent, update } = p;
  const experte = variant === "experte";

  // ---------- Detail: gewählter Hinweis vor gewählter Möglichkeit
  const hSel = selHint ? hints.find((h) => h.id === selHint) ?? lage.hints.find((h) => h.id === selHint) ?? null : null;
  const allCoas = [...lage.coas, ...lage.more];
  const cSel = !hSel && selCoa ? allCoas.find((c) => c.id === selCoa) ?? null : null;
  const selId = hSel?.id ?? cSel?.id ?? null;
  /** Auswahl, deren Detail geschlossen wurde (Liste zeigen, Auswahl bleibt markiert) */
  const [closed, setClosed] = useState<string | null>(null);
  useEffect(() => { setClosed(null); }, [selHint, selCoa]);
  const showDetail = !!selId && closed !== selId;
  /** Detail aus der Liste geöffnet → Fokus auf den Titel; von der Karte → Fokus bleibt */
  const [fromList, setFromList] = useState(false);
  /** Hinweis aus einer Möglichkeit geöffnet → «Zurück zur Möglichkeit» */
  const [backCoa, setBackCoa] = useState<RedCoa | null>(null);
  useEffect(() => { if (!hSel) setBackCoa(null); }, [hSel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const root = useRef<HTMLElement>(null);
  const toList = () => {
    setClosed(selId);
    setBackCoa(null);
    // Zeile der Auswahl in der Liste zeigen
    window.setTimeout(() => {
      const el = selId ? root.current?.querySelector<HTMLElement>(`[data-hint="${CSS.escape(selId)}"] button, [data-coa="${CSS.escape(selId)}"] button`) : null;
      el?.scrollIntoView({ block: "nearest" });
      if (fromList) el?.focus({ preventScroll: true });
    }, 0);
  };
  const back = () => {
    if (backCoa && allCoas.some((c) => c.id === backCoa.id)) { const c = backCoa; setBackCoa(null); onSelectCoa(c.id); onMapCoa(c); return; }
    toList();
  };
  const openHint = (h: Hint) => { setFromList(true); setClosed(null); onSelectHint(h.id); onMapHint(h); };
  const openCoa = (c: RedCoa) => { setFromList(true); setClosed(null); onSelectCoa(c.id); onMapCoa(c); };
  const onIndicator = (c: RedCoa, i: CoaIndicator) => {
    const h = i.hintId ? hints.find((x) => x.id === i.hintId) : undefined;
    if (h) { setFromList(true); setClosed(null); onSelectHint(h.id); onMapHint(h); setBackCoa(c); return; }
    // Hinweis ausserhalb von «Zeige letzte» bzw. Meldung ohne Hinweis: letzte Meldung zeigen
    const last = (i.hintId ? lage.hints.find((x) => x.id === i.hintId)?.events : i.events)?.at(-1);
    if (last) onEvent(last);
  };

  // ---------- Entscheid mit Rückgängig
  const [undo, setUndo] = useState<{ h: Hint; s: "bestaetigt" | "verworfen" } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const set = (h: Hint, s: DecisionState) => {
    update((x) => decide(x, h, s === "neu" ? null : s));
    window.clearTimeout(timer.current);
    if (s === "neu") { setUndo(null); return; }
    setUndo({ h, s });
    timer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
    // zurück zur Liste, Auswahl (und Hervorhebung auf der Karte) aufheben
    if (h.id === selHint) onSelectHint(null);
    setBackCoa(null);
  };
  const undoNow = () => { if (undo) set(undo.h, "neu"); };
  useEffect(() => {
    if (!undo) return;
    const k = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        undoNow();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && showDetail) { e.stopPropagation(); back(); }
  };

  // ---------- Listen
  const [group, setGroup] = useState<HintGroup | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showRefs, setShowRefs] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const inGroup = (h: Hint) => !experte || !group || groupOf(h) === group;
  const main = hints.filter((h) => h.level !== "info");
  const open = main.filter((h) => isOpen(ex, h, t));
  const done = main.filter((h) => isDone(ex, h, t)).sort((a, b) => (b.until ?? b.t).localeCompare(a.until ?? a.t));
  const refs = experte ? hints.filter((h) => h.level === "info") : [];
  const groupCount = new Map<HintGroup, number>();
  if (experte) for (const h of open) groupCount.set(groupOf(h), (groupCount.get(groupOf(h)) ?? 0) + 1);
  useEffect(() => { if (group && !groupCount.get(group)) setGroup(null); }); // eslint-disable-line react-hooks/exhaustive-deps
  const force = forceLine(lage);
  const nothing = !main.length && !lage.coas.length;

  const row = (h: Hint) => <RedHintRow key={h.id} h={h} ex={ex} t={t} sel={h.id === selHint} experte={experte} onOpen={() => openHint(h)} />;

  return (
    <section className={"panel red" + (experte ? " experte" : "")} ref={root} aria-label="Was Rot vorhaben könnte" onKeyDown={onKey}>
      {p.stand && <p className="red-stand" role="status">Stand {hhmm(p.stand, ex.days)}</p>}
      {showDetail && hSel ? (
        <RedHintDetail h={hSel} ex={ex} t={t} experte={experte} focus={fromList}
          backLabel={backCoa ? "Zurück zur Möglichkeit" : "Zurück zur Liste"} onBack={back}
          onDecide={(s) => set(hSel, s)} onMap={() => onMapHint(hSel)} onEvent={onEvent} />
      ) : showDetail && cSel ? (
        <RedCoaDetail c={cSel} ex={ex} t={t} experte={experte} focus={fromList} backLabel="Zurück zur Liste" onBack={back}
          onMap={() => onMapCoa(cSel)} onIndicator={(i) => onIndicator(cSel, i)} />
      ) : (
        <div className="red-list">
          <p className="red-lead">{LEAD}</p>
          {experte && <KiLageberichtButton hints={lage.hints} coas={lage.coas} />}
          {nothing ? (
            <p className="red-empty">{EMPTY_RED}</p>
          ) : (
            <>
              {lage.coas.length > 0 ? (
                <ol className="red-cards" aria-label="Möglichkeiten Rot">
                  {lage.coas.map((c) => <RedCard key={c.id} c={c} ex={ex} t={t} sel={c.id === selCoa && !hSel} onOpen={() => openCoa(c)} />)}
                </ol>
              ) : <p className="red-empty">{EMPTY_COA}</p>}
              {experte && lage.more.length > 0 && (
                <div className="red-more">
                  <button className="red-link" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>
                    Weitere Möglichkeiten ({lage.more.length})
                  </button>
                  {showMore && (
                    <ul className="red-morelist">
                      {lage.more.map((c) => <li key={c.id}><button className="red-link" onClick={() => openCoa(c)}>{coaLine(c)}</button></li>)}
                    </ul>
                  )}
                </div>
              )}

              <h3 className="red-h">Hinweise ({open.length} offen)</h3>
              {from && <p className="red-note">Zeigt nur Hinweise ab {hhmm(from, ex.days, t)}.</p>}
              {experte && groupCount.size > 1 && (
                <div className="red-groups" role="group" aria-label="Gruppe" data-zaehl="red-gruppen">
                  <button aria-pressed={!group} onClick={() => setGroup(null)}>Alle</button>
                  {GROUPS.filter(([g]) => groupCount.get(g)).map(([g, l]) => (
                    <button key={g} aria-pressed={group === g} onClick={() => setGroup(group === g ? null : g)}>{l} <span className="tnum">{groupCount.get(g)}</span></button>
                  ))}
                </div>
              )}
              {open.length ? <ol className="red-hints">{open.filter(inGroup).map(row)}</ol> : <p className="red-note">Keine offenen Hinweise.</p>}
            </>
          )}

          {force && <p className="red-force">{force}</p>}
          {experte && (lage.force.rows.length > 0 || lage.force.notSeen.length > 0) && (
            <div className="red-forcetab"><ForceTable lage={lage} ex={ex} t={t} onEvent={onEvent} /></div>
          )}

          {refs.length > 0 && (
            <div className="red-more">
              <button className="red-link" aria-expanded={showRefs} onClick={() => setShowRefs(!showRefs)}>Normalbild der NAI ({refs.length})</button>
              {showRefs && <ol className="red-hints">{refs.map(row)}</ol>}
            </div>
          )}
          {done.length > 0 && (
            <div className="red-more">
              <button className="red-link" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
                {showDone ? "Erledigte ausblenden" : `Erledigte zeigen (${done.length})`}
              </button>
              {showDone && <ol className="red-hints">{done.filter(inGroup).map(row)}</ol>}
            </div>
          )}
        </div>
      )}
      {undo && (
        <div className="undobar red-undo" role="status">
          <span>{decidedText(undo.h, undo.s)}</span>
          <button onClick={undoNow}>Rückgängig</button>
        </div>
      )}
    </section>
  );
}

/**
 * Beschriftung des Umschalters «Journal | Was Rot vorhaben könnte» mit Zahl (Kap. 3.6): neutral (Tinte), «⚠» bei offenem
 * «hoch», einmaliges Aufleuchten bei Zunahme, kein Ton. `badge` aus `redBadge(ex, hints, t)` (hintsData).
 */
export function RedTabLabel({ badge }: { badge: RedBadge }) {
  const prev = useRef(badge.n);
  const [pulse, setPulse] = useState(0);
  useEffect(() => { if (badge.n > prev.current) setPulse((n) => n + 1); prev.current = badge.n; }, [badge.n]);
  return (
    <>
      <span className="red-tab-l">Was Rot vorhaben könnte</span>
      {badge.n > 0 && <span key={pulse} className={"red-badge" + (pulse ? " pulse" : "")} aria-label={badge.aria}>{badge.text}</span>}
    </>
  );
}
