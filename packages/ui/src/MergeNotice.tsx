/**
 * Ergebnis von «Datei öffnen (zusammenführen)» als Rückmeldung **unter dem Meldungsfeld** (Spez. MVP 3, Kap. 3.13 Nr. 2,
 * E18) statt als Band über der Karte: nichts verdeckt Karte oder Meldungsband, kein Layoutsprung in der Kartenspalte.
 *
 * - Text aus `mergeReportText` («3 neu · 1 aktualisiert · 1 Konflikt (in Offen)», «2 Nummern doppelt – als 12a/12b
 *   gekennzeichnet»); Konflikte stehen zusätzlich als Punkt in «Offen» («Offen zeigen»).
 * - Verschwindet nach 6 s von selbst (Maus darüber oder Fokus darin hält sie) – ausser es ist eine Wahl offen:
 *   abweichendes Raster/NAI aus der Datei («hiesige behalten / aus Datei übernehmen») steht dann als Blatt in der Spalte.
 * - «Ersetzen durch Datei …» bleibt der ausdrückliche zweite Weg.
 */
import { useEffect, useRef, useState } from "react";
import type { HullDiff } from "@lage/core";
import type { HullChoice, MergeInfo } from "./SaveBand";
import "./lvzui/lvzui.css";

/** so lange steht die Rückmeldung, wenn nichts zu entscheiden ist */
export const MERGENOTICE_MS = 6000;

const KIND_LABEL: Record<HullDiff["kind"], string> = { sheets: "Raster", areas: "Fläche", overlays: "Bild" };

export function MergeNotice({ info, onClose, onOffen }: { info: MergeInfo; onClose: () => void; onOffen?: () => void }) {
  const [picked, setPicked] = useState<Record<string, HullChoice>>({});
  const diffs = info.diffs ?? [];
  const conflicts = info.conflictIds ?? [];
  const pick = (d: HullDiff, c: HullChoice) => {
    if ((picked[d.id] ?? "hier") === c) return;
    setPicked((x) => ({ ...x, [d.id]: c }));
    info.choose?.(d, c);
  };
  const hold = useRef(false);
  /** Online-Frage beantwortet (Einschalten oder Aus lassen) */
  const [onlineDone, setOnlineDone] = useState(false);
  const onlineFrage = !!info.online && !onlineDone;
  const choosing = (diffs.length > 0 && !!info.choose) || onlineFrage;
  useEffect(() => {
    if (choosing) return;
    let left = MERGENOTICE_MS;
    const id = window.setInterval(() => {
      if (hold.current) { left = MERGENOTICE_MS; return; }
      left -= 500;
      if (left <= 0) { window.clearInterval(id); onClose(); }
    }, 500);
    return () => window.clearInterval(id);
  }, [info, choosing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={"mn" + (conflicts.length ? " konflikt" : "") + (choosing ? " wahl" : "")} role="status"
      onPointerEnter={() => { hold.current = true; }} onPointerLeave={() => { hold.current = false; }}
      onFocus={() => { hold.current = true; }} onBlur={() => { hold.current = false; }}>
      <p className="mn-t"><b>«{info.name}»</b> {info.replace ? "zusammengeführt" : "geöffnet"}: {info.text}</p>
      {conflicts.length > 0 && (
        <p className="mn-k">
          ⚠ Auf beiden Geräten verschieden korrigiert – beide Fassungen bleiben erhalten.
          {onOffen && <> <button type="button" className="mn-link" onClick={onOffen}>Offen zeigen</button></>}
        </p>
      )}
      {info.online && (
        <div className="mn-online">
          <p className="mn-dh">In der Datei waren {info.online.namen} an – hier einschalten? <span className="mn-sub">Jetzt aus: nichts geht ans Netz.</span></p>
          {onlineFrage ? (
            <span className="mn-online-b">
              <button type="button" className="jl-btn" onClick={() => { info.online!.einschalten(); setOnlineDone(true); }}>Einschalten</button>
              <button type="button" className="jl-btn" onClick={() => setOnlineDone(true)}>Aus lassen</button>
            </span>
          ) : <p className="mn-sub">Gewählt – ändern: Vorbereiten → Übung → Online-Dienste.</p>}
        </div>
      )}
      {diffs.length > 0 && !!info.choose && (
        <div className="mn-diffs">
          <p className="mn-dh">In der Datei anders – was gilt?{diffs.length > 1 && <> Alle: <button type="button" className="mn-link" onClick={() => diffs.forEach((d) => pick(d, "hier"))}>hiesige</button> · <button type="button" className="mn-link" onClick={() => diffs.forEach((d) => pick(d, "datei"))}>aus Datei</button></>}</p>
          <ul>
            {diffs.map((d) => {
              const c = picked[d.id] ?? "hier";
              return (
                <li key={d.kind + d.id}>
                  <span className="mn-name">{KIND_LABEL[d.kind]} «{d.name}»{d.theirsName !== d.name ? <> (Datei: «{d.theirsName}»)</> : null}</span>
                  <span className="seg mn-seg" role="group" aria-label={`${KIND_LABEL[d.kind]} ${d.name}`}>
                    <button type="button" aria-pressed={c === "hier"} onClick={() => pick(d, "hier")}>hiesige behalten</button>
                    <button type="button" aria-pressed={c === "datei"} onClick={() => pick(d, "datei")}>aus Datei übernehmen</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <span className="mn-acts">
        {info.replace && (
          <button type="button" className="mn-link" title="Übung auf diesem Gerät ganz durch die Datei ersetzen (nur auf ausdrücklichen Wunsch)"
            onClick={() => {
              const loss = info.nurHier ? `\n\n${info.nurHier} ${info.nurHier === 1 ? "Meldung ist" : "Meldungen sind"} nur auf diesem Gerät und ${info.nurHier === 1 ? "geht" : "gehen"} verloren – vorher «Speichern».` : "";
              if (window.confirm(`Übung «${info.name}» durch die Datei ersetzen?${loss}`)) info.replace!();
            }}>Ersetzen durch Datei …</button>
        )}
        <button type="button" className="jl-btn mn-ok" onClick={onClose}>{choosing ? "Fertig" : "OK"}</button>
      </span>
    </div>
  );
}
