import { useAppStore } from "../../store/appStore";
import {
  publishClickyVisibility,
  publishVadEnabled,
} from "../../lib/appEvents";

export function SettingsPanel() {
  const isClickyVisible = useAppStore((appState) => appState.isClickyVisible);
  const isVadEnabled = useAppStore((appState) => appState.isVadEnabled);
  const setIsClickyVisible = useAppStore(
    (appState) => appState.setIsClickyVisible,
  );
  const setIsVadEnabled = useAppStore((appState) => appState.setIsVadEnabled);

  return (
    <div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={isVadEnabled}
          onChange={(event) => {
            setIsVadEnabled(event.target.checked);
            publishVadEnabled(event.target.checked);
          }}
        />
        Auto listen
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={isClickyVisible}
          onChange={(event) => {
            setIsClickyVisible(event.target.checked);
            publishClickyVisibility(event.target.checked);
          }}
        />
        Show Clicky
      </label>
    </div>
  );
}
