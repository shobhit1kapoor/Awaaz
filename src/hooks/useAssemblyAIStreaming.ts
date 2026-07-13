import { useCallback, useEffect, useRef } from "react";
import {
  downsampleFloat32To16Khz,
  encodeFloat32AsPcm16,
} from "../lib/pcmAudio";
import { getAssemblyAIStreamingToken } from "../lib/workerClient";

interface StreamingSession {
  audioContext: AudioContext;
  mediaSource: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  socket: WebSocket;
  transcriptPromise: Promise<string>;
  resolveTranscript: (transcript: string) => void;
  rejectTranscript: (error: Error) => void;
  latestTranscript: string;
  isStopping: boolean;
  terminationTimer: number | null;
}

interface AssemblyAIStreamingMessage {
  type?: string;
  transcript?: string;
  utterance?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
  error?: string;
}

const STREAM_OPEN_TIMEOUT_MS = 8_000;
const STREAM_STOP_TIMEOUT_MS = 2_500;

export function useAssemblyAIStreaming() {
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const activeSessionRef = useRef<StreamingSession | null>(null);

  const warmStreamingTranscription = useCallback(async () => {
    await withTimeout(
      getAssemblyAIStreamingToken(),
      STREAM_OPEN_TIMEOUT_MS,
      "AssemblyAI token request timed out.",
    );
    if (!microphoneStreamRef.current) {
      microphoneStreamRef.current = await withTimeout(
        navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
        STREAM_OPEN_TIMEOUT_MS,
        "Microphone permission or capture timed out.",
      );
    }
  }, []);

  const startStreamingTranscription = useCallback(
    async (onInterimTranscript: (transcript: string) => void) => {
      if (activeSessionRef.current) {
        return;
      }

      await warmStreamingTranscription();
      const token = await withTimeout(
        getAssemblyAIStreamingToken(),
        STREAM_OPEN_TIMEOUT_MS,
        "AssemblyAI token request timed out.",
      );
      const socket = new WebSocket(
        `wss://streaming.assemblyai.com/v3/ws?speech_model=u3-rt-pro&encoding=pcm_s16le&sample_rate=16000&min_turn_silence=100&max_turn_silence=700&token=${encodeURIComponent(
          token,
        )}`,
      );

      const audioContext = new AudioContext();
      const mediaSource = audioContext.createMediaStreamSource(
        microphoneStreamRef.current!,
      );
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      let resolveTranscript!: (transcript: string) => void;
      let rejectTranscript!: (error: Error) => void;
      const transcriptPromise = new Promise<string>((resolve, reject) => {
        resolveTranscript = resolve;
        rejectTranscript = reject;
      });

      const session: StreamingSession = {
        audioContext,
        mediaSource,
        processor,
        socket,
        transcriptPromise,
        resolveTranscript,
        rejectTranscript,
        latestTranscript: "",
        isStopping: false,
        terminationTimer: null,
      };
      activeSessionRef.current = session;

      socket.binaryType = "arraybuffer";
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          return;
        }

        let message: AssemblyAIStreamingMessage;
        try {
          message = JSON.parse(event.data) as AssemblyAIStreamingMessage;
        } catch {
          session.rejectTranscript(
            new Error("AssemblyAI streaming returned malformed JSON."),
          );
          return;
        }

        if (message.type === "Turn") {
          const transcript = (
            message.utterance ||
            message.transcript ||
            ""
          ).trim();
          if (transcript) {
            session.latestTranscript = transcript;
            onInterimTranscript(transcript);
          }
          if (message.end_of_turn && message.turn_is_formatted) {
            session.resolveTranscript(session.latestTranscript);
          }
        } else if (message.type === "Error") {
          session.rejectTranscript(
            new Error(message.error ?? "AssemblyAI streaming failed."),
          );
        } else if (message.type === "Termination") {
          session.resolveTranscript(session.latestTranscript);
        }
      };
      socket.onclose = () => {
        if (session.isStopping) {
          session.resolveTranscript(session.latestTranscript);
        }
      };

      await withTimeout(
        new Promise<void>((resolve, reject) => {
          const handleOpen = () => {
            socket.removeEventListener("open", handleOpen);
            socket.removeEventListener("error", handleOpenError);
            resolve();
          };
          const handleOpenError = () => {
            socket.removeEventListener("open", handleOpen);
            socket.removeEventListener("error", handleOpenError);
            reject(new Error("AssemblyAI streaming socket failed to open."));
          };
          socket.addEventListener("open", handleOpen);
          socket.addEventListener("error", handleOpenError);
        }),
        STREAM_OPEN_TIMEOUT_MS,
        "AssemblyAI streaming socket timed out.",
      );

      socket.onerror = () =>
        session.rejectTranscript(
          new Error("AssemblyAI streaming socket failed."),
        );

      processor.onaudioprocess = (event) => {
        if (socket.readyState !== WebSocket.OPEN || session.isStopping) {
          return;
        }
        const inputSamples = event.inputBuffer.getChannelData(0);
        const downsampledSamples = downsampleFloat32To16Khz(
          inputSamples,
          audioContext.sampleRate,
        );
        socket.send(encodeFloat32AsPcm16(downsampledSamples));
      };

      mediaSource.connect(processor);
      processor.connect(audioContext.destination);
    },
    [warmStreamingTranscription],
  );

  const stopStreamingTranscription = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) {
      throw new Error("Streaming transcription has not started.");
    }

    session.isStopping = true;
    try {
      session.processor.disconnect();
    } catch {
      // The processor may not have connected if the user released quickly.
    }
    try {
      session.mediaSource.disconnect();
    } catch {
      // The source may not have connected if the user released quickly.
    }
    await session.audioContext.close();

    if (session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ type: "Terminate" }));
    }
    session.terminationTimer = window.setTimeout(() => {
      session.resolveTranscript(session.latestTranscript);
      session.socket.close();
    }, STREAM_STOP_TIMEOUT_MS);

    try {
      return (await session.transcriptPromise).trim();
    } finally {
      if (session.terminationTimer !== null) {
        window.clearTimeout(session.terminationTimer);
      }
      if (
        session.socket.readyState === WebSocket.OPEN ||
        session.socket.readyState === WebSocket.CONNECTING
      ) {
        session.socket.close();
      }
      activeSessionRef.current = null;
    }
  }, []);

  const cancelStreamingTranscription = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) {
      return;
    }

    session.isStopping = true;
    if (session.terminationTimer !== null) {
      window.clearTimeout(session.terminationTimer);
    }
    try {
      session.processor.disconnect();
    } catch {
      // Best-effort cleanup.
    }
    try {
      session.mediaSource.disconnect();
    } catch {
      // Best-effort cleanup.
    }
    try {
      await session.audioContext.close();
    } catch {
      // Best-effort cleanup.
    }
    if (
      session.socket.readyState === WebSocket.OPEN ||
      session.socket.readyState === WebSocket.CONNECTING
    ) {
      session.socket.close();
    }
    session.resolveTranscript("");
    activeSessionRef.current = null;
  }, []);

  useEffect(
    () => () => {
      activeSessionRef.current?.socket.close();
      void activeSessionRef.current?.audioContext.close();
      microphoneStreamRef.current
        ?.getTracks()
        .forEach((microphoneTrack) => microphoneTrack.stop());
      microphoneStreamRef.current = null;
    },
    [],
  );

  return {
    cancelStreamingTranscription,
    startStreamingTranscription,
    stopStreamingTranscription,
    warmStreamingTranscription,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timeoutId: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error(errorMessage)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
}
