/**
 * Zeitstrahl mit Schwimmbahnen (eine Zeile pro Element) – PLATZHALTER, wird ersetzt.
 * Vertrag: siehe Props. Darf keine anderen Dateien voraussetzen als @lage/core und ./Timeline (isoLocal, dayLabel).
 */
import type { ReactNode } from "react";
import type { Exercise, LageEvent } from "@lage/core";
import { Timeline } from "./Timeline";

export interface SwimTimelineProps {
  events: LageEvent[];
  days: string[];
  units: Exercise["units"];
  /** gewählter Zeitpunkt (ISO lokal «YYYY-MM-DDTHH:MM») oder null = Live */
  value: string | null;
  onChange: (t: string | null) => void;
  selectedId: string | null;
  /** Klick auf einen Punkt: Meldung auswählen (Workspace setzt dann auch die Zeit) */
  onSelect: (id: string) => void;
  /** Präsentation: kompakt, höchstens ca. 25 % der Bildschirmhöhe */
  compact?: boolean;
  /** zusätzlicher Inhalt rechts in der Kopfzeile (z. B. Knöpfe) */
  extra?: ReactNode;
}

export function SwimTimeline(p: SwimTimelineProps) {
  return (
    <div className="tlwrap">
      <Timeline events={p.events} days={p.days} value={p.value} onChange={p.onChange} />
      {p.extra}
    </div>
  );
}
