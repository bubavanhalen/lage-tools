import { useState } from "react";
import L from "leaflet";
import { areaFromRing, kmlUrlFromGeoAdminLink, parseGisText, type Area, type Exercise, type NaiTyp, type Overlay } from "@lage/core";
import { toLatLng } from "@lage/map";
import { pickFile } from "./store";
import { candidatesFromFile, type Candidate } from "./imageimport";
import "./hints.css";

interface Props {
  exercise: Exercise;
  map: L.Map;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (areas: Area[]) => void;
  onOverlays: (o: Overlay[]) => void;
  onImage: (c: Candidate[]) => void;
  say: (t: string) => void;
}

const KINDS: Array<[Area["kind"], string]> = [["nai", "NAI"], ["ao", "AO / Raum"], ["stao", "Standort"], ["other", "Andere"]];
/** Geländetyp eines NAI (steuert Hinweise, z. B. Engnis → Hinterhalt-Gefahr) */
const TYPEN: Array<[NaiTyp, string]> = [["strasse", "Strasse"], ["engnis", "Engstelle"], ["siedlung", "Siedlung"], ["bruecke", "Brücke"], ["wald", "Wald"], ["offen", "offenes Gelände"], ["anlage", "Anlage"]];

export function NaiPanel({ exercise, map, selected, onSelect, onChange, onOverlays, onImage, say }: Props) {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const areas = exercise.areas;

  const addFeatures = (text: string, source: string) => {
    const feats = parseGisText(text);
    const polys = feats.filter((f) => f.kind === "polygon" && f.coords.length >= 3);
    const skipped = feats.length - polys.length;
    const add = polys.map((f) => areaFromRing(f.name, f.coords, /\b(ao|raum)\b/i.test(f.name) ? "ao" : "nai", f.color));
    onChange([...areas, ...add]);
    say(`${add.length} Flächen aus ${source} übernommen${skipped ? ` · ${skipped} Linien/Punkte übersprungen` : ""}`);
    if (add.length) zoomTo(add);
  };

  const zoomTo = (list: Area[]) => {
    const pts = list.flatMap((a) => a.ring.map(toLatLng));
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  };

  const importFile = async () => {
    const f = await pickFile(".kml,.geojson,.json,.gpx,application/vnd.google-earth.kml+xml,application/geo+json");
    if (!f) return;
    try { addFeatures(await f.text(), f.name); } catch (e) { say((e as Error).message); }
  };

  const importLink = async () => {
    const url = kmlUrlFromGeoAdminLink(link);
    if (!url) { say("Im Link wurde keine Zeichnung (KML) gefunden. In map.geo.admin.ch: Zeichnen → Teilen → Link kopieren."); return; }
    setLoading(true);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      addFeatures(await r.text(), "map.geo.admin.ch");
      setLink("");
    } catch (e) {
      say("Zeichnung konnte nicht geladen werden (" + (e as Error).message + "). Alternativ in map.geo.admin.ch als KML exportieren und als Datei laden.");
    } finally {
      setLoading(false);
    }
  };

  const importImage = async () => {
    const f = await pickFile("image/*,.pdf,.docx");
    if (!f) return;
    setLoading(true);
    try {
      const c = await candidatesFromFile(f);
      if (!c.length) say("In der Datei wurde kein Bild gefunden.");
      else onImage(c);
    } catch (e) {
      say("Datei konnte nicht gelesen werden: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const patch = (id: string, p: Partial<Area>) => onChange(areas.map((a) => (a.id === id ? { ...a, ...p } : a)));

  return (
    <div className="panel">
      <div className="importbox">
        <b>NAI und Räume einfügen</b>
        <div className="btnrow">
          <button className="primary" onClick={importImage} disabled={loading}>Bild, PDF oder Word einpassen</button>
          <button onClick={importFile} disabled={loading}>Datei (KML, GeoJSON, GPX)</button>
        </div>
        <div className="linkrow">
          <input placeholder="Link aus map.geo.admin.ch einfügen" value={link} onChange={(e) => setLink(e.target.value)} />
          <button onClick={importLink} disabled={!link || loading}>Laden</button>
        </div>
      </div>

      <datalist id="nai-trupps">{exercise.units.blau.map((u) => <option key={u} value={u} />)}</datalist>
      {areas.length === 0 ? (
        <div className="empty"><p>Noch keine NAI. Datei (KML, GeoJSON) oder Bild/Word einfügen. Ein Bild (z. B. BNB-Skizze) wird auf der Karte eingepasst, die NAI werden als Linien übernommen.</p></div>
      ) : (
        <ul className="list">
          {areas.map((a) => (
            <li key={a.id} className={a.id === selected ? "sel" : ""}>
              <div className="arearow">
                <input type="color" value={a.color ?? "#1f78d1"} onChange={(e) => patch(a.id, { color: e.target.value })} aria-label="Farbe" />
                <input className="aname" value={a.name} aria-label="Name" onChange={(e) => patch(a.id, { name: e.target.value })} onFocus={() => onSelect(a.id)} />
                <select value={a.kind} onChange={(e) => patch(a.id, { kind: e.target.value as Area["kind"] })} aria-label="Art">
                  {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button title="Auf der Karte zeigen" aria-label={`${a.name} auf der Karte zeigen`} onClick={() => { onSelect(a.id); zoomTo([a]); }}>◎</button>
                <button title="Löschen" aria-label={`${a.name} löschen`} onClick={() => onChange(areas.filter((x) => x.id !== a.id))}>✕</button>
              </div>
              {a.kind === "nai" && (
                <div className="nairow2">
                  <label>Trupp
                    <input list="nai-trupps" value={a.trupp ?? ""} placeholder="nicht zugeteilt" onFocus={() => onSelect(a.id)}
                      onChange={(e) => patch(a.id, { trupp: e.target.value.trimStart() || undefined })} title="Eigener Trupp, der den NAI beobachtet (Auswahl oder frei)" />
                  </label>
                  <label>Gelände
                    <select value={a.typ ?? ""} onChange={(e) => patch(a.id, { typ: (e.target.value || undefined) as NaiTyp | undefined })} title="Gelände – steuert die Hinweise «Was Rot vorhaben könnte» (z. B. Engstelle → Hinterhalt)">
                      <option value="">– wählen –</option>
                      {TYPEN.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(exercise.overlays ?? []).length > 0 && (
        <>
          <h3>Bilder auf der Karte</h3>
          <ul className="list">
            {(exercise.overlays ?? []).map((o) => (
              <li key={o.id}>
                <div className="arearow">
                  <input type="checkbox" checked={o.visible} onChange={(e) => onOverlays((exercise.overlays ?? []).map((x) => (x.id === o.id ? { ...x, visible: e.target.checked } : x)))} aria-label="sichtbar" />
                  <span className="oname" title={o.name}>{o.name}</span>
                  <input type="range" min={0.1} max={1} step={0.05} value={o.opacity} aria-label="Deckkraft"
                    onChange={(e) => onOverlays((exercise.overlays ?? []).map((x) => (x.id === o.id ? { ...x, opacity: +e.target.value } : x)))} />
                  <button title="Entfernen" aria-label={`Bild ${o.name} entfernen`} onClick={() => onOverlays((exercise.overlays ?? []).filter((x) => x.id !== o.id))}>✕</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
