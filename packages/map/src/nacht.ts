/** Zeichen nachts (ohne Leaflet, testbar in Node) */
import { KARTE } from "./kartenfarben";

/**
 * Nacht (Review 6 Erstbenutzer H2): milsymbol zeichnet Bewegungspfeil, Stiel, Grössenangabe (●●●, |), Stab und
 * Radzeichen in Schwarz und säumt sie mit der Randfarbe – nachts ebenfalls Schwarz: schwarze Klumpen auf dunkler Karte.
 * Hier bleibt der schwarze Saum (Rand), die Teile **ausserhalb des Rahmens** selbst werden hell (`KARTE.halo`). Erkannt
 * an der Saum-Kopie (gleiche Geometrie mit `stroke` = Randfarbe); der Rahmen hat eine eigene Saum-Geometrie («Z Z») und
 * die Füllung, das Innenzeichen hat keinen Saum – beide bleiben unverändert.
 */
export function nachtHell(svg: string, outline: string): string {
  const geo = (tag: string): string | null => {
    const d = /\sd="([^"]+)"/.exec(tag)?.[1];
    if (d) return `p:${d}`;
    const cx = /\scx="([^"]+)"/.exec(tag)?.[1], cy = /\scy="([^"]+)"/.exec(tag)?.[1], r = /\sr="([^"]+)"/.exec(tag)?.[1];
    return cx !== undefined ? `c:${cx},${cy},${r}` : null;
  };
  const saum = new Set<string>();
  const re = /<(path|circle|ellipse|line|polyline|polygon|rect)\b[^>]*>/g;
  const esc = outline.toLowerCase();
  for (const m of svg.matchAll(re)) {
    if (!m[0].toLowerCase().includes(`stroke="${esc}"`)) continue;
    const k = geo(m[0]);
    if (k) saum.add(k);
  }
  if (!saum.size) return svg;
  const hell = KARTE.halo;
  return svg.replace(re, (tag) => {
    if (tag.toLowerCase().includes(`stroke="${esc}"`)) return tag;
    const k = geo(tag);
    if (!k || !saum.has(k)) return tag;
    let t = tag.replace(/\sstroke="(black|#000|#000000|rgb\(0, ?0, ?0\))"/gi, ` stroke="${hell}"`).replace(/\sfill="(black|#000|#000000|rgb\(0, ?0, ?0\))"/gi, ` fill="${hell}"`);
    // Kreise der Grössenangabe erben den Strich von der Gruppe (schwarz): ausdrücklich hell
    if (!/\sstroke="/.test(t)) t = t.replace(/^<(\w+)/, `<$1 stroke="${hell}"`);
    return t;
  });
}
