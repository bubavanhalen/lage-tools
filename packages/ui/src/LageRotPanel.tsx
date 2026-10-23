/**
 * Abschnitt «Lage Rot» oben im Reiter Hinweise: mögliche Aktionen Rot (wahrscheinlichste, gefährlichste, weitere)
 * mit Indikatoren, Annäherung und was zu prüfen ist – und Kräfte Rot (erkannt ↔ Feindannahme).
 * Hinweise, keine Fakten: jede Möglichkeit nennt ihre Indikatoren (erfüllt/offen); Klick wählt Hinweis bzw. Meldung.
 * Einklappbar (gemerkt pro Gerät), folgt Lagezeit und Zeitfenster.
 */
import { useEffect, useRef, useState } from "react";
import { parseStrength, type CoaIndicator, type Exercise, type RedCoa, type StrengthCompare } from "@lage/core";
import { hhmm } from "./hintsData";
import {
  COA_LABEL, durLabel, expectedLabel, foundLabel, metCount, rowName, STATE_LABEL, windowLabel, type LageRotState,
} from "./lageRot";
import { dayLabel } from "./Timeline";
import "./lagerot.css";

const OPEN_KEY = "lage-tools.lagerot-offen";
const loadOpen = () => { try { return localStorage.getItem(OPEN_KEY) !== "0"; } catch { return true; } };

interface Props {
  ex: Exercise;
  lage: LageRotState;
  /** Lagezeit (ISO lokal) */
  t: string;
  /** gewählte Möglichkeit (auf der Karte hervorgehoben) */
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Möglichkeit auf der Karte zeigen */
  onMap: (c: RedCoa) => void;
  /** Indikator-Hinweis wählen */
  onHint: (id: string) => void;
  /** Meldung wählen (Karte springt) */
  onEvent: (id: string) => void;
  update: (f: (x: Exercise) => Exercise) => void;
  /** Präsentation: ohne Bearbeiten */
  compact?: boolean;
}

export function LageRotPanel({ ex, lage, t, selected, onSelect, onMap, onHint, onEvent, update, compact }: Props) {
  const [open, setOpen] = useState(loadOpen);
  const toggle = () => { setOpen(!open); try { localStorage.setItem(OPEN_KEY, open ? "0" : "1"); } catch { /* egal */ } };
  const { coas } = lage;
  const likely = coas.find((c) => c.label === "wahrscheinlichste");

  // aufgeklappte Karten: Standard die wahrscheinlichste; gewählte (z. B. Klick auf der Karte) immer
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const isExpanded = (c: RedCoa) => c.id === selected || (expanded ? expanded.has(c.id) : c.label === "wahrscheinlichste");
  const setExp = (c: RedCoa, v: boolean) => {
    const s = new Set(expanded ?? (likely ? [likely.id] : []));
    if (v) s.add(c.id); else s.delete(c.id);
    setExpanded(s);
  };
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selected || !coas.some((c) => c.id === selected)) return;
    if (!open) toggle();
    const id = window.setTimeout(() => ref.current?.querySelector<HTMLElement>(`[data-coa="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    return () => window.clearTimeout(id);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = (c: RedCoa) => {
    // zu → auf und wählen; auf, nicht gewählt → wählen; gewählt → zu
    if (!isExpanded(c)) { setExp(c, true); onSelect(c.id); }
    else if (c.id !== selected) onSelect(c.id);
    else { setExp(c, false); onSelect(null); }
  };

  const hasRed = lage.force.rows.length > 0 || lage.force.notSeen.length > 0;
  const summary = likely ? likely.title : hasRed ? null : "noch keine Sichtungen";

  return (
    <section className={"lr" + (compact ? " compact" : "") + (open ? " open" : "")} ref={ref} aria-label="Lage Rot">
      <button className="lr-head" aria-expanded={open} onClick={toggle} title={open ? "Lage Rot einklappen" : "Lage Rot aufklappen"}>
        <span className="hp-chev" aria-hidden="true">▸</span>
        <h3>Lage Rot</h3>
        {!open && summary && <span className="lr-sum">{likely && <CoaIcon label="wahrscheinlichste" size={12} />}{summary}</span>}
        <span className="hp-sub">{dayLabel(t, ex.days)} {t.slice(11, 16)}</span>
      </button>
      {open && (
        <div className="lr-body">
          <div className="lr-sec">
            <h4 className="lr-h">Mögliche Aktionen Rot</h4>
            {coas.length ? (
              <ol className="lr-coas">
                {coas.map((c) => (
                  <CoaCard key={c.id} c={c} ex={ex} t={t} open={isExpanded(c)} sel={c.id === selected}
                    onHead={() => head(c)} onMap={() => onMap(c)} onHint={onHint} onEvent={onEvent} />
                ))}
              </ol>
            ) : (
              <p className="lr-empty">{hasRed
                ? "Keine erkennbare Absicht Rot – zu wenig Indikatoren (mindestens zwei zutreffende Hinweise oder Meldungen)."
                : "Noch keine Sichtungen Rot. Mögliche Aktionen entstehen aus Hinweisen und Meldungen."}</p>
            )}
            {lage.more.length > 0 && <MoreCoas more={lage.more} />}
          </div>
          <div className="lr-sec">
            <h4 className="lr-h">Kräfte Rot{lage.from && <span className="lr-hnote"> · im Zeitfenster ab {hhmm(lage.from, ex.days, t)}</span>}</h4>
            <ForceTable lage={lage} ex={ex} t={t} onEvent={onEvent} />
            <Feindannahme ex={ex} update={update} compact={compact} />
          </div>
        </div>
      )}
    </section>
  );
}

/** übrige Möglichkeiten (genügend Indikatoren, aber nicht ausgewählt): eingeklappt, nur Titel und Indikatoren */
function MoreCoas({ more }: { more: LageRotState["more"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lr-more">
      <button className="linkbtn lr-morebtn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hp-chev" aria-hidden="true">▸</span> {more.length} {more.length === 1 ? "weitere Möglichkeit" : "weitere Möglichkeiten"} mit genügend Indikatoren
      </button>
      {open && (
        <ul className="lr-morelist">
          {more.map((c) => {
            const n = c.indicators.filter((i) => i.met).length;
            return (
              <li key={c.id} title={c.indicators.map((i) => `${i.met ? "✓" : "○"} ${i.text}`).join("\n")}>
                <span className="lr-mt">{c.title}</span>
                <span className="lr-mn tnum">{n}/{c.indicators.length}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Regel des Indikators als Kürzel, falls nicht schon im Text, und Gewicht im Tooltip */
const indTitle = (i: CoaIndicator, act: string) => [act, i.rule && /^[A-E]\d$/.test(i.rule) ? `Regel ${i.rule}` : "", i.weight !== undefined ? `Gewicht ${i.weight.toFixed(2).replace(".", ",")}` : ""].filter(Boolean).join(" · ");
const ruleTag = (i: CoaIndicator) => (i.rule && /^[A-E]\d$/.test(i.rule) && !i.text.includes(`(${i.rule})`) ? i.rule : null);

/** Einordnung als Zeichen: wahrscheinlichste ▲, gefährlichste ⚠, weitere ◇ */
export function CoaIcon({ label, size = 16 }: { label: RedCoa["label"]; size?: number }) {
  return (
    <span className={"lr-ico " + label} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 16 16">
        {label === "wahrscheinlichste" && <path d="M8 2.2L14.6 13.6H1.4z" fill="currentColor" />}
        {label === "gefaehrlichste" && <><path d="M8 1.8L15 14.2H1z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M8 6.2v3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="8" cy="11.9" r="1" fill="currentColor" /></>}
        {label === "weitere" && <path d="M8 2L14 8 8 14 2 8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />}
      </svg>
    </span>
  );
}

/** Indikatoren als Punkte: erfüllt gefüllt, offen leer */
function Pips({ c }: { c: RedCoa }) {
  return (
    <span className="lr-pips" aria-hidden="true">
      {c.indicators.map((i, k) => <i key={k} className={i.met ? "met" : ""} />)}
    </span>
  );
}

function CoaCard({ c, ex, t, open, sel, onHead, onMap, onHint, onEvent }: {
  c: RedCoa; ex: Exercise; t: string; open: boolean; sel: boolean;
  onHead: () => void; onMap: () => void; onHint: (id: string) => void; onEvent: (id: string) => void;
}) {
  const w = windowLabel(c, ex.days, t);
  const n = metCount(c);
  const pick = (i: CoaIndicator) => { if (i.hintId) onHint(i.hintId); else if (i.events?.length) onEvent(i.events.at(-1)!); };
  const canMap = !!(c.target || c.approach?.length);
  return (
    <li className={`lr-coa k-${c.label}` + (open ? " open" : "") + (sel ? " sel" : "")} data-coa={c.id}>
      <button className="lr-coa-head" aria-expanded={open} onClick={onHead}
        title={sel ? "Einklappen" : "Indikatoren auf der Karte hervorheben"}>
        <CoaIcon label={c.label} />
        <span className="lr-kick">{COA_LABEL[c.label]}</span>
        {w ? (
          <span className={"lr-win tnum" + (w.now ? " now" : "") + (w.past ? " past" : "")} title={w.now ? "Zeitraum hat begonnen" : w.past ? "Zeitraum vorbei" : "erwarteter Zeitraum"}>
            {w.now ? "jetzt" : "ca."} {w.text}
          </span>
        ) : !open ? <span className="lr-cnt tnum" title={`${n} von ${c.indicators.length} Indikatoren erfüllt`}><Pips c={c} /></span> : null}
        <span className="lr-title">{c.title}</span>
      </button>
      {open && (
        <div className="lr-coa-body">
          <div className="lr-row">
            <span className="lr-dt">Indikatoren</span>
            <span className="lr-dd lr-meter"><b className="tnum">{n} von {c.indicators.length}</b> <Pips c={c} /></span>
          </div>
          <ul className="lr-inds">
            {c.indicators.map((i, k) => {
              const act = i.met && !!(i.hintId || i.events?.length);
              return (
                <li key={k} className={i.met ? "met" : "off"}>
                  {act ? (
                    <button className="lr-ind" onClick={() => pick(i)} title={indTitle(i, i.hintId ? "Hinweis zeigen" : "Meldung zeigen")}>
                      <span className="lr-tick" aria-label="erfüllt">✓</span><span>{i.text}{ruleTag(i) && <span className="lr-rule"> {ruleTag(i)}</span>}</span>
                    </button>
                  ) : (
                    <span className="lr-ind" title={indTitle(i, i.met ? "erfüllt" : "offen – noch nicht beobachtet")}><span className="lr-tick" aria-label={i.met ? "erfüllt" : "offen"}>{i.met ? "✓" : "○"}</span><span>{i.text}{ruleTag(i) && <span className="lr-rule"> {ruleTag(i)}</span>}</span></span>
                  )}
                </li>
              );
            })}
          </ul>
          {c.approachText && (
            <div className="lr-row">
              <span className="lr-dt">Annäherung</span>
              <span className="lr-dd">{c.approachText}{c.approach && c.approach.length > 1 && <span className="lr-onmap"> · Pfeil auf Karte</span>}</span>
            </div>
          )}
          {c.check.length > 0 && (
            <div className="lr-row">
              <span className="lr-dt">Prüfen</span>
              <ul className="lr-dd lr-checks">{c.check.map((x, k) => <li key={k}>{x}</li>)}</ul>
            </div>
          )}
          {canMap && (
            <div className="hc-foot">
              <button className="hc-btn ghost" onClick={onMap} title="Ziel und Annäherung auf der Karte zeigen">
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>
                Auf Karte
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** Kräfte Rot: erkannt ↔ erwartet (Feindannahme) ↔ Stand; ohne Feindannahme nur «erkannt» */
function ForceTable({ lage, ex, t, onEvent }: { lage: LageRotState; ex: Exercise; t: string; onEvent: (id: string) => void }) {
  const rows = lage.compare.filter((c) => c.found || c.expected !== undefined);
  const withSpec = !!lage.spec;
  const { notSeen } = lage.force;
  if (!rows.length && !notSeen.length) return <p className="lr-empty">Noch nichts erkannt.</p>;
  return (
    <div className={"lr-tab" + (withSpec ? " spec" : "")} role="table" aria-label="Kräfte Rot">
      <div className="lr-tr lr-th" role="row">
        <span role="columnheader"><span className="sr">Art</span></span>
        <span role="columnheader">erkannt</span>
        {withSpec && <><span role="columnheader" title="erwartet (Feindannahme)"><span className="lr-l">erwartet</span><span className="lr-s">erw.</span></span><span role="columnheader">Stand</span></>}
      </div>
      {rows.map((c) => {
        const f = foundLabel(c.found);
        return (
          <div key={c.row.key} className={"lr-tr s-" + c.state + (c.row.parent ? " sub" : "") + (c.row.key === "unklar" ? " unk" : "")} role="row">
            <span className="lr-name" role="rowheader">{rowName(c)}</span>
            <span className="lr-found" role="cell">{f.main}{f.sub && <small>{f.sub}</small>}</span>
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

/** Feindannahme in Kurzschrift, z. B. «2 Det, 14 Pers, 5 Fz, 1 Drohne»; Live-Vorschau der gelesenen Zeilen */
function Feindannahme({ ex, update, compact }: { ex: Exercise; update: (f: (x: Exercise) => Exercise) => void; compact?: boolean }) {
  const [edit, setEdit] = useState<string | null>(null);
  const cur = ex.feindannahme?.trim() ?? "";
  const save = () => {
    const v = (edit ?? "").trim();
    update((x) => { if (v) x.feindannahme = v; else delete x.feindannahme; return x; });
    setEdit(null);
  };
  if (edit !== null) {
    const p = edit.trim() ? parseStrength(edit) : { rows: [], unknown: [] };
    return (
      <div className="lr-fa-edit">
        <label className="lr-fa-l" htmlFor="lr-fa-in">Feindannahme <span>(Kurzschrift wie Meldungen)</span></label>
        <input id="lr-fa-in" className="mono" value={edit} autoFocus placeholder="z. B. 2 Det, 14 Pers, 5 Fz (2 Kpz), 1 Drohne" spellCheck={false}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }} />
        {(p.rows.length > 0 || p.unknown.length > 0) && (
          <ul className="lr-fa-prev" aria-label="Gelesen">
            {p.rows.map((r) => <li key={r.key} className={r.parent ? "sub" : ""}><b className="tnum">{r.count}</b> {r.parent && !/^davon /i.test(r.name) ? `davon ${r.name}` : r.name}</li>)}
            {p.unknown.map((u, k) => <li key={"u" + k} className="unk" title="nicht verstanden – wird nicht gezählt">? {u}</li>)}
          </ul>
        )}
        <div className="btnrow">
          <button className="primary" onClick={save}>Speichern</button>
          <button onClick={() => setEdit(null)}>Abbrechen</button>
          {cur && <button className="linkbtn lr-fa-del" onClick={() => setEdit("")}>Leeren</button>}
        </div>
      </div>
    );
  }
  if (!cur) {
    return compact ? <p className="lr-fa none">Keine Feindannahme – nur erkannt.</p> : (
      <div className="lr-fa none">
        <button className="hc-btn ghost" onClick={() => setEdit("")} title="Erwartete Kräfte Rot in Kurzschrift, z. B. «2 Det, 14 Pers, 5 Fz, 1 Drohne»">+ Feindannahme eintragen</button>
        <span className="lr-fa-why">für «erwartet» und Stand</span>
      </div>
    );
  }
  return (
    <p className="lr-fa">
      <span className="lr-fa-k">Feindannahme</span> <span className="mono">{cur}</span>
      {!compact && <button className="lr-fa-ed" onClick={() => setEdit(cur)} title="Feindannahme ändern" aria-label="Feindannahme ändern">✎</button>}
    </p>
  );
}
