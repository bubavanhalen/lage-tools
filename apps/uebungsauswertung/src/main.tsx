import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@lage/map/map.css";
import "@lage/ui/style.css";
import { PreviewShell } from "@lage/ui";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PreviewShell product="Übungsauswertung" tagline="Rot / Blau auswerten, AAR vorbereiten" />
  </StrictMode>,
);
