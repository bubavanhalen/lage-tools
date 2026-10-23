/**
 * Einstellungen Spracherkennung (pro Gerät): Offline (Whisper, empfohlen) oder Browser (schnell, online).
 * `SpeechModelRow` zeigt Zustand/Download des Offline-Modells (auch in der Offline-Box).
 */
import { useEffect, useState } from "react";
import {
  WHISPER_MODELS,
  browserSttAvailable,
  browserSttVendor,
  cancelModelLoad,
  downloadLabel,
  ensureModel,
  modelMb,
  removeModel,
  setSpeechPrefs,
  smallDevice,
  useModelState,
  useSpeechPrefs,
  whisperInfo,
} from "./stt";
import "./voice.css";

const mb = (b: number) => Math.round(b / 1e6);

function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const f = () => setOn(navigator.onLine);
    window.addEventListener("online", f); window.addEventListener("offline", f);
    return () => { window.removeEventListener("online", f); window.removeEventListener("offline", f); };
  }, []);
  return on;
}

/** Zustand des Offline-Modells mit Laden/Löschen */
export function SpeechModelRow({ compact }: { compact?: boolean }) {
  const s = useModelState();
  const size = useSpeechPrefs().model;
  const MB = modelMb(size);
  const online = useOnline();
  const [confirmDel, setConfirmDel] = useState(false);
  const load = () => { ensureModel().catch(() => { /* Fehler steht im Zustand */ }); };
  if (s.status === "laedt") {
    const pct = Math.min(100, Math.round((s.loaded / Math.max(1, s.total)) * 100));
    return (
      <div className="sp-model">
        <div className="btnrow sp-load">
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Spracherkennung laden">
            <div className="sp-bar" style={{ width: `${pct}%` }} /><span>Spracherkennung {mb(s.loaded)} / {mb(s.total)} MB</span>
          </div>
          <button onClick={cancelModelLoad} title="Download abbrechen – Sprachmemos werden weiter gespeichert">Abbrechen</button>
        </div>
        <p className="help">Einmalig – danach funktioniert die Erkennung ohne Netz. Seite offen lassen.</p>
      </div>
    );
  }
  if (s.status === "bereit") {
    return (
      <div className="btnrow sp-model">
        <span className="help sp-ok" title={whisperInfo.device ? `Zuletzt: ${whisperInfo.device === "webgpu" ? "Grafikkarte (WebGPU) + " : ""}${whisperInfo.threads ?? 1} Thread${(whisperInfo.threads ?? 1) > 1 ? "s" : ""}` : undefined}>✓ Spracherkennung (Sprachmemos) offline verfügbar</span>
        {confirmDel
          ? <><button className="danger" onClick={() => { setConfirmDel(false); removeModel(); }}>Ja, löschen</button><button onClick={() => setConfirmDel(false)}>Nein</button></>
          : <button onClick={() => setConfirmDel(true)} title={`Modell löschen (gibt ca. ${MB} MB frei)`}>Löschen</button>}
      </div>
    );
  }
  return (
    <div className="sp-model">
      <div className="btnrow">
        <button className={compact ? "" : "primary"} disabled={!online || s.status === "pruefen"} onClick={load}>
          {compact ? <>Spracherkennung offline verfügbar machen ({downloadLabel(MB)}) – laden</> : <>Spracherkennung offline laden ({downloadLabel(MB)})</>}
        </button>
      </div>
      {s.status === "fehler" && <p className="help warn">{s.error ?? "Laden fehlgeschlagen."}</p>}
      {!online && <p className="help">Zum Laden braucht es einmal Netz. Sprachmemos werden trotzdem gespeichert und später erkannt.</p>}
      {!compact && online && <p className="help">Modell «Whisper {size}» vom Hugging Face Hub, danach im Browser gespeichert. Der Ton verlässt das Gerät nicht.</p>}
    </div>
  );
}

/** Ganze Einstellung (im Mikrofon-Menü) */
export function SpeechSettings({ onClose }: { onClose?: () => void }) {
  const p = useSpeechPrefs();
  const dev = smallDevice();
  const avail = browserSttAvailable();
  const vendor = browserSttVendor();
  const [ask, setAsk] = useState(false);
  const [agree, setAgree] = useState(false);
  return (
    <div className="sp-settings" role="dialog" aria-label="Spracherkennung">
      <div className="btnrow sp-head">
        <b>Spracherkennung</b>
        {onClose && <button className="sp-x" onClick={onClose} aria-label="Schliessen">✕</button>}
      </div>
      <label className={"sp-opt" + (p.mode === "offline" ? " on" : "")}>
        <input type="radio" name="sp-mode" checked={p.mode === "offline"} onChange={() => { /* über onClick */ }} onClick={() => { setAsk(false); setSpeechPrefs({ mode: "offline" }); }} />
        <span><b>Offline</b> (empfohlen) – Whisper im Browser, ohne Netz. Ton bleibt auf dem Gerät.</span>
      </label>
      <div className="sp-indent">
        <div className="seg sp-size" role="group" aria-label="Modell">
          {(["small", "base"] as const).map((k) => (
            <button key={k} aria-pressed={p.model === k} onClick={() => setSpeechPrefs({ model: k })}
              title={k === "small" ? "versteht Funksprache deutlich besser – empfohlen" : "kleiner und schneller, aber viele Fehler bei Buchstabieralphabet und Zahlen"}>
              {WHISPER_MODELS[k].name} · {modelMb(k)} MB
            </button>
          ))}
        </div>
        {dev.small && (
          <p className="help sp-dev">
            {dev.touch ? "Handy/Tablet" : "Gerät mit wenig Arbeitsspeicher"}{dev.mem ? ` (${dev.mem} GB)` : ""}: «Genau» braucht beim Erkennen ca. 1 GB Arbeitsspeicher
            und ist langsamer – bei Abstürzen oder langen Wartezeiten «Klein» wählen (ungenauer bei Buchstabieralphabet und Zahlen). Laden im WLAN.
          </p>
        )}
        <SpeechModelRow />
      </div>
      <label className={"sp-opt" + (p.mode === "browser" ? " on" : "") + (avail ? "" : " off")}>
        <input type="radio" name="sp-mode" disabled={!avail} checked={p.mode === "browser"}
          onChange={() => { /* über onClick */ }} onClick={() => { if (p.browserOk) setSpeechPrefs({ mode: "browser" }); else setAsk(true); }} />
        <span><b>Browser</b> (schnell, nur online) – Text erscheint schon beim Sprechen.{!avail && " In diesem Browser nicht vorhanden."}</span>
      </label>
      {(ask || p.mode === "browser") && avail && (
        <div className="sp-indent sp-warn">
          <p><b>Achtung:</b> Der Ton geht zur Erkennung an <b>{vendor}</b> (Internet). Nur verwenden, wenn das für diese Übung erlaubt ist.</p>
          {p.mode === "browser" ? (
            <div className="btnrow"><button onClick={() => setSpeechPrefs({ browserOk: false, mode: "offline" })}>Ausschalten</button></div>
          ) : (
            <>
              <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Verstanden – Ton darf an {vendor} gehen</label>
              <div className="btnrow">
                <button className="primary" disabled={!agree} onClick={() => { setSpeechPrefs({ browserOk: true, mode: "browser" }); setAsk(false); }}>Browser-Erkennung einschalten</button>
                <button onClick={() => { setAsk(false); setAgree(false); }}>Abbrechen</button>
              </div>
            </>
          )}
        </div>
      )}
      <p className="help">Sprachmemos werden immer gespeichert. Ohne Erkennung (kein Modell, kein Netz) später mit «Erkennen» am Memo.</p>
      <p className="help">Bedienung: Knopf <b>gedrückt halten</b> und sprechen, loslassen = fertig. Oder <b>antippen</b> = Start, nochmals = Stopp. Am Laptop: <b>Leertaste halten</b> (ausserhalb des Textfelds). <b>Esc</b> oder wegwischen = abbrechen.</p>
    </div>
  );
}
