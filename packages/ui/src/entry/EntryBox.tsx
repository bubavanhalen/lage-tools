/**
 * Meldungsfeld (Spez. MVP 1, Kap. 2.1–2.5, 3.2, 3.3): «Wer meldet?» · Feld «Was wurde gemeldet?» mit Hilfe «?» ·
 * Vorschau mit Zustand · Eintragen / Foto / Sprechen. Korrektur im selben Feld (Kopfzeile «✎ Korrektur von T2 07:20 ·
 * H03», Rahmen 2 px Tinte, Enter speichert, Esc bricht ab). Logik in `useEntryDraft`.
 * Vertrag: `EntryBoxProps` (shell/contracts.ts); `onCorrecting` (additiv) meldet die Meldung in Korrektur an die Liste.
 */
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
import { lastMelder, truppOrder, useEntryDraft, wideScreen } from "./useEntryDraft";
import "./entry.css";

/**
 * Vorschau entkoppelt vom Tippen: das Feld zeigt jeden Buchstaben sofort, die Vorschau zeichnet React mit
 * `useDeferredValue` nach (bei vielen Meldungen und langsamem Gerät bleibt das Tippen flüssig). Eintragen liest immer
 * den aktuellen Stand aus `useEntryDraft`, nie die nachgezogene Vorschau.
 */
const PreviewLater = memo(PreviewLine);

/** nächster scrollender Vorfahre (Spalte), sonst null = Dokument */
function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/**
 * Bildschirmtastatur (Tablet/Handy): Knöpfe «Eintragen» und die Vorschau unter dem Feld sichtbar halten. Misst gegen
 * `visualViewport` (die Tastatur verkleinert nur den sichtbaren Teil) und schiebt die Spalte bzw. Seite so weit, dass
 * die Knopfzeile unten sichtbar ist – das Feld selbst bleibt dabei oben im Bild.
 */
function keepVisible(field: HTMLElement | null): void {
  if (!field || document.activeElement !== field) return;
  const btns = field.closest(".ebox")?.querySelector<HTMLElement>(".eb-btns");
  if (!btns) return;
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0, bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const b = btns.getBoundingClientRect(), f = field.getBoundingClientRect();
  const need = b.bottom - bottom + 8;
  if (need <= 0) return;
  const dy = Math.min(need, Math.max(0, f.top - top - 8));
  if (dy <= 0) return;
  const sc = scrollBox(field);
  if (sc) sc.scrollTop += dy; else window.scrollBy(0, dy);
}

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
  const last = useMemo(() => lastMelder(ex), [ex.events, ex.units]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const addRef = useRef<(u: string) => void>(() => {});
  addRef.current = (u: string) => { const n = d.addUnit(u); d.tell(`«${n}» als neuer Trupp aufgenommen.`); d.inputRef.current?.focus(); };
  const addUnit = useCallback((u: string) => addRef.current(u), []);
  const dLater = useDeferredValue(d);

  // Bildschirmtastatur geht auf/zu bzw. Vorschau wächst: Knopfzeile sichtbar halten
  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => keepVisible(d.inputRef.current)); };
    const vv = window.visualViewport;
    vv?.addEventListener("resize", on);
    window.addEventListener("resize", on);
    return () => { vv?.removeEventListener("resize", on); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const raf = requestAnimationFrame(() => keepVisible(d.inputRef.current));
    return () => cancelAnimationFrame(raf);
  }, [dLater.draft, lvl, d.notice]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <TruppChips trupps={trupps} selected={draft?.melder} last={last} onPick={d.chooseTrupp} onAdd={(u) => { const n = d.addUnit(u); if (n) d.chooseTrupp(n); }} />
      <div className="eb-fieldwrap">
        <textarea ref={d.inputRef} className="eb-field" data-meldungsfeld value={d.text} rows={1} autoFocus={wideScreen()}
          placeholder="Was wurde gemeldet?" aria-label="Was wurde gemeldet?" aria-describedby="eb-live" spellCheck={false}
          enterKeyHint={korr ? "done" : "send"} autoCorrect="off" autoCapitalize="off" autoComplete="off"
          onFocus={() => keepVisible(d.inputRef.current)}
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
      <p className="eb-keys" aria-hidden="true">Enter eintragen · Esc leeren · ↑ korrigieren · Ctrl+K suchen · L LIVE</p>
      <span id="eb-live" className="eb-sr" aria-live="polite">{live}</span>
      {info && <p className="eb-info"><span aria-hidden="true">ⓘ </span>{info}</p>}
      <VoiceStatus v={d.voice} />
      {draft ? <PreviewLater d={dLater.draft ? dLater : d} onAddUnit={addUnit} /> : !korr && <p className="eb-hint">Zeit · Trupp · was · wo</p>}
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
      {d.notice && <p className="eb-notice" role="status">{d.notice}</p>}
      {!d.voice.available && !korr && <p className="eb-nomic" id="eb-nomic">Kein Mikrofon gefunden – Tippen und Foto gehen weiter.</p>}
      <JournalUndoBar />
    </section>
  );
}
