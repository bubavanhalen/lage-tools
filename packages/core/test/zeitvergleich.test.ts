/**
 * Zeitvergleiche nur über `zeitCmp`/`zeitBis`/`zeitMax` (Spez. MVP 3.5, Kap. 3.6, S23): Ereignis- und Lagezeiten
 * dürfen nicht mehr als Zeichenketten mit `<`, `<=`, `>`, `>=` verglichen werden (doppelte Stunde, Offset-Endung).
 * Tagesvergleiche (`slice(0, 10)`) und reine Anzeige (`slice(11, 16)`) bleiben erlaubt.
 *
 * Der Test durchsucht `packages/{core,map,ui}/src` zeilenweise nach den Mustern der Spezifikation und führt die Zahl je
 * Datei von Phase 0 (52d951d) als `BEKANNT` – wie `tokens.test.ts`. **Jede Zahl darf nur sinken** (wer eine Datei
 * umstellt, senkt bzw. streicht hier ihren Eintrag); Ende Phase 2: 0. Ausnahmen (z. B. Zahlen statt Zeiten wie
 * `Date.now() - rec.t < MAX`) nur mit Kommentar `// zeit-ok: <Grund>` auf derselben Zeile. Kommentarzeilen zählen nicht.
 * Zuständig je Datei: Spez. Kap. 6.2, Spalte «Zeitvergleiche».
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
/** «e.t <= t», «e.t.slice(0, 16) > tNow» */
export const MUSTER_LINKS = /\.t(\.slice\(0,\s*16\))?\s*(<=|>=|<|>)/;
/** «tNow >= e.t», «x < best.t.slice(0, 16)» (ohne Pfeil «=>») */
export const MUSTER_RECHTS = /(?<![=>-])(<=|>=|<|>)\s*[\w.]*\.t(\.slice\(0,\s*16\))?\b/;

/** Stand Phase 0 (Datei → Zeilen mit Treffer). Nur senken, nie erhöhen. */
const BEKANNT: Record<string, number> = {
  // Paket C: alle Dateien umgestellt (0)
  // Paket D: alle Dateien umgestellt (0)
  // Paket B: umgestellt (aufgehoben, journalLayer, print/lagekarte, shapeLayer → 0)
  // Paket A (Zahl, keine Zeit: mit «// zeit-ok:» markieren)
  "packages/ui/src/roadsource.ts": 1,
  // Paket E: alle umgestellt (MVP 3.5, Phase 1)
};

/** Zeilen mit Zeitvergleich als Zeichenkette (ohne Kommentarzeilen und ohne `// zeit-ok:`) */
export function zeitvergleiche(text: string): Array<{ zeile: number; text: string }> {
  const out: Array<{ zeile: number; text: string }> = [];
  text.split("\n").forEach((line, i) => {
    const s = line.trim();
    if (s.startsWith("*") || s.startsWith("//") || s.startsWith("/*")) return;
    if (/\/\/\s*zeit-ok:/.test(line)) return;
    if (MUSTER_LINKS.test(line) || MUSTER_RECHTS.test(line)) out.push({ zeile: i + 1, text: s.slice(0, 120) });
  });
  return out;
}

function dateien(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts")) out.push(p);
    }
  };
  for (const pkg of ["core", "map", "ui"]) walk(join(ROOT, "packages", pkg, "src"));
  return out;
}

describe("Zeitvergleiche als Text (Kap. 3.6)", () => {
  it("Muster erkennen die bekannten Formen, nicht Pfeile, Tage und Anzeige", () => {
    const ja = ["if (e.t <= t) x();", "e.t.slice(0, 16) > tNow", "(a, b) => a.t < b.t", "if (tNow >= e.t) y();", "x < best.t.slice(0, 16)"];
    const nein = ["(e) => e.t", "e.t.slice(0, 10) === day", "const a = e.t.slice(11, 16);", "e.tOffset < x", "zeitBis(e, t)", "// e.t <= t", "e.t <= t; // zeit-ok: Test"];
    for (const s of ja) expect(zeitvergleiche(s).length, s).toBe(1);
    for (const s of nein) expect(zeitvergleiche(s).length, s).toBe(0);
  });
  it("je Datei höchstens so viele wie in Phase 0 (BEKANNT), neue Dateien 0", () => {
    const zuViel: string[] = [];
    const stand: Record<string, number> = {};
    for (const p of dateien()) {
      const rel = relative(ROOT, p).replace(/\\/g, "/");
      const treffer = zeitvergleiche(readFileSync(p, "utf8"));
      if (treffer.length) stand[rel] = treffer.length;
      const max = BEKANNT[rel] ?? 0;
      if (treffer.length > max) zuViel.push(`${rel}: ${treffer.length} > ${max} – ${treffer.map((t) => `${t.zeile}: ${t.text}`).join(" | ")}`);
    }
    expect(zuViel, "neue Zeitvergleiche als Text – zeitCmp/zeitBis/zeitMax (clock.ts) verwenden").toEqual([]);
    // gesunkene Zahlen sind willkommen: dann BEKANNT nachführen (senken/streichen)
    const total = Object.values(stand).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(Object.values(BEKANNT).reduce((a, b) => a + b, 0));
  });
  it.todo("Ende Phase 2 (Paket E): 0 Treffer, BEKANNT leer");
});
