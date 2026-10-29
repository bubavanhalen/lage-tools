/**
 * Vorschau unter dem Meldungsfeld (Spez. MVP 1, Kap. 2.4/2.5): Zustandszeile (✓ Bereit / ⚠ Bitte prüfen / ⛔ Geht nicht)
 * mit Ausweg, «Verstanden:» (Zeit, Trupp), «gelesen als» (Funksprache), Zeichen ▾ und Einordnung Feind|Eigene|Unklar,
 * Ort (mit Strassenwahl) und «Ort auf Karte setzen». In der Korrektur: geänderte Werte fett mit «(vorher …)».
 * Experte: «Fläche zeichnen». KI deuten nur bei eingeschalteter KI (KiMeldungSuggest blendet sich sonst aus).
 * Testhaken: `data-zustand` am Block (= EntryState.level).
 */
import { createPortal } from "react-dom";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { describeTactical, type Kind, type LageEvent } from "@lage/core";
import { iconSvg } from "@lage/map";
import { LAGE_KARTE } from "../colors";
import { useDraftMissing } from "../QualityMarks";
import { RoadChoice, baseWhere } from "../RoadChoice";
import { ShapeButton } from "../ShapeDraw";
import { SymbolPicker, choiceSvg, pickerEntry, type SymbolChoice } from "../SymbolPicker";
import { dayLabel } from "../Timeline";
import { KiMeldungSuggest, meldungUnklar } from "../ki/KiFeatures";
import { dayTitle, genericWhat, missLabel, replaceToken } from "./labels";
import type { EntryDraft } from "./useEntryDraft";

const KINDS: Array<[Kind, string, string]> = [["feind", "Feind", "◆"], ["eigen", "Eigene", "●"], ["unklar", "Unklar", "■"]];
const KIND_WORD: Record<Kind, string> = { feind: "Feind", eigen: "Eigene", unklar: "Unklar" };
const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;
const coarse = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/** ausgeschriebener Sinn zu einer von Hand gewählten Zeichenwahl */
function choiceText(c: SymbolChoice, count?: number): string {
  return describeTactical({ key: c.key, echelon: c.echelon, count: count && count > 0 ? count : undefined }, c.aff === "H" || c.aff === "F" ? c.aff : null)
    || pickerEntry(c.key)?.name || c.key;
}

export function PreviewLine({ d, onAddUnit }: { d: EntryDraft; onAddUnit(name: string): void }) {
  const { draft, state, ex, base } = d;
  const missing = useDraftMissing(draft, ex);
  const [pickOpen, setPickOpen] = useState(false);
  const [pickPos, setPickPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const pickClosedAt = useRef(0);
  const iconHtml = useMemo(() => {
    if (!draft || !d.choice) return "";
    const e = pickerEntry(d.choice.key) ?? pickerEntry("einheit")!;
    if (d.keepSymbol && base) return iconSvg(base.sym, base.aff, 16, { sidc: base.sidc, status: base.status }).svg;
    if (!d.symOverride && draft.sidc) return iconSvg(draft.sym, draft.aff, 16, { sidc: draft.sidc, status: draft.status }).svg;
    return choiceSvg(e, d.choice.aff, 16, { echelon: d.choice.echelon, status: d.choice.status });
  }, [draft, d.choice, d.symOverride, d.keepSymbol, base]);
  if (!draft || !state) return null;

  const openPicker = (btn: HTMLElement) => {
    if (pickOpen) { setPickOpen(false); return; }
    if (Date.now() - pickClosedAt.current < 300) return;
    const r = btn.getBoundingClientRect();
    const w = Math.min(440, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    const below = window.innerHeight - r.bottom - 18;
    const top = below >= 360 ? r.bottom + 6 : Math.max(12, window.innerHeight - Math.min(560, window.innerHeight - 24) - 12);
    setPickPos({ left, top, maxH: Math.min(560, window.innerHeight - top - 12) });
    setPickOpen(true);
  };

  const lvl = state.level;
  const r0 = state.reasons[0];
  const more = state.reasons.length - 1;
  const asked = lvl === "pruefen" && d.armed === d.text;
  const korr = d.mode.art === "korrektur";
  const time = `${dayLabel(draft.t, ex.days)} ${draft.t.slice(11, 16)}${!korr && !draft.timeFromText ? " (jetzt)" : ""}`;
  const timeChanged = korr && base && draft.timeFromText && draft.t !== base.t;
  const what = d.keepSymbol && base ? base.desc : d.symOverride ? choiceText(d.symOverride, draft.count) : draft.desc;
  const kindNow = d.effKind ?? draft.kind;
  const note = draft.kindHint === "notiz" && !d.kindOverride && !d.symOverride;
  const generic = what ? null : genericWhat(d.choice?.key ?? draft.sym, kindNow === "eigen" ? "blau" : "rot", draft.unit || draft.melder);
  const whatText = what ?? generic ?? (pickerEntry(d.choice?.key ?? draft.sym)?.name ?? draft.sym) + (draft.count && draft.count > 1 ? ` ×${draft.count}` : "");
  const kindBefore = korr && base ? (base.side === "blau" ? "eigen" : base.aff === "U" || base.aff === "N" ? "unklar" : "feind") as Kind : null;
  const placeChanged = korr && d.oldPlace !== null && (d.placeText || "ohne Ort") !== d.oldPlace;
  const ortProblem = state.reasons.some((x) => x.problem === "ort" || x.problem === "orte");
  const melderProblems = state.reasons.filter((x) => (x.problem === "melder" || x.code === "trupp-neu") && x.token);
  /** Vorschläge der Erkennung, die in den Text übernommen werden können («meintest du 07:35?», «Schützenpanzer») */
  const offers = state.reasons.flatMap((x) => {
    if (x.code === "zukunft" && x.suggest && x.token) return [{ key: "z", label: `${x.suggest.slice(0, 2)}:${x.suggest.slice(2)} einsetzen`, token: x.token, by: x.suggest }];
    if (x.code === "was" && x.token && draft.unknownWord?.suggestLabel) return [{ key: "w", label: `«${draft.unknownWord.suggestLabel}» einsetzen`, token: x.token, by: draft.unknownWord.suggestLabel }];
    return [];
  });
  const take = (token: string, by: string) => {
    const cur = d.inputRef.current?.value ?? d.text;
    const next = replaceToken(cur, token, by);
    if (next === cur) return;
    d.setText(next);
    d.fitInput();
    requestAnimationFrame(() => { const t = d.inputRef.current; if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(next.length, next.length); } });
  };
  const verb = korr ? "speichert die Korrektur" : coarse() ? "Senden-Taste trägt ein" : "Enter trägt ein";
  const fehlt = note ? [] : missing.filter((m) => m !== "Melder" && m !== "Ort").map(missLabel);
  const shapeColor = kindNow === "eigen" ? LAGE_KARTE.eigen : kindNow === "feind" ? LAGE_KARTE.feind : LAGE_KARTE.unklar;
  const shapeEvent: Pick<LageEvent, "sym" | "pos" | "cells" | "nai" | "where" | "angle" | "dir"> = {
    sym: d.choice?.key ?? draft.sym, pos: d.effPos, cells: draft.cells, nai: draft.nai, where: d.effWhere, angle: d.road?.angle, dir: draft.dir,
  };

  return (
    <div className={`eb-prev lvl-${lvl}`} data-zustand={lvl}>
      <div className={`eb-state s-${lvl}${asked ? " asked" : ""}`}>
        {lvl === "bereit" && <p className="eb-state-h"><span aria-hidden="true">✓ </span>Bereit – {korr ? "Enter speichert die Korrektur" : verb}</p>}
        {lvl === "pruefen" && r0 && (asked
          ? <p className="eb-state-h"><span aria-hidden="true">⚠ </span>{r0.ask ?? "Trotzdem eintragen? Nochmals Enter."}</p>
          : <>
            <p className="eb-state-h"><span aria-hidden="true">⚠ </span>Bitte prüfen: {r0.text}{more > 0 && <span className="eb-more"> +{more}</span>}</p>
            {r0.hint && <p className="eb-state-t">{r0.hint}</p>}
          </>)}
        {lvl === "geht-nicht" && r0 && <>
          <p className="eb-state-h"><span aria-hidden="true">⛔ </span>Geht nicht: {r0.text}</p>
          {r0.hint && <p className="eb-state-t">{r0.hint}</p>}
          {state.reasons.slice(1).filter((x) => x.problem).map((x, i) => <p key={i} className="eb-state-t">⛔ {x.text}</p>)}
        </>}
        {(melderProblems.length > 0 || offers.length > 0 || (ortProblem && lvl === "geht-nicht")) && (
          <div className="eb-acts">
            {offers.map((o) => <button key={o.key} type="button" className="eb-btn" onClick={() => take(o.token, o.by)}>{o.label}</button>)}
            {melderProblems.map((x) => (
              <button key={x.token} type="button" className="eb-btn" onClick={() => onAddUnit(x.token!)}>«{x.token}» als neuen Trupp aufnehmen</button>
            ))}
            {ortProblem && !state.reasons.some((x) => x.problem === "orte") && (
              <button type="button" className="eb-btn" onClick={d.pickOnMap} disabled={d.picking}>{d.picking ? "Auf Karte tippen …" : "Ort auf Karte setzen"}</button>
            )}
          </div>
        )}
      </div>
      <p className="eb-und">
        <span className="eb-und-k">Verstanden: </span>
        <span className={timeChanged ? "chg" : ""} title={dayTitle(draft.t, ex.days)}>{time}</span>
        {timeChanged && <span className="eb-vorher"> (vorher {base!.t.slice(11, 16)})</span>}
        <span> · </span>
        {draft.melder ? <span>{draft.melder} meldet</span> : <span className="eb-q">Trupp ?</span>}
        {lvl === "geht-nicht" && <span> · {whatText}</span>}
        {fehlt.length > 0 && <span className="eb-fehlt"> · Fehlt noch: {fehlt.join(", ")}</span>}
      </p>
      {draft.normalized && draft.normalized !== draft.text && <p className="eb-readas">gelesen als: <span className="mono">{draft.normalized}</span></p>}
      {lvl !== "geht-nicht" && note && (
        <div className="eb-row">
          <span className="eb-note">Notiz – kein Zeichen, nichts auf der Karte</span>
          <span className="eb-seg" role="group" aria-label="Doch eine Lage? Einordnung wählen" data-zaehl="einordnung">
            {KINDS.map(([k, l, f]) => (
              <button key={k} type="button" className={`k-${k}`} aria-pressed={false} onClick={() => { d.setKind(k); d.inputRef.current?.focus(); }}>
                <span aria-hidden="true">{f} </span>{l}
              </button>
            ))}
          </span>
        </div>
      )}
      {lvl !== "geht-nicht" && !note && <>
        <div className="eb-row">
          <span className="eb-symwrap">
            <button type="button" className={"eb-btn eb-sym" + (d.symOverride ? " manual" : "")} aria-expanded={pickOpen} aria-label={`Zeichen: ${whatText} – ändern`}
              onClick={(ev) => openPicker(ev.currentTarget)}>
              <span className="eb-symico" dangerouslySetInnerHTML={{ __html: iconHtml }} />
              <span className="eb-symtxt">{whatText}</span> <span aria-hidden="true">▾</span>
            </button>
            {pickOpen && d.choice && createPortal(
              <div className="sympop" style={pickPos && window.innerWidth > 560 ? ({ left: pickPos.left, top: pickPos.top, "--sp-maxh": `${pickPos.maxH}px` } as CSSProperties) : undefined}>
                <SymbolPicker value={d.choice} onChange={(c) => d.setSymOverride(c)} onClose={() => { pickClosedAt.current = Date.now(); setPickOpen(false); d.inputRef.current?.focus(); }} />
              </div>
            , document.body)}
          </span>
          <span className="eb-seg" role="group" aria-label="Einordnung" data-zaehl="einordnung">
            {KINDS.map(([k, l, f]) => (
              <button key={k} type="button" className={`k-${k}`} aria-pressed={kindNow === k} onClick={() => { d.setKind(k); d.inputRef.current?.focus(); }}>
                <span aria-hidden="true">{f} </span>{k === "unklar" && d.symOverride?.aff === "N" ? "Neutral" : l}
              </button>
            ))}
          </span>
          {kindBefore && kindBefore !== kindNow && <span className="eb-vorher">(vorher {KIND_WORD[kindBefore]})</span>}
        </div>
        <div className="eb-row eb-ort">
          {d.roadTarget && d.effPos ? (
            <RoadChoice where={baseWhere(d.effWhere0 ?? "")} res={d.roadShown} pick={d.roadPick ?? (d.keepPlace && base?.roadNone ? { none: true } : null)} manual={!!d.roadPick}
              hint={d.keepPlace && (base?.road || base?.roadNone) && !d.roadPick ? false : undefined}
              onPick={d.setRoadPick} onMap={d.pickOnMap} map={d.map} sheets={ex.sheets} />
          ) : (
            <span className="eb-ort-t">
              <span className="eb-und-k">Ort: </span>
              <b className={placeChanged ? "chg" : ""}>{d.placeText || (d.effPos ? "Koordinate" : "fehlt")}</b>
              {(draft.dir !== undefined || draft.dirLabel) && <span> · {draft.dirLabel ?? `Rtg ${compass(draft.dir!)}`}</span>}
              {(draft.from !== undefined || draft.fromLabel) && <span> · {draft.fromLabel ?? `aus ${compass(draft.from!)}`}</span>}
              {draft.roadHint && <span> · {draft.roadHint === "autobahn" ? "auf Autobahn" : "auf Hauptstrasse"}</span>}
              {d.keepPlace && d.textChanged && base?.pos && <span className="eb-vorher"> (bleibt)</span>}
            </span>
          )}
          {placeChanged && <span className="eb-vorher">(vorher {d.oldPlace})</span>}
          {!ortProblem && <button type="button" className="eb-btn eb-ortbtn" onClick={d.pickOnMap} disabled={d.picking}>{d.picking ? "Auf Karte tippen …" : "Ort auf Karte setzen"}</button>}
          {d.experte && (
            <ShapeButton map={d.map} sym={d.choice?.key ?? draft.sym} value={d.shapeDraft} onChange={d.setShapeDraft} color={shapeColor}
              owner={korr && base ? `korr:${base.id}` : "neu"} className="eb-btn" ctx={{ sheets: ex.sheets, areas: ex.areas, event: shapeEvent }} />
          )}
        </div>
      </>}
      <KiMeldungSuggest ex={ex} text={d.text} day={d.day} unklar={meldungUnklar(draft, d.text, !!d.effPos)} onTake={d.takeKi} />
    </div>
  );
}
