/**
 * Bildschirm bleibt an (Spez. MVP 3.5, S5, A3): in «Lage führen» hält `navigator.wakeLock.request("screen")` den
 * Bildschirm an – das LVZ-Tablet geht sonst zwischen zwei Funksprüchen aus. Einstellung pro Gerät
 * `localStorage[WAKE_KEY]` («an»|«aus», fehlt = an), Menü «Bildschirm bleibt an ✓».
 * - Anfordern bei `aktiv && an && document.visibilityState === "visible"`; bei `visibilitychange` → sichtbar neu
 *   anfordern (der Browser gibt beim Verbergen ohnehin frei – wir geben dann auch selbst frei).
 * - Freigeben bei `!aktiv` (Vorbereiten), `!an` (Menü) und Seite verborgen.
 * - Ohne `navigator.wakeLock`: Menü «… – geht in diesem Browser nicht»; Fehler (z. B. Energiesparmodus): kein Toast, Menü
 *   «… – zurzeit nicht möglich».
 * Der Automat (`WachSteuerung`) ist ohne React testbar (Navigator/Dokument werden übergeben).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { WAKE_KEY } from "../shell/contracts";

export { WAKE_KEY };

const lesen = (): boolean => { try { return localStorage.getItem(WAKE_KEY) !== "aus"; } catch { return true; } };

export interface WakeLockApi {
  /** Einstellung des Geräts (Standard an) */
  an: boolean;
  /** Browser kennt `navigator.wakeLock` */
  unterstuetzt: boolean;
  /** Sperre ist jetzt gehalten */
  aktivJetzt: boolean;
  /** letzter Fehler (z. B. Energiesparmodus) – Menü «zurzeit nicht möglich» */
  fehler?: string | null;
  setAn(v: boolean): void;
}

/** Text im Menü hinter «Bildschirm bleibt an» (null = keiner) */
export function wachHinweis(w: Pick<WakeLockApi, "unterstuetzt" | "fehler" | "an">): string | null {
  if (!w.unterstuetzt) return "geht in diesem Browser nicht – automatische Sperre am Gerät ausschalten";
  if (w.an && w.fehler) return "zurzeit nicht möglich";
  return null;
}

interface Sperre { released?: boolean; release(): Promise<void>; addEventListener?(t: "release", f: () => void): void }
interface WakeNav { wakeLock?: { request(t: "screen"): Promise<Sperre> } }
interface WakeDoc { visibilityState: string }

/** Zustand für die Anzeige */
export interface WachZustand { aktivJetzt: boolean; fehler: string | null }

/**
 * Automat: hält genau dann eine Sperre, wenn gewollt (`aktiv && an && sichtbar`). Mehrfaches `sync()` fordert nicht
 * doppelt an; eine Antwort, die erst nach dem Abwählen kommt, wird sofort freigegeben.
 */
export class WachSteuerung {
  private sperre: Sperre | null = null;
  private wartet = false;
  private aktiv = false;
  private an = true;
  zustand: WachZustand = { aktivJetzt: false, fehler: null };
  constructor(private nav: WakeNav, private doc: WakeDoc, private onChange: (z: WachZustand) => void = () => {}) {}

  get unterstuetzt(): boolean { return !!this.nav.wakeLock; }
  private gewollt(): boolean { return this.aktiv && this.an && this.doc.visibilityState === "visible" && this.unterstuetzt; }
  private setZ(z: Partial<WachZustand>): void { this.zustand = { ...this.zustand, ...z }; this.onChange(this.zustand); }

  setze(o: { aktiv: boolean; an: boolean }): void { this.aktiv = o.aktiv; this.an = o.an; this.sync(); }

  /** bei `visibilitychange`: verborgen → freigeben, sichtbar → neu anfordern */
  sichtbarkeit(): void {
    if (this.doc.visibilityState !== "visible") this.freigeben();
    this.sync();
  }

  sync(): void {
    if (!this.gewollt()) { this.freigeben(); return; }
    if (this.sperre && !this.sperre.released) return;
    if (this.wartet) return;
    this.wartet = true;
    let p: Promise<Sperre>;
    try { p = this.nav.wakeLock!.request("screen"); } catch (e) { this.wartet = false; this.setZ({ aktivJetzt: false, fehler: (e as Error)?.message || "zurzeit nicht möglich" }); return; }
    p.then((s) => {
      this.wartet = false;
      if (!this.gewollt()) { void s.release().catch(() => {}); this.sync(); return; }
      this.sperre = s;
      s.addEventListener?.("release", () => { if (this.sperre === s) { this.sperre = null; this.setZ({ aktivJetzt: false }); } });
      this.setZ({ aktivJetzt: true, fehler: null });
    }, (e: unknown) => {
      this.wartet = false;
      this.setZ({ aktivJetzt: false, fehler: (e as Error)?.message || "zurzeit nicht möglich" });
    });
  }

  freigeben(): void {
    const s = this.sperre;
    this.sperre = null;
    if (s && !s.released) void s.release().catch(() => {});
    if (this.zustand.aktivJetzt) this.setZ({ aktivJetzt: false });
  }
}

/** @param aktiv Modus «Lage führen» (Workspace verdrahtet in Phase 0) */
export function useWakeLock(aktiv: boolean): WakeLockApi {
  const [an, setAnState] = useState(lesen);
  const [z, setZ] = useState<WachZustand>({ aktivJetzt: false, fehler: null });
  const st = useRef<WachSteuerung | null>(null);
  if (!st.current && typeof navigator !== "undefined" && typeof document !== "undefined") st.current = new WachSteuerung(navigator as unknown as WakeNav, document, setZ);
  const setAn = useCallback((v: boolean) => {
    try { localStorage.setItem(WAKE_KEY, v ? "an" : "aus"); } catch { /* nur diese Sitzung */ }
    setAnState(v);
  }, []);
  useEffect(() => { st.current?.setze({ aktiv, an }); }, [aktiv, an]);
  useEffect(() => {
    const s = st.current;
    if (!s) return;
    const vis = () => s.sichtbarkeit();
    // anderes Fenster ändert die Einstellung
    const sto = (e: StorageEvent) => { if (e.key === WAKE_KEY) setAnState(lesen()); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("storage", sto);
    return () => { document.removeEventListener("visibilitychange", vis); window.removeEventListener("storage", sto); s.freigeben(); };
  }, []);
  const unterstuetzt = typeof navigator !== "undefined" && "wakeLock" in navigator && !!(navigator as unknown as WakeNav).wakeLock;
  return { an, unterstuetzt, aktivJetzt: z.aktivJetzt, fehler: z.fehler, setAn };
}
