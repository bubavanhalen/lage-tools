/** Kleine Strich-Symbole (16 px, currentColor) für Suche, Werkzeugleiste und Kontextmenü. */
import type { ReactNode } from "react";

const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const IconSearch = () => <Svg><circle cx="7" cy="7" r="4.5" /><path d="M10.4 10.4 14 14" /></Svg>;
export const IconLayers = () => <Svg><path d="M8 2 1.8 5.2 8 8.4l6.2-3.2L8 2Z" /><path d="m1.8 8 6.2 3.2L14.2 8" /><path d="m1.8 10.8 6.2 3.2 6.2-3.2" /></Svg>;
export const IconFit = () => <Svg><path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" /><rect x="5" y="5" width="6" height="6" rx=".5" /></Svg>;
export const IconRuler = () => <Svg><path d="m1.8 11.2 9.4-9.4 3 3-9.4 9.4-3-3Z" /><path d="m4.4 8.6 1.4 1.4M6.6 6.4l1 1M8.8 4.2l1.4 1.4" /></Svg>;
export const IconCell = () => <Svg><rect x="2" y="2" width="12" height="12" rx=".5" /><path d="M8 2v12M2 8h12" strokeWidth={1} /></Svg>;
export const IconQuad = () => <Svg><rect x="2" y="2" width="12" height="12" rx=".5" strokeWidth={1} /><rect x="8" y="8" width="6" height="6" fill="currentColor" stroke="none" /></Svg>;
export const IconCopy = () => <Svg><rect x="5" y="5" width="9" height="9" rx="1.2" /><path d="M11 5V3.2A1.2 1.2 0 0 0 9.8 2H3.2A1.2 1.2 0 0 0 2 3.2v6.6A1.2 1.2 0 0 0 3.2 11H5" /></Svg>;
export const IconPen = () => <Svg><path d="M10.8 2.6 13.4 5.2 5.6 13H3v-2.6l7.8-7.8Z" /><path d="m9.4 4 2.6 2.6" /></Svg>;
export const IconClose = () => <Svg><path d="m4 4 8 8M12 4l-8 8" /></Svg>;
export const IconUndo = () => <Svg><path d="M5 3 2 6l3 3" /><path d="M2 6h7.5a4.5 4.5 0 0 1 0 9H6" /></Svg>;
export const IconCheck = () => <Svg><path d="m3 8.5 3.2 3L13 4.5" /></Svg>;
export const IconGlobe = () => <Svg size={12}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2.2 2 9.8 0 12M8 2c-2 2.2-2 9.8 0 12" /></Svg>;
export const IconChevron = () => <Svg size={12}><path d="m4 6 4 4 4-4" /></Svg>;
