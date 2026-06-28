import { ConversationHistory } from "./ConversationHistory";
import { useAppStateBridge } from "../../hooks/useAppStateBridge";
import { ModelPicker } from "./ModelPicker";
import { PushToTalkButton } from "./PushToTalkButton";
import { SettingsPanel } from "./SettingsPanel";
import "./panel.css";

export function Panel() {
  useAppStateBridge();
  return (
    <main className="panel-root">
      <header>
        <p className="eyebrow">AI Buddy</p>
        <h1>Clicky for Windows</h1>
        <p className="subtitle">
          A faithful Tauri port scaffold of the original macOS companion.
        </p>
      </header>
      <PushToTalkButton />
      <ModelPicker />
      <SettingsPanel />
      <ConversationHistory />
    </main>
  );
}
