import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@lage/map/map.css";
import "@lage/ui/style.css";
import { Workspace } from "@lage/ui";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Workspace product="Übungsauswertung" tagline="Rot / Blau auswerten, AAR vorbereiten" />
  </StrictMode>,
);
