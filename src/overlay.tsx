import { createRoot } from "react-dom/client";
import { Overlay } from "./windows/overlay/Overlay";

createRoot(document.getElementById("root") as HTMLElement).render(<Overlay />);
