// Vite-Import «…?url» (Datei-URL als Zeichenkette, z. B. pdf.js-Worker) – für `tsc -p packages/ui` ohne vite/client
declare module "*?url" {
  const src: string;
  export default src;
}
