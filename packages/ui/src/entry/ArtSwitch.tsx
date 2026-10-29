/**
 * Auswahl «Was ist es?» in der Vorschau (Spez. MVP 3, Entscheid E1, Kap. 2.2): `[◆ Feind][● Eigene][■ Unklar][✎ Andere ▾]`.
 * Feind/Eigene/Unklar = Meldung (zeichnet). «Andere ▾» öffnet ein Menü Auftrag · Orientierung · Rückfrage ·
 * Verbindungskontrolle · Notiz; ist eine Nicht-Meldung gewählt, steht ihr Name im vierten Segment («✎ Auftrag ▾»,
 * gedrückt). Eine Gruppe (`data-zaehl="art"`, zählt im Inventar als 1). Menü: Einträge ≥ 44 px, Esc schliesst und gibt
 * den Fokus zurück, ↑/↓ wählen, Anfangsbuchstabe (A, O, R, V, N) wählt direkt. Tastatur im Feld: Alt+1/2/3/4 (EntryBox).
 */
import { useEffect, useRef } from "react";
import type { EntryArt, Kind } from "@lage/core";
import { ART_NAME } from "./labels";

export type NichtMeldung = Exclude<EntryArt, "meldung">;

const KINDS: Array<[Kind, string, string]> = [["feind", "Feind", "◆"], ["eigen", "Eigene", "●"], ["unklar", "Unklar", "■"]];

/** Menü «Andere»: Art, Zeichen, Erklärung, Taste */
export const ANDERE: Array<[NichtMeldung, string, string, string]> = [
  ["auftrag", "✎", "an Trupp", "a"],
  ["orientierung", "✎", "von oben (Bat, Kp)", "o"],
  ["rueckfrage", "✎", "Frage, Antwort offen", "r"],
  ["vbk", "⇄", "Vbk", "v"],
  ["notiz", "✎", "ohne Wirkung", "n"],
];

/** kurzer Name im Segment (Platz Tablet 384 px) */
const SEG_NAME: Record<NichtMeldung, string> = { auftrag: "Auftrag", orientierung: "Orientierung", rueckfrage: "Rückfrage", vbk: "Verbindung", notiz: "Notiz" };

export function ArtSwitch({ art, kind, neutral, onKind, onArt, open, setOpen, onDone }: {
  /** wirksame Art (Meldung = eines von Feind/Eigene/Unklar gedrückt) */
  art: EntryArt;
  /** wirksame Einordnung einer Meldung */
  kind: Kind | null;
  /** «Unklar» heisst «Neutral» (Zeichen von Hand neutral gewählt) */
  neutral?: boolean;
  onKind(k: Kind): void;
  onArt(a: NichtMeldung): void;
  /** Menü «Andere» offen (Zustand im Meldungsfeld, damit Alt+4 es öffnen kann) */
  open: boolean;
  setOpen(o: boolean): void;
  /** nach einer Wahl: Fokus zurück ins Meldungsfeld */
  onDone(): void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const other = art !== "meldung";

  useEffect(() => {
    if (!open) return;
    const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [])];
    const cur = items().find((b) => b.getAttribute("aria-checked") === "true") ?? items()[0];
    cur?.focus();
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open, setOpen]);

  const choose = (a: NichtMeldung) => { onArt(a); setOpen(false); onDone(); };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    const hit = ANDERE.find((x) => x[3] === e.key.toLowerCase());
    if (hit && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); choose(hit[0]); }
  };

  return (
    <span className="eb-artwrap">
      <span className="eb-seg eb-art" role="group" aria-label="Was ist es?" data-zaehl="art">
        {KINDS.map(([k, l, f]) => (
          <button key={k} type="button" className={`k-${k}`} aria-pressed={!other && kind === k} onClick={() => { onKind(k); onDone(); }}>
            <span aria-hidden="true">{f} </span>{k === "unklar" && neutral ? "Neutral" : l}
          </button>
        ))}
        <button ref={btn} type="button" className={"k-andere" + (other ? " is-art" : "")} aria-pressed={other} aria-haspopup="menu" aria-expanded={open}
          aria-label={other ? `${ART_NAME[art as NichtMeldung]} – andere Art wählen` : "Andere: Auftrag, Orientierung, Rückfrage, Verbindung, Notiz"}
          onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{art === "vbk" ? "⇄" : "✎"} </span>{other ? SEG_NAME[art as NichtMeldung] : "Andere"} <span aria-hidden="true">▾</span>
        </button>
      </span>
      {open && (
        <div ref={menu} className="eb-artmenu" role="menu" aria-label="Andere Art" onKeyDown={onMenuKey}>
          {ANDERE.map(([a, f, w]) => (
            <button key={a} type="button" role="menuitemradio" aria-checked={art === a} onClick={() => choose(a)}>
              <span className="eb-am-f" aria-hidden="true">{f}</span>
              <span className="eb-am-n">{ART_NAME[a]}</span>
              <span className="eb-am-w">{w}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
