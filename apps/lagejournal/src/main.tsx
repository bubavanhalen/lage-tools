import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@lage/map/map.css";
import "@lage/ui/style.css";
import { Workspace } from "@lage/ui";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Workspace product="Lagejournal" tagline="Lageverfolgung im LVZ" />
  </StrictMode>,
);
