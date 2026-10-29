/**
 * MVP 3 (Spez. MVP 3, Kap. 2.2): Einordnung wird zur Auswahl «Was ist es?» (`ArtSwitch`, `data-zaehl="art"`);
 * Nicht-Meldungen zeigen «kein Zeichen, nichts auf der Karte», Empfänger/Frist und «Genannt: … (nur Text)», kein
 * Zeichen ▾ und keinen Ort. AEIOU/Meldezettel: Zeile «gelesen als AEIOU: …». Aufheben: «Hebt auf: Nr 31 …» bzw. Wahl
 * bei mehreren Zielen. Tag fremd: Knopf «Als T2 07:26 eintragen». Bezug: «Antwort auf Nr 57».
 *
 * Vorschau unter dem Meldungsfeld (Spez. MVP 1, Kap. 2.4/2.5): Zustandszeile (✓ Bereit / ⚠ Bitte prüfen / ⛔ Geht nicht)
 * mit Ausweg, «Verstanden:» (Zeit, Trupp), «gelesen als» (Funksprache), Zeichen ▾ und Einordnung Feind|Eigene|Unklar,
 * Ort (mit Strassenwahl) und «Ort auf Karte setzen». In der Korrektur: geänderte Werte fett mit «(vorher …)».
 * Experte: «Fläche zeichnen». KI deuten nur bei eingeschalteter KI (KiMeldungSuggest blendet sich sonst aus).
 * Testhaken: `data-zustand` am Block (= EntryState.level, setzt EntryBox sofort, nie nachgezogen).
 */
import { createPortal } from "react-dom";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { artOf, catalogEntry, describeTactical, nrLabel, type Draft, type Kind, type LageEvent } from "@lage/core";
import { iconSvg } from "@lage/map";
import { LAGE_KARTE } from "../colors";
import { useDraftMissing } from "../QualityMarks";
import { RoadChoice, baseWhere } from "../RoadChoice";
import { ShapeButton } from "../ShapeDraw";
import { SymbolPicker, choiceSvg, pickerEntry, type SymbolChoice } from "../SymbolPicker";
import { dayLabel } from "../Timeline";
import { KiMeldungSuggest, meldungUnklar } from "../ki/KiFeatures";
import { ArtSwitch } from "./ArtSwitch";
import { ART_NAME, bezugLabel, dayTitle, felderText, genericWhat, knopfText, missLabel, replaceToken } from "./labels";
import type { EntryDraft } from "./useEntryDraft";

const KIND_WORD: Record<Kind, string> = { feind: "Feind", eigen: "Eigene", unklar: "Unklar" };
const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;
const coarse = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/** ausgeschriebener Sinn zu einer von Hand gewählten Zeichenwahl */
function choiceText(c: SymbolChoice, count?: number): string {
  return describeTactical({ key: c.key, echelon: c.echelon, count: count && count > 0 ? count : undefined }, c.aff === "H" || c.aff === "F" ? c.aff : null)
    || pickerEntry(c.key)?.name || c.key;
}

/** Art in Worten für «Verstanden: …» (Nicht-Meldungen; Kap. 2.2, 4) */
function artVerstanden(d: Draft): string {
  switch (d.art) {
    case "auftrag": return d.an ? `Auftrag an ${d.an}` : "Auftrag – an wen?";
    case "orientierung": return d.quelle ? `Orientierung von ${d.quelle}` : "Orientierung";
    case "rueckfrage": return d.an ? `Rückfrage an ${d.an}` : d.melder ? `Rückfrage von ${d.melder}` : "Rückfrage";
    case "vbk": return `Verbindung ${d.melder || "?"}${d.vbk ? ` · ${d.vbk === "keine" ? "keine – kommt in Offen" : d.vbk}` : ""}`;
    case "notiz": return d.bezugArt === "quittung" ? `Quittung${d.melder ? ` von ${d.melder}` : ""}`
      : d.bezugArt === "antwort" ? (d.an ? `Antwort an ${d.an}` : d.melder ? `Antwort von ${d.melder}` : "Antwort") : "Notiz";
    default: return d.melder ? `${d.melder} meldet` : "";
  }
}

/** Name des aufgehobenen Zeichens mit Ort («Sperre AG13») */
function liftName(e: LageEvent): string {
  return [catalogEntry(e.sym)?.name ?? e.desc ?? "", e.cells?.[0] ?? e.nai ?? e.where ?? ""].filter(Boolean).join(" ");
}

/** «T2 0726» → «T2 07:26» (Vorschlag bei «Tag fremd») */
const tagZeit = (s: string) => s.replace(/(\d{2})(\d{2})$/, "$1:$2");

/**
 * `part`: «kopf» = alles Sichtbare der Vorschau (sofort bei jedem Buchstaben, gleiche Reihenfolge wie Spez. 2.4);
 * «rest» = KI-Vorschlag (EntryBox zeichnet ihn mit `useDeferredValue` nach). Der Block `.eb-prev` mit `data-zustand` gehört EntryBox.
 */
export function PreviewLine({ d, onAddUnit, part }: { d: EntryDraft; onAddUnit(name: string): void; part: "kopf" | "rest" }) {
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
  /** Nicht-Meldung (MVP 3) bzw. MVP-1-Notizvorschlag: kein Zeichen, kein Ort */
  const note = d.nichtLage;
  /** Aufhebung: hebt genau ein Ziel auf – zeichnet selbst nicht */
  const lift = draft.hebtAuf ? (ex.events ?? []).find((e) => e.id === draft.hebtAuf) : undefined;
  const liftKand = !draft.hebtAuf && (draft.hebtAufKandidaten?.length ?? 0) > 1
    ? draft.hebtAufKandidaten!.map((id) => (ex.events ?? []).find((e) => e.id === id)).filter((e): e is LageEvent => !!e) : [];
  const bezugNr = draft.bezug || draft.bezugNr ? bezugLabel(ex, draft.bezug, draft.bezugNr) : null;
  const zeitInhalt = note && draft.art === "orientierung" && !draft.timeFromText && /(?<![\p{L}\d])\d{1,2}[:.]?\d{2}(?![\p{L}\d])/u.test(draft.text);
  const generic = what ? null : genericWhat(d.choice?.key ?? draft.sym, kindNow === "eigen" ? "blau" : "rot", draft.unit || draft.melder);
  const whatText = what ?? generic ?? (pickerEntry(d.choice?.key ?? draft.sym)?.name ?? draft.sym) + (draft.count && draft.count > 1 ? ` ×${draft.count}` : "");
  const kindBefore = korr && base && artOf(base) === "meldung" ? (base.side === "blau" ? "eigen" : base.aff === "U" || base.aff === "N" ? "unklar" : "feind") as Kind : null;
  /** Korrektur einer Nicht-Meldung zur Meldung: «(vorher Notiz)» statt «(vorher Eigene)» */
  const artBefore = korr && base && artOf(base) !== "meldung" ? (artOf(base) === "vbk" ? "Verbindung" : ART_NAME[artOf(base) as Exclude<ReturnType<typeof artOf>, "meldung">]) : null;
  const placeChanged = korr && d.oldPlace !== null && (d.placeText || "ohne Ort") !== d.oldPlace;
  const ortProblem = state.reasons.some((x) => x.problem === "ort" || x.problem === "orte");
  const melderProblems = state.reasons.filter((x) => (x.problem === "melder" || x.code === "trupp-neu") && x.token);
  /** Vorschläge der Erkennung, die in den Text übernommen werden können («meintest du 07:35?», «Schützenpanzer») */
  const offers = state.reasons.flatMap((x) => {
    if (x.code === "zukunft" && x.suggest && x.token) return [{ key: "z", label: `${x.suggest.slice(0, 2)}:${x.suggest.slice(2)} einsetzen`, token: x.token, by: x.suggest }];
    if (x.code === "was" && x.token && draft.unknownWord?.suggestLabel) return [{ key: "w", label: `«${draft.unknownWord.suggestLabel}» einsetzen`, token: x.token, by: draft.unknownWord.suggestLabel }];
    // (MVP 3, E17) heute kein Tag der Übung: Tag und Zeit vorne einsetzen
    if (x.code === "tag-fremd" && x.suggest) return [{ key: "t", label: `Als ${tagZeit(x.suggest)} eintragen`, token: "", by: x.suggest }];
    return [];
  });
  const take = (token: string, by: string) => {
    const cur = d.inputRef.current?.value ?? d.text;
    const next = token ? replaceToken(cur, token, by) : `${by} ${cur.trim()}`;
    if (next === cur) return;
    d.setText(next);
    d.fitInput();
    requestAnimationFrame(() => { const t = d.inputRef.current; if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(next.length, next.length); } });
  };
  const verb = korr ? "speichert die Korrektur" : coarse() ? "Senden-Taste trägt ein" : "Enter trägt ein";
  /** Tablet: Text passend zum Knopf («Trotzdem eintragen» statt «Nochmals Enter») */
  const kt = (s: string) => knopfText(s, { coarse: coarse(), korr });
  const fehlt = note ? [] : missing.filter((m) => m !== "Melder" && m !== "Ort").map(missLabel);
  const shapeColor = kindNow === "eigen" ? LAGE_KARTE.eigen : kindNow === "feind" ? LAGE_KARTE.feind : LAGE_KARTE.unklar;
  const shapeEvent: Pick<LageEvent, "sym" | "pos" | "cells" | "nai" | "where" | "angle" | "dir"> = {
    sym: d.choice?.key ?? draft.sym, pos: d.effPos, cells: draft.cells, nai: draft.nai, where: d.effWhere, angle: d.road?.angle, dir: draft.dir,
  };

  if (part === "kopf") return (
    <>
      <div className={`eb-state s-${lvl}${asked ? " asked" : ""}`}>
        {lvl === "bereit" && <p className="eb-state-h"><span aria-hidden="true">✓ </span>Bereit – {korr ? "Enter speichert die Korrektur" : verb}</p>}
        {lvl === "pruefen" && r0 && (asked
          ? <p className="eb-state-h"><span aria-hidden="true">⚠ </span>{kt(r0.ask ?? "Trotzdem eintragen? Nochmals Enter.")}</p>
          : <>
            <p className="eb-state-h"><span aria-hidden="true">⚠ </span>Bitte prüfen: {r0.text}{more > 0 && <span className="eb-more"> +{more}</span>}</p>
            {r0.hint && <p className="eb-state-t">{kt(r0.hint)}</p>}
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
        {note ? <span className="eb-art-v">{artVerstanden(draft)}</span>
          : draft.melder ? <span>{draft.melder} meldet</span> : <span className="eb-q">Trupp ?</span>}
        {note && draft.art === "auftrag" && draft.frist && <span> · bis {draft.frist.slice(11, 16)}</span>}
        {note && draft.art === "rueckfrage" && draft.artStark && <span> · offen bis Antwort</span>}
        {zeitInhalt && <span> · Zeiten im Text sind Inhalt</span>}
        {bezugNr && <span> · {draft.bezugArt === "quittung" ? "Quittung zu" : draft.bezugArt === "ausgefuehrt" ? "ausgeführt zu" : "Antwort auf"} Nr {bezugNr}</span>}
        {draft.dringend && <span className="eb-dringend"> · dringend</span>}
        {lvl === "geht-nicht" && !note && <span> · {whatText}</span>}
        {fehlt.length > 0 && <span className="eb-fehlt"> · Fehlt noch: {fehlt.join(", ")}</span>}
      </p>
      {draft.felder
        ? <p className="eb-readas eb-felder">{felderText(draft.felder)}</p>
        : draft.normalized && draft.normalized !== draft.text && <p className="eb-readas">gelesen als: <span className="mono">{draft.normalized}</span></p>}
      {lift && (
        <p className="eb-lift"><b>Hebt auf:</b> Nr {nrLabel(lift, ex)} · {dayLabel(lift.t, ex.days)} {lift.t.slice(11, 16)} {liftName(lift)}{lift.melder ? ` (von ${lift.melder})` : ""}
          {" – "}verschwindet ab {draft.t.slice(11, 16)} von der Karte</p>
      )}
      {liftKand.length > 0 && (
        <div className="eb-row eb-liftpick" role="group" aria-label="Welche aufheben?">
          {liftKand.map((e) => (
            <button key={e.id} type="button" className="eb-btn" onClick={() => { d.setLiftPick(e.id); d.inputRef.current?.focus(); }}>Nr {nrLabel(e, ex)} ({e.t.slice(11, 16)})</button>
          ))}
        </div>
      )}
      {lvl === "geht-nicht" && !lift && liftKand.length === 0 && (
        // Ausweg auf eine andere Art bleibt sichtbar («Bat Lagerapport 1800» → Orientierung: Zeiten sind dann Inhalt)
        <div className="eb-row eb-symrow">
          <ArtSwitch art={note ? draft.art : "meldung"} kind={note ? null : kindNow} neutral={d.symOverride?.aff === "N"} onKind={d.setKind} onArt={d.setArt}
            open={d.artMenu} setOpen={d.setArtMenu} onDone={() => d.inputRef.current?.focus()} />
          <span className="eb-note">{note ? "kein Zeichen, nichts auf der Karte" : "keine Meldung? Art hier wählen"}</span>
        </div>
      )}
      {lvl !== "geht-nicht" && note && <>
        <div className="eb-row eb-symrow">
          <ArtSwitch art={draft.art} kind={null} onKind={d.setKind} onArt={d.setArt} open={d.artMenu} setOpen={d.setArtMenu} onDone={() => d.inputRef.current?.focus()} />
          <span className="eb-note">kein Zeichen, nichts auf der Karte</span>
        </div>
        {draft.orte && draft.orte.length > 0 && <p className="eb-genannt">Genannt: {draft.orte.join(", ")} (nur Text)</p>}
      </>}
      {lvl !== "geht-nicht" && !note && !lift && <>
        <div className="eb-row eb-symrow">
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
          <ArtSwitch art="meldung" kind={kindNow} neutral={d.symOverride?.aff === "N"} onKind={d.setKind} onArt={d.setArt}
            open={d.artMenu} setOpen={d.setArtMenu} onDone={() => d.inputRef.current?.focus()} />
          {kindBefore && kindBefore !== kindNow && <span className="eb-vorher">(vorher {KIND_WORD[kindBefore]})</span>}
          {artBefore && <span className="eb-vorher">(vorher {artBefore})</span>}
        </div>
      </>}
      {lvl !== "geht-nicht" && !note && !lift && (
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
      )}
    </>
  );

  return (
    <>
      <KiMeldungSuggest ex={ex} text={d.text} day={d.day} unklar={meldungUnklar(draft, d.text, !!d.effPos)} onTake={d.takeKi} />
    </>
  );
}
