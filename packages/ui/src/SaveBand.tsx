/**
 * Speicherstatus sichtbar machen:
 * - `StatusBands`: rote Bänder unter der Kopfleiste – im Fluss, sie schieben Karte und Journal nach unten statt sie zu
 *   verdecken:
 *   · «Nicht gespeichert – Datei sichern», sobald das Speichern fehlschlägt (Speicher voll, blockiert, nicht verfügbar) –
 *     mit Knopf «Datei sichern». Verschwindet, sobald wieder gespeichert ist (Übung) bzw. nach dem Sichern/Schliessen
 *     oder wenn die Anhänge doch noch abgelegt bzw. verworfen wurden (Anhang). Der Text sagt ehrlich, was «Datei
 *     sichern» mitnimmt: nur Anhänge der Übung – ein Foto, das noch an keiner Meldung hängt, nicht.
 *   · Zeitzone des Geräts ≠ Zeitzone der Übung (beim Start, beim Öffnen einer Datei oder einer gespeicherten Übung).
 *   · Datenbank blockiert durch ein altes Lagejournal-Fenster bzw. Update-Notiz nach dem Aktualisieren der Datenbank
 *     («alte Lagejournal-Fenster schliessen»).
 * - `MergeBar`: Ergebnis von «Öffnen» (Zusammenführen), pro abweichendem Raster/NAI die Wahl «hiesige behalten / aus
 *   Datei übernehmen», und der ausdrückliche zweite Weg «Ersetzen durch Datei». Steht als Band im Fluss (verdeckt weder
 *   Live-Band noch Rückblick-Leiste) und verschwindet nach 8 s selbst – ausser bei einem Konflikt («1 Konflikt –
 *   ansehen») oder abweichendem Raster/NAI (dort ist eine Wahl offen).
 */
import { useEffect, useRef, useState } from "react";
import { zoneMismatch, type Exercise, type HullDiff } from "@lage/core";
import { memBlobIds, onDbUpgraded, onMemBlobs, onStoreStatus, type StoreProblem } from "./store";
import "./persist.css";

export function StatusBands({ ex, dbBlocked, onSaveFile }: { ex: Pick<Exercise, "id" | "tz" | "attachments"> | null; dbBlocked: boolean; onSaveFile: () => Promise<boolean> | void }) {
  // Anhänge im Arbeitsspeicher (neu darstellen, wenn einer dazukommt, abgelegt oder verworfen wird)
  const [, setMemTick] = useState(0);
  useEffect(() => onMemBlobs(() => setMemTick((n) => n + 1)), []);
  const [exP, setExP] = useState<StoreProblem | null>(null);
  const [att, setAtt] = useState<StoreProblem | null>(null);
  useEffect(() => onStoreStatus((p, where) => {
    if (where === "uebung") setExP(p);
    else setAtt(p);
  }), []);
  // Update-Notiz: Datenbank eben von einer älteren Version aktualisiert → alte Fenster schliessen
  const [upd, setUpd] = useState(0);
  useEffect(() => onDbUpgraded(setUpd), []);
  // Zeitzone: pro Übung einmal wegklickbar (gilt für dieses Fenster)
  const [zoneOk, setZoneOk] = useState<string | null>(null);
  const zone = ex && zoneOk !== ex.id ? zoneMismatch(ex.tz) : null;
  const p = exP ?? att;
  if (!p && !zone && !dbBlocked && !upd) return null;
  const save = async () => {
    const ok = await onSaveFile();
    if (ok !== false && !exP) setAtt(null);
  };
  const mem = memBlobIds();
  const inEx = new Set((ex?.attachments ?? []).map((a) => a.id));
  /** in der Übung: «Datei sichern» nimmt sie mit */
  const nMem = mem.filter((id) => inEx.has(id)).length;
  /** noch an keiner Meldung (Foto im Feld/Dialog): «Datei sichern» nimmt sie (noch) nicht mit */
  const nOpen = mem.length - nMem;
  const attWhy = [
    nMem ? `${nMem > 1 ? `${nMem} Anhänge liegen` : "Der Anhang liegt"} nur im Arbeitsspeicher dieses Fensters – «Datei für anderes Gerät sichern» nimmt ${nMem > 1 ? "sie" : "ihn"} mit.` : "",
    nOpen ? `${nOpen > 1 ? `${nOpen} Fotos/Sprachmemos hängen` : "Ein Foto/Sprachmemo hängt"} noch an keiner Meldung – erst eintragen, sonst nimmt «Datei sichern» ${nOpen > 1 ? "sie" : "es"} nicht mit.` : "",
  ].filter(Boolean).join(" ");
  return (
    <div className="bands">
      {p && (
        <div className="savefail" role="alert">
          <b>⛔ Nicht gespeichert</b>
          <span className="savefail-why">{p.text}{exP ? "" : " (Foto/Sprachmemo)"}. {exP ? "Neue Meldungen sind nur in diesem Fenster und im Notfallpuffer." : attWhy || "Der Anhang ist nicht mehr da (verworfen)."}</span>
          <button className="savefail-btn" onClick={save}>Datei für anderes Gerät sichern</button>
          {!exP && <button className="savefail-x" aria-label="Schliessen" onClick={() => setAtt(null)}>×</button>}
        </div>
      )}
      {dbBlocked && (
        <div className="savefail dbband" role="alert">
          <b>Ein anderes Lagejournal-Fenster ist offen – bitte schliessen.</b>
          <span className="savefail-why">Danach geht es hier automatisch weiter.</span>
        </div>
      )}
      {upd > 0 && (
        <div className="savefail updband" role="alert">
          <b>Lagejournal aktualisiert – alte Lagejournal-Fenster schliessen</b>
          <span className="savefail-why">Ist noch ein Fenster/Tab mit der alten Version offen, speichert es ab jetzt nichts mehr. Dort zuerst «Datei für anderes Gerät …», das Fenster schliessen und die Datei hier mit «Datei öffnen (zusammenführen) …» übernehmen.</span>
          <button className="savefail-x" aria-label="Hinweis schliessen" title="Hinweis schliessen" onClick={() => setUpd(0)}>×</button>
        </div>
      )}
      {zone && ex && (
        <div className="savefail zoneband" role="alert">
          <b>Zeitzone prüfen</b>
          <span className="savefail-why">{zone}.</span>
          <button className="savefail-x" aria-label="Hinweis schliessen" title="Hinweis schliessen" onClick={() => setZoneOk(ex.id)}>×</button>
        </div>
      )}
    </div>
  );
}

/** abweichendes Raster/NAI aus der Datei: was gilt jetzt? */
export type HullChoice = "hier" | "datei";

export interface MergeInfo {
  name: string;
  text: string;
  /** Meldungen nur auf diesem Gerät (gingen beim Ersetzen verloren) */
  nurHier: number;
  /** null = neu geöffnet (nichts zusammenzuführen) */
  replace: (() => void) | null;
  /** Raster/NAI/Bilder mit gleicher ID, aber anderem Inhalt in der Datei */
  diffs?: HullDiff[];
  /** Wahl pro Abweichung anwenden (Meldungen bleiben unberührt) */
  choose?: (d: HullDiff, c: HullChoice) => void;
  /** Meldungen, die auf beiden Geräten verschieden korrigiert wurden (gleiche Revision); die unterlegene Fassung liegt in `history` */
  conflictIds?: string[];
  /** «ansehen»: Meldung des Konflikts zeigen */
  onShowConflict?: (id: string) => void;
}

/** so lange steht das Ergebnis «Öffnen», wenn nichts zu entscheiden ist */
export const MERGEBAR_MS = 8000;

const KIND_LABEL: Record<HullDiff["kind"], string> = { sheets: "Raster", areas: "Fläche", overlays: "Bild" };

export function MergeBar({ info, onClose }: { info: MergeInfo; onClose: () => void }) {
  const [picked, setPicked] = useState<Record<string, HullChoice>>({});
  const diffs = info.diffs ?? [];
  const pick = (d: HullDiff, c: HullChoice) => {
    if ((picked[d.id] ?? "hier") === c) return;
    setPicked((x) => ({ ...x, [d.id]: c }));
    info.choose?.(d, c);
  };
  const all = (c: HullChoice) => diffs.forEach((d) => pick(d, c));
  const conflicts = info.conflictIds ?? [];
  const [seen, setSeen] = useState(0);
  // nichts zu entscheiden → nach 8 s von selbst weg (Maus darüber/Fokus darin hält sie)
  const hold = useRef(false);
  const stay = conflicts.length > 0 || (diffs.length > 0 && !!info.choose);
  useEffect(() => {
    if (stay) return;
    const id = window.setInterval(() => { if (!hold.current) { window.clearInterval(id); onClose(); } }, MERGEBAR_MS);
    return () => window.clearInterval(id);
  }, [info, stay]); // eslint-disable-line react-hooks/exhaustive-deps
  const showNext = () => {
    const id = conflicts[seen % conflicts.length];
    if (id) info.onShowConflict?.(id);
    setSeen((n) => n + 1);
  };
  return (
    <div className={"mergebar" + (conflicts.length ? " konflikt" : "")} role="status"
      onPointerEnter={() => { hold.current = true; }} onPointerLeave={() => { hold.current = false; }}
      onFocus={() => { hold.current = true; }} onBlur={() => { hold.current = false; }}>
      <span><b>«{info.name}»</b> {info.replace ? "zusammengeführt" : "geöffnet"}: {info.text}</span>
      {conflicts.length > 0 && info.onShowConflict && (
        <span className="mergeconf">
          <b>⚠ {conflicts.length} {conflicts.length === 1 ? "Konflikt" : "Konflikte"}</b> – auf beiden Geräten verschieden korrigiert; beide Fassungen bleiben erhalten.
          <button type="button" onClick={showNext}>{conflicts.length > 1 && seen > 0 ? "nächsten ansehen" : "ansehen"}</button>
        </span>
      )}
      {diffs.length > 0 && info.choose && (
        <div className="mergediffs">
          <span className="mergediffs-head">In der Datei anders{diffs.length > 1 ? <> – alle: <button onClick={() => all("hier")}>hiesige</button> <button onClick={() => all("datei")}>aus Datei</button></> : null}</span>
          <ul>
            {diffs.map((d) => {
              const c = picked[d.id] ?? "hier";
              return (
                <li key={d.kind + d.id}>
                  <span className="mergediffs-name">{KIND_LABEL[d.kind]} «{d.name}»{d.theirsName !== d.name ? <> (Datei: «{d.theirsName}»)</> : null}</span>
                  <span className="seg" role="group" aria-label={`${KIND_LABEL[d.kind]} ${d.name}`}>
                    <button aria-pressed={c === "hier"} onClick={() => pick(d, "hier")}>hiesige behalten</button>
                    <button aria-pressed={c === "datei"} onClick={() => pick(d, "datei")}>aus Datei übernehmen</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <span className="mergebar-acts">
        {info.replace && (
          <button title="Übung auf diesem Gerät ganz durch die Datei ersetzen (nur auf ausdrücklichen Wunsch)"
            onClick={() => {
              const loss = info.nurHier ? `\n\n${info.nurHier} ${info.nurHier === 1 ? "Meldung ist" : "Meldungen sind"} nur auf diesem Gerät und ${info.nurHier === 1 ? "geht" : "gehen"} verloren – vorher «Speichern».` : "";
              if (window.confirm(`Übung «${info.name}» durch die Datei ersetzen?${loss}`)) info.replace!();
            }}>Ersetzen durch Datei …</button>
        )}
        <button onClick={onClose}>OK</button>
      </span>
    </div>
  );
}
