import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';
import { useClaudeSSE } from '../../hooks/useClaudeSSE';
import { useDeepgramStream } from '../../hooks/useDeepgramStream';
import { useMicrophone } from '../../hooks/useMicrophone';
import { useTTSPlayer } from '../../hooks/useTTSPlayer';
import { detectFirstCompleteSentence } from '../../lib/sentenceDetector';
import { type ScreenCapturePayload } from '../../lib/workerClient';
import { useAppStore } from '../../store/appStore';

export function PushToTalkButton() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const voiceState = useAppStore((appState) => appState.voiceState);
  const selectedModel = useAppStore((appState) => appState.selectedModel);
  const conversationHistory = useAppStore((appState) => appState.conversationHistory);
  const setVoiceState = useAppStore((appState) => appState.setVoiceState);
  const setInterimTranscript = useAppStore((appState) => appState.setInterimTranscript);
  const setResponseText = useAppStore((appState) => appState.setResponseText);
  const appendResponseText = useAppStore((appState) => appState.appendResponseText);
  const appendConversationMessage = useAppStore((appState) => appState.appendConversationMessage);
  const { startRecording, stopRecording } = useMicrophone();
  const { transcribeRecordedAudio } = useDeepgramStream();
  const { streamClaudeResponse } = useClaudeSSE();
  const { playTTS } = useTTSPlayer();

  const startPushToTalk = async () => {
    setErrorMessage(null);
    setInterimTranscript('Listening...');
    setResponseText('');
    setVoiceState('listening');
    await startRecording();
  };

  const stopPushToTalk = async () => {
    try {
      setVoiceState('processing');
      const recordedAudioBlob = await stopRecording();
      const transcriptionResult = await transcribeRecordedAudio(recordedAudioBlob);
      const transcript = transcriptionResult.text.trim();
      setInterimTranscript(transcript);

      if (!transcript) {
        setVoiceState('idle');
        return;
      }

      appendConversationMessage({ role: 'user', text: transcript });
      const screenshot = await invoke<ScreenCapturePayload>('capture_screen');
      let textWaitingForSpeech = '';
      setResponseText('');

      setVoiceState('responding');
      const assistantResponseText = await streamClaudeResponse(
        {
          transcript,
          screenshot,
          conversationHistory,
          model: selectedModel,
        },
        (textDelta) => {
          appendResponseText(textDelta);
          textWaitingForSpeech += textDelta;
          const completeSentence = detectFirstCompleteSentence(textWaitingForSpeech);
          if (completeSentence) {
            textWaitingForSpeech = textWaitingForSpeech.slice(completeSentence.length).trimStart();
            void playTTS(completeSentence);
          }
        },
      );

      if (textWaitingForSpeech.trim()) {
        await playTTS(textWaitingForSpeech.trim());
      }

      appendConversationMessage({ role: 'assistant', text: assistantResponseText });
      setVoiceState('idle');
    } catch (error) {
      setErrorMessage(String(error));
      setVoiceState('idle');
    }
  };

  const isListening = voiceState === 'listening';

  return (
    <div>
      <button
        className="primary-button"
        onMouseDown={() => void startPushToTalk()}
        onMouseUp={() => void stopPushToTalk()}
        onMouseLeave={() => {
          if (isListening) {
            void stopPushToTalk();
          }
        }}
      >
        {isListening ? 'Release to send' : 'Hold to talk'}
      </button>
      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
    </div>
  );
}
