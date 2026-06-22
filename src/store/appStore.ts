import { create } from 'zustand';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'responding';
export type ClaudeModel = 'moonshotai/kimi-k2-thinking' | 'moonshotai/kimi-k2-instruct' | 'moonshotai/kimi-dev-72b';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface AppState {
  voiceState: VoiceState;
  selectedModel: ClaudeModel;
  isClickyVisible: boolean;
  interimTranscript: string;
  responseText: string;
  conversationHistory: ConversationMessage[];
  setVoiceState: (voiceState: VoiceState) => void;
  setSelectedModel: (selectedModel: ClaudeModel) => void;
  setIsClickyVisible: (isClickyVisible: boolean) => void;
  setInterimTranscript: (interimTranscript: string) => void;
  setResponseText: (responseText: string) => void;
  appendResponseText: (textDelta: string) => void;
  appendConversationMessage: (conversationMessage: ConversationMessage) => void;
}

export const useAppStore = create<AppState>((set) => ({
  voiceState: 'idle',
  selectedModel: 'moonshotai/kimi-k2-thinking',
  isClickyVisible: true,
  interimTranscript: '',
  responseText: '',
  conversationHistory: [],
  setVoiceState: (voiceState) => set({ voiceState }),
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setIsClickyVisible: (isClickyVisible) => set({ isClickyVisible }),
  setInterimTranscript: (interimTranscript) => set({ interimTranscript }),
  setResponseText: (responseText) => set({ responseText }),
  appendResponseText: (textDelta) =>
    set((currentState) => ({ responseText: `${currentState.responseText}${textDelta}` })),
  appendConversationMessage: (conversationMessage) =>
    set((currentState) => ({
      conversationHistory: [...currentState.conversationHistory, conversationMessage],
    })),
}));
