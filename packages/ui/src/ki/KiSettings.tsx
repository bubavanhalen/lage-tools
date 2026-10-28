/**
 * Menü «KI (Claude)»: für diese Übung ein/aus, Schlüssel und Modell (pro Gerät), «nicht mehr fragen», Protokoll.
 */
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { KI_PURPOSE_LABEL } from "@lage/core";
import { KiError, kiTestKey } from "./client";
import { KiMark, type KiApi } from "./context";
import { KiLog } from "./KiLog";
import { KI_MODEL_ORDER, KI_MODELS, maskKey, setKiKey, setKiModel, setSkip, skipPurposes, useKiLog, useKiSettings } from "./settings";
import "./ki.css";

type Test = { s: "idle" } | { s: "laeuft" } | { s: "ok"; ms: number } | { s: "fehler"; msg: string };

export function KiSettings({ api, onClose }: { api: KiApi; onClose: () => void }) {
  const { key, model } = useKiSettings();
  const [edit, setEdit] = useState(!key);
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<Test>({ s: "idle" });
  const [confirmDel, setConfirmDel] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const log = useKiLog(api.ex.id);
  const skips = skipPurposes(api.ex.id);
  const input = useRef<HTMLInputElement>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !ev.defaultPrevented && !document.querySelector(".ki-consent")) { ev.preventDefault(); closeRef.current(); } };
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("keydown", k); ctl.current?.abort(); };
  }, []);
  useEffect(() => { if (edit) input.current?.focus(); }, [edit]);

  const runTest = async (k: string) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setTest({ s: "laeuft" });
    try {
      const r = await kiTestKey(k, KI_MODELS[model].id, c.signal);
      if (!c.signal.aborted) setTest({ s: "ok", ms: r.ms });
    } catch (e) {
      if (!c.signal.aborted) setTest({ s: "fehler", msg: e instanceof KiError ? e.message : "Prüfen fehlgeschlagen." });
    }
  };
  const saveKey = () => {
    const v = draft.trim();
    if (!v) return;
    setKiKey(v);
    setDraft(""); setEdit(false); setShow(false);
    if (navigator.onLine) void runTest(v);
  };
  const looksWrong = draft.trim() !== "" && !/^sk-/.test(draft.trim());
  const on = api.enabled;
  const sum = log.reduce((s, e) => s + (e.usd ?? 0), 0);

  return createPortal(
    <div className="ki-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ki-dlg ki-settings" role="dialog" aria-modal="true" aria-labelledby="ki-set-h">
        <header className="ki-head">
          <KiMark size={18} />
          <h2 id="ki-set-h">KI (Claude)</h2>
          <span className="ki-sp" />
          <button className="ki-x" onClick={onClose} aria-label="Schliessen" title="Schliessen (Esc)">×</button>
        </header>
        <div className="ki-body">
          <section className={"ki-sec ki-ex" + (on ? " on" : "")}>
            <div className="ki-switchrow">
              <div>
                <h3>KI für diese Übung</h3>
                <p className="ki-help">{on
                  ? <>Eingeschaltet{api.ex.ki?.since ? ` seit ${new Date(api.ex.ki.since).toLocaleDateString("de-CH")}` : ""}. KI-Knöpfe sind sichtbar; gesendet wird nur auf Knopfdruck.</>
                  : api.state === "einwilligung"
                    ? <><b>KI aus – auf diesem Gerät noch nicht eingewilligt.</b> In der Übung ist die KI eingeschaltet; auf diesem Gerät geht erst etwas an eine KI, wenn du hier einwilligst.</>
                    : <>Aus. Es geht nichts an eine KI. Alles andere funktioniert wie gewohnt.</>}</p>
              </div>
              <button role="switch" aria-checked={on} className={"ki-switch" + (on ? " on" : "")} onClick={() => api.setEnabled(!on)} aria-label="KI für diese Übung">
                <span className="ki-knob" /><span className="ki-sw-l">{on ? "An" : "Aus"}</span>
              </button>
            </div>
            {on && !key && <p className="ki-warnline">Noch kein Schlüssel auf diesem Gerät – unten eingeben.</p>}
            {on && key && !api.online && <p className="ki-warnline">Zurzeit offline – KI-Knöpfe gehen erst wieder mit Netz.</p>}
          </section>

          <section className="ki-sec">
            <h3>Schlüssel <span className="ki-h-note">(nur auf diesem Gerät)</span></h3>
            {edit ? (
              <div className="ki-keyedit">
                <div className="ki-keyrow">
                  <input ref={input} className="mono ki-keyin" type={show ? "text" : "password"} value={draft} placeholder="sk-ant-…" autoComplete="off" spellCheck={false}
                    aria-label="Anthropic-Schlüssel" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }} />
                  <button className="ki-eye" onClick={() => setShow(!show)} aria-pressed={show} title={show ? "Verbergen" : "Anzeigen"}>{show ? "Verbergen" : "Anzeigen"}</button>
                </div>
                {looksWrong && <p className="ki-warnline">Ein Anthropic-Schlüssel beginnt mit «sk-».</p>}
                <div className="btnrow">
                  <button className="primary" disabled={!draft.trim()} onClick={saveKey}>Speichern und prüfen</button>
                  {key && <button onClick={() => { setEdit(false); setDraft(""); }}>Abbrechen</button>}
                </div>
              </div>
            ) : (
              <div className="ki-keyrow">
                <span className="mono ki-keymask" aria-label="gespeicherter Schlüssel">{maskKey(key)}</span>
                <button onClick={() => runTest(key)} disabled={test.s === "laeuft" || !api.online} title="Kleiner Testaufruf (kostet fast nichts)">{test.s === "laeuft" ? "Prüft …" : "Prüfen"}</button>
                <button onClick={() => { setEdit(true); setTest({ s: "idle" }); }}>Ändern</button>
                {confirmDel
                  ? <><button className="danger" onClick={() => { setKiKey(null); setConfirmDel(false); setEdit(true); setTest({ s: "idle" }); }}>Ja, löschen</button><button onClick={() => setConfirmDel(false)}>Nein</button></>
                  : <button className="danger" onClick={() => setConfirmDel(true)}>Löschen</button>}
              </div>
            )}
            {test.s === "ok" && <p className="ki-okline" role="status">✓ Schlüssel funktioniert ({(test.ms / 1000).toFixed(1).replace(".", ",")} s).</p>}
            {test.s === "fehler" && <p className="ki-errline" role="alert">{test.msg}</p>}
            {test.s === "laeuft" && <p className="ki-help" role="status">Kleiner Testaufruf läuft …</p>}
            <p className="ki-help">Kosten laufen über dein eigenes Anthropic-Konto. Schlüssel erstellen: <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer noopener">console.anthropic.com</a> → API Keys. Der Schlüssel bleibt auf diesem Gerät – nie in der Übungsdatei oder im Export.</p>
          </section>

          <section className="ki-sec">
            <h3>Modell</h3>
            <div className="ki-models" role="radiogroup" aria-label="Modell">
              {KI_MODEL_ORDER.map((k) => (
                <label key={k} className={"ki-model" + (model === k ? " on" : "")}>
                  <input type="radio" name="ki-model" checked={model === k} onChange={() => { setKiModel(k); setTest({ s: "idle" }); }} />
                  <span><b>{KI_MODELS[k].label}</b>{k === "standard" && <span className="ki-rec"> empfohlen</span>}<br /><span className="ki-mt">{KI_MODELS[k].text}</span></span>
                </label>
              ))}
            </div>
          </section>

          {skips.length > 0 && (
            <section className="ki-sec">
              <h3>Ohne Rückfrage senden <span className="ki-h-note">(diese Übung)</span></h3>
              <ul className="ki-skips">
                {skips.map((p) => (
                  <li key={p}><span>{KI_PURPOSE_LABEL[p]}</span><button className="linkbtn" onClick={() => setSkip(api.ex.id, p, false)}>wieder fragen</button></li>
                ))}
              </ul>
              <p className="ki-help">Was gesendet wird, steht trotzdem jedes Mal beim Knopf.</p>
            </section>
          )}

          <section className="ki-sec">
            <button className="ki-sechead" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}>
              <span className="hp-chev" aria-hidden="true">▸</span>
              <h3>Protokoll</h3>
              <span className="ki-h-note">{log.length ? `${log.length} ${log.length === 1 ? "Aufruf" : "Aufrufe"}${sum ? ` · ≈ ${sum < 0.01 ? "< 0.01" : sum.toFixed(2)} USD` : ""}` : "noch keine Aufrufe"}</span>
            </button>
            {logOpen && <KiLog exId={api.ex.id} list={log} />}
          </section>
        </div>
        <footer className="ki-foot">
          <button className="primary" onClick={onClose}>Fertig</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
