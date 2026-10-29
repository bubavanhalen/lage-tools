/**
 * Übergabe-Seite (Spez. MVP 3, Kap. 2.7, 3.8, E11): Vollbild-Blatt über der App, immer LIVE, lesbar in ≤ 5 min.
 * Abschnitte 1 Lage Blau · 2 Lage Rot · 3 Offene Punkte · 4 Neu seit der letzten Übergabe · 5 Zahlen für den Rapport ·
 * 6 Visum. «Als PDF» (dieselben Abschnitte, A4 hoch), «Übergabe abschliessen» (gesperrt ohne «übernommen von»).
 * Testhaken: `role="dialog"` mit `aria-label="Übergabe"`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UebergabeProps } from "../shell/contracts";
import { kuerzelNorm } from "../shell/contracts";
import { KiLageberichtButton } from "../ki/KiFeatures";
import { uebergabeDaten } from "./uebergabeDaten";
import "./lvzui.css";

export interface UebergabeExtra {
  /** Lagezeit des Schichtbeginns (ISO lokal) */
  seitT: string | null;
  /** «Lagebericht als Notiz»: eintragen, gibt die Nummer zurück */
  onKiNotiz?: (text: string, t: string) => string | null;
}

export function UebergabeView(p: UebergabeProps & UebergabeExtra) {
  const { ex, tLive, schicht } = p;
  const d = useMemo(() => uebergabeDaten({ ex, tLive, hints: p.hints, lage: p.lage, items: p.items, kuerzel: schicht.kuerzel, seit: schicht.seit, seitT: p.seitT }),
    [ex, tLive, p.hints, p.lage, p.items, schicht.kuerzel, schicht.seit, p.seitT]);
  const [von, setVon] = useState(schicht.kuerzel ?? "");
  const [an, setAn] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  const anOk = kuerzelNorm(an);
  const vonOk = kuerzelNorm(von);

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    // modal: die App dahinter ist nicht bedienbar (Tab bleibt im Blatt, Screenreader liest nur die Übergabe)
    const app = document.querySelector<HTMLElement>(".app");
    app?.setAttribute("inert", "");
    box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // KI-Dialog darüber schliesst zuerst sich selbst
      if (document.querySelector(".ki-back")) return;
      e.preventDefault(); e.stopPropagation(); closeRef.current();
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); app?.removeAttribute("inert"); back?.focus?.(); };
  }, []);

  const abschliessen = () => {
    if (!anOk) return;
    const v = vonOk ?? schicht.kuerzel ?? "";
    schicht.uebergeben(v, anOk, { offen: d.offenTotal, neu: d.neu.total });
    p.say(`Übergabe ${tLive.slice(11, 16)} ${v || "–"} → ${anOk} gespeichert. Neu gilt ab jetzt.`);
    p.onClose();
  };
  const pdf = async () => {
    setPdfBusy(true);
    try {
      const { uebergabePdf } = await import("./uebergabePdf");
      const blob = uebergabePdf(d, { von: vonOk ?? von.trim(), an: anOk ?? "", um: tLive.slice(11, 16) });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Uebergabe_${ex.name.replace(/[^\wäöüÄÖÜ-]+/g, "_")}_${tLive.replace(/[:T]/g, "-")}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      p.say("PDF konnte nicht erstellt werden: " + (e as Error).message + ".");
    } finally { setPdfBusy(false); }
  };

  return createPortal(
    <div className="ueb-back">
      <div ref={box} className="ueb" role="dialog" aria-modal="true" aria-label="Übergabe" tabIndex={-1}>
        <header className="ueb-head">
          <div className="ueb-l1">
            <h2 className="ueb-title">Übergabe</h2>
            <span className="ueb-name">{d.titel}</span>
            <span className="ueb-klass">{d.klass}</span>
            <span className="ueb-stand tnum">Stand {d.stand}</span>
          </div>
          <p className="ueb-l2">{d.schichtZeile}</p>
        </header>

        <div className="ueb-body">
          <section className="ueb-s" aria-label="Lage Blau">
            <h3>1 Lage Blau</h3>
            {d.blau.length ? (
              <table className="ueb-tab">
                <thead><tr><th>Trupp</th><th>Ort</th><th>seit</th><th>letzte Meldung</th><th>letzte Vbk</th><th>offen</th></tr></thead>
                <tbody>
                  {d.blau.map((z) => (
                    <tr key={z.trupp}>
                      <th scope="row">{z.trupp}</th>
                      <td data-l="Ort" className="mono">{z.ort}</td>
                      <td data-l="seit" className="tnum">{z.seit}</td>
                      <td data-l="letzte Meldung">{z.letzte}{z.still && <b className="ueb-still"> · {z.still}</b>}</td>
                      <td data-l="letzte Vbk" className="tnum">{z.vbk}</td>
                      <td data-l="offen">{z.offen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="ueb-leer">Keine eigenen Trupps erfasst.</p>}
          </section>

          <section className="ueb-s" aria-label="Lage Rot">
            <h3>2 Lage Rot</h3>
            {!d.rot.gesehen && !d.rot.moeglich.length ? <p className="ueb-leer">Noch kein Rot gemeldet.</p> : (
              <ul className="ueb-ul">
                {d.rot.gesehen && <li>{d.rot.gesehen}</li>}
                {d.rot.zuletzt && <li>{d.rot.zuletzt}</li>}
                {d.rot.moeglich.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
          </section>

          <section className="ueb-s" aria-label="Offene Punkte">
            <h3>3 Offene Punkte ({d.offenTotal})</h3>
            {d.offen.length ? (
              <ul className="ueb-ul ueb-offen">
                {d.offen.map((o) => (
                  <li key={o.key}><span className="ueb-mark" aria-hidden="true">{o.mark}</span>
                    {o.t && <span className="tnum">{o.t} </span>}{o.nr && <span className="mono ueb-nr">{o.nr} </span>}{o.text}{o.meta && <span className="ueb-meta"> · {o.meta}</span>}</li>
                ))}
                {d.offenWeitere > 0 && <li className="ueb-more">+{d.offenWeitere} weitere in «Offen»</li>}
              </ul>
            ) : <p className="ueb-leer">Nichts offen.</p>}
          </section>

          <section className="ueb-s" aria-label="Neu seit der letzten Übergabe">
            <h3>4 {d.neu.titel}</h3>
            {d.neu.zeilen.length ? (
              <ul className="ueb-ul ueb-neu">
                {d.neu.zeilen.map((z, i) => <li key={i}>{z}</li>)}
                {d.neu.weitere > 0 && <li className="ueb-more">+{d.neu.weitere} weitere im Journal</li>}
              </ul>
            ) : <p className="ueb-leer">Noch nichts Neues in dieser Schicht.</p>}
          </section>

          <section className="ueb-s" aria-label="Zahlen für den Rapport">
            <h3>5 Zahlen für den Rapport</h3>
            <table className="ueb-tab ueb-zahlen">
              <thead><tr><th /><th>Schicht</th><th>ganze Übung</th></tr></thead>
              <tbody>{d.zahlen.map(([l, a, b]) => <tr key={l}><th scope="row">{l}</th><td className="tnum">{a}</td><td className="tnum">{b}</td></tr>)}</tbody>
            </table>
          </section>

          <section className="ueb-s ueb-visum" aria-label="Visum">
            <h3>6 Visum</h3>
            <div className="ueb-vis">
              <label>übergeben von <input className="ueb-in mono" value={von} maxLength={6} autoComplete="off" spellCheck={false}
                onChange={(e) => setVon(e.target.value.toUpperCase())} /></label>
              <span className="tnum">um {tLive.slice(11, 16)}</span>
              <label>übernommen von <input className="ueb-in mono" value={an} maxLength={6} autoComplete="off" spellCheck={false} placeholder="z. B. MU"
                onChange={(e) => setAn(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); abschliessen(); } }} /></label>
            </div>
            {!anOk && <p className="ueb-fehlt" role="status">Kürzel der übernehmenden Person fehlt</p>}
          </section>
        </div>

        <footer className="ueb-foot">
          <button type="button" className="jl-btn" onClick={() => void pdf()} disabled={pdfBusy}>Als PDF</button>
          {p.ki && <KiLageberichtButton hints={p.hints} coas={p.lage.coas} onNotiz={p.onKiNotiz} />}
          <button type="button" className="jl-btn ueb-primary" onClick={abschliessen} disabled={!anOk}>Übergabe abschliessen</button>
          <button type="button" className="jl-btn" onClick={p.onClose}>Schliessen</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
