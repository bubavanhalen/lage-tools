/**
 * Import von GIS-Dateien: GeoJSON, KML (auch aus map.geo.admin.ch), GPX.
 * Ohne DOM – funktioniert im Browser und in Tests gleich.
 */
import { wgs84ToLv95, type LV95 } from "./lv95";

export interface ImportedFeature {
  name: string;
  kind: "polygon" | "line" | "point";
  /** Koordinaten in LV95 (bei Polygonen ohne Wiederholung des Startpunkts) */
  coords: LV95[];
  description?: string;
  color?: string;
}

const isLv95 = (x: number, y: number) => x > 2400000 && x < 2900000 && y > 1000000 && y < 1400000;
const isLv03 = (x: number, y: number) => x > 400000 && x < 900000 && y > 0 && y < 400000;

/** Wandelt ein Koordinatenpaar (WGS84 lon/lat, LV95 oder LV03) nach LV95. */
function toLv95(x: number, y: number): LV95 {
  if (isLv95(x, y)) return { e: x, n: y };
  if (isLv03(x, y)) return { e: x + 2000000, n: y + 1000000 };
  return wgs84ToLv95({ lon: x, lat: y });
}

function openRing(c: LV95[]): LV95[] {
  if (c.length > 1) {
    const a = c[0]!, b = c[c.length - 1]!;
    if (Math.abs(a.e - b.e) < 0.01 && Math.abs(a.n - b.n) < 0.01) return c.slice(0, -1);
  }
  return c;
}

// ---------- GeoJSON ----------
export function parseGeoJSON(input: string | object): ImportedFeature[] {
  const gj = typeof input === "string" ? JSON.parse(input) : input;
  const feats: any[] = gj.type === "FeatureCollection" ? gj.features : gj.type === "Feature" ? [gj] : [{ type: "Feature", geometry: gj, properties: {} }];
  const out: ImportedFeature[] = [];
  feats.forEach((f, i) => {
    const props = f.properties ?? {};
    const name = String(props.name ?? props.Name ?? props.title ?? props.label ?? `Objekt ${i + 1}`);
    const color = props.stroke ?? props.color ?? props.fill;
    const g = f.geometry;
    if (!g) return;
    const add = (kind: ImportedFeature["kind"], pts: number[][], suffix = "") =>
      out.push({ name: name + suffix, kind, coords: kind === "polygon" ? openRing(pts.map(([x, y]) => toLv95(x!, y!))) : pts.map(([x, y]) => toLv95(x!, y!)), color, description: props.description });
    switch (g.type) {
      case "Polygon": add("polygon", g.coordinates[0]); break;
      case "MultiPolygon": g.coordinates.forEach((p: number[][][], k: number) => add("polygon", p[0]!, g.coordinates.length > 1 ? ` (${k + 1})` : "")); break;
      case "LineString": add("line", g.coordinates); break;
      case "MultiLineString": g.coordinates.forEach((l: number[][], k: number) => add("line", l, ` (${k + 1})`)); break;
      case "Point": add("point", [g.coordinates]); break;
      case "MultiPoint": g.coordinates.forEach((p: number[], k: number) => add("point", [p], ` (${k + 1})`)); break;
    }
  });
  return out;
}

// ---------- KML ----------
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "i").exec(xml);
  return m ? m[1]! : null;
};
const tags = (xml: string, name: string) =>
  [...xml.matchAll(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "gi"))].map((m) => m[1]!);
const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
const coordList = (s: string) =>
  s.trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((p) => p.length >= 2 && p.every((v) => !Number.isNaN(v)));

/** KML-Farbe aabbggrr → #rrggbb */
const kmlColor = (s: string | null) => (s && /^[0-9a-f]{8}$/i.test(s.trim()) ? "#" + s.trim().slice(6, 8) + s.trim().slice(4, 6) + s.trim().slice(2, 4) : undefined);

export function parseKML(xml: string): ImportedFeature[] {
  const out: ImportedFeature[] = [];
  // Stile (für Farben)
  const styles = new Map<string, string>();
  for (const m of xml.matchAll(/<Style[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/Style>/gi)) {
    const c = kmlColor(tag(tag(m[2]!, "LineStyle") ?? "", "color"));
    if (c) styles.set(m[1]!, c);
  }
  tags(xml, "Placemark").forEach((pm, i) => {
    const name = decode(tag(pm, "name") ?? `Objekt ${i + 1}`);
    const description = tag(pm, "description");
    const styleUrl = tag(pm, "styleUrl")?.trim().replace(/^#/, "");
    const color = kmlColor(tag(tag(pm, "LineStyle") ?? "", "color")) ?? (styleUrl ? styles.get(styleUrl) : undefined);
    const base = { description: description ? decode(description) : undefined, color };
    const polys = tags(pm, "Polygon");
    polys.forEach((p, k) => {
      const outer = tag(tag(p, "outerBoundaryIs") ?? p, "coordinates");
      if (outer) out.push({ name: polys.length > 1 ? `${name} (${k + 1})` : name, kind: "polygon", coords: openRing(coordList(outer).map(([x, y]) => toLv95(x!, y!))), ...base });
    });
    const lines = tags(pm, "LineString");
    lines.forEach((l, k) => {
      const c = tag(l, "coordinates");
      if (c) out.push({ name: lines.length > 1 ? `${name} (${k + 1})` : name, kind: "line", coords: coordList(c).map(([x, y]) => toLv95(x!, y!)), ...base });
    });
    if (!polys.length && !lines.length) {
      const pt = tag(tag(pm, "Point") ?? "", "coordinates");
      if (pt) out.push({ name, kind: "point", coords: coordList(pt).map(([x, y]) => toLv95(x!, y!)), ...base });
    }
  });
  return out;
}

// ---------- GPX ----------
export function parseGPX(xml: string): ImportedFeature[] {
  const out: ImportedFeature[] = [];
  const pt = (attrs: string) => {
    const lat = /lat="([^"]+)"/.exec(attrs), lon = /lon="([^"]+)"/.exec(attrs);
    return lat && lon ? wgs84ToLv95({ lat: +lat[1]!, lon: +lon[1]! }) : null;
  };
  for (const m of xml.matchAll(/<wpt([^>]*)>([\s\S]*?)<\/wpt>/gi)) {
    const p = pt(m[1]!);
    if (p) out.push({ name: decode(tag(m[2]!, "name") ?? "Wegpunkt"), kind: "point", coords: [p] });
  }
  for (const kind of ["trk", "rte"] as const) {
    for (const m of xml.matchAll(new RegExp(`<${kind}>([\\s\\S]*?)</${kind}>`, "gi"))) {
      const pts = [...m[1]!.matchAll(/<(?:trkpt|rtept)([^>]*)\/?>/gi)].map((x) => pt(x[1]!)).filter((x): x is LV95 => !!x);
      if (pts.length) out.push({ name: decode(tag(m[1]!, "name") ?? (kind === "trk" ? "Track" : "Route")), kind: "line", coords: pts });
    }
  }
  return out;
}

/** Erkennt das Format am Inhalt. */
export function parseGisText(text: string): ImportedFeature[] {
  const t = text.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return parseGeoJSON(t);
  if (/<gpx[\s>]/i.test(t)) return parseGPX(t);
  if (/<kml[\s>]/i.test(t) || /<Placemark/i.test(t)) return parseKML(t);
  throw new Error("Unbekanntes Format – unterstützt: KML, GeoJSON, GPX");
}

/**
 * Liest aus einem Teilen-Link von map.geo.admin.ch die URL der KML-Zeichnung.
 * Beispiel: …?layers=KML%7C%7Chttps://public.geo.admin.ch/api/kml/files/abc…
 */
export function kmlUrlFromGeoAdminLink(link: string): string | null {
  let s = link.trim();
  try { s = decodeURIComponent(s); } catch { /* bleibt */ }
  const m = /KML\|\|?(https?:\/\/[^,;&|\s]+)/i.exec(s) ?? /(https?:\/\/public\.geo\.admin\.ch\/api\/kml\/files\/[^,;&|\s]+)/i.exec(s);
  return m ? m[1]! : null;
}
