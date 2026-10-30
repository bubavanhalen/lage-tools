/**
 * Feste Kartenfarben (Spez. MVP 1, Kap. 5.1/5.4): die hellen Werte des Farbvertrags – die Karte bleibt auch im
 * Dunkelmodus hell, deshalb hier feste Werte statt CSS-Variablen. Ein Rot auf der Karte: `feind` = #C62828.
 * Spiegel: `--karte-*` in `packages/ui/src/theme.css` und `LAGE_KARTE` in `packages/ui/src/colors.ts`
 * (Test: `packages/ui/test/kartenfarben.test.ts`).
 */
export const KARTE = {
  feind: "#C62828",
  eigen: "#1F5FB8",
  unklar: "#8A5A00",
  unklarFill: "#F2C200",
  neutral: "#2E7D32",
  zivil: "#6A1B9A",
  ink: "#1B2320",
  halo: "#FFFFFF",
  /** Rand der Zeichen nachts (MVP 3.5, K3: Variante V4 – Nacht-Rand schwarz); Spiegel `--karte-halo-nacht`, `LAGE_KARTE.haloNacht` */
  haloNacht: "#000000",
  /** NAI und andere Räume */
  nai: "#1F78D1",
  /** Einsatzraum (AO) */
  ao: "#0B3D91",
} as const;
