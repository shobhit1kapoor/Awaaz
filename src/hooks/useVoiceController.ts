import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MicVAD, utils } from "@ricky0123/vad-web";
import { useCallback, useEffect, useRef } from "react";
import ortWasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmBinaryUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import {
  CLICKY_VISIBILITY_CHANGED_EVENT,
  APP_STATE_REQUESTED_EVENT,
  MODEL_SELECTED_EVENT,
  PUSH_TO_TALK_PRESSED_EVENT,
  PUSH_TO_TALK_RELEASED_EVENT,
  VAD_ENABLED_CHANGED_EVENT,
  publishAppSnapshot,
} from "../lib/appEvents";
import {
  inferExplicitWindowsAction,
  parseActionTags,
  type WindowsAction,
} from "../lib/actionParser";
import { parsePointTags } from "../lib/pointParser";
import { detectFirstCompleteSentence } from "../lib/sentenceDetector";
import { pingWorker, type ScreenCapturePayload } from "../lib/workerClient";
import {
  getAppSnapshot,
  type ClaudeModel,
  useAppStore,
} from "../store/appStore";
import { useClaudeSSE } from "./useClaudeSSE";
import { useDeepgramStream } from "./useDeepgramStream";
import { useMicrophone } from "./useMicrophone";
import { useTTSPlayer } from "./useTTSPlayer";

function mutateAndPublish(mutation: () => void): void {
  mutation();
  publishAppSnapshot(getAppSnapshot());
}

function encodeVadAudioAsWav(audio: Float32Array): Blob {
  return new Blob([utils.encodeWAV(audio, 1, 16_000, 1, 16)], {
    type: "audio/wav",
  });
}

export function useVoiceController(): void {
  const isListeningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const recordingStartPromiseRef = useRef<Promise<void> | null>(null);
  const vadRef = useRef<MicVAD | null>(null);
  const isVadStartingRef = useRef(false);

  const { startRecording, stopRecording } = useMicrophone();
  const { transcribeRecordedAudio } = useDeepgramStream();
  const { streamClaudeResponse } = useClaudeSSE();
  const { playTTS, drainTTS, cancelTTS } = useTTSPlayer();

  const executeWindowsActions = useCallback(
    async (actions: WindowsAction[]) => {
      const actionErrors: string[] = [];
      for (const action of actions.slice(0, 3)) {
        try {
          await invoke("open_windows_target", {
            kind: action.kind,
            query: action.target,
          });
        } catch (error) {
          actionErrors.push(String(error));
        }
      }
      return actionErrors;
    },
    [],
  );

  const resumeVadIfEnabled = useCallback(async () => {
    if (
      getAppSnapshot().isVadEnabled &&
      vadRef.current &&
      !isListeningRef.current
    ) {
      await vadRef.current.start();
    }
  }, []);

  const processRecordedAudio = useCallback(
    async (recordedAudioBlob: Blob) => {
      if (isProcessingRef.current) {
        return;
      }

      isProcessingRef.current = true;
      mutateAndPublish(() =>
        useAppStore.getState().setVoiceState("processing"),
      );

      try {
        const transcriptionResult =
          await transcribeRecordedAudio(recordedAudioBlob);
        const transcript = transcriptionResult.text.trim();
        mutateAndPublish(() =>
          useAppStore.getState().setInterimTranscript(transcript),
        );

        if (!transcript) {
          mutateAndPublish(() => useAppStore.getState().setVoiceState("idle"));
          return;
        }

        mutateAndPublish(() =>
          useAppStore
            .getState()
            .appendConversationMessage({ role: "user", text: transcript }),
        );

        const screenshot = await invoke<ScreenCapturePayload>("capture_screen");
        let textWaitingForSpeech = "";
        let receivedFirstToken = false;
        mutateAndPublish(() => useAppStore.getState().setResponseText(""));
        const stateBeforeResponse = getAppSnapshot();

        const assistantResponseText = await streamClaudeResponse(
          {
            transcript,
            screenshot,
            conversationHistory: stateBeforeResponse.conversationHistory.slice(
              0,
              -1,
            ),
            model: stateBeforeResponse.selectedModel,
          },
          (textDelta) => {
            mutateAndPublish(() => {
              const appState = useAppStore.getState();
              if (!receivedFirstToken) {
                receivedFirstToken = true;
                appState.setVoiceState("responding");
              }
              appState.appendResponseText(textDelta);
            });

            textWaitingForSpeech += textDelta;
            let completeSentence =
              detectFirstCompleteSentence(textWaitingForSpeech);
            while (completeSentence) {
              textWaitingForSpeech = textWaitingForSpeech
                .slice(completeSentence.length)
                .trimStart();
              const spokenSentence = parseActionTags(
                parsePointTags(completeSentence).cleanText,
              ).cleanText;
              if (spokenSentence) {
                void playTTS(spokenSentence);
              }
              completeSentence =
                detectFirstCompleteSentence(textWaitingForSpeech);
            }
          },
        );

        const remainingSpeech = parseActionTags(
          parsePointTags(textWaitingForSpeech.trim()).cleanText,
        ).cleanText;
        if (remainingSpeech) {
          void playTTS(remainingSpeech);
        }

        const parsedAssistantResponse = parseActionTags(assistantResponseText);
        const inferredAction = inferExplicitWindowsAction(transcript);
        const actionsToExecute = inferredAction ? [inferredAction] : [];
        const actionErrors = await executeWindowsActions(actionsToExecute);
        const cleanAssistantResponse = parsePointTags(
          parsedAssistantResponse.cleanText,
        ).cleanText;
        const displayedResponse =
          actionErrors.length === 0
            ? cleanAssistantResponse
            : `${cleanAssistantResponse}\n\nI couldn't complete that action: ${actionErrors.join(" ")}`;
        mutateAndPublish(() =>
          useAppStore.getState().setResponseText(displayedResponse),
        );
        await drainTTS();

        mutateAndPublish(() => {
          const appState = useAppStore.getState();
          appState.appendConversationMessage({
            role: "assistant",
            text: displayedResponse,
          });
          appState.setVoiceState("idle");
        });
      } catch (error) {
        mutateAndPublish(() => {
          const appState = useAppStore.getState();
          appState.setErrorMessage(String(error));
          appState.setVoiceState("idle");
        });
      } finally {
        isProcessingRef.current = false;
        isListeningRef.current = false;
        await resumeVadIfEnabled().catch(() => undefined);
      }
    },
    [
      drainTTS,
      executeWindowsActions,
      playTTS,
      resumeVadIfEnabled,
      streamClaudeResponse,
      transcribeRecordedAudio,
    ],
  );

  const startVad = useCallback(async () => {
    if (vadRef.current || isVadStartingRef.current) {
      if (vadRef.current && getAppSnapshot().isVadEnabled) {
        await vadRef.current.start();
      }
      return;
    }

    isVadStartingRef.current = true;
    try {
      const vad = await MicVAD.new({
        model: "v5",
        baseAssetPath: "/vad/",
        onnxWASMBasePath: {
          mjs: ortWasmModuleUrl,
          wasm: ortWasmBinaryUrl,
        } as unknown as string,
        ortConfig: (ort) => {
          ort.env.logLevel = "error";
          ort.env.wasm.numThreads = 1;
        },
        positiveSpeechThreshold: 0.8,
        negativeSpeechThreshold: 0.35,
        redemptionMs: 500,
        preSpeechPadMs: 300,
        minSpeechMs: 250,
        startOnLoad: false,
        onSpeechStart: () => {
          if (isProcessingRef.current || isListeningRef.current) {
            return;
          }

          isListeningRef.current = true;
          cancelTTS();
          mutateAndPublish(() => {
            const appState = useAppStore.getState();
            appState.setErrorMessage(null);
            appState.setInterimTranscript("Listening...");
            appState.setResponseText("");
            appState.setVoiceState("listening");
          });
        },
        onVADMisfire: () => {
          if (!isProcessingRef.current) {
            isListeningRef.current = false;
            mutateAndPublish(() => {
              const appState = useAppStore.getState();
              appState.setInterimTranscript("");
              appState.setVoiceState("idle");
            });
          }
        },
        onSpeechEnd: (audio) => {
          if (!isListeningRef.current || isProcessingRef.current) {
            return;
          }

          isListeningRef.current = false;
          void vadRef.current?.pause();
          void processRecordedAudio(encodeVadAudioAsWav(audio));
        },
      });

      vadRef.current = vad;
      if (getAppSnapshot().isVadEnabled) {
        await vad.start();
      }
    } catch (error) {
      mutateAndPublish(() => {
        const appState = useAppStore.getState();
        appState.setErrorMessage(
          `Auto listen could not start: ${String(error)}`,
        );
        appState.setIsVadEnabled(false);
        appState.setVoiceState("idle");
      });
    } finally {
      isVadStartingRef.current = false;
    }
  }, [cancelTTS, processRecordedAudio]);

  const stopVad = useCallback(async () => {
    isListeningRef.current = false;
    await vadRef.current?.pause();
    mutateAndPublish(() => {
      const appState = useAppStore.getState();
      appState.setInterimTranscript("");
      if (!isProcessingRef.current) {
        appState.setVoiceState("idle");
      }
    });
  }, []);

  const startPushToTalk = useCallback(async () => {
    if (isListeningRef.current || isProcessingRef.current) {
      return;
    }

    await vadRef.current?.pause().catch(() => undefined);
    isListeningRef.current = true;
    cancelTTS();
    mutateAndPublish(() => {
      const appState = useAppStore.getState();
      appState.setErrorMessage(null);
      appState.setInterimTranscript("Listening...");
      appState.setResponseText("");
      appState.setVoiceState("listening");
    });

    try {
      const recordingStartPromise = startRecording();
      recordingStartPromiseRef.current = recordingStartPromise;
      await recordingStartPromise;
    } catch (error) {
      isListeningRef.current = false;
      mutateAndPublish(() => {
        const appState = useAppStore.getState();
        appState.setErrorMessage(String(error));
        appState.setVoiceState("idle");
      });
      await resumeVadIfEnabled().catch(() => undefined);
    } finally {
      recordingStartPromiseRef.current = null;
    }
  }, [cancelTTS, resumeVadIfEnabled, startRecording]);

  const stopPushToTalk = useCallback(async () => {
    if (!isListeningRef.current || isProcessingRef.current) {
      return;
    }

    isListeningRef.current = false;
    try {
      await recordingStartPromiseRef.current;
      const recordedAudioBlob = await stopRecording();
      await processRecordedAudio(recordedAudioBlob);
    } catch (error) {
      mutateAndPublish(() => {
        const appState = useAppStore.getState();
        appState.setErrorMessage(String(error));
        appState.setVoiceState("idle");
      });
      await resumeVadIfEnabled().catch(() => undefined);
    }
  }, [processRecordedAudio, resumeVadIfEnabled, stopRecording]);

  useEffect(() => {
    void pingWorker().catch(() => undefined);
    const workerWarmupInterval = window.setInterval(() => {
      void pingWorker().catch(() => undefined);
    }, 30_000);

    if (getAppSnapshot().isVadEnabled) {
      void startVad();
    }

    const unlistenPromises = [
      listen(PUSH_TO_TALK_PRESSED_EVENT, () => void startPushToTalk()),
      listen(PUSH_TO_TALK_RELEASED_EVENT, () => void stopPushToTalk()),
      listen<ClaudeModel>(MODEL_SELECTED_EVENT, (event) => {
        mutateAndPublish(() =>
          useAppStore.getState().setSelectedModel(event.payload),
        );
      }),
      listen<boolean>(CLICKY_VISIBILITY_CHANGED_EVENT, (event) => {
        mutateAndPublish(() =>
          useAppStore.getState().setIsClickyVisible(event.payload),
        );
      }),
      listen<boolean>(VAD_ENABLED_CHANGED_EVENT, (event) => {
        mutateAndPublish(() =>
          useAppStore.getState().setIsVadEnabled(event.payload),
        );
        if (event.payload) {
          void startVad();
        } else {
          void stopVad();
        }
      }),
      listen(APP_STATE_REQUESTED_EVENT, () =>
        publishAppSnapshot(getAppSnapshot()),
      ),
    ];

    publishAppSnapshot(getAppSnapshot());
    return () => {
      void Promise.all(unlistenPromises).then((unlistenFunctions) => {
        unlistenFunctions.forEach((unlistenFunction) => unlistenFunction());
      });
      window.clearInterval(workerWarmupInterval);
      void vadRef.current?.destroy();
      vadRef.current = null;
    };
  }, [startPushToTalk, startVad, stopPushToTalk, stopVad]);
}
