import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Panel } from "./windows/panel/Panel";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
