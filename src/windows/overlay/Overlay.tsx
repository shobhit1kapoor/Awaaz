import { useMemo } from "react";
import { parseActionTags } from "../../lib/actionParser";
import { useCursorPosition } from "../../hooks/useCursorPosition";
import { useVoiceController } from "../../hooks/useVoiceController";
import { useAppStore } from "../../store/appStore";
import { parsePointTags } from "../../lib/pointParser";
import { AudioWaveform } from "./AudioWaveform";
import { PointerAnimation } from "./PointerAnimation";
import { ResponseBubble } from "./ResponseBubble";
import "./overlay.css";

export function Overlay() {
  useVoiceController();
  const cursorPosition = useCursorPosition();
  const voiceState = useAppStore((appState) => appState.voiceState);
  const isClickyVisible = useAppStore((appState) => appState.isClickyVisible);
  const responseText = useAppStore((appState) => appState.responseText);
  const interimTranscript = useAppStore(
    (appState) => appState.interimTranscript,
  );
  const errorMessage = useAppStore((appState) => appState.errorMessage);

  const parsedResponse = useMemo(() => {
    const pointResponse = parsePointTags(responseText);
    return {
      ...pointResponse,
      cleanText: parseActionTags(pointResponse.cleanText).cleanText,
    };
  }, [responseText]);

  if (!isClickyVisible) {
    return null;
  }

  return (
    <main className="overlay-root">
      <div
        className="cursor-cluster"
        style={{ left: cursorPosition.x, top: cursorPosition.y }}
      >
        {voiceState === "listening" ? <AudioWaveform /> : null}
        {voiceState === "processing" ? (
          <div className="processing-spinner" />
        ) : null}
        {voiceState === "listening" && interimTranscript ? (
          <ResponseBubble text={interimTranscript} />
        ) : (
          <ResponseBubble text={errorMessage ?? parsedResponse.cleanText} />
        )}
      </div>
      <PointerAnimation activePoint={parsedResponse.points[0] ?? null} />
    </main>
  );
}
