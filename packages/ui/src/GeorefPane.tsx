import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  applyAffine,
  areaFromRing,
  colorMask,
  detectOutline,
  fitAffine,
  invertAffine,
  type Affine,
  type Area,
  type LV95,
  type Overlay,
  type XY,
} from "@lage/core";
import { AffineImageLayer, toLatLng, toLv95 } from "@lage/map";
import { imageDataOf, type Candidate } from "./imageimport";

export interface GeorefResult {
  overlay: Overlay;
  areas: Area[];
}

interface Props {
  candidates: Candidate[];
  map: L.Map;
  existing: Area[];
  onDone: (r: GeorefResult | null) => void;
}

interface Pair { img?: XY; map?: LV95 }

const numIcon = (n: number, cls: string) => L.divIcon({ className: `lt-pin ${cls}`, html: `<span>${n}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });

export function GeorefPane({ candidates, map, existing, onDone }: Props) {
  const [idx, setIdx] = useState<number | null>(candidates.length === 1 ? 0 : null);
  const [pairs, setPairs] = useState<Pair[]>([{}, {}, {}]);
  const [active, setActive] = useState(0);
  const [step, setStep] = useState<"points" | "nai">("points");
  const [lineColor, setLineColor] = useState<[number, number, number] | null>(null);
  const [lineWidth, setLineWidth] = useState(4);
  const [tol, setTol] = useState(70);
  const [pickColor, setPickColor] = useState(false);
  const [found, setFound] = useState<Area[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const viewerEl = useRef<HTMLDivElement>(null);
  const viewer = useRef<L.Map | null>(null);
  const imgMarkers = useRef<L.LayerGroup>(L.layerGroup());
  const mapMarkers = useRef<L.LayerGroup>(L.layerGroup());
  const preview = useRef<AffineImageLayer | null>(null);
  const cand = idx !== null ? candidates[idx]! : null;
  const imgData = useMemo(() => (cand ? imageDataOf(cand.canvas) : null), [cand]);
  const dataUrl = useMemo(() => (cand ? cand.canvas.toDataURL("image/jpeg", 0.85) : ""), [cand]);

  const complete = pairs.filter((p) => p.img && p.map) as Array<Required<Pair>>;
  const fit = useMemo(() => {
    if (complete.length < 3) return null;
    try { return fitAffine(complete.map((p) => p.img), complete.map((p) => ({ x: p.map.e, y: p.map.n }))); } catch { return null; }
  }, [pairs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bildbetrachter
  useEffect(() => {
    if (!cand || !viewerEl.current) return;
    const v = L.map(viewerEl.current, { crs: L.CRS.Simple, minZoom: -5, maxZoom: 4, zoomSnap: 0.25, attributionControl: false });
    const b = L.latLngBounds([-cand.canvas.height, 0], [0, cand.canvas.width]);
    L.imageOverlay(dataUrl, b).addTo(v);
    v.fitBounds(b);
    const t = window.setTimeout(() => { v.invalidateSize(); v.fitBounds(b); }, 60);
    imgMarkers.current.addTo(v);
    viewer.current = v;
    return () => { window.clearTimeout(t); v.remove(); viewer.current = null; };
  }, [cand, dataUrl]);

  // Klicks im Bild
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const onClick = (ev: L.LeafletMouseEvent) => {
      const p = { x: ev.latlng.lng, y: -ev.latlng.lat };
      if (step === "points") {
        setPairs((ps) => ps.map((q, i) => (i === active ? { ...q, img: p } : q)));
      } else if (pickColor) {
        choosePixelColor(p);
      } else {
        detectAt(p);
      }
    };
    v.on("click", onClick);
    return () => { v.off("click", onClick); };
  });

  // Klicks auf der Hauptkarte
  useEffect(() => {
    const onClick = (ev: L.LeafletMouseEvent) => {
      const q = toLv95(ev.latlng);
      if (step === "points") {
        setPairs((ps) => ps.map((x, i) => (i === active ? { ...x, map: q } : x)));
      } else if (fit && !pickColor) {
        detectAt(applyAffine(invertAffine(fit.t), { x: q.e, y: q.n }));
      }
    };
    map.on("click", onClick);
    map.getContainer().classList.add("lt-picking");
    return () => { map.off("click", onClick); map.getContainer().classList.remove("lt-picking"); };
  });

  // nächstes offenes Paar aktivieren, wenn das aktuelle vollständig ist
  useEffect(() => {
    const cur = pairs[active];
    if (cur?.img && cur?.map) {
      const next = pairs.findIndex((p) => !p.img || !p.map);
      if (next >= 0 && next !== active) setActive(next);
    }
  }, [pairs, active]);

  // Marker
  useEffect(() => {
    imgMarkers.current.clearLayers();
    mapMarkers.current.clearLayers();
    pairs.forEach((p, i) => {
      if (p.img) L.marker([-p.img.y, p.img.x], { icon: numIcon(i + 1, i === active ? "act" : ""), interactive: false }).addTo(imgMarkers.current);
      if (p.map) L.marker(toLatLng(p.map), { icon: numIcon(i + 1, i === active ? "act" : ""), interactive: false }).addTo(mapMarkers.current);
    });
    found.forEach((a) => {
      if (!fit) return;
      const inv = invertAffine(fit.t);
      L.polygon(a.ring.map((q) => { const p = applyAffine(inv, { x: q.e, y: q.n }); return [-p.y, p.x] as [number, number]; }), { color: "#c8102e", weight: 2, fillOpacity: 0.1, interactive: false }).addTo(imgMarkers.current);
      L.polygon(a.ring.map(toLatLng), { color: "#c8102e", weight: 2, fillOpacity: 0.1, interactive: false }).addTo(mapMarkers.current);
    });
    mapMarkers.current.addTo(map);
    return () => { mapMarkers.current.remove(); };
  }, [pairs, active, found, fit, map]);

  // Vorschau auf der Karte
  useEffect(() => {
    preview.current?.remove();
    preview.current = null;
    if (fit && cand) {
      preview.current = new AffineImageLayer(dataUrl, cand.canvas.width, cand.canvas.height, fit.t as Affine, 0.55).addTo(map);
    }
    return () => { preview.current?.remove(); preview.current = null; };
  }, [fit, cand, dataUrl, map]);

  const choosePixelColor = (p: XY) => {
    if (!imgData) return;
    const x = Math.round(p.x), y = Math.round(p.y);
    // gesättigtsten Pixel in der Umgebung nehmen (Klick liegt oft am Linienrand)
    let c: [number, number, number] = [255, 255, 255];
    let best = -1;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= imgData.width || yy >= imgData.height) continue;
      const k = (yy * imgData.width + xx) * 4;
      const px: [number, number, number] = [imgData.data[k]!, imgData.data[k + 1]!, imgData.data[k + 2]!];
      const sat = Math.max(...px) - Math.min(...px);
      if (sat > best) { best = sat; c = px; }
    }
    const sat = Math.max(...c) - Math.min(...c);
    if (sat < 40) { setMsg("Das ist keine farbige Linie. Bitte genau auf die farbige NAI-Umrandung klicken (ggf. hineinzoomen)."); return; }
    setLineColor(c);
    // Linienbreite: kürzester Lauf durch den Punkt
    const m = colorMask(imgData, c, tol);
    const run = (dx: number, dy: number) => { let k = 0, xx = x, yy = y; while (xx >= 0 && yy >= 0 && xx < m.width && yy < m.height && m.data[yy * m.width + xx]) { k++; xx += dx; yy += dy; } return k; };
    const w = Math.max(2, Math.min(run(1, 0) + run(-1, 0), run(0, 1) + run(0, -1)) - 1);
    setLineWidth(Math.min(w, 20));
    setPickColor(false);
    setMsg("Linienfarbe gewählt. Jetzt in jedes NAI klicken (im Bild oder auf der Karte).");
  };

  const detectAt = (p: XY) => {
    if (!imgData || !fit) return;
    if (!lineColor) { setMsg("Zuerst die Linienfarbe wählen: «Farbe wählen» und dann auf eine NAI-Umrandung im Bild klicken."); return; }
    const ring = detectOutline(imgData, p, lineColor, { tolerance: tol, lineWidth, closeGaps: 1, simplify: 1.5 });
    if (!ring) { setMsg("Kein geschlossener Umriss gefunden. Toleranz erhöhen oder genauer in die Fläche klicken."); return; }
    const lv = ring.map((q) => { const r = applyAffine(fit.t, q); return { e: r.x, n: r.y }; });
    const n = existing.filter((a) => a.kind === "nai").length + found.length + 1;
    const hex = "#" + lineColor.map((v) => v.toString(16).padStart(2, "0")).join("");
    setFound((f) => [...f, areaFromRing(`NAI ${n}`, lv, "nai", hex)]);
    setMsg(null);
  };

  const finish = () => {
    if (!fit || !cand) return onDone(null);
    onDone({
      overlay: { id: "ov-" + Date.now().toString(36), name: cand.name, dataUrl, width: cand.canvas.width, height: cand.canvas.height, affine: fit.t, opacity: 0.6, visible: found.length === 0 },
      areas: found,
    });
  };

  if (idx === null) {
    return (
      <div className="panel georef">
        <b>Welches Bild?</b>
        <div className="thumbs">
          {candidates.map((c, i) => (
            <button key={i} className="thumb" onClick={() => setIdx(i)}>
              <img src={c.canvas.toDataURL("image/jpeg", 0.6)} alt="" />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
        <button onClick={() => onDone(null)}>Abbrechen</button>
      </div>
    );
  }

  return (
    <div className="panel georef">
      <div className="steps">
        <span className={step === "points" ? "on" : ""}>1 Passpunkte</span>
        <span className={step === "nai" ? "on" : ""}>2 NAI erkennen</span>
      </div>
      <div ref={viewerEl} className="viewer" />
      {step === "points" ? (
        <>
          <p className="help">Punkt <b>{active + 1}</b>: einen markanten Ort <b>im Bild</b> anklicken (Kreuzung, Rasterecke, Gebäude) und denselben Ort <b>auf der Karte</b>. Mindestens 3 Punkte, gut verteilt.</p>
          <ol className="pairs">
            {pairs.map((p, i) => (
              <li key={i} className={i === active ? "act" : ""}>
                <button onClick={() => setActive(i)}>Punkt {i + 1}</button>
                <span>{p.img ? "Bild ✓" : "Bild –"}</span>
                <span>{p.map ? "Karte ✓" : "Karte –"}</span>
                <button title="Zurücksetzen" onClick={() => setPairs((ps) => ps.map((q, k) => (k === i ? {} : q)))}>↺</button>
              </li>
            ))}
          </ol>
          <div className="btnrow">
            <button onClick={() => { setPairs((ps) => [...ps, {}]); setActive(pairs.length); }}>+ Punkt</button>
            {fit && <span className="mono fitinfo">Restfehler ≈ {fit.rms.toFixed(1)} m</span>}
          </div>
          <div className="btnrow">
            <button className="primary" disabled={!fit} onClick={() => { setStep("nai"); setPickColor(true); setMsg("Auf eine NAI-Umrandung im Bild klicken, um die Linienfarbe zu wählen."); }}>Weiter: NAI erkennen</button>
            <button disabled={!fit} onClick={finish}>Nur Bild übernehmen</button>
            <button onClick={() => onDone(null)}>Abbrechen</button>
          </div>
        </>
      ) : (
        <>
          <div className="btnrow">
            <button className={pickColor ? "primary" : ""} onClick={() => setPickColor(true)}>Farbe wählen</button>
            {lineColor && <span className="swatch" style={{ background: `rgb(${lineColor.join(",")})` }} title={`Linienbreite ≈ ${lineWidth} px`} />}
            <label className="field">Toleranz<input type="range" min={20} max={140} value={tol} onChange={(e) => setTol(+e.target.value)} /></label>
          </div>
          {msg && <p className="help">{msg}</p>}
          <ul className="list">
            {found.map((a, i) => (
              <li key={a.id}>
                <div className="arearow">
                  <input className="aname" value={a.name} onChange={(e) => setFound((f) => f.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                  <button className="danger" onClick={() => setFound((f) => f.filter((_, k) => k !== i))}>✕</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="btnrow">
            <button className="primary" onClick={finish}>Fertig ({found.length} NAI)</button>
            <button onClick={() => setStep("points")}>Zurück</button>
            <button onClick={() => onDone(null)}>Abbrechen</button>
          </div>
        </>
      )}
    </div>
  );
}
