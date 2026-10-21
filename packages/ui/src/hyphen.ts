/**
 * Weiche Trennstellen (U+00AD) in langen Wörtern an Wortfugen, damit «Sanitätshilfsstelle» in schmalen Kacheln
 * sauber umbricht – auch in Browsern ohne deutsches Trennwörterbuch (Chrome unter Windows/Linux).
 */
const FUGEN = [
  "grenadiere", "jäger", "abwehr", "truppen", "kräfte", "schütze", "artillerie", "werfer", "hilfe", "hilfs", "transport",
  "unterstützung", "führung", "haltung", "polizei", "schutz", "menge", "linge", "panzer", "wagen", "fahrzeug", "raupe", "lege",
  "haubitze", "gewehr", "lenkwaffe", "faust", "posten", "lager", "stelle", "nest", "platz", "raum", "sperre", "mine", "objekt",
  "draht", "hindernis", "falle", "kontakt", "suchung", "punkt", "stration", "mittlung", "stellungs", "schaft", "schirm", "feld",
];
const hyphCache = new Map<string, string>();
export function softHyphens(name: string): string {
  const hit = hyphCache.get(name);
  if (hit !== undefined) return hit;
  const out = name.replace(/[\p{L}]{10,}/gu, (w) => {
    const lw = w.toLowerCase();
    const cuts = new Set<number>();
    for (const f of FUGEN) {
      for (let i = lw.indexOf(f, 3); i >= 3 && i <= lw.length - 3; i = lw.indexOf(f, i + 1)) cuts.add(i);
    }
    const sorted = [...cuts].sort((a, b) => a - b).filter((c, i, a) => i === 0 || c - a[i - 1]! >= 3);
    let r = "", last = 0;
    for (const c of sorted) { r += w.slice(last, c) + "\u00AD"; last = c; }
    return r + w.slice(last);
  });
  hyphCache.set(name, out);
  return out;
}
