/**
 * Einfacher Dialog der Hülle (Übung wechseln, Hilfe, Über, Spracherkennung): über allem, Esc oder Klick daneben
 * schliesst, Fokus kommt beim Schliessen dorthin zurück, wo er vorher war. `onOpenChange` lässt den Rückblick-Timer
 * ruhen (R4).
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./shell.css";

export function Dialog({ title, onClose, children, wide, schliessen = true }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; /** Knopf «Schliessen» im Kopf (false: der Dialog hat selbst genau ein «Abbrechen») */ schliessen?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const back = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>("[autofocus], input, button:not(.dlg-x), [href], [tabindex]:not([tabindex='-1'])");
    (first ?? box.current)?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeRef.current(); } };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); back.current?.focus?.(); };
  }, []);
  return createPortal(
    <div className="dlg-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={"dlg" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <div className="dlg-h">
          <h2 id={id}>{title}</h2>
          {schliessen && <button type="button" className="dlg-x" onClick={onClose}>Schliessen</button>}
        </div>
        <div className="dlg-b">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
