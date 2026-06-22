import { useAppStore } from '../../store/appStore';

export function SettingsPanel() {
  const isClickyVisible = useAppStore((appState) => appState.isClickyVisible);
  const setIsClickyVisible = useAppStore((appState) => appState.setIsClickyVisible);

  return (
    <label className="checkbox-row">
      <input
        type="checkbox"
        checked={isClickyVisible}
        onChange={(event) => setIsClickyVisible(event.target.checked)}
      />
      Show Clicky
    </label>
  );
}
