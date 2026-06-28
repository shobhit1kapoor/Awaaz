import { useCallback, useRef } from "react";
import { fetchTextToSpeechAudio } from "../lib/workerClient";

export function useTTSPlayer() {
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());

  const playWorkerTTS = useCallback(async (sentence: string) => {
    const response = await fetchTextToSpeechAudio(sentence);
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audioElement = new Audio(audioUrl);

    try {
      await audioElement.play();
      await new Promise<void>((resolve, reject) => {
        audioElement.onended = () => resolve();
        audioElement.onerror = () =>
          reject(new Error("TTS audio playback failed."));
      });
    } finally {
      URL.revokeObjectURL(audioUrl);
    }
  }, []);

  const playLocalTTS = useCallback(
    (sentence: string) =>
      new Promise<void>((resolve, reject) => {
        if (!("speechSynthesis" in window)) {
          reject(
            new Error(
              "Local speech synthesis is not available in this WebView.",
            ),
          );
          return;
        }

        const utterance = new SpeechSynthesisUtterance(sentence);
        utterance.rate = 1.05;
        utterance.onend = () => resolve();
        utterance.onerror = (event) =>
          reject(new Error(`Local speech synthesis failed: ${event.error}`));
        window.speechSynthesis.speak(utterance);
      }),
    [],
  );

  const playTTS = useCallback(
    (sentence: string) => {
      const speechTask = () =>
        import.meta.env.VITE_TTS_MODE === "worker"
          ? playWorkerTTS(sentence)
          : playLocalTTS(sentence);
      speechQueueRef.current = speechQueueRef.current
        .catch(() => undefined)
        .then(speechTask);
      return speechQueueRef.current;
    },
    [playLocalTTS, playWorkerTTS],
  );

  const drainTTS = useCallback(() => speechQueueRef.current, []);
  const cancelTTS = useCallback(() => {
    window.speechSynthesis?.cancel();
    speechQueueRef.current = Promise.resolve();
  }, []);

  return { playTTS, drainTTS, cancelTTS };
}
