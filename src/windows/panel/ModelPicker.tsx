import { type ClaudeModel, useAppStore } from "../../store/appStore";
import { publishSelectedModel } from "../../lib/appEvents";

const availableModels: Array<{ label: string; value: ClaudeModel }> = [
  {
    label: "Llama 4 Maverick",
    value: "meta/llama-4-maverick-17b-128e-instruct",
  },
  { label: "Kimi K2.6", value: "moonshotai/kimi-k2.6" },
  {
    label: "Nemotron Nano VL",
    value: "nvidia/nemotron-nano-12b-v2-vl",
  },
];

export function ModelPicker() {
  const selectedModel = useAppStore((appState) => appState.selectedModel);
  const setSelectedModel = useAppStore((appState) => appState.setSelectedModel);

  return (
    <label className="field-label">
      <span>Model</span>
      <select
        value={selectedModel}
        onChange={(event) => {
          const nextModel = event.target.value as ClaudeModel;
          setSelectedModel(nextModel);
          publishSelectedModel(nextModel);
        }}
      >
        {availableModels.map((availableModel) => (
          <option key={availableModel.value} value={availableModel.value}>
            {availableModel.label}
          </option>
        ))}
      </select>
    </label>
  );
}
