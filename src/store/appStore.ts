import { create } from "zustand";

export type VoiceState = "idle" | "listening" | "processing" | "responding";
export type ClaudeModel =
  | "meta/llama-4-maverick-17b-128e-instruct"
  | "moonshotai/kimi-k2.6"
  | "nvidia/nemotron-nano-12b-v2-vl";

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AppSnapshot {
  voiceState: VoiceState;
  selectedModel: ClaudeModel;
  isClickyVisible: boolean;
  isVadEnabled: boolean;
  interimTranscript: string;
  responseText: string;
  conversationHistory: ConversationMessage[];
  errorMessage: string | null;
}

interface AppState extends AppSnapshot {
  setVoiceState: (voiceState: VoiceState) => void;
  setSelectedModel: (selectedModel: ClaudeModel) => void;
  setIsClickyVisible: (isClickyVisible: boolean) => void;
  setIsVadEnabled: (isVadEnabled: boolean) => void;
  setInterimTranscript: (interimTranscript: string) => void;
  setResponseText: (responseText: string) => void;
  appendResponseText: (textDelta: string) => void;
  appendConversationMessage: (conversationMessage: ConversationMessage) => void;
  setErrorMessage: (errorMessage: string | null) => void;
  hydrateSnapshot: (appSnapshot: AppSnapshot) => void;
}

export const useAppStore = create<AppState>((set) => ({
  voiceState: "idle",
  selectedModel: "meta/llama-4-maverick-17b-128e-instruct",
  isClickyVisible: true,
  isVadEnabled: false,
  interimTranscript: "",
  responseText: "",
  conversationHistory: [],
  errorMessage: null,
  setVoiceState: (voiceState) => set({ voiceState }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setIsClickyVisible: (isClickyVisible) => set({ isClickyVisible }),
  setIsVadEnabled: (isVadEnabled) => set({ isVadEnabled }),
  setInterimTranscript: (interimTranscript) => set({ interimTranscript }),
  setResponseText: (responseText) => set({ responseText }),
  appendResponseText: (textDelta) =>
    set((currentState) => ({
      responseText: `${currentState.responseText}${textDelta}`,
    })),
  appendConversationMessage: (conversationMessage) =>
    set((currentState) => ({
      conversationHistory: [
        ...currentState.conversationHistory,
        conversationMessage,
      ],
    })),
  setErrorMessage: (errorMessage) => set({ errorMessage }),
  hydrateSnapshot: (appSnapshot) => set(appSnapshot),
}));

export function getAppSnapshot(): AppSnapshot {
  const appState = useAppStore.getState();
  return {
    voiceState: appState.voiceState,
    selectedModel: appState.selectedModel,
    isClickyVisible: appState.isClickyVisible,
    isVadEnabled: appState.isVadEnabled,
    interimTranscript: appState.interimTranscript,
    responseText: appState.responseText,
    conversationHistory: appState.conversationHistory,
    errorMessage: appState.errorMessage,
  };
}
