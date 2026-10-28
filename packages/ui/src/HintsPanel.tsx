/**
 * Hinweise zu Rot für Experte und Präsentation (Spez. MVP 1: Grundansicht = `red/RedPanel`). Kompakte Liste – eine
 * Zeile je Hinweis (Stufe · Code-Marke · Klartext · seit). Klick klappt einen Hinweis auf («Warum», «Jetzt prüfen»,
 * Prognose, Auslöser, Knöpfe, «Woher kommt das?») und markiert ihn auf der Karte; es ist immer nur einer offen.
 * Der Zfhr entscheidet «Trifft zu» / «Trifft nicht zu» (rückgängig).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Exercise, Hint, HintGroup, HintLevel, LageEvent } from "@lage/core";
import { iconSvg } from "@lage/map";
import { decide, decisionOf, decisionRec, GROUPS, GROUP_LABEL, groupOf, hhmm, isOpen, isOver, nextLabel, ruleOf, type DecisionState } from "./hintsData";
import { decidedText, EMPTY_RED, hintLine } from "./red/redText";
import { dayLabel } from "./Timeline";
import { KiHintExplain } from "./ki/KiFeatures";
import "./hints.css";

type Filter = "neu" | "bestaetigt" | "verworfen" | "alle";
const FILTERS: Array<[Filter, string]> = [["neu", "Offen"], ["bestaetigt", "Trifft zu"], ["verworfen", "Trifft nicht zu"], ["alle", "Alle"]];

interface Props {
  ex: Exercise;
  /** sichtbare Hinweise zur Lagezeit (sortiert) */
  hints: Hint[];
  /** Lagezeit (ISO lokal) */
  t: string;
  /** gewählter (aufgeklappter) Hinweis */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** «Auf Karte»: Hinweis wählen und hinfliegen */
  onMap: (h: Hint) => void;
  /** Auslöser-Meldung wählen (Karte springt) */
  onEvent: (id: string) => void;
  update: (f: (x: Exercise) => Exercise) => void;
  onCsv?: () => void;
  /** Zeitfenster aktiv: ältere Hinweise ausgeblendet */
  winFrom?: string | null;
  onWinClear?: () => void;
  /** Präsentation: schmale Spalte, nur offene und bestätigte Hinweise, ohne Entscheid-Knöpfe */
  compact?: boolean;
  /** oben im Reiter, vor den Hinweisen (Lage Rot) */
  lead?: ReactNode;
}

export function HintsPanel({ ex, hints, t, selected, onSelect, onMap, onEvent, update, onCsv, winFrom, onWinClear, compact, lead }: Props) {
  const [filter, setFilter] = useState<Filter>("neu");
  const [group, setGroup] = useState<HintGroup | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const evById = useMemo(() => new Map((ex.events ?? []).map((e) => [e.id, e])), [ex.events]);

  const main = hints.filter((h) => h.level !== "info");
  const refs = hints.filter((h) => h.level === "info");
  const stateOf = (h: Hint) => decisionOf(ex, h);
  // «Neu» = offen: nicht entschieden und nicht beendet (beendete, nicht entschiedene nur unter «Alle»)
  const filterOf = (h: Hint): Filter | null => {
    const st = stateOf(h);
    return st !== "neu" ? st : isOpen(ex, h, t) ? "neu" : null;
  };
  const counts: Record<Filter, number> = { neu: 0, bestaetigt: 0, verworfen: 0, alle: main.length };
  for (const h of main) { const f = filterOf(h); if (f) counts[f]++; }
  const inFilter = (h: Hint) => (compact ? filterOf(h) === "neu" || filterOf(h) === "bestaetigt" : filter === "alle" || filterOf(h) === filter);
  const groupCount = new Map<HintGroup, number>();
  for (const h of main) if (inFilter(h)) groupCount.set(groupOf(h), (groupCount.get(groupOf(h)) ?? 0) + 1);
  const list = main.filter((h) => inFilter(h) && (!group || groupOf(h) === group));
  // gewählte Gruppe hat im aktuellen Filter nichts mehr: zurück auf alle
  useEffect(() => { if (group && !groupCount.get(group)) setGroup(null); }); // eslint-disable-line react-hooks/exhaustive-deps

  // Entscheid: Zeile verschwindet aus «Neu» – kurz «Rückgängig» anbieten (wie beim Löschen im Journal)
  const [undo, setUndo] = useState<{ h: Hint; s: DecisionState } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);
  const set = (h: Hint, s: DecisionState | null) => {
    update((x) => decide(x, h, s === "neu" ? null : s));
    window.clearTimeout(undoTimer.current);
    if (s === "neu" || s === null) { setUndo(null); if (undo?.h.id === h.id) onSelect(h.id); return; }
    // Zeile verlässt die Liste «Neu»: Auswahl (und Hervorhebung auf der Karte) aufheben
    if (filter === "neu" && h.id === selected) onSelect(null);
    setUndo({ h, s });
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  };

  // Auswahl von aussen (Karte): Zeile zeigen
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const h = hints.find((x) => x.id === selected);
    if (h && h.level === "info") setRefOpen(true);
    if (h && h.level !== "info" && !inFilter(h)) setFilter("alle");
    if (h && group && groupOf(h) !== group) setGroup(null);
    const id = window.setTimeout(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-hint="${CSS.escape(selected)}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 30);
    return () => window.clearTimeout(id);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const row = (h: Hint) => (
    <HintRow key={h.id} h={h} ex={ex} t={t} state={stateOf(h)} open={h.id === selected} evById={evById} compact={compact}
      onToggle={() => onSelect(h.id === selected ? null : h.id)} onMap={() => onMap(h)} onEvent={onEvent}
      onDecide={(s) => set(h, s)} />
  );

  return (
    <div className={"panel hints" + (compact ? " compact" : "")} ref={listRef}>
      {lead}
      <div className="hp-head">
        <div className="hp-title">
          <h3>Hinweise</h3>
          {!lead && <span className="hp-sub">Lage {dayLabel(t, ex.days)} {t.slice(11, 16)}</span>}
        </div>
        {!compact && <p className="hp-lead">Vermutungen aus den Meldungen, keine Fakten – jeder Hinweis nennt Auslöser, Regel und Quelle. Du entscheidest.</p>}
        {!compact && (
          <div className="seg hp-filter" role="group" aria-label="Entscheid">
            {FILTERS.map(([f, l]) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} title={f === "neu" ? "offen: nicht entschieden und nicht vorbei" : undefined}>
                {l}{counts[f] > 0 && <span className="hp-n tnum">{counts[f]}</span>}
              </button>
            ))}
          </div>
        )}
        {groupCount.size > 1 && (
          <div className="hp-groups" role="group" aria-label="Gruppe">
            <button className="hp-gchip" aria-pressed={!group} onClick={() => setGroup(null)}>Alle</button>
            {GROUPS.filter(([g]) => groupCount.get(g)).map(([g, l]) => (
              <button key={g} className="hp-gchip" aria-pressed={group === g} onClick={() => setGroup(group === g ? null : g)}>
                {l} <span className="tnum">{groupCount.get(g)}</span>
              </button>
            ))}
          </div>
        )}
        {winFrom && (
          <p className="hp-win">Zeigt nur Hinweise ab {hhmm(winFrom, ex.days, t)}.{onWinClear && <> <button className="linkbtn" onClick={onWinClear}>alles zeigen</button></>}</p>
        )}
      </div>

      {list.length ? (
        <ol className="hp-list">{list.map(row)}</ol>
      ) : (
        <div className="hp-empty">
          <p>{main.length === 0 ? EMPTY_RED
            : filter === "neu" ? "Keine offenen Hinweise – alle sind entschieden oder vorbei." : "Keine Hinweise für diesen Filter."}</p>
        </div>
      )}

      {refs.length > 0 && (
        <section className="hp-refs">
          <button className="hp-refhead" aria-expanded={refOpen} onClick={() => setRefOpen(!refOpen)}>
            <LevelIcon level="info" />
            <span>Normalbild der NAI</span>
            <span className="hp-n tnum">{refs.length}</span>
            <span className="hp-chev" aria-hidden="true">▸</span>
          </button>
          {refOpen && <ol className="hp-list">{refs.map(row)}</ol>}
        </section>
      )}

      {undo && (
        <div className="undobar" role="status">
          <span>{decidedText(undo.h, undo.s === "bestaetigt" ? "bestaetigt" : "verworfen")}</span>
          <button onClick={() => set(undo.h, "neu")}>Rückgängig</button>
        </div>
      )}

      {!compact && onCsv && (
        <div className="btnrow foot">
          <span className="help">{main.length} {main.length === 1 ? "Hinweis" : "Hinweise"}{refs.length ? ` · ${refs.length} Referenz` : ""}</span>
          <button onClick={onCsv} disabled={!hints.length} title="Hinweise mit Entscheid als Tabelle (auch im Journal-PDF als Anhang)">Hinweise als Tabelle (CSV)</button>
        </div>
      )}
    </div>
  );
}

/** Eine Zeile je Hinweis; aufgeklappt (gewählt) mit Begründung, Prognose, Auslösern, Knöpfen und Quelle */
function HintRow({ h, ex, t, state, open, evById, compact, onToggle, onMap, onEvent, onDecide }: {
  h: Hint; ex: Exercise; t: string; state: DecisionState; open: boolean; evById: Map<string, LageEvent>; compact?: boolean;
  onToggle: () => void; onMap: () => void; onEvent: (id: string) => void; onDecide: (s: DecisionState) => void;
}) {
  const [srcOpen, setSrcOpen] = useState(false);
  const [allEv, setAllEv] = useState(false);
  const rule = ruleOf(h.rule);
  const over = isOver(h, t);
  const nx = nextLabel(h, t, ex.days);
  const timeTitle = over
    ? `galt ${dayLabel(h.t, ex.days)} ${h.t.slice(11, 16)} bis ${dayLabel(h.until!, ex.days)} ${h.until!.slice(11, 16)}`
    : `gilt seit ${dayLabel(h.t, ex.days)} ${h.t.slice(11, 16)}${h.last && h.last > h.t ? `, zuletzt ${h.last.slice(11, 16)}` : ""}${nx ? ` · ${nx.text}` : ""}`;
  return (
    <li className={`hrow l-${h.level} d-${state}` + (open ? " open" : "") + (over ? " over" : "")} data-hint={h.id}>
      <button className="hr-line" aria-expanded={open} onClick={onToggle}
        title={`${h.rule} ${rule?.name ?? GROUP_LABEL[groupOf(h)]} – ${hintLine(h)}`}>
        <LevelIcon level={h.level} />
        <span className="hr-rule">{h.rule}</span>
        <span className="hr-title">{hintLine(h)}</span>
        {state === "bestaetigt" && <span className="hr-dec ok" title="trifft zu" aria-label="trifft zu">✓</span>}
        {nx?.late && !open && <span className="hr-late" title={nx.text} aria-label={nx.text} />}
        <span className="hr-time tnum" title={timeTitle}>{over ? <><span className="hr-over">vorbei</span> {hhmm(h.until!, ex.days, t)}</> : <>seit {hhmm(h.t, ex.days, t)}</>}</span>
      </button>
      {open && <HintDetail h={h} ex={ex} t={t} state={state} evById={evById} compact={compact} nx={nx} srcOpen={srcOpen} setSrcOpen={setSrcOpen}
        allEv={allEv} setAllEv={setAllEv} onMap={onMap} onEvent={onEvent} onDecide={onDecide} />}
    </li>
  );
}

function HintDetail({ h, ex, t, state, evById, compact, nx, srcOpen, setSrcOpen, allEv, setAllEv, onMap, onEvent, onDecide }: {
  h: Hint; ex: Exercise; t: string; state: DecisionState; evById: Map<string, LageEvent>; compact?: boolean;
  nx: { text: string; late: boolean } | null; srcOpen: boolean; setSrcOpen: (v: boolean) => void; allEv: boolean; setAllEv: (v: boolean) => void;
  onMap: () => void; onEvent: (id: string) => void; onDecide: (s: DecisionState) => void;
}) {
  const rule = ruleOf(h.rule);
  const evs = h.events.map((id) => evById.get(id)).filter((e): e is LageEvent => !!e && !e.deleted).sort((a, b) => b.t.localeCompare(a.t));
  const shown = allEv || evs.length <= 3 ? evs : evs.slice(0, 2);
  const dec = decisionRec(ex, h);
  return (
    <div className="hr-body">
      <p className="hc-text"><b>Warum:</b> {h.text}</p>
      {h.todo && <p className="hc-text"><b>Jetzt prüfen:</b> {h.todo}</p>}
      {nx && (
        <p className={"hc-next" + (nx.late ? " late" : "")}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h9M8 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {nx.late
            ? <>seit <b className="tnum">{hhmm(h.next!, ex.days, t)}</b> <span className="hc-late">überfällig</span></>
            : <>nächste ca. <b className="tnum">{hhmm(h.next!, ex.days, t)}</b></>}
        </p>
      )}
      {evs.length > 0 && (
        <ol className="hc-evs" aria-label="Auslöser">
          {shown.map((e) => (
            <li key={e.id}>
              <button className="hc-ev" onClick={() => onEvent(e.id)} title="Meldung zeigen">
                <span className="tnum">{e.t.slice(11, 16)}</span>
                <EvSym e={e} />
                <span className="hc-evt">{e.desc && e.desc.length < 48 ? e.desc : e.text}</span>
                <span className="hc-evw">{e.cells?.[0] ?? e.nai ?? ""}{e.melder ? <small> · {e.melder}</small> : null}</span>
              </button>
            </li>
          ))}
          {evs.length > shown.length && (
            <li><button className="linkbtn hc-more" onClick={() => setAllEv(true)}>+ {evs.length - shown.length} weitere Meldungen</button></li>
          )}
        </ol>
      )}
      <div className="hc-foot">
        {!compact && h.level !== "info" && (state === "neu" ? (
          <>
            <button className="hc-btn ok" onClick={() => onDecide("bestaetigt")} title="Hinweis trifft zu – zählt für «Was Rot tun könnte» stärker">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Trifft zu
            </button>
            <button className="hc-btn" onClick={() => onDecide("verworfen")} title="Hinweis trifft nicht zu – bleibt so, auch bei neuen Meldungen">
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              Trifft nicht zu
            </button>
          </>
        ) : (
          <>
            <span className={"hc-state " + state}>{state === "bestaetigt" ? "Trifft zu" : "Trifft nicht zu"}{dec?.at ? <span className="tnum"> {dec.at.slice(11, 16)}</span> : null}</span>
            <button className="linkbtn" onClick={() => onDecide("neu")}>Rückgängig</button>
          </>
        ))}
        {(h.pos || h.cells?.length || h.nai || evs.some((e) => e.pos)) && (
          <button className="hc-btn ghost" onClick={onMap} title="Auf der Karte zeigen">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>
            Auf Karte zeigen
          </button>
        )}
      </div>
      {!compact && <KiHintExplain h={h} />}
      <button className="hc-src" aria-expanded={srcOpen} onClick={() => setSrcOpen(!srcOpen)} title="Regel und Quelle">
        <span className="hp-chev" aria-hidden="true">▸</span> Woher kommt das? <span className="hc-srcref">· {h.rule} {rule?.name ?? ""}{rule?.source ? ` · ${rule.source}` : ""}</span>
      </button>
      {srcOpen && rule && (
        <div className="hc-rulebox">
          <p>{rule.rule}</p>
          <p className="hc-srcline">{GROUP_LABEL[rule.group]}{rule.source ? <> · Quelle: <span className="mono">{rule.source}</span></> : null}</p>
        </div>
      )}
    </div>
  );
}

function EvSym({ e }: { e: LageEvent }) {
  const html = useMemo(() => ({ __html: iconSvg(e.sym, e.aff, 14, { sidc: e.sidc, status: e.status }).svg }), [e.sym, e.aff, e.sidc, e.status]);
  return <span className="symmini" dangerouslySetInnerHTML={html} />;
}

/** Stufe als kleines Zeichen: hoch = Dreieck mit «!», mittel = Raute, Referenz = «i» */
export function LevelIcon({ level, size = 16 }: { level: HintLevel; size?: number }) {
  return (
    <span className={`hc-lvl l-${level}`} title={level === "hoch" ? "wichtig – Handeln prüfen" : level === "mittel" ? "beobachten" : "Normalbild"} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 16 16">
        {level === "hoch" && <><path d="M8 1.6L15 14H1z" fill="currentColor" /><path d="M8 6v3.6" stroke="var(--card)" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="11.8" r="1" fill="var(--card)" /></>}
        {level === "mittel" && <><path d="M8 1.5L14.5 8 8 14.5 1.5 8z" fill="currentColor" /><path d="M5.2 8h5.6" stroke="var(--card)" strokeWidth="1.8" strokeLinecap="round" /></>}
        {level === "info" && <><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="8" cy="4.8" r="1" fill="currentColor" /></>}
      </svg>
    </span>
  );
}
