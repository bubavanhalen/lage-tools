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
 *  R5 nichts wird gespeichert: Neuladen und Übungswechsel → LIVE und Standard «Zeige letzte» (alles; MVP 3: ab
 *     200 Meldungen 6 h, Spez. MVP 3 Kap. 3.12/E16 – der Chip «zeigt nur letzte 6 h ✕» macht es sichtbar),
 *  R6 gewählte Zeit ≥ LIVE → LIVE,
 *  Alt+L → LIVE (MVP 3.5, E2: die Einzeltaste L ist Text – Tippen springt ins Meldungsfeld).
 *
 * `LageZeitCtl` ist ohne React (Test mit vitest und Fake-Timern), `useLageZeit` hängt ihn an die Seite.
 */
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { jetztLagezeit, mitOffset, offsetOf, showLastStart, windowStart, zaehleMeldungen, zeitBis, zeitCmp, zeitMs, zeitTeile, type LageEvent } from "@lage/core";
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
  /** genauer Ablauf (R1): unabhängig vom Sekundentakt, damit die Rückkehr nach exakt `timeout` s erfolgt */
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => number;
  private readonly timeout: number;
  private readonly warn: number;

  constructor(private o: LageZeitCtlOptions) {
    this.now = o.now ?? (() => Date.now());
    this.timeout = o.timeoutS ?? RUECKBLICK_TIMEOUT_S;
    this.warn = o.warnS ?? RUECKBLICK_WARN_S;
    this.lastInput = this.now();
  }

  /**
   * Lagezeit zurückstellen (R6: ≥ LIVE → LIVE). Abspielen läuft weiter, wenn es schon lief. MVP 3.5 (S23): `t` mit oder
   * ohne Offset; gespeichert wird die Lagezeit **mit** Offset (fehlt er, abgeleitet – doppelte Stunde: Sommerzeit, die
   * Rückblick-Leiste fragt dort vorher «02:30 MESZ / 02:30 MEZ»).
   */
  lookBack = (t: string): void => {
    const t16 = t.slice(0, 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t16)) return;
    const z = mitOffset(t16, zeitTeile(t).off ?? offsetOf({ t: t16 }));
    if (zeitBis(this.o.tLive(), z)) { this.goLive("ende"); return; }
    const playing = this.zeit.kind === "rueckblick" && this.zeit.playing;
    if (this.zeit.kind === "rueckblick" && this.zeit.t === z) { if (!playing) this.touch(); return; }
    this.zeit = { kind: "rueckblick", t: z, playing };
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
    if (this.zeit.kind === "rueckblick") { this.arm(); this.publish(); }
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

  /** Lagezeit mit Offset (MVP 3.5, S23: «2030-10-27T02:10+01:00»); `slice(0, 16)` = ISO lokal für die Anzeige */
  tNow(): string {
    return this.zeit.kind === "rueckblick" ? this.zeit.t : this.o.tLive();
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
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    this.deadline = undefined;
  }

  /** Ablauf genau auf `lastInput + timeout` stellen (nur wenn der Timer läuft) */
  private arm(): void {
    if (this.deadline !== undefined) clearTimeout(this.deadline);
    this.deadline = undefined;
    if (!this.active()) return;
    const ms = Math.max(0, this.timeout * 1000 - (this.now() - this.lastInput));
    this.deadline = setTimeout(() => { this.deadline = undefined; this.tick(); }, ms);
  }

  /** Timer läuft? (Rückblick, nicht abspielend, nichts ruht) */
  private active(): boolean {
    return this.zeit.kind === "rueckblick" && !this.zeit.playing && this.keys.size === 0;
  }

  private sync(notify: boolean): void {
    if (this.active()) {
      if (this.timer === undefined) this.timer = setInterval(() => this.tick(), 1000);
      this.arm();
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

/** ab so vielen Meldungen (Art Meldung, nicht gestrichen) gilt beim Laden «Zeige letzte 6 h» (Spez. MVP 3, E16) */
export const LANG_AB = 200;
/** Standard «Zeige letzte» beim Laden/Übungswechsel: alles, ab 200 Meldungen 6 h */
export function showLastStandard(events: LageEvent[] | undefined): ShowLast {
  return zaehleMeldungen({ events }) >= LANG_AB ? 360 : null;
}

/**
 * Alt+L (MVP 3.5, E2): Prüfung über `code` («KeyL»), weil macOS mit Option ein Sonderzeichen liefert («¬»); gilt auch
 * im Meldungsfeld (Alt ist dort keine Eingabe), ohne Ctrl/⌘.
 */
export function isLiveKey(ev: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "code">): boolean {
  return ev.altKey && !ev.ctrlKey && !ev.metaKey && ev.code === "KeyL";
}

/** Meldungen zur Rückkehr nach LIVE (Kap. 3.5) */
export const GO_LIVE_TEXT: Partial<Record<GoLiveGrund, string>> = {
  zeitablauf: "Zurück auf LIVE (2 min ohne Bedienung)",
  eintragen: "Eingetragen – Ansicht wieder LIVE",
};

/** so weit darf eine Meldung in der Zukunft liegen (Uhren der Geräte gehen verschieden), ohne dass sie «geht nicht» ist */
export const ZUKUNFT_MS = 10 * 60000;

/**
 * LIVE-Zeit der **Lage** (Entscheid MVP 1-Nachbesserung, K1; MVP 3.5 S22/S23 mit Offset): solange die Übung läuft
 * (Bezugsmeldung ≤ 12 h vor jetzt), gilt die **Geräteuhr** – eine Meldung höchstens 10 min in der Zukunft (Uhren gehen
 * verschieden) zieht die Lage bis dorthin mit (Anzeige bleibt die Uhr, `liveAnzeige`). Eine Meldung weiter in der
 * Zukunft (Tippfehler «1535» statt «0735») verschiebt LIVE nie. Sonst – Übung vorbei (> 12 h her) oder ganz in der
 * Zukunft (Beispiel 2030) – LIVE = Bezugsmeldung, damit das Lagebild nicht leer erscheint. `ref` = Bezugsmeldung als
 * Lagezeit (mit oder ohne Offset), siehe `liveRefOf`. Ergebnis immer mit Offset.
 */
export function liveIso(ref: string | null, nowMs: number): string {
  const now = jetztLagezeit(new Date(nowMs));
  if (!ref) return now;
  const r = zeitMs(ref);
  const d = Math.floor(nowMs / 60000) * 60000 - r;
  if (!Number.isFinite(d)) return now;
  const refZ = zeitTeile(ref).off ? ref : mitOffset(ref, offsetOf({ t: ref }));
  if (d > VORBEI_MS) return refZ; // Übung vorbei
  if (d >= -ZUKUNFT_MS) return d >= 0 ? now : refZ; // läuft (höchstens 10 min Vorsprung)
  return d >= -VORBEI_MS ? now : refZ; // läuft, Meldung mit Zeit weit in der Zukunft → Geräteuhr; Übung ganz in der Zukunft → Meldung
}

/**
 * Bezugsmeldung für LIVE: die späteste (nicht gelöschte) Meldung bis höchstens 10 min nach jetzt; liegen alle weiter
 * in der Zukunft (Beispiel 2030), die späteste überhaupt. Lagezeit mit Offset (Zeitvergleiche über `zeitCmp`); null =
 * keine Meldung.
 */
export function liveRefOf(events: LageEvent[] | undefined, nowMs: number): string | null {
  const lim = jetztLagezeit(new Date(nowMs + ZUKUNFT_MS));
  let past: LageEvent | null = null, any: LageEvent | null = null;
  for (const e of events ?? []) {
    if (e.deleted) continue;
    if (!any || zeitCmp(e, any) > 0) any = e;
    if (zeitBis(e, lim) && (!past || zeitCmp(e, past) > 0)) past = e;
  }
  const r = past ?? any;
  return r ? mitOffset(r.t.slice(0, 16), offsetOf(r)) : null;
}

/**
 * Anzeige «LIVE 07:31» (MVP 3.5, S22): immer die Geräteuhr, solange die Lage der Uhr folgt (Meldungen bis 10 min
 * voraus ziehen nur die Lage mit); ist die Übung vorbei bzw. ganz in der Zukunft, die LIVE-Zeit der Lage.
 */
export function liveAnzeige(tLive: string, tUhr: string): string {
  const d = zeitMs(tLive) - zeitMs(tUhr);
  return Number.isFinite(d) && d >= -60000 && d <= ZUKUNFT_MS ? tUhr : tLive;
}

/** «4 min nach jetzt» (MVP 3.5, S22): Meldung liegt nach der Geräteuhr, aber noch in der Toleranz; sonst null */
export function nachJetztText(e: Pick<LageEvent, "t" | "tOffset" | "createdAt">, tUhr: string): string | null {
  const d = Math.round((zeitMs(e) - Math.floor(zeitMs(tUhr) / 60000) * 60000) / 60000);
  return d > 0 && d * 60000 <= ZUKUNFT_MS ? `${d} min nach jetzt` : null;
}

/** Zeit der letzten (nicht gelöschten) Meldung oder null */
export function lastReportOf(events: LageEvent[] | undefined): string | null {
  let m: LageEvent | null = null;
  for (const e of events ?? []) if (!e.deleted && (!m || zeitCmp(e, m) > 0)) m = e;
  return m ? m.t.slice(0, 16) : null;
}

/** letzte Meldung bis zur Lagezeit `t` (für «letzte Meldung 07:25» im Live-Band: nie eine aus der Zukunft) */
export function lastReportUntil(events: LageEvent[] | undefined, t: string): string | null {
  let m: LageEvent | null = null;
  for (const e of events ?? []) if (!e.deleted && zeitBis(e, t) && (!m || zeitCmp(e, m) > 0)) m = e;
  return m ? m.t.slice(0, 16) : null;
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
  const ref = useMemo(() => liveRefOf(events, clock), [events, clock]);
  const tLive = liveIso(ref, clock);
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
    const key = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || !isLiveKey(ev)) return;
      ev.preventDefault();
      if (ctl.zeit.kind === "rueckblick") ctl.goLive("taste");
    };
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

  // Laden und Übungswechsel → LIVE, Standard «Zeige letzte» (R5: alles, ab 200 Meldungen 6 h)
  const prevEx = useRef<string | undefined>(undefined);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  useEffect(() => {
    if (prevEx.current === exId) return;
    prevEx.current = exId;
    ctl.reset();
    if (exId) { const d = showLastStandard(eventsRef.current); if (d) ctl.setShowLast(d); }
  }, [exId, ctl]);

  return useMemo(() => ({
    zeit: ctl.zeit,
    // MVP 3.5 (S23): Lagezeiten mit Offset («…T02:10+01:00»); Anzeige mit `slice(11, 16)`, Vergleiche nur `zeitCmp`
    tNow: ctl.tNow(),
    tLive,
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
    // MVP 3.5 (S22, Phase 0): Geräteuhr mit Offset – Anzeige «LIVE 07:31», Übergabe/Druck «Stand» (Paket E/D)
    tUhr: jetztLagezeit(new Date(clock)),
  }), [version, tLive, ctl, clock]); // eslint-disable-line react-hooks/exhaustive-deps
}
