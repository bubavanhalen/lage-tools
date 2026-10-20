/**
 * BNB-Bilder einpflegen: Bild auf der Karte einpassen (automatisch oder mit Passpunkten),
 * NAI-Umrisse erkennen und als Linien übernehmen. Das Bild selbst wird danach verworfen.
 * Mehrere Bilder (z. B. aus einer Word-Datei) werden nacheinander abgearbeitet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  applyAffine,
  areaFromRing,
  colorMask,
  detectAllOutlines,
  detectOutline,
  fitAffine,
  fitScaleShift,
  invertAffine,
  overlayColor,
  pointInRing,
  residualsOf,
  ringCentroid,
  type Affine,
  type Area,
  type LV95,
  type XY,
} from "@lage/core";
import { AffineImageLayer, toLatLng, toLv95 } from "@lage/map";
import { imageDataOf, type Candidate } from "./imageimport";
import { autoPlace, refinePlace, type PlaceResult } from "./autoplace";

interface Props {
  candidates: Candidate[];
  map: L.Map;
  existing: Area[];
  onAreas: (areas: Area[]) => void;
  onClose: () => void;
}

interface Pair { img?: XY; map?: LV95 }
interface Found { area: Area; on: boolean }
type Mode = "place" | "points" | "nai";
type RGB = [number, number, number];

const COLOR_KEY = "lage-tools.naiColor";
const numIcon = (n: number, cls: string) => L.divIcon({ className: `lt-pin ${cls}`, html: `<span>${n}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
const hex = (c: RGB) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const loadColor = (): RGB | null => { try { const v = JSON.parse(localStorage.getItem(COLOR_KEY) ?? "null"); return Array.isArray(v) && v.length === 3 ? (v as RGB) : null; } catch { return null; } };
const saveColor = (c: RGB) => { try { localStorage.setItem(COLOR_KEY, JSON.stringify(c)); } catch { /* egal */ } };

export function GeorefPane({ candidates, map, existing, onAreas, onClose }: Props) {
  const [idx, setIdx] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [taken, setTaken] = useState(0);
  const [mode, setMode] = useState<Mode>("place");
  const [place, setPlace] = useState<PlaceResult | { t: Affine; score?: number; ref?: undefined } | null>(null);
  const [busy, setBusy] = useState<{ p: number; what: string } | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([{}, {}]);
  const [active, setActive] = useState(0);
  const [distorted, setDistorted] = useState(false);
  const [lineColor, setLineColor] = useState<RGB | null>(loadColor);
  const [lineWidth, setLineWidth] = useState(4);
  const [tol, setTol] = useState(70);
  const [pickColor, setPickColor] = useState(false);
  const [found, setFound] = useState<Found[]>([]);
  const [showImg, setShowImg] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const viewerEl = useRef<HTMLDivElement>(null);
  const viewer = useRef<L.Map | null>(null);
  const imgLayer = useRef<L.LayerGroup>(L.layerGroup());
  const mapLayer = useRef<L.LayerGroup>(L.layerGroup());
  const preview = useRef<AffineImageLayer | null>(null);
  const homeView = useRef<{ c: L.LatLng; z: number } | null>(null);

  const cand = candidates[idx]!;
  const imgData = useMemo(() => imageDataOf(cand.canvas), [cand]);
  const dataUrl = useMemo(() => cand.canvas.toDataURL("image/jpeg", 0.85), [cand]);

  // ---------- Passpunkte → Transformation ----------
  const complete = pairs.map((p, i) => ({ ...p, i })).filter((p) => p.img && p.map) as Array<Required<Pair> & { i: number }>;
  const pointFit = useMemo(() => {
    const need = distorted ? 3 : 2;
    if (complete.length < need) return null;
    const src = complete.map((p) => p.img), dst = complete.map((p) => ({ x: p.map.e, y: p.map.n }));
    try {
      if (distorted) { const f = fitAffine(src, dst); return { t: f.t, ...residualsOf(f.t, src, dst) }; }
      return fitScaleShift(src, dst);
    } catch (e) { return { error: (e as Error).message }; }
  }, [pairs, distorted]); // eslint-disable-line react-hooks/exhaustive-deps
  const t: Affine | null = mode === "points" ? (pointFit && "t" in pointFit ? pointFit.t : null) : place?.t ?? null;

  // ---------- Bildbetrachter ----------
  useEffect(() => {
    if (!viewerEl.current) return;
    const v = L.map(viewerEl.current, { crs: L.CRS.Simple, minZoom: -6, maxZoom: 4, zoomSnap: 0.25, attributionControl: false });
    const b = L.latLngBounds([-cand.canvas.height, 0], [0, cand.canvas.width]);
    L.imageOverlay(dataUrl, b).addTo(v);
    v.fitBounds(b);
    imgLayer.current.addTo(v);
    viewer.current = v;
    const ro = new ResizeObserver(() => { v.invalidateSize(); });
    ro.observe(viewerEl.current);
    return () => { ro.disconnect(); v.remove(); viewer.current = null; };
  }, [cand, dataUrl]);

  // Grösse des Betrachters wechselt mit dem Modus → neu einpassen
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const id = window.setTimeout(() => { v.invalidateSize(); v.fitBounds(L.latLngBounds([-cand.canvas.height, 0], [0, cand.canvas.width])); }, 30);
    return () => window.clearTimeout(id);
  }, [mode, cand]);

  // ---------- Klicks ----------
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const onClick = (ev: L.LeafletMouseEvent) => {
      const p = { x: ev.latlng.lng, y: -ev.latlng.lat };
      if (p.x < 0 || p.y < 0 || p.x > cand.canvas.width || p.y > cand.canvas.height) return; // neben dem Bild
      if (mode === "points") setPairs((ps) => ps.map((q, i) => (i === active ? { ...q, img: p } : q)));
      else if (mode === "nai") { if (pickColor || !lineColor) choosePixelColor(p); else addAt(p); }
    };
    v.on("click", onClick);
    return () => { v.off("click", onClick); };
  });

  useEffect(() => {
    if (mode === "place") return;
    const onClick = (ev: L.LeafletMouseEvent) => {
      const q = toLv95(ev.latlng);
      if (mode === "points") setPairs((ps) => ps.map((x, i) => (i === active ? { ...x, map: q } : x)));
      else if (t && lineColor && !pickColor) addAt(applyAffine(invertAffine(t), { x: q.e, y: q.n }));
    };
    map.on("click", onClick);
    map.getContainer().classList.add("lt-picking");
    return () => { map.off("click", onClick); map.getContainer().classList.remove("lt-picking"); };
  });

  // nächstes offenes Paar aktivieren
  useEffect(() => {
    const cur = pairs[active];
    if (cur?.img && cur?.map) {
      const next = pairs.findIndex((p) => !p.img || !p.map);
      if (next >= 0 && next !== active) setActive(next);
    }
  }, [pairs, active]);

  // ---------- Zeichnen: Marker, erkannte Flächen ----------
  useEffect(() => {
    imgLayer.current.clearLayers();
    mapLayer.current.clearLayers();
    if (mode === "points") {
      pairs.forEach((p, i) => {
        const cls = i === active ? "act" : "";
        if (p.img) L.marker([-p.img.y, p.img.x], { icon: numIcon(i + 1, cls), interactive: false }).addTo(imgLayer.current);
        if (p.map) L.marker(toLatLng(p.map), { icon: numIcon(i + 1, cls), interactive: false }).addTo(mapLayer.current);
      });
    }
    if (t) {
      const inv = invertAffine(t);
      for (const f of found) {
        const style = { color: f.on ? "#c8102e" : "#888", weight: f.on ? 2.5 : 1.5, dashArray: f.on ? undefined : "4 4", fillOpacity: f.on ? 0.08 : 0, interactive: false };
        L.polygon(f.area.ring.map((q) => { const p = applyAffine(inv, { x: q.e, y: q.n }); return [-p.y, p.x] as [number, number]; }), style).addTo(imgLayer.current);
        if (f.on) L.polygon(f.area.ring.map(toLatLng), style).addTo(mapLayer.current);
      }
    }
    mapLayer.current.addTo(map);
    return () => { mapLayer.current.remove(); };
  }, [pairs, active, found, t, map, mode]);

  // Bild halbtransparent auf der Karte – nur zur Kontrolle beim Einpassen
  useEffect(() => {
    preview.current?.remove();
    preview.current = null;
    if (t && showImg) preview.current = new AffineImageLayer(dataUrl, cand.canvas.width, cand.canvas.height, t, mode === "nai" ? 0.45 : 0.6).addTo(map);
    return () => { preview.current?.remove(); preview.current = null; };
  }, [t, showImg, cand, dataUrl, map, mode]);

  // ---------- Aktionen ----------
  const footprint = (tt: Affine) => {
    const pts = [[0, 0], [cand.canvas.width, 0], [cand.canvas.width, cand.canvas.height], [0, cand.canvas.height]].map(([x, y]) => applyAffine(tt, { x: x!, y: y! }));
    return L.latLngBounds(pts.map((p) => toLatLng({ e: p.x, n: p.y })));
  };

  const runAuto = async () => {
    const b = map.getBounds();
    const sw = toLv95(b.getSouthWest()), ne = toLv95(b.getNorthEast());
    const view = { minE: sw.e, maxE: ne.e, minN: sw.n, maxN: ne.n };
    if (view.maxE - view.minE > 60000) {
      setMsg("Zuerst näher an das Gebiet zoomen (oben rechts Ort suchen). Der Kartenausschnitt sollte das Gebiet des Bildes zeigen, höchstens etwa 50 km breit.");
      return;
    }
    homeView.current ??= { c: map.getCenter(), z: map.getZoom() };
    setMsg(null);
    setBusy({ p: 0, what: "Karte laden …" });
    try {
      const r = await autoPlace(cand.canvas, view, (p, what) => setBusy({ p, what }));
      if (!r || r.score < 0.4) {
        setMsg("Nicht gefunden. Näher an den Ort des Bildes zoomen – die Karte sollte etwa gleich viel Gelände zeigen wie das Bild, höchstens etwa zehnmal so viel – und nochmals versuchen. Oder von Hand mit Passpunkten.");
        setPlace(null);
      } else {
        setPlace(r);
        setShowImg(true);
        map.fitBounds(footprint(r.t), { padding: [30, 30] });
        setMsg(r.score > 0.6 ? null : "Unsicherer Treffer – bitte prüfen, ob das Bild mit der Karte übereinstimmt.");
      }
    } catch (e) {
      setMsg("Automatisches Einpassen fehlgeschlagen: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runRefine = async () => {
    if (!t) return;
    setBusy({ p: 0, what: "Feinabgleich …" });
    try {
      const r = await refinePlace(cand.canvas, t, (p, what) => setBusy({ p, what }));
      if (r && r.score > 0.4) { setPlace(r); setMode("place"); setMsg(null); map.fitBounds(footprint(r.t), { padding: [30, 30] }); }
      else setMsg("Feinabgleich hat nichts Besseres gefunden – die Passpunkte bleiben.");
    } finally {
      setBusy(null);
    }
  };

  const startNai = () => {
    if (mode === "points" && t) setPlace({ t });
    setMode("nai");
    setShowImg(false);
    // Linienfarbe: Bild mit der Landeskarte vergleichen – was nicht zur Karte gehört, ist die Zeichnung
    const ref = mode === "place" ? place?.ref : undefined;
    let c = lineColor;
    if (ref && t) {
      const toRef = (x: number, y: number) => { const p = applyAffine(t, { x, y }); return { x: (p.x - ref.minE) / ref.res, y: (ref.maxN - p.y) / ref.res }; };
      c = overlayColor(imgData, ref.img, toRef) ?? c;
    }
    if (c) {
      const w = lineWidthOf(c);
      setLineColor(c); saveColor(c); setLineWidth(w);
      detectAll(c, w, tol);
    } else { setPickColor(true); setMsg("Auf eine NAI-Linie im Bild klicken – so weiss ich, welche Farbe die NAI haben."); }
  };

  /** typische Linienbreite: häufigste Lauflänge der Linienfarbe (waagrecht und senkrecht) */
  const lineWidthOf = (c: RGB) => {
    const m = colorMask(imgData, c, tol);
    const counts = new Array(32).fill(0) as number[];
    const scan = (n: number, len: number, at: (i: number, k: number) => number) => {
      for (let i = 0; i < n; i += 3) { let run = 0; for (let k = 0; k <= len; k++) { if (k < len && m.data[at(i, k)]) run++; else { if (run > 0 && run < 32) counts[run]!++; run = 0; } } }
    };
    scan(m.height, m.width, (i, k) => i * m.width + k);
    scan(m.width, m.height, (i, k) => k * m.width + i);
    let best = 3;
    counts.forEach((v, i) => { if (i >= 1 && v > counts[best]!) best = i; });
    return Math.max(2, Math.min(20, best));
  };

  const naming = (rings: LV95[][], start: number): Area[] => {
    let n = start;
    return rings.map((ring, i) => {
      // Fläche, die andere Flächen enthält → Raum
      const others = rings.filter((_, k) => k !== i);
      const isRoom = others.some((o) => { const c = ringCentroid(o.map((p) => ({ x: p.e, y: p.n }))); return pointInRing(c, ring.map((p) => ({ x: p.e, y: p.n }))); });
      return areaFromRing(isRoom ? "Raum" : `NAI ${++n}`, ring, isRoom ? "ao" : "nai", lineColor ? hex(lineColor) : undefined);
    });
  };

  const naiStart = () => existing.filter((a) => a.kind === "nai").length + taken;

  const detectAll = (c: RGB, lw: number, tolerance: number) => {
    if (!t) return;
    const rings = detectAllOutlines(imgData, c, { tolerance, lineWidth: lw, closeGaps: 1, simplify: 1.5 });
    const lv = rings.map((r) => r.map((q) => { const p = applyAffine(t, q); return { e: p.x, n: p.y }; }));
    const areas = naming(lv, naiStart()).map((a) => ({ ...a, color: hex(c) }));
    setFound(areas.map((area) => ({ area, on: true })));
    setMsg(areas.length
      ? `${areas.length} Fläche${areas.length === 1 ? "" : "n"} erkannt. Falsche abwählen, Namen anpassen. Fehlt eine: im Bild hineinklicken.`
      : "Keine geschlossene Fläche erkannt. In ein NAI klicken oder die Toleranz erhöhen.");
  };

  const choosePixelColor = (p: XY) => {
    const x = Math.round(p.x), y = Math.round(p.y);
    let c: RGB = [255, 255, 255];
    let best = -1;
    const zoom = viewer.current?.getZoom() ?? 0;
    const R = Math.max(3, Math.min(25, Math.ceil(6 / 2 ** zoom))); // ca. 6 Bildschirmpixel
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= imgData.width || yy >= imgData.height) continue;
      const k = (yy * imgData.width + xx) * 4;
      const px: RGB = [imgData.data[k]!, imgData.data[k + 1]!, imgData.data[k + 2]!];
      const sat = Math.max(...px) - Math.min(...px);
      if (sat > best) { best = sat; c = px; }
    }
    if (Math.max(...c) - Math.min(...c) < 40) { setMsg("Das ist keine farbige Linie. Bitte genau auf die farbige NAI-Umrandung klicken (im Bild hineinzoomen)."); return; }
    const w = lineWidthOf(c);
    setLineColor(c); saveColor(c); setLineWidth(w); setPickColor(false);
    detectAll(c, w, tol);
  };

  const addAt = (p: XY) => {
    if (!t || !lineColor) return;
    const ring = detectOutline(imgData, p, lineColor, { tolerance: tol, lineWidth, closeGaps: 1, simplify: 1.5 });
    if (!ring) { setMsg("Dort ist keine geschlossene Fläche. Genauer hineinklicken oder Toleranz erhöhen."); return; }
    const lv = ring.map((q) => { const r = applyAffine(t, q); return { e: r.x, n: r.y }; });
    const n = naiStart() + found.filter((f) => f.area.kind === "nai").length + 1;
    setFound((f) => [...f, { area: areaFromRing(`NAI ${n}`, lv, "nai", hex(lineColor)), on: true }]);
    setMsg(null);
  };

  const nextImage = () => {
    setDoneCount((d) => d + 1);
    if (idx + 1 >= candidates.length) { onClose(); return; }
    setIdx(idx + 1);
    setMode("place"); setPlace(null); setPairs([{}, {}]); setActive(0); setFound([]); setMsg(null); setDistorted(false); setShowImg(true);
    if (homeView.current) map.setView(homeView.current.c, homeView.current.z);
  };

  const accept = () => {
    const sel = found.filter((f) => f.on).map((f) => f.area);
    if (sel.length) { onAreas(sel); setTaken((n) => n + sel.filter((a) => a.kind === "nai").length); }
    nextImage();
  };

  const steps = (
    <div className="steps">
      <span className={mode !== "nai" ? "on" : ""}>1 Einpassen</span>
      <span className={mode === "nai" ? "on" : ""}>2 NAI</span>
      {candidates.length > 1 && <span className="count">Bild {idx + 1} / {candidates.length}</span>}
    </div>
  );

  return (
    <div className="panel georef">
      {steps}
      <div ref={viewerEl} className={"viewer" + (mode === "points" ? " big" : "")} />
      {busy && (
        <div className="progress"><div style={{ width: `${Math.round(busy.p * 100)}%` }} /><span>{busy.what}</span></div>
      )}

      {mode === "place" && (
        <>
          {!place ? (
            <p className="help">Karte auf den Ort des Bildes stellen (oben rechts <b>Ort suchen</b>) und so weit zoomen, dass die Karte <b>etwa gleich viel Gelände</b> zeigt wie das Bild. Dann <b>Automatisch einpassen</b>.</p>
          ) : (
            <p className="help">Gefunden{place.score !== undefined ? ` (Übereinstimmung ${Math.round(place.score * 100)} %)` : ""}. Liegt das Bild deckungsgleich auf der Karte?</p>
          )}
          {msg && <p className="help warn">{msg}</p>}
          <div className="btnrow">
            {place && <button className="primary" disabled={!!busy} onClick={startNai}>Passt – weiter zu den NAI</button>}
            <button className={place ? "" : "primary"} disabled={!!busy} onClick={runAuto}>{place ? "Nochmals suchen" : "Automatisch einpassen"}</button>
          </div>
          <div className="btnrow">
            <button disabled={!!busy} onClick={() => { setMode("points"); setMsg(null); }}>Von Hand: Passpunkte</button>
            {place && <label className="check"><input type="checkbox" checked={showImg} onChange={(e) => setShowImg(e.target.checked)} /> Bild einblenden</label>}
          </div>
        </>
      )}

      {mode === "points" && (
        <>
          <p className="help">Punkt <b>{active + 1}</b>: einen markanten Ort <b>im Bild</b> (links, gross) anklicken – Kreuzung, Brücke, Gebäude – und denselben Ort <b>auf der Karte</b>. Zwei Punkte weit auseinander genügen.</p>
          <ol className="pairs">
            {pairs.map((p, i) => {
              const k = complete.findIndex((c) => c.i === i);
              const res = pointFit && "residuals" in pointFit && k >= 0 ? pointFit.residuals[k] : undefined;
              return (
                <li key={i} className={i === active ? "act" : ""}>
                  <button onClick={() => setActive(i)}>Punkt {i + 1}</button>
                  <span>{p.img ? "Bild ✓" : "Bild –"}</span>
                  <span>{p.map ? "Karte ✓" : "Karte –"}</span>
                  <span className={"mono res" + (res !== undefined && res > 25 ? " bad" : "")}>{res !== undefined ? `${Math.round(res)} m` : ""}</span>
                  <button title="Zurücksetzen" onClick={() => setPairs((ps) => ps.map((q, j) => (j === i ? {} : q)))}>↺</button>
                </li>
              );
            })}
          </ol>
          {pointFit && "error" in pointFit && <p className="help warn">{pointFit.error}</p>}
          <div className="btnrow">
            <button onClick={() => { setPairs((ps) => [...ps, {}]); setActive(pairs.length); }}>+ Punkt</button>
            <label className="check" title="Nur für schräg fotografierte oder gescannte Skizzen"><input type="checkbox" checked={distorted} onChange={(e) => setDistorted(e.target.checked)} /> Foto / Scan (verzerrt, ab 3 Punkten)</label>
          </div>
          {msg && <p className="help warn">{msg}</p>}
          <div className="btnrow">
            <button className="primary" disabled={!t || !!busy} onClick={startNai}>Weiter zu den NAI</button>
            {!distorted && <button disabled={!t || !!busy} onClick={runRefine} title="Bild mit der Landeskarte vergleichen und genau ausrichten">Automatisch feinjustieren</button>}
            <button onClick={() => { setMode("place"); setMsg(null); }}>Zurück</button>
          </div>
        </>
      )}

      {mode === "nai" && (
        <>
          <div className="btnrow">
            <button className={pickColor ? "primary" : ""} onClick={() => { setPickColor(true); setMsg("Auf eine NAI-Linie im Bild klicken."); }}>Linienfarbe wählen</button>
            {lineColor && <span className="swatch" style={{ background: `rgb(${lineColor.join(",")})` }} title={`Linienbreite ≈ ${lineWidth} px`} />}
            <label className="field">Toleranz<input type="range" min={20} max={140} value={tol} onChange={(e) => setTol(+e.target.value)} onPointerUp={() => lineColor && detectAll(lineColor, lineWidth, tol)} onKeyUp={() => lineColor && detectAll(lineColor, lineWidth, tol)} /></label>
          </div>
          {msg && <p className="help">{msg}</p>}
          <ul className="list">
            {found.map((f, i) => (
              <li key={f.area.id}>
                <div className="arearow">
                  <input type="checkbox" checked={f.on} onChange={(e) => setFound((l) => l.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} aria-label="übernehmen" />
                  <input className="aname" value={f.area.name} onChange={(e) => setFound((l) => l.map((x, k) => (k === i ? { ...x, area: { ...x.area, name: e.target.value } } : x)))} />
                  <select value={f.area.kind} onChange={(e) => setFound((l) => l.map((x, k) => (k === i ? { ...x, area: { ...x.area, kind: e.target.value as Area["kind"] } } : x)))} aria-label="Art">
                    <option value="nai">NAI</option><option value="ao">Raum</option><option value="other">Andere</option>
                  </select>
                  <button title="Zeigen" onClick={() => map.fitBounds(L.latLngBounds(f.area.ring.map(toLatLng)), { padding: [60, 60] })}>◎</button>
                </div>
              </li>
            ))}
          </ul>
          <label className="check"><input type="checkbox" checked={showImg} onChange={(e) => setShowImg(e.target.checked)} /> Bild zur Kontrolle einblenden</label>
          <div className="btnrow">
            <button className="primary" onClick={accept}>Übernehmen ({found.filter((f) => f.on).length}){idx + 1 < candidates.length ? " – nächstes Bild" : ""}</button>
            <button onClick={() => { setMode("place"); setFound([]); setMsg(null); setShowImg(true); }}>Zurück</button>
          </div>
        </>
      )}

      <div className="btnrow foot">
        {candidates.length > 1 && idx + 1 < candidates.length && <button onClick={nextImage}>Bild überspringen</button>}
        <button onClick={onClose}>{doneCount > 0 ? "Fertig" : "Abbrechen"}</button>
      </div>
    </div>
  );
}
