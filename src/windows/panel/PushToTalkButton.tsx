import { emit } from "@tauri-apps/api/event";
import {
  PUSH_TO_TALK_PRESSED_EVENT,
  PUSH_TO_TALK_RELEASED_EVENT,
} from "../../lib/appEvents";
import { useAppStore } from "../../store/appStore";

export function PushToTalkButton() {
  const voiceState = useAppStore((appState) => appState.voiceState);
  const errorMessage = useAppStore((appState) => appState.errorMessage);

  const isListening = voiceState === "listening";

  return (
    <div>
      <button
        className="primary-button"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          void emit(PUSH_TO_TALK_PRESSED_EVENT);
        }}
        onPointerUp={() => void emit(PUSH_TO_TALK_RELEASED_EVENT)}
        onPointerCancel={() => void emit(PUSH_TO_TALK_RELEASED_EVENT)}
      >
        {isListening ? "Release to send" : "Hold Ctrl+Shift+Space to talk"}
      </button>
      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
    </div>
  );
}
