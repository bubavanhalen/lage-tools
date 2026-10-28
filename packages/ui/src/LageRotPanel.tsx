/**
 * «Was Rot tun könnte» für Experte und Präsentation (Spez. MVP 1: nur noch Experte; Grundansicht = `red/RedPanel`):
 * Möglichkeiten Rot (am wahrscheinlichsten, am gefährlichsten, auch möglich) mit Anzeichen, Weg von Rot und «Jetzt
 * prüfen» – und Kräfte Rot (gesehen ↔ erwartet). Klartext-Titel mit Code-Marke an den Anzeichen. Die erwarteten Kräfte
 * werden in Vorbereiten, Schritt 5, bearbeitet (`red/FeindannahmeEdit`), hier nur angezeigt.
 * Vermutungen, keine Fakten: Klick auf ein Anzeichen wählt Hinweis bzw. Meldung.
 * Einklappbar (gemerkt pro Gerät), folgt Lagezeit und «Zeige letzte».
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { coaHeadline, indicatorText, type CoaIndicator, type Exercise, type RedCoa, type StrengthCompare } from "@lage/core";
import { hhmm } from "./hintsData";
import {
  countLabel, durLabel, expectedLabel, foundLabel, indCounts, indSign, inWindowLabel, isAgainst, MIND_BIS_TITLE,
  rowName, shownIndicators, STATE_LABEL, windowLabel, type LageRotState,
} from "./lageRot";
import { COA_KICKER, coaWhen, EMPTY_COA } from "./red/redText";
import { dayLabel } from "./Timeline";
import { KiCoaExplain, KiLageberichtButton } from "./ki/KiFeatures";
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
  /** Indikator-Hinweis wählen (die Liste springt zum Hinweis – «← zurück zu Lage Rot» bringt zurück) */
  onHint: (id: string) => void;
  /** Meldung wählen (Karte springt) */
  onEvent: (id: string) => void;
  /** nicht mehr gebraucht (erwartete Kräfte: `red/FeindannahmeEdit` in Vorbereiten) – bleibt für bestehende Aufrufe */
  update?: (f: (x: Exercise) => Exercise) => void;
  /** Präsentation: ohne Bearbeiten */
  compact?: boolean;
}

export function LageRotPanel({ ex, lage, t, selected, onSelect, onMap, onHint, onEvent, compact }: Props) {
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

  // Klick auf einen Indikator-Hinweis: die Liste springt zum Hinweis. Scrollposition merken und – solange die Karte
  // der Möglichkeit nicht sichtbar ist – unten «← zurück zu Lage Rot» anbieten.
  const [back, setBack] = useState<Back | null>(null);
  const hint = (c: RedCoa, id: string) => {
    const host = ref.current?.closest<HTMLElement>(".panel") ?? null;
    const sc = scroller(ref.current);
    if (host) setBack({ host, sc, top: sc ? sc.scrollTop : window.scrollY, coa: c.id });
    setExp(c, true); // Karte bleibt offen, auch wenn die Möglichkeit abgewählt wird
    onHint(id);
  };
  useEffect(() => {
    if (!back) return;
    const card = ref.current?.querySelector<HTMLElement>(`[data-coa="${CSS.escape(back.coa)}"]`);
    if (!card || typeof IntersectionObserver === "undefined") return;
    let left = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e) return;
      if (!e.isIntersecting) left = true;
      else if (left) setBack(null); // wieder zurückgescrollt
    }, { threshold: 0.3 });
    io.observe(card);
    // Karte blieb sichtbar (Hinweis in der Nähe): kein Zurück nötig
    const tm = window.setTimeout(() => { if (!left) setBack(null); }, 1800);
    return () => { io.disconnect(); window.clearTimeout(tm); };
  }, [back]);
  const goBack = () => {
    if (!back) return;
    if (back.sc) back.sc.scrollTo({ top: back.top, behavior: "smooth" }); else window.scrollTo({ top: back.top, behavior: "smooth" });
    if (coas.some((c) => c.id === back.coa)) { setExp(coas.find((c) => c.id === back.coa)!, true); onSelect(back.coa); }
    setBack(null);
  };

  const head = (c: RedCoa) => {
    // zu → auf und wählen; auf, nicht gewählt → wählen; gewählt → zu
    if (!isExpanded(c)) { setExp(c, true); onSelect(c.id); }
    else if (c.id !== selected) onSelect(c.id);
    else { setExp(c, false); onSelect(null); }
  };

  const hasRed = lage.force.rows.length > 0 || lage.force.notSeen.length > 0;
  const summary = likely ? coaHeadline(likely) : hasRed ? null : "noch keine Sichtungen";

  return (
    <section className={"lr" + (compact ? " compact" : "") + (open ? " open" : "")} ref={ref} aria-label="Was Rot tun könnte">
      <button className="lr-head" aria-expanded={open} onClick={toggle} title={open ? "Einklappen" : "Aufklappen"}>
        <span className="hp-chev" aria-hidden="true">▸</span>
        <h3>Was Rot tun könnte</h3>
        {!open && summary && <span className="lr-sum">{likely && <CoaIcon label="wahrscheinlichste" size={12} />}{summary}</span>}
        <span className="hp-sub">{dayLabel(t, ex.days)} {t.slice(11, 16)}</span>
      </button>
      {open && (
        <div className="lr-body">
          {!compact && <KiLageberichtButton hints={lage.hints} coas={coas} />}
          <div className="lr-sec">
            <h4 className="lr-h">Möglichkeiten</h4>
            {coas.length ? (
              <ol className="lr-coas">
                {coas.map((c) => (
                  <CoaCard key={c.id} c={c} ex={ex} t={t} open={isExpanded(c)} sel={c.id === selected} compact={compact}
                    onHead={() => head(c)} onMap={() => onMap(c)} onHint={(id) => hint(c, id)} onEvent={onEvent} />
                ))}
              </ol>
            ) : (
              <p className="lr-empty">{hasRed ? EMPTY_COA : "Noch keine Sichtungen Rot. Vermutungen entstehen aus Hinweisen und Meldungen."}</p>
            )}
            {lage.more.length > 0 && <MoreCoas more={lage.more} />}
          </div>
          <div className="lr-sec">
            <h4 className="lr-h">Kräfte Rot{lage.from && <span className="lr-hnote" title="Kräfte und «nicht mehr gesehen» über das ganze Journal bis zur Lagezeit; Spalte «im Fenster» nur Meldungen ab «Zeige letzte»"> · ganzes Journal, «im Fenster» ab {hhmm(lage.from, ex.days, t)}</span>}</h4>
            <ForceTable lage={lage} ex={ex} t={t} onEvent={onEvent} />
            <p className="lr-fa">{ex.feindannahme?.trim()
              ? <><span className="lr-fa-k">Erwartet (aus dem Befehl)</span> <span className="mono">{ex.feindannahme.trim()}</span></>
              : <>Erwartete Kräfte: in Vorbereiten, Schritt 5 eintragen.</>}</p>
          </div>
        </div>
      )}
      {back && createPortal(
        <button className="lr-back" onClick={goBack} title="Zurück zur möglichen Aktion in Lage Rot">
          <span aria-hidden="true">←</span> zurück zu Lage Rot
        </button>, back.host)}
    </section>
  );
}

interface Back { host: HTMLElement; sc: HTMLElement | null; top: number; coa: string }

/** nächster scrollender Vorfahre (Seitenleiste, Präsentationsspalte); null = Fenster (Handy) */
function scroller(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** übrige Möglichkeiten (genügend Indikatoren, aber nicht ausgewählt): eingeklappt, nur Titel und Indikatoren */
function MoreCoas({ more }: { more: RedCoa[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lr-more">
      <button className="linkbtn lr-morebtn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hp-chev" aria-hidden="true">▸</span> {more.length} {more.length === 1 ? "weitere Möglichkeit" : "weitere Möglichkeiten"} mit genügend Anzeichen
      </button>
      {open && (
        <ul className="lr-morelist">
          {more.map((c) => {
            const n = indCounts(c);
            return (
              <li key={c.id} title={shownIndicators(c).map((i) => `${indSign(i)} ${indicatorText(i)}`).join("\n")}>
                <span className="lr-mt">{coaHeadline(c)}</span>
                <span className="lr-mn tnum">{n.met}/{n.of}{n.against > 0 && <span className="lr-mx"> · {n.against} ✗</span>}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Regel des Anzeichens als Kürzel und Gewicht im Tooltip */
const indTitle = (i: CoaIndicator, act: string) => [act, i.rule && /^[A-E]\d$/.test(i.rule) ? `Regel ${i.rule}` : "", i.weight !== undefined ? `Gewicht ${i.weight.toFixed(2).replace(".", ",")}` : ""].filter(Boolean).join(" · ");
/** Code-Marke (Experte): Regel des Anzeichens, z. B. «D1» */
const ruleTag = (i: CoaIndicator) => (i.rule && /^[A-E]\d$/.test(i.rule) ? i.rule : null);

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

/** Indikatoren als Punkte (Zähler): erfüllt zuerst, gefüllt (grün), offen leer, Gegenindikatoren rot dahinter */
function Pips({ c }: { c: RedCoa }) {
  const list = shownIndicators(c);
  return (
    <span className="lr-pips" aria-hidden="true">
      {list.filter((i) => !isAgainst(i)).sort((a, b) => Number(b.met) - Number(a.met)).map((i, k) => <i key={k} className={i.met ? "met" : ""} />)}
      {list.filter(isAgainst).map((_, k) => <i key={"x" + k} className="against" />)}
    </span>
  );
}

function CoaCard({ c, ex, t, open, sel, compact, onHead, onMap, onHint, onEvent }: {
  c: RedCoa; ex: Exercise; t: string; open: boolean; sel: boolean; compact?: boolean;
  onHead: () => void; onMap: () => void; onHint: (id: string) => void; onEvent: (id: string) => void;
}) {
  const w0 = windowLabel(c, ex.days, t);
  const w = w0 && { ...w0, text: coaWhen(c, ex, t)?.text ?? w0.text };
  const n = indCounts(c);
  const cnt = countLabel(c);
  const pick = (i: CoaIndicator) => { if (i.hintId) onHint(i.hintId); else if (i.events?.length) onEvent(i.events.at(-1)!); };
  const canMap = !!(c.target || c.approach?.length);
  return (
    <li className={`lr-coa k-${c.label}` + (open ? " open" : "") + (sel ? " sel" : "")} data-coa={c.id}>
      <button className="lr-coa-head" aria-expanded={open} onClick={onHead}
        title={sel ? "Einklappen" : "Anzeichen auf der Karte hervorheben"}>
        <CoaIcon label={c.label} />
        <span className="lr-kick">{COA_KICKER[c.label]}</span>
        {w ? (
          <span className={"lr-win tnum w-" + w.state} title={w.title}>{w.text}</span>
        ) : !open ? <span className="lr-cnt tnum" title={`${cnt} Anzeichen`}><Pips c={c} /></span> : null}
        <span className="lr-title">{coaHeadline(c)}</span>
      </button>
      {open && (
        <div className="lr-coa-body">
          <div className="lr-row">
            <span className="lr-dt">Anzeichen</span>
            <span className="lr-dd lr-meter" title={`${n.met} von ${n.of} Anzeichen erfüllt${n.against ? `, ${n.against} ${n.against === 1 ? "spricht" : "sprechen"} dagegen` : ""}`}>
              <b className="tnum">{n.met} von {n.of} <span className="lr-ok">✓</span>{n.against > 0 && <> · {n.against} <span className="lr-x">✗</span></>}</b> <Pips c={c} />
            </span>
          </div>
          <ul className="lr-inds">
            {shownIndicators(c).map((i, k) => {
              const act = i.met && !!(i.hintId || i.events?.length);
              const x = isAgainst(i);
              const aria = x ? "spricht dagegen" : i.met ? "erfüllt" : "offen";
              const body = <><span className="lr-tick" aria-label={aria}>{indSign(i)}</span><span>{indicatorText(i)}{ruleTag(i) && <span className="lr-rule"> {ruleTag(i)}</span>}</span></>;
              return (
                <li key={k} className={x ? "against" : i.met ? "met" : "off"}>
                  {act ? (
                    <button className="lr-ind" onClick={() => pick(i)} title={indTitle(i, (x ? "spricht dagegen – " : "") + (i.hintId ? "Hinweis zeigen" : "Meldung zeigen"))}>{body}</button>
                  ) : (
                    <span className="lr-ind" title={indTitle(i, x ? "spricht dagegen" : i.met ? "trifft zu" : "offen – noch nicht beobachtet")}>{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {c.approachText && (
            <div className="lr-row">
              <span className="lr-dt">Weg von Rot</span>
              <span className="lr-dd">{c.approachText}{c.approach && c.approach.length > 1 && <span className="lr-onmap"> · Pfeil auf Karte</span>}</span>
            </div>
          )}
          {c.check.length > 0 && (
            <div className="lr-row">
              <span className="lr-dt">Jetzt prüfen</span>
              <ul className="lr-dd lr-checks">{c.check.map((x, k) => <li key={k}>{x}</li>)}</ul>
            </div>
          )}
          {!compact && <KiCoaExplain c={c} />}
          {canMap && (
            <div className="hc-foot">
              <button className="hc-btn ghost" onClick={onMap} title="Ziel, Weg von Rot und Orte der Anzeichen auf der Karte zeigen">
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>
                Auf Karte zeigen
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

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
