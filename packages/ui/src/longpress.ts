/**
 * Langes Drücken mit Finger oder Stift (Pointer Events), robust für Tablets:
 * - löst nach `delay` ms ohne Bewegung aus,
 * - bricht ab bei Bewegung > `tolerance` px, zweitem Finger (Pinch), Loslassen oder pointercancel,
 * - schluckt danach den folgenden Klick und das native `contextmenu` (keine Doppelöffnung).
 * Gemeinsames Gerüst für das Kontextmenü der Karte und das Anheben eines Zeichens zum Verschieben.
 */

export interface PressInfo {
  x: number;
  y: number;
  pointerId: number;
  pointerType: string;
  target: EventTarget | null;
}

export interface LongPressOptions {
  /** Wartezeit bis zum Auslösen (ms) */
  delay: number;
  /** erlaubte Bewegung bis zum Auslösen (px, Standard 8) */
  tolerance?: number;
  /** nur diese Zeiger berücksichtigen (Standard: Touch und Stift, keine Maus) */
  accept?: (e: PointerEvent) => boolean;
  /** ausgelöst; Rückgabe false = nichts schlucken (z. B. wenn nichts geöffnet wurde) */
  onPress: (p: PressInfo) => boolean | void;
  /** Geste begonnen (Finger unten, Timer läuft) */
  onStart?: (p: PressInfo) => void;
  /** Geste ohne Auslösen beendet */
  onCancel?: (why: "move" | "multi" | "up" | "cancel") => void;
}

// ---------- gemeinsames Schlucken von Klick und nativem Kontextmenü nach einem langen Drücken
let ctxUntil = 0;
let clickUntil = 0;
/** natives/Leaflet-Kontextmenü für `ms` unterdrücken (z. B. nach dem Anheben eines Zeichens) */
export function suppressContextMenu(ms = 900): void { ctxUntil = Math.max(ctxUntil, Date.now() + ms); }
export const contextMenuSuppressed = (): boolean => Date.now() < ctxUntil;
/** den nächsten Klick (innert `ms`) schlucken */
export function suppressClick(ms = 450): void { clickUntil = Math.max(clickUntil, Date.now() + ms); }
export const clickSuppressed = (): boolean => Date.now() < clickUntil;
let installed = false;
function installGlobal() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("click", (e) => {
    if (clickSuppressed()) { clickUntil = 0; e.stopPropagation(); e.preventDefault(); }
  }, true);
  document.addEventListener("contextmenu", (e) => {
    if (contextMenuSuppressed()) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

const touchish = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";

/** Langes Drücken an `el` beobachten. Gibt eine Abmeldefunktion zurück. */
export function longPress(el: HTMLElement, o: LongPressOptions): () => void {
  installGlobal();
  const tol = o.tolerance ?? 8;
  const accept = o.accept ?? touchish;
  const down = new Set<number>();
  let timer = 0;
  let start: PressInfo | null = null;
  const stop = (why: "move" | "multi" | "up" | "cancel" | null) => {
    window.clearTimeout(timer);
    timer = 0;
    if (start && why) o.onCancel?.(why);
    start = null;
  };
  // Finger zählen am ganzen Dokument: der zweite Finger eines Pinch landet oft ausserhalb von `el`
  const onAnyDown = (e: PointerEvent) => {
    if (e.isPrimary) down.clear(); // erster Finger einer neuen Berührung: verlorene «pointerup» nicht mitzählen
    down.add(e.pointerId);
    if (down.size > 1) stop("multi");
  };
  const onDown = (e: PointerEvent) => {
    if (down.size > 1 || !accept(e) || (e.pointerType === "mouse" && e.button !== 0)) return;
    start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType, target: e.target };
    o.onStart?.(start);
    timer = window.setTimeout(() => {
      const p = start;
      start = null;
      timer = 0;
      if (!p) return;
      if (o.onPress(p) !== false) {
        suppressContextMenu();
        suppressClick();
        navigator.vibrate?.(15);
      }
    }, o.delay);
  };
  const onMove = (e: PointerEvent) => {
    if (start && e.pointerId === start.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) > tol) stop("move");
  };
  const onUp = (e: PointerEvent) => {
    down.delete(e.pointerId);
    if (start && e.pointerId === start.pointerId) stop(e.type === "pointercancel" ? "cancel" : "up");
  };
  // mehrere Finger auch über Touch-Ereignisse erkennen (manche Browser melden den 2. Zeiger verspätet)
  const onTouch = (e: TouchEvent) => { if (e.touches.length > 1) stop("multi"); };
  document.addEventListener("pointerdown", onAnyDown, true);
  el.addEventListener("pointerdown", onDown);
  // Bewegung und Loslassen am Dokument (Zeiger kann das Element verlassen, Element kann neu gezeichnet werden)
  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
  document.addEventListener("touchstart", onTouch, { passive: true, capture: true });
  return () => {
    stop(null);
    document.removeEventListener("pointerdown", onAnyDown, true);
    el.removeEventListener("pointerdown", onDown);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    document.removeEventListener("touchstart", onTouch, { capture: true });
  };
}
