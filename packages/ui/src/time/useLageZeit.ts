/**
 * Lagezeit: LIVE (Normalfall) oder RÜCKBLICK(t) – Automat aus Spez. MVP 1, Kap. 3.5, und «Zeige letzte» (R8).
 *
 * Rückkehr nach LIVE:
 *  R1 120 s ohne Bedienung (pointerdown, keydown, wheel, touchstart irgendwo; Mausbewegung zählt nicht),
 *  R2 die letzten 20 s zählt `remaining` sekundengenau herunter (darüber in 10-s-Schritten, damit nicht jede
 *     Bedienung die ganze Seite neu zeichnet),
 *  R3 Eintragen/Korrektur → `goLive("eintragen")` (ruft die Hülle),
 *  R4 Timer ruht beim Abspielen und solange ein `suspend`-Schlüssel an ist (Präsentation, Menü, Dialog);
 *     verborgene Seite zählt als «ohne Bedienung» (beim Zurückkehren nach > 120 s sofort LIVE),
 *  R5 nichts wird gespeichert: Neuladen und Übungswechsel → LIVE und «Zeige letzte: alles»,
 *  R6 gewählte Zeit ≥ LIVE → LIVE,
 *  Taste L (ausserhalb von Eingabefeldern) → LIVE.
 *
 * `LageZeitCtl` ist ohne React (Test mit vitest und Fake-Timern), `useLageZeit` hängt ihn an die Seite.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { localIso, showLastStart, windowStart, type LageEvent } from "@lage/core";
import type { GoLiveGrund, LageZeit, ShowLast, ZeitApi } from "../shell/contracts";

/** so lange ohne Bedienung, dann zurück nach LIVE (R1) */
export const RUECKBLICK_TIMEOUT_S = 120;
/** ab dann steht «zurück zu LIVE in 0:20» im Band (R2) */
export const RUECKBLICK_WARN_S = 20;
/** Übung gilt als vorbei, wenn die letzte Meldung so lange zurückliegt: LIVE = letzte Meldung */
const VORBEI_MS = 12 * 3600000;

const LIVE: LageZeit = { kind: "live" };
/** Bedienung im Sinn von R1 (Mausbewegung zählt nicht) */
export const BEDIENUNG = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

export interface LageZeitCtlOptions {
  /** aktuelle LIVE-Zeit (ISO lokal) */
  tLive: () => string;
  /** Zustand geändert → neu zeichnen */
  onChange: () => void;
  /** Rückkehr nach LIVE (`war` = es war Rückblick) – für die Meldung «Zurück auf LIVE …» */
  onGoLive?: (grund: GoLiveGrund, war: boolean) => void;
  now?: () => number;
  timeoutS?: number;
  warnS?: number;
}

export class LageZeitCtl {
  zeit: LageZeit = LIVE;
  showLast: ShowLast = null;
  ab: string | null = null;
  remaining: number | null = null;
  private lastInput: number;
  private keys = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;
  private readonly timeout: number;
  private readonly warn: number;

  constructor(private o: LageZeitCtlOptions) {
    this.now = o.now ?? (() => Date.now());
    this.timeout = o.timeoutS ?? RUECKBLICK_TIMEOUT_S;
    this.warn = o.warnS ?? RUECKBLICK_WARN_S;
    this.lastInput = this.now();
  }

  /** Lagezeit zurückstellen (R6: ≥ LIVE → LIVE). Abspielen läuft weiter, wenn es schon lief. */
  lookBack = (t: string): void => {
    const t16 = t.slice(0, 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t16)) return;
    if (t16 >= this.o.tLive().slice(0, 16)) { this.goLive("ende"); return; }
    const playing = this.zeit.kind === "rueckblick" && this.zeit.playing;
    if (this.zeit.kind === "rueckblick" && this.zeit.t === t16) { if (!playing) this.touch(); return; }
    this.zeit = { kind: "rueckblick", t: t16, playing };
    if (!playing) this.lastInput = this.now();
    this.sync(true);
  };

  /** Abspielen an/aus (nur im Rückblick; Timer ruht beim Abspielen) */
  setPlaying = (p: boolean): void => {
    if (this.zeit.kind !== "rueckblick" || this.zeit.playing === p) return;
    this.zeit = { ...this.zeit, playing: p };
    this.lastInput = this.now();
    this.sync(true);
  };

  goLive = (grund: GoLiveGrund): void => {
    const war = this.zeit.kind === "rueckblick";
    if (war) {
      this.zeit = LIVE;
      this.sync(true);
    }
    this.o.onGoLive?.(grund, war);
  };

  setShowLast = (s: ShowLast): void => {
    if (this.showLast === s && this.ab === null) return;
    this.showLast = s;
    this.ab = null;
    this.o.onChange();
  };

  setAb = (t: string | null): void => {
    const v = t ? t.slice(0, 16) : null;
    if (this.ab === v && (v === null || this.showLast === null)) return;
    this.ab = v;
    if (v) this.showLast = null;
    this.o.onChange();
  };

  /** R4: Timer ruht, solange ein Schlüssel an ist; danach wieder volle Zeit */
  suspend = (key: string, on: boolean): void => {
    const had = this.keys.has(key);
    if (on === had) return;
    if (on) this.keys.add(key); else { this.keys.delete(key); this.lastInput = this.now(); }
    this.sync(true);
  };

  /** Bedienung irgendwo in der App (R1) */
  touch = (): void => {
    this.lastInput = this.now();
    if (this.zeit.kind === "rueckblick") this.publish();
  };

  /** Seite wieder sichtbar: nach > Zeitablauf sofort LIVE (R4) */
  visible = (): void => { this.tick(); };

  /** Übungswechsel / Neubeginn: LIVE und alles zeigen (R5) */
  reset = (): void => {
    const changed = this.zeit.kind !== "live" || this.showLast !== null || this.ab !== null;
    this.zeit = LIVE;
    this.showLast = null;
    this.ab = null;
    this.sync(false);
    if (changed) this.o.onChange();
  };

  /** Lagezeit (ISO lokal) */
  tNow(): string {
    return this.zeit.kind === "rueckblick" ? this.zeit.t : this.o.tLive().slice(0, 16);
  }

  /** Anfang von «Zeige letzte» bzw. des festen Anfangs (Experte), null = alles */
  from(): string | null {
    const t = this.tNow();
    if (this.showLast) return showLastStart(this.showLast, t);
    return this.ab ? windowStart({ mode: "ab", t: this.ab }, t) : null;
  }

  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Timer läuft? (Rückblick, nicht abspielend, nichts ruht) */
  private active(): boolean {
    return this.zeit.kind === "rueckblick" && !this.zeit.playing && this.keys.size === 0;
  }

  private sync(notify: boolean): void {
    if (this.active()) {
      if (this.timer === undefined) this.timer = setInterval(() => this.tick(), 1000);
    } else this.dispose();
    const r = this.shown();
    const changed = r !== this.remaining;
    this.remaining = r;
    if (notify || changed) this.o.onChange();
  }

  /** angezeigte Restzeit: letzte `warn` s sekundengenau, darüber auf 10 s aufgerundet */
  private shown(): number | null {
    if (!this.active()) return null;
    const rem = this.timeout - (this.now() - this.lastInput) / 1000;
    if (rem <= 0) return 0;
    return rem <= this.warn ? Math.ceil(rem) : Math.min(this.timeout, Math.ceil(rem / 10) * 10);
  }

  private publish(): void {
    const r = this.shown();
    if (r === this.remaining) return;
    this.remaining = r;
    this.o.onChange();
  }

  private tick(): void {
    if (!this.active()) return;
    if (this.now() - this.lastInput >= this.timeout * 1000) { this.goLive("zeitablauf"); return; }
    this.publish();
  }
}

/** Taste L (ohne Ctrl/Alt/⌘, nicht in Eingabefeldern) */
export function isLiveKey(ev: KeyboardEvent): boolean {
  if (ev.ctrlKey || ev.altKey || ev.metaKey || (ev.key !== "l" && ev.key !== "L")) return false;
  const t = ev.target as HTMLElement | null;
  return !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
}

/** Meldungen zur Rückkehr nach LIVE (Kap. 3.5) */
export const GO_LIVE_TEXT: Partial<Record<GoLiveGrund, string>> = {
  zeitablauf: "Zurück auf LIVE (2 min ohne Bedienung)",
  eintragen: "Eingetragen – Ansicht wieder LIVE",
};

/**
 * LIVE-Zeit: jetzt – oder, wenn die Übung vorbei ist (letzte Meldung > 12 h her), die letzte Meldung
 * (wie bisher im Workspace, damit das Beispiel 2030 nicht leer erscheint).
 */
export function liveIso(lastReport: string | null, nowMs: number): string {
  const now = localIso(new Date(nowMs));
  if (!lastReport) return now;
  return nowMs - Date.parse(lastReport) < VORBEI_MS ? (now > lastReport ? now : lastReport.slice(0, 16)) : lastReport.slice(0, 16);
}

/** Zeit der letzten (nicht gelöschten) Meldung oder null */
export function lastReportOf(events: LageEvent[] | undefined): string | null {
  let m = "";
  for (const e of events ?? []) if (!e.deleted && e.t > m) m = e.t;
  return m ? m.slice(0, 16) : null;
}

/** Uhr auf die Minute (springt zu jeder vollen Minute und beim Zurückkehren ins Fenster) */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t: number | undefined;
    const arm = () => { t = window.setTimeout(() => { setNow(Date.now()); arm(); }, 60000 - (Date.now() % 60000) + 50); };
    arm();
    const vis = () => { if (document.visibilityState === "visible") setNow(Date.now()); };
    document.addEventListener("visibilitychange", vis);
    return () => { window.clearTimeout(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
  return now;
}

export interface UseLageZeitOptions {
  /** Übung: Wechsel → LIVE, «Zeige letzte: alles» (R5) */
  exId: string | undefined;
  events: LageEvent[] | undefined;
  /** Meldung für die Rückkehr nach LIVE (Toast der Hülle) */
  say?: (t: string) => void;
}

/**
 * Lagezeit der App (Kap. 3.5). Gibt die `ZeitApi` zurück; die Hülle setzt `data-lagezeit={api.zeit.kind}` an `.app`
 * und ruft `goLive("eintragen")` nach dem Eintragen. Nichts wird gespeichert.
 */
export function useLageZeit({ exId, events, say }: UseLageZeitOptions): ZeitApi & { tLive: string; ab: string | null; setAb(t: string | null): void } {
  const clock = useMinuteClock();
  const last = useMemo(() => lastReportOf(events), [events]);
  const tLive = liveIso(last, clock);
  const tLiveRef = useRef(tLive);
  tLiveRef.current = tLive;
  const sayRef = useRef(say);
  sayRef.current = say;
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const ctl = useMemo(() => new LageZeitCtl({
    tLive: () => tLiveRef.current,
    onChange: bump,
    onGoLive: (g, war) => { const t = GO_LIVE_TEXT[g]; if (war && t) sayRef.current?.(t); },
  }), []);

  // Bedienung irgendwo (R1), Taste L, Sichtbarkeit (R4)
  useEffect(() => {
    const on = () => ctl.touch();
    const key = (ev: KeyboardEvent) => { if (!ev.defaultPrevented && isLiveKey(ev) && ctl.zeit.kind === "rueckblick") ctl.goLive("taste"); };
    const vis = () => { if (document.visibilityState === "visible") ctl.visible(); };
    for (const t of BEDIENUNG) window.addEventListener(t, on, { capture: true, passive: true });
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", vis);
    return () => {
      for (const t of BEDIENUNG) window.removeEventListener(t, on, { capture: true });
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", vis);
      ctl.dispose();
    };
  }, [ctl]);

  // Übungswechsel → LIVE, alles zeigen (R5)
  const prevEx = useRef(exId);
  useEffect(() => {
    if (prevEx.current !== exId) { prevEx.current = exId; ctl.reset(); }
  }, [exId, ctl]);

  return useMemo(() => ({
    zeit: ctl.zeit,
    tNow: ctl.tNow(),
    tLive: tLive.slice(0, 16),
    from: ctl.from(),
    showLast: ctl.showLast,
    setShowLast: ctl.setShowLast,
    ab: ctl.ab,
    setAb: ctl.setAb,
    lookBack: ctl.lookBack,
    setPlaying: ctl.setPlaying,
    goLive: ctl.goLive,
    suspend: ctl.suspend,
    remaining: ctl.remaining,
  }), [version, tLive, ctl]); // eslint-disable-line react-hooks/exhaustive-deps
}
