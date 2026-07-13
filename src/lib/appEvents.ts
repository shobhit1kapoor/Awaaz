import { emit } from "@tauri-apps/api/event";
import type { AppSnapshot, ClaudeModel } from "../store/appStore";

export const PUSH_TO_TALK_PRESSED_EVENT = "push-to-talk-pressed";
export const PUSH_TO_TALK_RELEASED_EVENT = "push-to-talk-released";
export const APP_STATE_UPDATED_EVENT = "app-state-updated";
export const APP_STATE_REQUESTED_EVENT = "app-state-requested";
export const MODEL_SELECTED_EVENT = "model-selected";
export const CLICKY_VISIBILITY_CHANGED_EVENT = "clicky-visibility-changed";
export const VAD_ENABLED_CHANGED_EVENT = "vad-enabled-changed";
export const WAKE_WORD_ENABLED_CHANGED_EVENT = "wake-word-enabled-changed";
export const TASK_CONTEXT_RESET_EVENT = "task-context-reset";
export const LISTENING_CANCELLED_EVENT = "listening-cancelled";

export function publishAppSnapshot(appSnapshot: AppSnapshot): void {
  void emit(APP_STATE_UPDATED_EVENT, appSnapshot);
}

export function publishSelectedModel(selectedModel: ClaudeModel): void {
  void emit(MODEL_SELECTED_EVENT, selectedModel);
}

export function publishClickyVisibility(isClickyVisible: boolean): void {
  void emit(CLICKY_VISIBILITY_CHANGED_EVENT, isClickyVisible);
}

export function publishVadEnabled(isVadEnabled: boolean): void {
  void emit(VAD_ENABLED_CHANGED_EVENT, isVadEnabled);
}

export function publishWakeWordEnabled(isWakeWordEnabled: boolean): void {
  void emit(WAKE_WORD_ENABLED_CHANGED_EVENT, isWakeWordEnabled);
}

export function publishTaskContextReset(): void {
  void emit(TASK_CONTEXT_RESET_EVENT);
}

export function publishListeningCancelled(): void {
  void emit(LISTENING_CANCELLED_EVENT);
}
