/**
 * Token-Test (Spez. MVP 1, Kap. 7.3.1): Farbvertrag in theme.css hell/dunkel, WCAG-Kontraste, ein Rot,
 * JS-Spiegel colors.ts, keine Hex-Farben ausserhalb theme.css/colors.ts.
 *
 * Hex-Farben: heute gibt es noch Verstösse aus der Zeit vor MVP 1. Sie stehen unten als bekannte Ausnahmen
 * (`BEKANNT`, Anzahl je Datei). Der Test ist eine Sperrklinke: neue Dateien mit Hex-Farben oder mehr Hex-Farben als
 * bekannt schlagen fehl; weniger ist erlaubt (bitte dann die Zahl hier senken). Ziel MVP 1: `BEKANNT` leer –
 * siehe `it.todo` unten. Die Pakete A–D bauen ihre Dateien ab (Zuständigkeit: src/shell/README.md).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FARBEN, type FarbToken } from "../src/colors";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const css = readFileSync(join(SRC, "theme.css"), "utf8");

/** Blöcke «vertrag:hell|dunkel … vertrag:ende» als Name → Wert (var(--x) aufgelöst). */
function blocks(kind: "hell" | "dunkel"): Array<Record<string, string>> {
  const re = new RegExp(`/\\*\\s*vertrag:${kind}\\s*\\*/([\\s\\S]*?)/\\*\\s*vertrag:ende\\s*\\*/`, "g");
  return [...css.matchAll(re)].map((m) => {
    const raw: Record<string, string> = {};
    for (const d of m[1]!.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) raw[d[1]!] = d[2]!.trim();
    const res = (v: string, n = 0): string => {
      const r = /^var\(--([\w-]+)\)$/.exec(v);
      if (!r) return v.toUpperCase();
      if (n > 5 || !(r[1]! in raw)) throw new Error(`unaufgelöst: ${v}`);
      return res(raw[r[1]!]!, n + 1);
    };
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, res(v)]));
  });
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

/** Paare aus Kap. 5.1: [Vordergrund, Hintergrund, Minimum] – Text 4.5, Rahmen/Symbol/Fokus 3, Rückblick-Text 7 */
const PAARE: Array<[string, string, number]> = [
  ["ink", "bg", 4.5], ["ink", "surface", 4.5], ["surface", "ink", 4.5], // Primärknopf: helle Schrift auf Tinte
  ["muted", "bg", 4.5], ["muted", "surface", 4.5], ["muted", "warn-bg", 4.5], ["muted", "ok-bg", 4.5],
  ["warn-ink", "warn-bg", 4.5], ["stop", "stop-bg", 4.5], ["stop", "surface", 4.5], ["ok", "ok-bg", 4.5], ["ok", "surface", 4.5],
  ["feind", "bg", 4.5], ["feind", "surface", 4.5], ["eigen", "bg", 4.5], ["eigen", "surface", 4.5],
  ["unklar", "bg", 4.5], ["unklar", "surface", 4.5], ["neutral", "surface", 4.5], ["zivil", "surface", 4.5],
  ["line", "bg", 3], ["line", "surface", 3], ["sel", "surface", 3], ["warn-sym", "warn-bg", 3],
  ["focus-ring", "bg", 3], ["focus-ring", "surface", 3], ["focus-ring", "focus-gap", 3],
  ["rueckblick-ink", "rueckblick", 7],
];

describe("Farbvertrag theme.css", () => {
  const hell = blocks("hell");
  const dunkel = blocks("dunkel");

  it("hat genau einen hellen und zwei gleiche dunkle Blöcke (Systemeinstellung und data-theme)", () => {
    expect(hell).toHaveLength(1);
    expect(dunkel).toHaveLength(2);
    expect(dunkel[0]).toEqual(dunkel[1]);
    expect(Object.keys(dunkel[0]!).sort()).toEqual(Object.keys(hell[0]!).sort());
  });

  for (const [name, t] of [["hell", hell[0]!], ["dunkel", dunkel[0]!]] as const) {
    it(`Kontraste ${name}`, () => {
      const fails = PAARE.filter(([f, b, min]) => ratio(t[f]!, t[b]!) < min)
        .map(([f, b, min]) => `${f} auf ${b}: ${ratio(t[f]!, t[b]!).toFixed(2)} < ${min}`);
      expect(fails).toEqual([]);
    });
  }

  it("Rot gibt es genau einmal (#C62828) im hellen Vertrag", () => {
    const hsl = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      const h = d === 0 ? 0 : mx === r ? (60 * ((g - b) / d) + 360) % 360 : mx === g ? 60 * ((b - r) / d) + 120 : 60 * ((r - g) / d) + 240;
      return { h, s, l };
    };
    const reds = new Set(Object.values(hell[0]!).filter((v) => { const c = hsl(v); return (c.h <= 15 || c.h >= 345) && c.s >= 0.4 && c.l >= 0.2 && c.l <= 0.8; }));
    expect([...reds]).toEqual(["#C62828"]);
  });

  it("colors.ts spiegelt theme.css", () => {
    for (const [name, t] of [["hell", hell[0]!], ["dunkel", dunkel[0]!]] as const) {
      const fromCss = Object.fromEntries(Object.entries(t).filter(([k]) => k !== "sel"));
      expect(FARBEN[name]).toEqual(fromCss as Record<FarbToken, string>);
    }
  });

  it("Typografie-Skala und Mindestgrösse Bedienelemente", () => {
    const sizes = [...css.matchAll(/--fs-(\d+):\s*(\d+)px/g)].map((m) => +m[2]!);
    expect(sizes).toEqual([12, 14, 16, 20, 28]);
    expect(css).toMatch(/--hit:\s*44px/);
  });
});

/**
 * Bekannte Hex-Farben ausserhalb theme.css/colors.ts (Stand Phase 0, Anzahl Vorkommen je Datei unter packages/ui/src).
 * Nur senken, nie erhöhen. Milsymbol-Füllungen (Kap. 5.1) dürfen bleiben, gehören dann aber nach colors.ts.
 */
const BEKANNT: Record<string, number> = {
  "NaiPanel.tsx": 1,
  "PreviewShell.tsx": 2,
  "ShapeDraw.tsx": 1,
  "SymbolPicker.tsx": 1,
  "attachmentStore.ts": 2,
  "mapoverlays.css": 1,
  "pdf.ts": 16,
  "tiles.ts": 1,
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
}

describe("Hex-Farben ausserhalb theme.css/colors.ts", () => {
  it("keine neuen Verstösse (Sperrklinke gegen BEKANNT)", () => {
    const over: string[] = [];
    for (const f of walk(SRC)) {
      if (!/\.(tsx?|css)$/.test(f)) continue;
      const rel = relative(SRC, f).replace(/\\/g, "/");
      if (rel === "theme.css" || rel === "colors.ts") continue;
      const n = (readFileSync(f, "utf8").match(/#[0-9a-fA-F]{6}\b/g) ?? []).length;
      if (n > (BEKANNT[rel] ?? 0)) over.push(`${rel}: ${n} Hex-Farben (bekannt ${BEKANNT[rel] ?? 0}) – Token aus theme.css/colors.ts verwenden`);
    }
    expect(over).toEqual([]);
  });
  it.todo("keine Hex-Farben ausserhalb theme.css/colors.ts (Ziel MVP 1: BEKANNT leer)");
});
