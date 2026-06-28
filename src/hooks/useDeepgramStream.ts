import { useCallback } from "react";
import { transcribeAudio } from "../lib/workerClient";

export function useDeepgramStream() {
  const transcribeRecordedAudio = useCallback(async (audioBlob: Blob) => {
    return transcribeAudio(audioBlob);
  }, []);

  return { transcribeRecordedAudio };
}
