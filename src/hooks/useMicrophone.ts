import { useCallback, useRef, useState } from 'react';

interface UseMicrophoneResult {
  microphoneStream: MediaStream | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob>;
}

export function useMicrophone(): UseMicrophoneResult {
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    const nextMicrophoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunksRef.current = [];

    const mediaRecorder = new MediaRecorder(nextMicrophoneStream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.start();
    mediaRecorderRef.current = mediaRecorder;
    setMicrophoneStream(nextMicrophoneStream);
  }, []);

  const stopRecording = useCallback(async () => {
    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder) {
      throw new Error('Recording has not started.');
    }

    const recordedAudioBlob = await new Promise<Blob>((resolve) => {
      mediaRecorder.onstop = () => {
        resolve(new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' }));
      };
      mediaRecorder.stop();
    });

    microphoneStream?.getTracks().forEach((microphoneTrack) => microphoneTrack.stop());
    mediaRecorderRef.current = null;
    setMicrophoneStream(null);
    return recordedAudioBlob;
  }, [microphoneStream]);

  return { microphoneStream, startRecording, stopRecording };
}
