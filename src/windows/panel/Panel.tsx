import { ConversationHistory } from "./ConversationHistory";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStateBridge } from "../../hooks/useAppStateBridge";
import { ModelPicker } from "./ModelPicker";
import { PushToTalkButton } from "./PushToTalkButton";
import { SettingsPanel } from "./SettingsPanel";
import "./panel.css";

export function Panel() {
  useAppStateBridge();
  return (
    <main className="panel-root">
      <header
        className="panel-header"
        onPointerDown={(event) => {
          if (event.button === 0) {
            void getCurrentWindow().startDragging();
          }
        }}
      >
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="eyebrow">Awaaz</p>
          <h1>Clicky</h1>
          <p className="subtitle">Screen-aware voice guide for Windows.</p>
        </div>
      </header>
      <section className="panel-section">
        <PushToTalkButton />
      </section>
      <section className="panel-section">
        <ModelPicker />
        <SettingsPanel />
      </section>
      <ConversationHistory />
    </main>
  );
}
