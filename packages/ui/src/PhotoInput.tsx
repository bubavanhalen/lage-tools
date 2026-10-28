/**
 * Foto im Meldungsfeld: Meldezettel oder Journalseite fotografieren/hochladen (Kamera, Datei, Einfügen, Ziehen).
 * Danach: Ausschnitt markieren (optional), drehen, gedruckten Text offline erkennen → mehrere Meldungen prüfen
 * (`BatchReview`). Das Foto bleibt an jeder übernommenen Meldung, auf Wunsch auch an einem Planquadrat.
 * Ohne Erkennung: Foto an die Meldung im Feld hängen oder nur an ein Planquadrat.
 */
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as RPointerEvent } from "react";
import { findCells, type Attachment, type Exercise, type KiRequest, type KiZeile } from "@lage/core";
import { BatchReview, type BatchItem } from "./BatchReview";
import { attLabel, deleteAttachmentBlob, storeAttachmentBlob, useBlobUrl } from "./attachmentStore";
import { clampRect, fmtSize, grayCanvas, imageFromTransfer, ocrPrepare, preparePhoto, type PhotoQuality, type PreparedPhoto, type Rect } from "./photo";
import { LOW_CONFIDENCE, OCR_MB, OcrAbort, abortable, downloadOcr, ocrState, ocrToMeldungen, originOf, recognize, recognizeOriented, type OcrState } from "./ocr";
import { KiPhotoButton } from "./ki/KiFeatures";
import { SentInfo } from "./ki/KiButton";
import { useKi } from "./ki/context";
import "./photo.css";

const coarse = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const ICON_CAM = <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 7.5h3l1.6-2h6.8l1.6 2h3c.6 0 1 .4 1 1V18c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V8.5c0-.6.4-1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>;

interface PhotoProps {
  ex: Exercise;
  /** Tag für Meldungen ohne Tagesangabe */
  day: string;
  say: (t: string) => void;
  /** Foto an die Meldung im Feld hängen (wird beim Eintragen gespeichert) */
  onAttach: (att: Attachment) => void;
  /** Foto nur an ein Planquadrat (ohne Meldung) */
  onCell: (att: Attachment) => void;
  /** erkannte Meldungen eintragen (mit dem Foto als Anhang) */
  onCommit: (texts: string[], att: Attachment) => void;
}

/** Knopf «Foto» (Kamera auf Handy/Tablet, Datei am Laptop) + Einfügen/Ziehen aufs Meldungsfeld */
export function PhotoButton(p: PhotoProps) {
  const [file, setFile] = useState<File | null>(null);
  const [menu, setMenu] = useState(false);
  const [drop, setDrop] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);

  // Einfügen (Strg+V) eines Bildes, Ziehen aufs Meldungsfeld
  useEffect(() => {
    const paste = (ev: ClipboardEvent) => {
      if (file) return;
      const f = imageFromTransfer(ev.clipboardData);
      if (f) { ev.preventDefault(); setFile(f); }
    };
    const box = btn.current?.closest<HTMLElement>(".entry");
    const over = (ev: DragEvent) => { if ([...(ev.dataTransfer?.types ?? [])].includes("Files")) { ev.preventDefault(); setDrop(true); } };
    const leave = (ev: DragEvent) => { if (!box?.contains(ev.relatedTarget as Node)) setDrop(false); };
    const dropped = (ev: DragEvent) => { setDrop(false); const f = imageFromTransfer(ev.dataTransfer); if (f) { ev.preventDefault(); setFile(f); } };
    document.addEventListener("paste", paste);
    box?.addEventListener("dragover", over); box?.addEventListener("dragleave", leave); box?.addEventListener("drop", dropped);
    return () => {
      document.removeEventListener("paste", paste);
      box?.removeEventListener("dragover", over); box?.removeEventListener("dragleave", leave); box?.removeEventListener("drop", dropped);
    };
  }, [file]);
  useEffect(() => { btn.current?.closest(".entry")?.classList.toggle("photo-drop", drop); }, [drop]);

  useEffect(() => {
    if (!menu) return;
    const off = (ev: PointerEvent) => { if (!(ev.target as HTMLElement).closest(".ph-menu, .ph-btn")) setMenu(false); };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [menu]);

  const chosen = (ev: ChangeEvent<HTMLInputElement>) => { const f = ev.target.files?.[0]; ev.target.value = ""; setMenu(false); if (f) setFile(f); };
  /** «Neu aufnehmen»: Dialog zu, gleich wieder Kamera bzw. Dateiauswahl (im Klick, damit der Browser es erlaubt) */
  const retake = () => { setFile(null); (coarse() ? cam : pick).current?.click(); };

  return (
    <span className="ph-wrap">
      <button ref={btn} type="button" className="chipbtn ph-btn" aria-expanded={menu}
        title="Foto eines Meldezettels oder einer Journalseite – Text wird offline erkannt (auch Einfügen mit Strg+V oder Bild aufs Feld ziehen)"
        onClick={() => (coarse() ? setMenu(!menu) : pick.current?.click())}>
        {ICON_CAM}<span>Foto</span>
      </button>
      {menu && (
        <span className="ph-menu" role="menu">
          <button role="menuitem" onClick={() => cam.current?.click()}>Kamera</button>
          <button role="menuitem" onClick={() => pick.current?.click()}>Bild wählen</button>
        </span>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={chosen} />
      <input ref={pick} type="file" accept="image/*" hidden onChange={chosen} />
      {file && <PhotoDialog {...p} file={file} onClose={() => setFile(null)} onRetake={retake} />}
    </span>
  );
}

/** Foto, das an die nächste eingetragene Meldung gehängt wird (im Meldungsfeld) */
export function PendingAttachment({ att, onRemove }: { att: Attachment; onRemove: () => void }) {
  const u = useBlobUrl(att.id, true);
  return (
    <span className="chip ph-pending" title="wird an die nächste eingetragene Meldung gehängt">
      {u && att.kind === "foto" && <img src={u} alt="" />}
      {attLabel(att)}{att.cell ? ` · an ${att.cell}` : ""} wird angehängt
      <button type="button" className="ph-pending-x" onClick={onRemove} aria-label={att.kind === "foto" ? "Foto nicht anhängen" : "Sprachmemo nicht anhängen"} title="nicht anhängen">×</button>
    </span>
  );
}

type Step =
  | { s: "laden" }
  | { s: "bereit" }
  | { s: "ocr"; label: string; p: number }
  | { s: "leer"; conf: number; q: PhotoQuality }
  | { s: "fehler"; msg: string };

/** unter dieser Sicherheit wird bei dunklem/unscharfem Foto auf die Bildqualität hingewiesen */
const QUALITY_HINT = 75;

/** Hinweis bei schlechter Bildqualität (statt «Handschrift?») */
function qualityText(q: PhotoQuality): string {
  return q.verdict === "dunkel" ? "Foto zu dunkel" : q.verdict === "unscharf" ? "Foto unscharf" : "";
}

function PhotoDialog({ file, ex, day, say, onAttach, onCell, onCommit, onClose, onRetake }: PhotoProps & { file: File; onClose: () => void; onRetake: () => void }) {
  const [ph, setPh] = useState<PreparedPhoto | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [rot, setRot] = useState(0);
  const [step, setStep] = useState<Step>({ s: "laden" });
  const [rect, setRect] = useState<Rect | null>(null);
  const [cell, setCell] = useState("");
  const [ocr, setOcr] = useState<OcrState>("unbekannt");
  /** Foto nicht im Gerätespeicher (voll) – nur im Arbeitsspeicher dieses Fensters */
  const [unsaved, setUnsaved] = useState(false);
  const [review, setReview] = useState<{ items: BatchItem[]; att: Attachment; conf: number; q: PhotoQuality; rot: number; ki?: { notes?: string; sent: KiRequest["disclosure"] }; n: number } | null>(null);
  const ki = useKi();
  const used = useRef(false);
  const saved = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const online = navigator.onLine;

  useEffect(() => { ocrState().then(setOcr); }, []);
  // Foto vorbereiten (verkleinern, EXIF-Drehung), sofort im Gerätespeicher ablegen
  useEffect(() => {
    let gone = false;
    setStep({ s: "laden" });
    (async () => {
      try {
        const r = await preparePhoto(file, rot);
        if (gone) return;
        if (saved.current) await deleteAttachmentBlob(saved.current);
        // Gerätespeicher voll/blockiert: Foto bleibt im Arbeitsspeicher (putBlob) – ehrlich melden, nicht «nicht lesbar»
        let ok = true;
        try { await storeAttachmentBlob(r.att, r.blob, r.canvas); } catch { ok = false; }
        if (gone) return;
        saved.current = r.att.id;
        setUnsaved(!ok);
        setPh(r);
        setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(r.blob); });
        setRect(null);
        setStep({ s: "bereit" });
      } catch (e) {
        if (!gone) setStep({ s: "fehler", msg: "Bild konnte nicht gelesen werden" + ((e as Error).message ? `: ${(e as Error).message}` : "") });
      }
    })();
    return () => { gone = true; };
  }, [file, rot]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  /** Dialog zu: Foto nicht gebraucht → wieder löschen */
  const close = () => {
    abort.current?.abort();
    if (!used.current && saved.current) void deleteAttachmentBlob(saved.current);
    onClose();
  };
  useEffect(() => {
    if (review) return;
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !ev.defaultPrevented) { ev.preventDefault(); close(); } };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const cellOk = !cell.trim() || findCells(cell.trim().toUpperCase(), ex.sheets).length > 0;
  const att = (): Attachment => ({ ...ph!.att, ...(cell.trim() && cellOk ? { cell: cell.trim().toUpperCase().replace(/\s+/g, " ") } : {}) });

  const run = async () => {
    if (!ph) return;
    const ac = new AbortController();
    abort.current = ac;
    try {
      if (ocr !== "bereit") {
        setStep({ s: "ocr", label: `Texterkennung wird geladen (einmalig, ≈ ${OCR_MB} MB)`, p: 0 });
        await abortable(downloadOcr((d, t) => { if (!ac.signal.aborted) setStep({ s: "ocr", label: `Texterkennung wird geladen – ${fmtSize(d)} von ${fmtSize(t)}`, p: (d / t) * 0.5 }); }, ac.signal), ac.signal);
        setOcr("bereit");
      }
      setStep({ s: "ocr", label: "Bild wird aufbereitet", p: 0.5 });
      await new Promise((r) => window.setTimeout(r, 20));
      if (ac.signal.aborted) return;
      const prep = ocrPrepare(ph.canvas, rect);
      const r = await recognizeOriented(prep, (g, attempt) => {
        const again = attempt ? (prep.quality.verdict === "gut" ? "anders gedreht" : "geglättet") : "";
        return recognize(grayCanvas(g), (q) => {
          if (ac.signal.aborted) return;
          const label = again && q.phase === "erkennen" ? `Schlecht lesbar – neuer Versuch (${again})` : q.label;
          setStep({ s: "ocr", label, p: q.phase === "erkennen" ? (attempt ? 0.8 + 0.2 * q.p : 0.6 + 0.4 * q.p * (again ? 0.5 : 1)) : 0.5 + 0.1 * q.p });
        }, ac.signal);
      }, ac.signal);
      if (ac.signal.aborted) return;
      const texts = ocrToMeldungen(r.text, (c) => findCells(c, ex.sheets).length > 0, ex.days, ex.areas.filter((x) => x.kind === "nai").map((x) => x.name));
      const a: Attachment = { ...att(), text: r.text.trim(), engine: "ocr-offline" };
      if (!texts.length) { setStep({ s: "leer", conf: r.confidence, q: r.quality }); return; }
      const stamp = attLabel(a);
      setReview({ items: texts.map((t, i) => ({ text: t, origin: originOf(stamp, i, texts.length) })), att: a, conf: r.confidence, q: r.quality, rot: r.rotation, n: Date.now() });
    } catch (e) {
      if (ac.signal.aborted || e instanceof OcrAbort) { if (abort.current === ac) setStep({ s: "bereit" }); return; }
      setStep({ s: "fehler", msg: navigator.onLine || ocr === "bereit" ? `Texterkennung fehlgeschlagen: ${(e as Error).message ?? e}` : "Texterkennung noch nicht geladen – braucht einmal Netz. Das Foto kann trotzdem angehängt werden." });
    }
  };
  /** Handschrift von der KI gelesen → gleiche Prüfung wie nach der Texterkennung (Herkunft «KI») */
  const kiLines = (rows: KiZeile[], notes: string | undefined, sent: KiRequest["disclosure"]) => {
    if (!ph) return;
    const a: Attachment = { ...att(), text: rows.map((r) => r.line).join("\n"), engine: "ki" };
    const stamp = attLabel(a);
    setReview({
      items: rows.map((r, i) => ({ text: r.line, origin: `KI · ${originOf(stamp, i, rows.length)}`, ki: true, unsicher: r.unsicher })),
      att: a, conf: 100, q: review?.q ?? { bright: 255, contrast: 255, sharp: 1.3, verdict: "gut" }, rot: 0, ki: { notes, sent }, n: Date.now(),
    });
    setStep({ s: "bereit" });
  };
  /** Abbrechen: sofort zurück (Erkennung bzw. Laden wird im Hintergrund beendet) */
  const cancel = () => { abort.current?.abort(); setStep({ s: "bereit" }); };

  // Ausschnitt ziehen (Bildkoordinaten = Pixel des vorbereiteten Fotos)
  const toImg = (ev: RPointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * ph!.canvas.width, y: ((ev.clientY - r.top) / r.height) * ph!.canvas.height };
  };
  const pDown = (ev: RPointerEvent) => { if (!ph || step.s === "ocr") return; ev.preventDefault(); (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId); drag.current = toImg(ev); setRect(null); };
  const pMove = (ev: RPointerEvent) => { if (!drag.current) return; const q = toImg(ev); setRect({ x: drag.current.x, y: drag.current.y, w: q.x - drag.current.x, h: q.y - drag.current.y }); };
  const pUp = () => { drag.current = null; setRect((r) => (r && ph ? clampRect(r, ph.canvas.width, ph.canvas.height) : null)); };
  const shown = rect && ph ? clampRect(rect, ph.canvas.width, ph.canvas.height) ?? null : null;

  const lowConf = (conf: number) => conf < LOW_CONFIDENCE;
  /** schlechte Bildqualität und unsichere Erkennung → «neu aufnehmen» statt «Handschrift?» */
  const badPhoto = (conf: number, q: PhotoQuality) => q.verdict !== "gut" && conf < QUALITY_HINT;
  /** schlecht lesbar: bei schlechter Bildqualität «neu aufnehmen», sonst «Handschrift?» (KI nur wenn eingeschaltet) */
  const kiHint = (conf: number, q: PhotoQuality) => badPhoto(conf, q) ? (
    <span className="ph-ki ph-bad">
      <b>{qualityText(q)} – {lowConf(conf) ? "neu aufnehmen" : "bitte genau prüfen oder neu aufnehmen"}.</b> Erkannt mit Sicherheit {Math.round(conf)} %{q.verdict === "dunkel" ? " – mehr Licht, Schatten vermeiden" : " – Gerät ruhig halten, scharf stellen"}.
      {" "}<button className="chipbtn" onClick={() => { abort.current?.abort(); onRetake(); }}>Neu aufnehmen</button>
    </span>
  ) : (
    <span className="ph-ki">
      {lowConf(conf) ? <>Schlecht lesbar (Sicherheit {Math.round(conf)} %) – <b>Handschrift?</b> Gedruckter Text wird offline erkannt, Handschrift kaum.</> : <>Handschrift wird offline kaum erkannt.</>}
      {" "}<KiPhotoButton ex={ex} canvas={ph?.canvas ?? null} rect={shown} onLines={kiLines} showOff />
    </span>
  );
  const rotNote = (rot: number) => (rot ? <> · Foto lag {rot === 2 ? "verkehrt" : "quer"} – automatisch gedreht</> : null);

  if (review) return (
    <BatchReview key={review.n} ex={ex} day={day} items={review.items} attachment={review.att}
      title={review.ki ? (review.items.length === 1 ? "1 Meldung von der KI gelesen" : `${review.items.length} Meldungen von der KI gelesen`) : undefined}
      notice={review.ki ? <span className="ph-conf ph-kiconf"><b>KI-Vorschlag (Claude)</b> – jede Zeile mit dem Foto vergleichen, dann übernehmen.{review.items.some((x) => x.unsicher?.length) ? <> Unsichere Zeilen sind <b>nicht angehakt</b>.</> : null}{review.ki.notes ? <> Hinweis der KI: «{review.ki.notes}»</> : null}<SentInfo disclosure={review.ki.sent} /></span>
        : lowConf(review.conf) || badPhoto(review.conf, review.q) ? <>{kiHint(review.conf, review.q)}{rotNote(review.rot)}</>
        : <span className="ph-conf">Gedruckter Text offline erkannt · Sicherheit {Math.round(review.conf)} %{rotNote(review.rot)} · bitte prüfen{ki && ki.state !== "aus" ? <> · Handschrift? <KiPhotoButton ex={ex} canvas={ph?.canvas ?? null} rect={shown} onLines={kiLines} /></> : null}</span>}
      onCommit={(texts) => { used.current = true; onCommit(texts, review.att); }}
      onClose={() => { if (!used.current) { setReview(null); setStep({ s: "bereit" }); return; } onClose(); }} />
  );

  const busy = step.s === "ocr" || step.s === "laden";
  return createPortal(
    <div className="ph-back" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
      <div className="ph-dlg" role="dialog" aria-modal="true" aria-label="Foto">
        <header className="ph-head">
          <b className="ph-title">Foto{ph ? ` ${attLabel(ph.att).slice(5)}` : ""}</b>
          {ph && <span className="ph-meta tnum">{ph.canvas.width} × {ph.canvas.height} · {fmtSize(ph.att.size)}</span>}
          <span className="ph-sp" />
          <button className="ph-icon" onClick={() => setRot((r) => r - 1)} disabled={busy} title="Links drehen" aria-label="Links drehen">⟲</button>
          <button className="ph-icon" onClick={() => setRot((r) => r + 1)} disabled={busy} title="Rechts drehen" aria-label="Rechts drehen">⟳</button>
          <button className="ph-icon ph-x" onClick={close} aria-label="Schliessen" title="Schliessen (Esc)">×</button>
        </header>
        <div className="ph-stage">
          {url ? (
            <div className="ph-imgwrap" onPointerDown={pDown} onPointerMove={pMove} onPointerUp={pUp} onPointerCancel={pUp}>
              <img ref={imgRef} src={url} alt="Foto" draggable={false} />
              {shown && ph && (
                <div className="ph-rect" style={{ left: `${(shown.x / ph.canvas.width) * 100}%`, top: `${(shown.y / ph.canvas.height) * 100}%`, width: `${(shown.w / ph.canvas.width) * 100}%`, height: `${(shown.h / ph.canvas.height) * 100}%` }} />
              )}
            </div>
          ) : <p className="help">Foto wird vorbereitet …</p>}
        </div>
        <div className="ph-body">
          <p className="help ph-tip">{shown ? <>Nur der markierte Ausschnitt wird erkannt. <button className="linkbtn" onClick={() => setRect(null)}>Ganzes Bild</button></> : "Optional: Bereich mit dem Text auf dem Foto aufziehen (z. B. nur die Tabelle)."}</p>
          {step.s === "ocr" && (
            <div className="progress ph-prog"><div style={{ width: `${Math.round(step.p * 100)}%` }} /><span>{step.label} …</span></div>
          )}
          {step.s === "leer" && <p className="help warn">Kein Text erkannt. {kiHint(step.conf, step.q)}</p>}
          {step.s === "fehler" && <p className="help warn">{step.msg}</p>}
          {unsaved && <p className="help warn ph-unsaved" role="alert"><b>Foto nicht gespeichert – Datei sichern.</b> Gerätespeicher voll: Das Foto liegt nur in diesem Fenster und geht beim Schliessen verloren, ausser es wird mit «Speichern» als Datei gesichert.</p>}
          {ocr !== "bereit" && step.s === "bereit" && (
            <p className="help">{online ? `Texterkennung läuft auf dem Gerät – beim ersten Mal werden ≈ ${OCR_MB} MB geladen, danach offline.` : "Offline: Texterkennung ist noch nicht geladen (braucht einmal Netz). Das Foto lässt sich trotzdem anhängen."}</p>
          )}
          <label className="ph-cell">An Planquadrat <span className="help">(optional)</span>
            <input value={cell} onChange={(e) => setCell(e.target.value)} placeholder="z. B. AG13" className={"mono" + (cellOk ? "" : " bad")} aria-invalid={!cellOk} />
          </label>
          {!cellOk && <p className="help warn">Planquadrat «{cell}» gibt es im Raster nicht.</p>}
          {ki && ki.state !== "aus" && ph && step.s !== "ocr" && step.s !== "leer" && (
            <div className="ph-kirow"><span className="help">Handschrift?</span><KiPhotoButton ex={ex} canvas={ph.canvas} rect={shown} onLines={kiLines} label="Mit KI lesen" /></div>
          )}
        </div>
        <footer className="ph-foot">
          {step.s === "ocr"
            ? <button onClick={cancel}>Abbrechen</button>
            : <>
              <button onClick={() => { if (!ph) return; used.current = true; onAttach(att()); onClose(); }} disabled={!ph || !cellOk} title="Foto an die Meldung hängen, die im Feld getippt wird">An Meldung im Feld</button>
              {cell.trim() && <button onClick={() => { if (!ph) return; used.current = true; onCell(att()); say(`Foto an ${att().cell} gehängt`); onClose(); }} disabled={!ph || !cellOk}>Nur an {cell.trim().toUpperCase()}</button>}
              <button className="primary" onClick={run} disabled={!ph || busy || !cellOk || (ocr !== "bereit" && !online)}>Text erkennen</button>
            </>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Zeile in der Offline-Box: Texterkennung vorab laden (≈ 5 MB), danach offline */
export function OcrOffline() {
  const [st, setSt] = useState<OcrState | "laedt">("unbekannt");
  const [prog, setProg] = useState<{ d: number; t: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { ocrState().then(setSt); }, []);
  const load = async () => {
    setErr(null); setSt("laedt"); setProg({ d: 0, t: 1 });
    try {
      await downloadOcr((d, t) => setProg({ d, t }));
      setSt(await ocrState());
    } catch (e) {
      setErr((e as Error).message || "nicht geladen"); setSt("fehlt");
    } finally { setProg(null); }
  };
  if (st === "bereit") return <p className="help ph-ocrok">✓ Texterkennung (Fotos) offline verfügbar.</p>;
  return (
    <>
      {prog ? (
        <div className="progress"><div style={{ width: `${Math.round((prog.d / Math.max(1, prog.t)) * 100)}%` }} /><span>Texterkennung {fmtSize(prog.d)} / {fmtSize(prog.t)}</span></div>
      ) : (
        <div className="btnrow">
          <button onClick={load} disabled={!navigator.onLine} title="Gedruckten Text auf Fotos (Meldezettel, Journalseite) ohne Netz erkennen">Texterkennung offline (≈ {OCR_MB} MB) – laden</button>
        </div>
      )}
      {err && <p className="help warn">Texterkennung: {err}</p>}
    </>
  );
}
