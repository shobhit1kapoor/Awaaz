import { type ClaudeModel, useAppStore } from '../../store/appStore';

const availableModels: Array<{ label: string; value: ClaudeModel }> = [
  { label: 'Kimi K2 Thinking', value: 'moonshotai/kimi-k2-thinking' },
  { label: 'Kimi K2 Instruct', value: 'moonshotai/kimi-k2-instruct' },
  { label: 'Kimi Dev 72B', value: 'moonshotai/kimi-dev-72b' },
];

export function ModelPicker() {
  const selectedModel = useAppStore((appState) => appState.selectedModel);
  const setSelectedModel = useAppStore((appState) => appState.setSelectedModel);

  return (
    <label className="field-label">
      Model
      <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value as ClaudeModel)}>
        {availableModels.map((availableModel) => (
          <option key={availableModel.value} value={availableModel.value}>
            {availableModel.label}
          </option>
        ))}
      </select>
    </label>
  );
}
