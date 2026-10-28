/**
 * Meldungsfeld (Spez. MVP 1, Kap. 2.1–2.5, 3.2, 3.3): «Wer meldet?» · Feld «Was wurde gemeldet?» mit Hilfe «?» ·
 * Vorschau mit Zustand · Eintragen / Foto / Sprechen. Korrektur im selben Feld (Kopfzeile «✎ Korrektur von T2 07:20 ·
 * H03», Rahmen 2 px Tinte, Enter speichert, Esc bricht ab). Logik in `useEntryDraft`.
 * Vertrag: `EntryBoxProps` (shell/contracts.ts); `onCorrecting` (additiv) meldet die Meldung in Korrektur an die Liste.
 */
import { useEffect, useRef, useState } from "react";
import { formatLv95 } from "@lage/core";
import { EditConflict } from "../EditConflict";
import { PhotoButton, PendingAttachment } from "../PhotoInput";
import { VoiceButton, VoiceStatus } from "../VoiceInput";
import { addEvents } from "../commit";
import { dayLabel } from "../Timeline";
import { JournalUndoBar } from "../journal/journalUndo";
import { rueckblickInfo } from "../time/RueckblickBanner";
import type { EntryBoxProps } from "../shell/contracts";
import { HelpPopover } from "./HelpPopover";
import { PreviewLine } from "./PreviewLine";
import { TruppChips } from "./TruppChips";
import { truppOrder, useEntryDraft, wideScreen } from "./useEntryDraft";
import "./entry.css";

/** Zustandszeile verzögert ansagen (500 ms), bei erneutem Enter nochmals */
function useLiveText(text: string, bump: number): string {
  const [live, setLive] = useState("");
  useEffect(() => {
    setLive("");
    const t = window.setTimeout(() => setLive(text), 500);
    return () => window.clearTimeout(t);
  }, [text, bump]);
  return live;
}

export function EntryBox(props: EntryBoxProps & { onCorrecting?: (id: string | null) => void }) {
  const d = useEntryDraft(props);
  const { ex, draft, state, mode, base } = d;
  const [help, setHelp] = useState(false);
  const helpBtn = useRef<HTMLButtonElement>(null);
  const korr = mode.art === "korrektur";
  const trupps = truppOrder(ex);

  // Taste «N» (ausserhalb von Eingabefeldern): zurück ins Meldungsfeld
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if ((ev.key === "n" || ev.key === "N") && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { ev.preventDefault(); d.inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lvl = state?.level ?? null;
  const asked = lvl === "pruefen" && d.armed === d.text;
  const stateText = !state ? "" : lvl === "bereit" ? "Bereit" : asked ? state.reasons[0]?.ask ?? "" : `${lvl === "pruefen" ? "Bitte prüfen" : "Geht nicht"}: ${state.reasons[0]?.text ?? ""}`;
  const live = useLiveText(stateText, d.announce);
  const info = rueckblickInfo(props.zeit);
  const blocked = lvl === "geht-nicht";
  const mainLabel = korr ? "Korrektur speichern" : asked ? "Trotzdem eintragen" : "Eintragen";
  const addUnit = (u: string) => { d.addUnit(u); props.say(`«${u}» als neuer Trupp aufgenommen.`); d.inputRef.current?.focus(); };

  return (
    <section className={"ebox entry" + (korr ? " is-korr" : "") + (props.experte ? " is-experte" : "")} aria-label="Meldung eintragen">
      {korr && base && (
        <div className="eb-korr">
          <span className="eb-korr-t"><span aria-hidden="true">✎ </span>Korrektur von {dayLabel(base.t, ex.days)} {base.t.slice(11, 16)}{base.melder ? ` · ${base.melder}` : ""}</span>
          <button type="button" className="eb-btn" onClick={() => d.endKorr()}>Abbrechen (Esc)</button>
        </div>
      )}
      {korr && <EditConflict kind={d.conflict} nudge={d.nudge} onForce={() => d.submit(true)} onDiscard={() => d.endKorr()} />}
      <p className="eb-label" id="eb-wer">Wer meldet?</p>
      <TruppChips trupps={trupps} selected={draft?.melder} onPick={d.chooseTrupp} onAdd={(u) => { d.addUnit(u); d.chooseTrupp(u); }} />
      <div className="eb-fieldwrap">
        <textarea ref={d.inputRef} className="eb-field" data-meldungsfeld value={d.text} rows={1} autoFocus={wideScreen()}
          placeholder="Was wurde gemeldet?" aria-label="Was wurde gemeldet?" aria-describedby="eb-live" spellCheck={false}
          aria-invalid={blocked || undefined}
          onInput={() => d.fitInput()}
          onChange={(e) => d.setText(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); d.submit(); }
            else if (e.key === "Escape") { e.preventDefault(); if (help) setHelp(false); else d.escape(); }
            else if (e.key === "ArrowUp" && !d.text && !korr) { if (d.correctLast()) e.preventDefault(); }
          }} />
        <button ref={helpBtn} type="button" className="eb-helpbtn" aria-label="Hilfe und Beispiele" aria-expanded={help} onClick={() => setHelp(!help)}>?</button>
        {help && <HelpPopover anchor={helpBtn.current} hasRaster={ex.sheets.length > 0}
        onClose={() => { setHelp(false); d.inputRef.current?.focus(); }}
        onPick={(t) => { setHelp(false); d.setText(t); d.fitInput(); requestAnimationFrame(() => { const x = d.inputRef.current; if (x) { x.focus(); x.setSelectionRange(t.length, t.length); } }); }} />}
      </div>
      <p className="eb-keys" aria-hidden="true">Enter eintragen · Esc leeren · ↑ letzte korrigieren · Ctrl+K suchen · L LIVE</p>
      <span id="eb-live" className="eb-sr" aria-live="polite">{live}</span>
      {info && <p className="eb-info"><span aria-hidden="true">ⓘ </span>{info}</p>}
      <VoiceStatus v={d.voice} />
      {draft ? <PreviewLine d={d} onAddUnit={addUnit} /> : !korr && <p className="eb-hint">Zeit · Trupp · was · wo</p>}
      <div className="eb-btns">
        <button type="button" className={"eb-btn primary eb-main" + (blocked ? " blocked" : "")} aria-disabled={blocked || undefined}
          onClick={() => d.submit()}>
          <span className="eb-main-l">{mainLabel}</span><span className="eb-kbd" aria-hidden="true"> ⏎</span>
        </button>
        {!korr && (
          <PhotoButton ex={ex} day={d.day} say={props.say} onAttach={(a) => { d.setPendingAtt(a); d.inputRef.current?.focus(); }}
            onCell={(a) => props.update((x) => addEvents(x, [], { attachments: [a] }))}
            onCommit={d.commitBatch} />
        )}
        {!korr && (d.voice.available ? <VoiceButton v={d.voice} /> : <button type="button" className="eb-btn" aria-disabled="true" aria-describedby="eb-nomic">Sprechen</button>)}
        {d.pendingAtt && !korr && <PendingAttachment att={d.pendingAtt} onRemove={d.removePending} />}
        {d.manualPos && <span className="eb-coord mono">{formatLv95(d.manualPos)}</span>}
      </div>
      {blocked && <p className="eb-blocked">geht nicht – siehe oben</p>}
      {!d.voice.available && !korr && <p className="eb-nomic" id="eb-nomic">Kein Mikrofon gefunden – Tippen und Foto gehen weiter.</p>}
      <JournalUndoBar />
    </section>
  );
}
