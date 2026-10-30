/**
 * Menü ☰ (Spez. MVP 1, Kap. 1.3, 2.8): Popover rechts oben (320 px), Einträge 44 px, Esc/Klick daneben schliesst,
 * Fokus zurück auf ☰. Pfeiltasten wandern durch die Einträge. Experten-Einträge (Präsentation, KI, Spracherkennung,
 * Hinweise als Tabelle) nur mit Schalter «Experten-Werkzeuge».
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent as RKeyboardEvent, type ReactNode } from "react";
import type { Arbeitsweise, Modus } from "./contracts";
import "./shell.css";

export const APP_VERSION = "MVP 3";

export interface MainMenuProps {
  exName: string;
  aw: Arbeitsweise;
  setModus(m: Modus): void;
  setExperte(on: boolean): void;
  /** «Offline nicht bereit» neben «Vorbereiten» */
  offlineReady: boolean;
  onRename(name: string): void;
  onSwitch(): void;
  onNew(): void;
  onDemo(): void;
  onSaveFile(): void;
  onOpenFile(): void;
  /** «Journal drucken …» (MVP 3: Dialog mit Umfang) */
  onPdf(): void;
  onCsv(): void;
  /** (MVP 3) «Lagekarte drucken …» */
  onLagekarte?: () => void;
  /** (MVP 3) Gruppe «Lage»: «Übergabe …», «Kürzel ändern …» mit Hinweis «Schicht MU seit 22:00» */
  onUebergabe?: () => void;
  onKuerzel?: () => void;
  schichtNote?: string | null;
  /** «Letzte Übergabe als PDF» (nach dem Abschliessen, Hinweis «06:45 BSP → WMA») */
  onLetzteUebergabe?: () => void;
  letzteUebergabeNote?: string | null;
  night: boolean;
  onNight(on: boolean): void;
  /** nur Experte */
  onPresent(): void;
  onKi?: () => void;
  onSpeech(): void;
  onHintsCsv(): void;
  onHelp(): void;
  onAbout(): void;
  /** Menü offen/zu (Rückblick-Timer ruht, R4) */
  onOpenChange?(open: boolean): void;
  // ---- MVP 3.5 (Spez. MVP 3.5, Kap. 1.2; Phase 0: von Workspace geliefert, Paket A zeigt sie an) ----
  /** Gruppe «Ansicht»: «Bildschirm bleibt an ✓» (nur in «Lage führen» wirksam); ohne Unterstützung «… – geht in diesem Browser nicht» */
  wach?: { an: boolean; unterstuetzt: boolean; fehler?: string | null; setAn(v: boolean): void };
  /** «Auf diesem Gerät sicher? …» öffnet das Offline-Popover; `sicher` = Speicher geschützt und installiert (✓/✗) */
  onSicher?: () => void;
  sicher?: boolean;
  /** Zusatz bei «Datei für anderes Gerät …»: «zuletzt 07:31» bzw. «nie gesichert» */
  dateiNote?: string | null;
}

export function MainMenu(p: MainMenuProps) {
  const [open, setOpenState] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  const setOpen = (o: boolean) => { setOpenState(o); p.onOpenChange?.(o); if (!o) setRename(null); };
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) close(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (rename !== null) setRename(null); else close(); } };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && rename === null) pop.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => p.onOpenChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (fn: () => void) => () => { close(false); fn(); };
  const onKey = (e: RKeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    e.preventDefault();
    const items = [...(pop.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not([aria-disabled=true])") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[n]?.focus();
  };
  const saveName = () => {
    const v = (rename ?? "").trim();
    if (v && v !== p.exName) p.onRename(v);
    setRename(null);
    pop.current?.querySelector<HTMLElement>("[role^=menuitem]")?.focus();
  };
  const x = p.aw.experte;

  return (
    <div className="mm">
      <button ref={btn} type="button" className="mm-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)} aria-label="Menü">
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false"><path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div ref={pop} id={id} className="mm-pop" role="menu" aria-label="Menü" onKeyDown={onKey}>
          <Group title={<>Übung <span className="mm-ex">«{p.exName}»</span></>}>
            {rename === null ? (
              <Item onClick={() => setRename(p.exName)}>Namen ändern</Item>
            ) : (
              <div className="mm-rename">
                <input aria-label="Name der Übung" value={rename} autoFocus onChange={(e) => setRename(e.target.value)} onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveName(); } }} />
                <button type="button" onClick={saveName}>OK</button>
              </div>
            )}
            <Item onClick={act(p.onSwitch)}>Übung wechseln …</Item>
            <Item onClick={act(p.onNew)}>Neue Übung</Item>
            <Item onClick={act(p.onDemo)}>Beispiel ansehen (fiktiv, Raum Bern)</Item>
          </Group>
          {(p.onUebergabe || p.onKuerzel) && (
            <Group title="Lage">
              {p.onUebergabe && <Item onClick={act(p.onUebergabe)}>Übergabe …</Item>}
              {p.onLetzteUebergabe && <Item onClick={act(p.onLetzteUebergabe)}>Letzte Übergabe als PDF{p.letzteUebergabeNote && <span className="mm-note">{p.letzteUebergabeNote}</span>}</Item>}
              {p.onKuerzel && <Item onClick={act(p.onKuerzel)}>Kürzel ändern …{p.schichtNote && <span className="mm-note">{p.schichtNote}</span>}</Item>}
            </Group>
          )}
          <Group title="Daten">
            <Item onClick={act(p.onSaveFile)}>Datei für anderes Gerät …</Item>
            <Item onClick={act(p.onOpenFile)}>Datei öffnen (zusammenführen) …</Item>
            <Item onClick={act(p.onPdf)}>Journal drucken …</Item>
            {p.onLagekarte && <Item onClick={act(p.onLagekarte)}>Lagekarte drucken …</Item>}
            <Item onClick={act(p.onCsv)}>Journal als Tabelle (CSV)</Item>
          </Group>
          <Group title="Ansicht">
            <Item role="menuitemcheckbox" checked={p.night} onClick={() => p.onNight(!p.night)}>
              Nacht <Switch on={p.night} />
            </Item>
            {x && <Item onClick={act(p.onPresent)}>Präsentation (Vollbild)</Item>}
          </Group>
          <Group title="Arbeitsweise">
            <Item role="menuitemradio" checked={p.aw.modus === "lage"} onClick={act(() => p.setModus("lage"))}>
              <Radio on={p.aw.modus === "lage"} /> Lage führen
            </Item>
            <Item role="menuitemradio" checked={p.aw.modus === "vorbereiten"} onClick={act(() => p.setModus("vorbereiten"))}>
              <Radio on={p.aw.modus === "vorbereiten"} /> Vorbereiten{!p.offlineReady && <span className="mm-note">Offline nicht bereit</span>}
            </Item>
            <Item role="menuitemcheckbox" checked={x} onClick={() => p.setExperte(!x)}>
              <Check on={x} /> Experten-Werkzeuge
            </Item>
          </Group>
          {x && (
            <Group title="Experte">
              {p.onKi && <Item onClick={act(p.onKi)}>KI …</Item>}
              <Item onClick={act(p.onSpeech)}>Spracherkennung …</Item>
              <Item onClick={act(p.onHintsCsv)}>Hinweise als Tabelle (CSV)</Item>
            </Group>
          )}
          <Group title="Hilfe">
            <Item onClick={act(p.onHelp)}>Beispiele und Tastenkürzel</Item>
            <Item onClick={act(p.onAbout)}>Über</Item>
          </Group>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="mm-g" role="group">
      <div className="mm-h">{title}</div>
      {children}
    </div>
  );
}

function Item({ children, onClick, role = "menuitem", checked }: { children: ReactNode; onClick: () => void; role?: "menuitem" | "menuitemradio" | "menuitemcheckbox"; checked?: boolean }) {
  return (
    <button type="button" role={role} className="mm-i" aria-checked={role === "menuitem" ? undefined : !!checked} tabIndex={-1} onClick={onClick}>
      {children}
    </button>
  );
}

const Switch = ({ on }: { on: boolean }) => <span className={"mm-sw" + (on ? " on" : "")} aria-hidden="true"><span /></span>;
const Radio = ({ on }: { on: boolean }) => <span className={"mm-radio" + (on ? " on" : "")} aria-hidden="true" />;
const Check = ({ on }: { on: boolean }) => <span className={"mm-check" + (on ? " on" : "")} aria-hidden="true">{on ? "✓" : ""}</span>;
