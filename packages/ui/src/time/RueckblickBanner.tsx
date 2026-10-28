/**
 * Rückblick unübersehbar (Spez. MVP 1, Kap. 2.6, 3.5): gelbes Band oben über der Karte (44 px, Schrift 20 px 600,
 * Tinte auf `--rueckblick`, Kontrast ≥ 7:1) mit «Zurück zu LIVE», dazu ein Rahmen 4 px `--rueckblick` + 1 px Tinte
 * innen um die ganze Kartenspalte. In LIVE wird nichts gezeichnet.
 *
 * Einbau (Hülle): als erstes Kind der Kartenspalte; die Spalte braucht `position: relative` (Rahmen und Band liegen
 * absolut darin, die Karte springt beim Wechsel nicht). In der Spalte gilt im Rückblick `--rb-oben: 44px`
 * (gesetzt über `.app[data-lagezeit="rueckblick"]`) – Werkzeuge oben an der Karte rücken damit unter das Band.
 */
import { lageZeitText, rueckblickTitel } from "@lage/core";
import type { ZeitApi } from "../shell/contracts";
import "./time.css";

export interface RueckblickBannerProps {
  zeit: ZeitApi;
  /** Übungstage (für «T2 05:30») */
  days: string[];
}

export function RueckblickBanner({ zeit, days }: RueckblickBannerProps) {
  if (zeit.zeit.kind !== "rueckblick") return null;
  const tLive = zeit.tLive ?? zeit.tNow;
  return (
    <>
      <div className="rb-frame" aria-hidden="true" />
      <div className="rb-band" role="status">
        <span className="rb-text">{rueckblickTitel(zeit.zeit.t, tLive, days)}</span>
        {zeit.zeit.playing && <span className="rb-play">spielt ab</span>}
        <button type="button" className="rb-live" onClick={() => zeit.goLive("knopf")}>Zurück zu LIVE</button>
      </div>
    </>
  );
}

/**
 * Streifen über Liste bzw. «Was Rot»: «Liste bis 05:30» / «Stand 05:30» (nur im Rückblick).
 * Für Paket B (Journal-Liste) und D («Was Rot vorhaben könnte»).
 */
export function RueckblickStreifen({ zeit, days, art }: { zeit: Pick<ZeitApi, "zeit">; days: string[]; art: "liste" | "stand" }) {
  if (zeit.zeit.kind !== "rueckblick") return null;
  const t = lageZeitText(zeit.zeit.t, days);
  return <div className="rb-strip" role="note">{art === "liste" ? `Liste bis ${t}` : `Stand ${t}`}</div>;
}

/** Info-Zeile fürs Meldungsfeld (Kap. 3.2): «ⓘ Du siehst 05:30. Beim Eintragen springt die Ansicht auf LIVE.» */
export function rueckblickInfo(zeit: Pick<ZeitApi, "zeit">): string | null {
  if (zeit.zeit.kind !== "rueckblick") return null;
  return `Du siehst ${zeit.zeit.t.slice(11, 16)}. Beim Eintragen springt die Ansicht auf LIVE.`;
}
