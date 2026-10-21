/**
 * Reiter «Hinweise»: Hinweise zu Rot aus dem Journal (Regeln, offline). Jeder Hinweis zeigt Stufe, Begründung,
 * Auslöser-Meldungen, Regel und Quelle; der Zfhr bestätigt oder verwirft (rückgängig machbar).
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Exercise, Hint, HintGroup, HintLevel, LageEvent } from "@lage/core";
import { iconSvg } from "@lage/map";
import { decide, decisionOf, GROUPS, GROUP_LABEL, groupOf, hhmm, isOver, ruleOf, type DecisionState } from "./hintsData";
import { dayLabel } from "./Timeline";
import "./hints.css";

type Filter = "neu" | "bestaetigt" | "verworfen" | "alle";
const FILTERS: Array<[Filter, string]> = [["neu", "Neu"], ["bestaetigt", "Bestätigt"], ["verworfen", "Verworfen"], ["alle", "Alle"]];

interface Props {
  ex: Exercise;
  /** sichtbare Hinweise zur Lagezeit (sortiert) */
  hints: Hint[];
  /** Lagezeit (ISO lokal) */
  t: string;
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
}

export function HintsPanel({ ex, hints, t, selected, onSelect, onMap, onEvent, update, onCsv, winFrom, onWinClear, compact }: Props) {
  const [filter, setFilter] = useState<Filter>("neu");
  const [group, setGroup] = useState<HintGroup | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const evById = useMemo(() => new Map((ex.events ?? []).map((e) => [e.id, e])), [ex.events]);

  const main = hints.filter((h) => h.level !== "info");
  const refs = hints.filter((h) => h.level === "info");
  const stateOf = (h: Hint) => decisionOf(ex, h);
  const counts: Record<Filter, number> = { neu: 0, bestaetigt: 0, verworfen: 0, alle: main.length };
  for (const h of main) counts[stateOf(h)]++;
  const inFilter = (h: Hint) => (compact ? stateOf(h) !== "verworfen" : filter === "alle" || stateOf(h) === filter);
  const groupCount = new Map<HintGroup, number>();
  for (const h of main) if (inFilter(h)) groupCount.set(groupOf(h), (groupCount.get(groupOf(h)) ?? 0) + 1);
  const list = main.filter((h) => inFilter(h) && (!group || groupOf(h) === group));
  // gewählte Gruppe hat im aktuellen Filter nichts mehr: zurück auf alle
  useEffect(() => { if (group && !groupCount.get(group)) setGroup(null); }); // eslint-disable-line react-hooks/exhaustive-deps

  // Entscheid: Karte verschwindet aus «Neu» – kurz «Rückgängig» anbieten (wie beim Löschen im Journal)
  const [undo, setUndo] = useState<{ h: Hint; s: DecisionState } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);
  const set = (h: Hint, s: DecisionState | null) => {
    update((x) => decide(x, h.id, s === "neu" ? null : s));
    window.clearTimeout(undoTimer.current);
    if (s === "neu" || s === null) { setUndo(null); return; }
    setUndo({ h, s });
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000);
  };

  // Auswahl von aussen (Karte): Karte zeigen
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const h = hints.find((x) => x.id === selected);
    if (h && h.level === "info") setRefOpen(true);
    if (h && h.level !== "info" && !inFilter(h)) setFilter("alle");
    const id = window.setTimeout(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-hint="${CSS.escape(selected)}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 30);
    return () => window.clearTimeout(id);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = (h: Hint) => (
    <HintCard key={h.id} h={h} ex={ex} t={t} state={stateOf(h)} sel={h.id === selected} evById={evById} compact={compact}
      onSelect={() => onSelect(h.id === selected ? null : h.id)} onMap={() => onMap(h)} onEvent={(id) => { if (h.id !== selected) onSelect(h.id); onEvent(id); }}
      onDecide={(s) => set(h, s)} />
  );

  return (
    <div className={"panel hints" + (compact ? " compact" : "")} ref={listRef}>
      <div className="hp-head">
        <div className="hp-title">
          <h3>Hinweise zu Rot</h3>
          <span className="hp-sub">Lage {dayLabel(t, ex.days)} {t.slice(11, 16)}</span>
        </div>
        {!compact && <p className="hp-lead">Hinweise, keine Fakten: Jeder Hinweis nennt Auslöser, Regel und Quelle – du entscheidest.</p>}
        {!compact && (
          <div className="seg hp-filter" role="group" aria-label="Entscheid">
            {FILTERS.map(([f, l]) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
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
          <p className="hp-win">Zeitfenster ab {hhmm(winFrom, ex.days, t)} – ältere Hinweise ausgeblendet.{onWinClear && <> <button className="linkbtn" onClick={onWinClear}>Alles zeigen</button></>}</p>
        )}
      </div>

      {list.length ? (
        <ol className="hp-list">{list.map(card)}</ol>
      ) : (
        <div className="hp-empty">
          <p>{main.length === 0
            ? "Noch keine Hinweise. Sie entstehen aus dem Journal, sobald Meldungen ein Muster zeigen – zum Beispiel Pendelverkehr, Übergaben oder Rot nahe bei einem eigenen Stao."
            : filter === "neu" ? "Keine neuen Hinweise – alle sind entschieden." : "Keine Hinweise für diesen Filter."}</p>
        </div>
      )}

      {refs.length > 0 && (
        <section className="hp-refs">
          <button className="hp-refhead" aria-expanded={refOpen} onClick={() => setRefOpen(!refOpen)}>
            <LevelIcon level="info" />
            <span>Referenz · Normallage</span>
            <span className="hp-n tnum">{refs.length}</span>
            <span className="hp-chev" aria-hidden="true">▸</span>
          </button>
          {refOpen && <ol className="hp-list">{refs.map(card)}</ol>}
        </section>
      )}

      {undo && (
        <div className="undobar" role="status">
          <span>{undo.h.rule} {undo.s === "bestaetigt" ? "bestätigt" : "verworfen"}</span>
          <button onClick={() => set(undo.h, "neu")}>Rückgängig</button>
        </div>
      )}

      {!compact && onCsv && (
        <div className="btnrow foot">
          <span className="help">{main.length} {main.length === 1 ? "Hinweis" : "Hinweise"}{refs.length ? ` · ${refs.length} Referenz` : ""}</span>
          <button onClick={onCsv} disabled={!hints.length} title="Hinweise mit Entscheid als CSV (auch im Journal-PDF als Anhang)">CSV</button>
        </div>
      )}
    </div>
  );
}

function HintCard({ h, ex, t, state, sel, evById, compact, onSelect, onMap, onEvent, onDecide }: {
  h: Hint; ex: Exercise; t: string; state: DecisionState; sel: boolean; evById: Map<string, LageEvent>; compact?: boolean;
  onSelect: () => void; onMap: () => void; onEvent: (id: string) => void; onDecide: (s: DecisionState) => void;
}) {
  const [srcOpen, setSrcOpen] = useState(false);
  const [allEv, setAllEv] = useState(false);
  const rule = ruleOf(h.rule);
  const evs = h.events.map((id) => evById.get(id)).filter((e): e is LageEvent => !!e && !e.deleted).sort((a, b) => b.t.localeCompare(a.t));
  const shown = allEv || evs.length <= 3 ? evs : evs.slice(0, 2);
  const dec = ex.hintDecisions?.[h.id];
  const over = isOver(h, t);
  const folded = state === "verworfen" && !sel;
  // Prognose: kurz überfällig = auffällig; lange vorbei = nur noch Hinweis «war erwartet»
  const late = h.next && h.next <= t ? (Date.parse(t) - Date.parse(h.next)) / 60000 : -1;
  const stop = (f: () => void) => (ev: MouseEvent) => { ev.stopPropagation(); f(); };
  return (
    <li className={`hcard l-${h.level} d-${state}` + (sel ? " sel" : "") + (folded ? " folded" : "") + (over ? " over" : "")} data-hint={h.id} tabIndex={0}
      aria-label={`${h.title}, Stufe ${h.level}`} aria-current={sel || undefined}
      onClick={onSelect} onKeyDown={(ev) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) onSelect(); }}>
      <div className="hc-head">
        <LevelIcon level={h.level} />
        <span className="hc-rule">{h.rule}</span>
        <span className="hc-group">{rule?.name ?? GROUP_LABEL[groupOf(h)]}</span>
        {over
          ? <span className="hc-time tnum" title={`galt ${dayLabel(h.t, ex.days)} ${h.t.slice(11, 16)} bis ${dayLabel(h.until!, ex.days)} ${h.until!.slice(11, 16)}`}><span className="hc-over">vorbei</span> {hhmm(h.t, ex.days, t)}–{hhmm(h.until!, ex.days, t)}</span>
          : <span className="hc-time tnum" title={`gilt seit ${dayLabel(h.t, ex.days)} ${h.t.slice(11, 16)}${h.last && h.last > h.t ? `, zuletzt ${h.last.slice(11, 16)}` : ""}`}>seit {hhmm(h.t, ex.days, t)}</span>}
      </div>
      <h4 className="hc-title">{h.title}</h4>
      {!folded && <p className="hc-text">{h.text}</p>}
      {!folded && h.next && late <= 60 && (
        <p className={"hc-next" + (late >= 0 ? " late" : "")}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h9M8 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {late < 0 ? "nächste ca." : "erwartet ca."} <b className="tnum">{hhmm(h.next, ex.days, t)}</b>
          {late >= 0 && <span className="hc-late"> – überfällig</span>}
        </p>
      )}
      {!folded && h.next && late > 60 && <p className="hc-was">Seit der erwarteten Durchfahrt (ca. {hhmm(h.next, ex.days, t)}) keine Meldung mehr.</p>}
      {!folded && evs.length > 0 && (
        <ol className="hc-evs" aria-label="Auslöser">
          {shown.map((e) => (
            <li key={e.id}>
              <button className="hc-ev" onClick={stop(() => onEvent(e.id))} title="Meldung zeigen">
                <span className="tnum">{e.t.slice(11, 16)}</span>
                <EvSym e={e} />
                <span className="hc-evt">{e.desc && e.desc.length < 48 ? e.desc : e.text}</span>
                <span className="hc-evw">{e.cells?.[0] ?? e.nai ?? ""}{e.melder ? <small> · {e.melder}</small> : null}</span>
              </button>
            </li>
          ))}
          {evs.length > shown.length && (
            <li><button className="linkbtn hc-more" onClick={stop(() => setAllEv(true))}>+ {evs.length - shown.length} weitere Meldungen</button></li>
          )}
        </ol>
      )}
      <div className="hc-foot">
        {!compact && h.level !== "info" && (state === "neu" ? (
          <>
            <button className="hc-btn ok" onClick={stop(() => onDecide("bestaetigt"))} title="Hinweis trifft zu – bleibt in der Liste «Bestätigt»">
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Bestätigen
            </button>
            <button className="hc-btn" onClick={stop(() => onDecide("verworfen"))} title="Hinweis trifft nicht zu – bleibt auch bei neuen Meldungen verworfen">
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              Verwerfen
            </button>
          </>
        ) : (
          <>
            <span className={"hc-state " + state}>{state === "bestaetigt" ? "Bestätigt" : "Verworfen"}{dec?.at ? <span className="tnum"> {dec.at.slice(11, 16)}</span> : null}</span>
            <button className="linkbtn" onClick={stop(() => onDecide("neu"))}>Rückgängig</button>
          </>
        ))}
        {(h.pos || h.cells?.length || h.nai || evs.some((e) => e.pos)) && (
          <button className="hc-btn ghost" onClick={stop(onMap)} title="Auf der Karte zeigen">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>
            Auf Karte
          </button>
        )}
        <button className="hc-src" aria-expanded={srcOpen} onClick={stop(() => setSrcOpen(!srcOpen))} title="Regel und Quelle">
          Regel {h.rule}{rule?.source ? ` · ${rule.source}` : ""} <span aria-hidden="true" className="hp-chev">▸</span>
        </button>
      </div>
      {srcOpen && rule && (
        <div className="hc-rulebox" onClick={(ev) => ev.stopPropagation()}>
          <b>{rule.id} · {rule.name}</b> <span className="hc-grp">({GROUP_LABEL[rule.group]})</span>
          <p>{rule.rule}</p>
          {rule.source && <p className="hc-srcline">Quelle: <span className="mono">{rule.source}</span></p>}
        </div>
      )}
    </li>
  );
}

function EvSym({ e }: { e: LageEvent }) {
  const html = useMemo(() => ({ __html: iconSvg(e.sym, e.aff, 14, { sidc: e.sidc, status: e.status }).svg }), [e.sym, e.aff, e.sidc, e.status]);
  return <span className="symmini" dangerouslySetInnerHTML={html} />;
}

/** Stufe als kleines Zeichen: hoch = Dreieck mit «!», mittel = Raute, Referenz = «i» */
export function LevelIcon({ level, size = 16 }: { level: HintLevel; size?: number }) {
  return (
    <span className={`hc-lvl l-${level}`} title={level === "hoch" ? "Stufe hoch – Handeln prüfen" : level === "mittel" ? "Stufe mittel – beobachten" : "Referenz"} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 16 16">
        {level === "hoch" && <><path d="M8 1.6L15 14H1z" fill="currentColor" /><path d="M8 6v3.6" stroke="var(--card)" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="11.8" r="1" fill="var(--card)" /></>}
        {level === "mittel" && <><path d="M8 1.5L14.5 8 8 14.5 1.5 8z" fill="currentColor" /><path d="M5.2 8h5.6" stroke="var(--card)" strokeWidth="1.8" strokeLinecap="round" /></>}
        {level === "info" && <><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="8" cy="4.8" r="1" fill="currentColor" /></>}
      </svg>
    </span>
  );
}
