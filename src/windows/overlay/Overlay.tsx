import { useMemo } from 'react';
import { useAppStore } from '../../store/appStore';
import { parsePointTags } from '../../lib/pointParser';
import { AudioWaveform } from './AudioWaveform';
import { BlueCursor } from './BlueCursor';
import { PointerAnimation } from './PointerAnimation';
import { ResponseBubble } from './ResponseBubble';
import './overlay.css';

export function Overlay() {
  const voiceState = useAppStore((appState) => appState.voiceState);
  const isClickyVisible = useAppStore((appState) => appState.isClickyVisible);
  const responseText = useAppStore((appState) => appState.responseText);
  const interimTranscript = useAppStore((appState) => appState.interimTranscript);

  const parsedResponse = useMemo(() => parsePointTags(responseText), [responseText]);

  if (!isClickyVisible) {
    return null;
  }

  return (
    <main className="overlay-root">
      <div className="cursor-cluster">
        <BlueCursor />
        {voiceState === 'listening' ? <AudioWaveform /> : null}
        {voiceState === 'processing' ? <div className="processing-spinner" /> : null}
        {voiceState === 'listening' && interimTranscript ? (
          <ResponseBubble text={interimTranscript} />
        ) : (
          <ResponseBubble text={parsedResponse.cleanText} />
        )}
        <PointerAnimation activePoint={parsedResponse.points[0] ?? null} />
      </div>
    </main>
  );
}
