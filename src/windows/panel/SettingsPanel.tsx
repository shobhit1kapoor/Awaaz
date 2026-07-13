import { useAppStore } from "../../store/appStore";
import {
  publishClickyVisibility,
  publishListeningCancelled,
  publishTaskContextReset,
  publishVadEnabled,
  publishWakeWordEnabled,
} from "../../lib/appEvents";
import { useAgentSessionStore } from "../../store/agentSessionStore";

export function SettingsPanel() {
  const isClickyVisible = useAppStore((appState) => appState.isClickyVisible);
  const isVadEnabled = useAppStore((appState) => appState.isVadEnabled);
  const isWakeWordEnabled = useAppStore(
    (appState) => appState.isWakeWordEnabled,
  );
  const setIsClickyVisible = useAppStore(
    (appState) => appState.setIsClickyVisible,
  );
  const setIsVadEnabled = useAppStore((appState) => appState.setIsVadEnabled);
  const setIsWakeWordEnabled = useAppStore(
    (appState) => appState.setIsWakeWordEnabled,
  );
  const clearConversation = useAppStore(
    (appState) => appState.clearConversation,
  );
  const endSession = useAgentSessionStore((agentState) => agentState.endSession);

  return (
    <div className="settings-list">
      <label className="checkbox-row">
        <span>
          <strong>Auto listen</strong>
          <small>Listen without holding the shortcut.</small>
        </span>
        <input
          type="checkbox"
          checked={isVadEnabled}
          onChange={(event) => {
            setIsVadEnabled(event.target.checked);
            publishVadEnabled(event.target.checked);
          }}
        />
      </label>
      <label className="checkbox-row">
        <span>
          <strong>Hey Clicky wake word</strong>
          <small>Also accepts Hey ChatGPT and Hey Awaaz.</small>
        </span>
        <input
          type="checkbox"
          checked={isWakeWordEnabled}
          onChange={(event) => {
            setIsWakeWordEnabled(event.target.checked);
            publishWakeWordEnabled(event.target.checked);
          }}
        />
      </label>
      <label className="checkbox-row">
        <span>
          <strong>Show Clicky</strong>
          <small>Keep the cursor-side bubble visible.</small>
        </span>
        <input
          type="checkbox"
          checked={isClickyVisible}
          onChange={(event) => {
            setIsClickyVisible(event.target.checked);
            publishClickyVisibility(event.target.checked);
          }}
        />
      </label>
      <button
        className="secondary-button danger-button"
        type="button"
        onClick={() => {
          setIsVadEnabled(false);
          publishVadEnabled(false);
          publishListeningCancelled();
        }}
      >
        Stop listening · Ctrl+Shift+X
      </button>
      <button
        className="secondary-button"
        type="button"
        onClick={() => {
          endSession();
          clearConversation();
          publishTaskContextReset();
        }}
      >
        Fresh task / reset talk
      </button>
    </div>
  );
}
