/**
 * Protokoll der KI-Aufrufe dieser Übung (auf dem Gerät): Zeit, Zweck, Modell, Grösse, Dauer, Ergebnis, Kosten.
 * Fachbegriffe («Einheiten»/Tokens) nur hier im Experten-Bereich.
 */
import { useState } from "react";
import { KI_PURPOSE_LABEL } from "@lage/core";
import { clearKiLog, modelLabel, usdText, type KiLogEntry } from "./settings";
import { downloadText } from "../store";

const sizeText = (e: KiLogEntry) => {
  const parts = [`${e.chars.toLocaleString("de-CH")} Zeichen`];
  if (e.imageBytes) parts.push(`Bild ${Math.round(e.imageBytes / 1024)} kB`);
  return parts.join(" + ");
};
const timeText = (iso: string) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}. ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export function KiLog({ exId, list }: { exId: string; list: KiLogEntry[] }) {
  const [ask, setAsk] = useState(false);
  if (!list.length) return <p className="ki-help">Noch keine Aufrufe in dieser Übung.</p>;
  const csv = () => {
    const rows = [["Zeit", "Zweck", "Modell", "Zeichen", "Bild (Bytes)", "Dauer (s)", "Ergebnis", "Tokens ein", "Tokens aus", "Kosten geschätzt (USD)"]];
    for (const e of list) rows.push([e.at, KI_PURPOSE_LABEL[e.purpose] ?? e.purpose, e.model, String(e.chars), String(e.imageBytes ?? ""), (e.ms / 1000).toFixed(1), e.ok ? "ok" : `Fehler: ${e.error ?? ""}`, String(e.inTok ?? ""), String(e.outTok ?? ""), e.usd !== undefined ? e.usd.toFixed(4) : ""]);
    downloadText("KI-Protokoll.csv", rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n"), "text/csv;charset=utf-8");
  };
  return (
    <div className="ki-log">
      <ol className="ki-logl">
        {[...list].reverse().map((e, i) => (
          <li key={i} className={e.ok ? "ok" : "err"}>
            <span className="ki-lt tnum">{timeText(e.at)}</span>
            <span className="ki-lp">{KI_PURPOSE_LABEL[e.purpose] ?? e.purpose}</span>
            <span className="ki-lr">{e.ok ? "✓ ok" : "✗ Fehler"}</span>
            <span className="ki-lm">{modelLabel(e.model)} · {sizeText(e)} · {(e.ms / 1000).toFixed(1).replace(".", ",")} s{e.ok ? ` · ${usdText(e.usd)}` : ""}
              {e.inTok !== undefined && <span className="ki-tok"> · {e.inTok}/{e.outTok ?? 0} Tokens</span>}</span>
            {!e.ok && e.error && <span className="ki-le">{e.error}</span>}
          </li>
        ))}
      </ol>
      <div className="btnrow">
        <span className="ki-help">Kosten geschätzt nach Preisliste – massgebend ist die Abrechnung von Anthropic.</span>
        <button onClick={csv}>CSV</button>
        {ask
          ? <><button className="danger" onClick={() => { clearKiLog(exId); setAsk(false); }}>Ja, leeren</button><button onClick={() => setAsk(false)}>Nein</button></>
          : <button onClick={() => setAsk(true)}>Leeren</button>}
      </div>
    </div>
  );
}
