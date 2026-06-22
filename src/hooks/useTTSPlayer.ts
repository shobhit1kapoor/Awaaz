import { useCallback } from 'react';
import { fetchTextToSpeechAudio } from '../lib/workerClient';

export function useTTSPlayer() {
  const playTTS = useCallback(async (sentence: string) => {
    const response = await fetchTextToSpeechAudio(sentence);
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audioElement = new Audio(audioUrl);

    try {
      await audioElement.play();
      await new Promise<void>((resolve, reject) => {
        audioElement.onended = () => resolve();
        audioElement.onerror = () => reject(new Error('TTS audio playback failed.'));
      });
    } finally {
      URL.revokeObjectURL(audioUrl);
    }
  }, []);

  return { playTTS };
}
