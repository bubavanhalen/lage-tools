/**
 * JS-Spiegel des Farbvertrags (theme.css, Spez. Kap. 5.1) – für Leaflet, Canvas, PDF und alles, was keine
 * CSS-Variablen lesen kann. Werte müssen mit theme.css übereinstimmen (Test: packages/ui/test/tokens.test.ts).
 *
 * Die Karte bleibt auch im Dunkelmodus hell: Kartenzeichen nehmen immer `LAGE_KARTE` (= helle Werte).
 * In der Oberfläche (HTML) stattdessen `var(--feind)` usw. verwenden, nicht diese Konstanten.
 */

export type FarbToken =
  | "bg" | "surface" | "ink" | "muted" | "line" | "line-soft"
  | "warn-bg" | "warn-ink" | "warn-sym" | "stop" | "stop-bg" | "ok" | "ok-bg"
  | "rueckblick" | "rueckblick-ink" | "focus-ring" | "focus-gap"
  | "feind" | "eigen" | "unklar" | "unklar-fill" | "neutral" | "zivil";

/** `--sel` ist kein eigener Wert (= `--ink`) und fehlt deshalb hier. */
export const FARBEN: Record<"hell" | "dunkel", Record<FarbToken, string>> = {
  hell: {
    bg: "#EEF0EB", surface: "#F9FAF7", ink: "#1B2320", muted: "#4F5953", line: "#7F8882", "line-soft": "#D2D7CF",
    "warn-bg": "#FFF4D6", "warn-ink": "#1B2320", "warn-sym": "#8A5A00", stop: "#C62828", "stop-bg": "#FDECEA",
    ok: "#1E6B3A", "ok-bg": "#E6F2EA", rueckblick: "#F2B705", "rueckblick-ink": "#1B2320",
    "focus-ring": "#1B2320", "focus-gap": "#FFFFFF",
    feind: "#C62828", eigen: "#1F5FB8", unklar: "#8A5A00", "unklar-fill": "#F2C200", neutral: "#2E7D32", zivil: "#6A1B9A",
  },
  dunkel: {
    bg: "#111614", surface: "#181F1C", ink: "#E3E8E3", muted: "#A3AEA7", line: "#6B7771", "line-soft": "#2C3531",
    "warn-bg": "#3A3418", "warn-ink": "#F5E6B8", "warn-sym": "#E1AE4E", stop: "#FF8A80", "stop-bg": "#3A1F21",
    ok: "#6CC795", "ok-bg": "#1A2B21", rueckblick: "#F2B705", "rueckblick-ink": "#111614",
    "focus-ring": "#E3E8E3", "focus-gap": "#111614",
    feind: "#FF8A80", eigen: "#8AB4F8", unklar: "#E1AE4E", "unklar-fill": "#F2C200", neutral: "#81C784", zivil: "#CE93D8",
  },
};

/** Farben auf der Karte (immer hell, auch im Dunkelmodus). */
export const LAGE_KARTE = {
  feind: FARBEN.hell.feind,
  eigen: FARBEN.hell.eigen,
  unklar: FARBEN.hell.unklar,
  unklarFill: FARBEN.hell["unklar-fill"],
  neutral: FARBEN.hell.neutral,
  zivil: FARBEN.hell.zivil,
  ink: FARBEN.hell.ink,
  /** Halo um Zeichen und Beschriftungen (Nacht: schwarz, Kap. 5.4) */
  halo: "#FFFFFF",
  haloNacht: "#000000",
  /** Raster leise (Kap. 5.4) */
  raster: "rgba(17,17,17,.35)",
  rueckblick: FARBEN.hell.rueckblick,
} as const;

/** CSS-Variable eines Tokens, z. B. `cssVar("feind")` → «var(--feind)». */
export const cssVar = (t: FarbToken | "sel"): string => `var(--${t})`;

/** Wirksames Farbschema der Seite (data-theme hat Vorrang vor der Systemeinstellung). */
export function schema(): "hell" | "dunkel" {
  if (typeof document === "undefined") return "hell";
  const forced = document.documentElement.getAttribute("data-theme");
  if (forced === "dark") return "dunkel";
  if (forced === "light") return "hell";
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dunkel" : "hell";
}

/** Wert eines Tokens im aktuellen Schema (für Oberflächen-Canvas; Karte: `LAGE_KARTE`). */
export const farbe = (t: FarbToken): string => FARBEN[schema()][t];
