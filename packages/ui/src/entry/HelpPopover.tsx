/**
 * Hilfe «?» im Meldungsfeld (Spez. MVP 1, Kap. 3.2/4.4; MVP 3, Kap. 4): Popover unter dem Feld, Beispiele als Knöpfe – antippen
 * setzt den Text ins Feld (trägt nicht ein). Esc/Klick daneben schliesst, Fokus zurück ins Feld.
 * Beispiele fiktiv, passend zum Beispiel Bern.
 */
import { useEffect, useRef } from "react";

export const HILFE_BEISPIELE: Array<[string, string]> = [
  ["H04 2 Fz in AK7 Rtg N", "Fahrzeuge gesehen"],
  ["1015 H02 Beo Stao bezogen AJ9", "eigener Trupp"],
  ["H03 3 Pers unklar bei NAI 2", "unklar"],
  ["H01 Sperre AF13 auf Hauptstrasse", "Sperre auf der Strasse"],
  ["H05 Kontakt mit Gegner AP11", "Kontakt"],
  ["H03 A: 1020 E: 3 Pers I: Rtg W O: AF8 C", "Meldung im AEIOU-Schema"],
];

/** je ein Beispiel pro andere Art (Prüfung Übergabe M6) – zeichnen nie, nichts auf der Karte */
export const HILFE_ANDERE: Array<[string, string]> = [
  ["Auftrag an H01: Beo NAI 1 bis 1200", "Auftrag – offen bis erledigt"],
  ["Bat: Lagerapport 1800 im KP", "Orientierung von oben (Bat, Kp)"],
  ["H04 Rückfrage: Standort Det 2?", "Rückfrage – offen bis Antwort"],
  ["Antwort zu 12: weiter beobachten", "Antwort auf Nr 12 (Notiz)"],
  ["H02 Vbk gut", "Verbindungskontrolle"],
  ["H01 quittiert Auftrag", "Quittung"],
];

export function HelpPopover({ onPick, onClose, anchor, hasRaster }: {
  onPick(text: string): void;
  onClose(): void;
  /** Knopf «?» (Klick darauf schliesst nicht doppelt) */
  anchor: HTMLElement | null;
  hasRaster: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !anchor?.contains(t)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }, [anchor, onClose]);
  return (
    <div ref={ref} className="eb-help" role="dialog" aria-label="Beispiele">
      <p className="eb-help-h">Beispiele – antippen setzt den Text ins Feld</p>
      <p className="eb-help-g">Meldungen (Zeichen auf der Karte)</p>
      <ul>
        {HILFE_BEISPIELE.map(([t, w]) => (
          <li key={t}><button type="button" onClick={() => onPick(t)}><span className="mono">{t}</span><span className="eb-help-w">{w}</span></button></li>
        ))}
      </ul>
      <p className="eb-help-g">Andere Arten (kein Zeichen) – sonst «Was ist es?» → «Andere»</p>
      <ul>
        {HILFE_ANDERE.map(([t, w]) => (
          <li key={t}><button type="button" onClick={() => onPick(t)}><span className="mono">{t}</span><span className="eb-help-w">{w}</span></button></li>
        ))}
      </ul>
      <p>Reihenfolge egal. Ohne Zeit gilt jetzt. Korrigieren: Zeile wählen → Korrigieren oder ↑.</p>
      <p className="eb-help-f">«T2» = Übungstag 2 (Datum beim Zeigen auf die Zeit). Neu in deiner Schicht: seit deinem Kürzel bzw. der letzten Übergabe. «62 min» an einem Trupp = so lange keine Meldung. {hasRaster ? "" : "Planquadrate gehen erst mit Führungsraster (Vorbereiten)."}</p>
    </div>
  );
}
