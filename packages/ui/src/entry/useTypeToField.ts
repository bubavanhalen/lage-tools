/**
 * Tippen springt ins Meldungsfeld (Spez. MVP 3.5, E2, S21): Ein druckbares Zeichen (ausser Leerschlag) ausserhalb eines
 * Eingabefelds – Fokus in der Liste, auf der Karte, auf einem Knopf oder nirgends – landet am Ende des Meldungsfelds,
 * der Fokus folgt. «Tippen geht nie verloren» geht vor Einzeltasten-Kürzeln (L/U sind neu Alt+L/Alt+U, «/» entfällt).
 *
 * Ausnahmen: Ctrl/⌘/Alt gedrückt, Leerschlag (Knöpfe), Ziel ist ein Eingabefeld (`input/textarea/select/
 * [contenteditable]`), ein Dialog, Menü oder eine Auswahlliste ist offen, Modus nicht «Lage führen», Komposition (IME).
 * Läuft in der Fang-Phase am `window` und stoppt die Weitergabe: die Leaflet-Tastatur der Karte zoomt dann nicht.
 * Der Text kommt über das `input`-Ereignis des Felds (wie Tippen): Vorschau und Entwurf folgen.
 */
import { useEffect, useRef } from "react";

/** offene Ebenen, in denen Tasten bleiben (Dialog, Menü, Auswahlliste, Zeichenwahl) */
export const OFFEN_SELEKTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .sympop';

export interface TasteInfo {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
}

/** Ziel ist ein Eingabefeld (dort tippt man schon) */
export function istEingabe(t: EventTarget | null | undefined): boolean {
  const el = t as HTMLElement | null | undefined;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/**
 * Soll diese Taste ins Meldungsfeld umgeleitet werden? (ohne DOM-Abfragen testbar: `offen` = Dialog/Menü/Liste offen,
 * `aktiv` = Modus «Lage führen», kein Dialog der Hülle, keine Präsentation)
 */
export function umleiten(ev: TasteInfo, o: { aktiv: boolean; offen: boolean }): boolean {
  if (!o.aktiv || o.offen) return false;
  if (ev.defaultPrevented || ev.isComposing) return false;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  if (ev.key.length !== 1 || ev.key === " ") return false;
  return !istEingabe(ev.target);
}

/** Zeichen am Ende des Felds einfügen wie getippt (React sieht ein `input`-Ereignis) und Fokus ins Feld */
export function anhaengen(field: HTMLTextAreaElement | HTMLInputElement, zeichen: string): void {
  const next = field.value + zeichen;
  const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
  field.focus({ preventScroll: true });
  if (set) set.call(field, next); else field.value = next;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  try { field.setSelectionRange(next.length, next.length); } catch { /* egal */ }
  field.scrollIntoView?.({ block: "nearest" });
}

/** Meldungsfeld der Seite */
export const meldungsfeld = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>("textarea[data-meldungsfeld]");

/** `aktiv`: Modus «Lage führen», kein Dialog der Hülle offen, keine Präsentation */
export function useTypeToField(aktiv: boolean, feld: () => HTMLTextAreaElement | HTMLInputElement | null = meldungsfeld): void {
  const on = useRef(aktiv);
  on.current = aktiv;
  const get = useRef(feld);
  get.current = feld;
  useEffect(() => {
    const key = (ev: KeyboardEvent) => {
      if (!umleiten(ev, { aktiv: on.current, offen: !!document.querySelector(OFFEN_SELEKTOR) })) return;
      const f = get.current();
      if (!f || f.disabled || f.readOnly) return;
      ev.preventDefault();
      ev.stopPropagation();
      anhaengen(f, ev.key);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
}
