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
import { executeAgentPlan } from "../lib/agentExecutor";
import {
  shouldBlockAgenticRequest as shouldBlockPlannedRequest,
  shouldUseAgenticPlanner as shouldPlanRequest,
} from "../lib/agentPlan";
import { observeCurrentContext } from "../lib/agentObservation";
import {
  extractCoachGoal,
  formatCoachResponse,
  shouldContinueCoachSession,
  shouldStartCoachSession,
} from "../lib/coachSession";
import { parsePointTags } from "../lib/pointParser";
import { detectFirstCompleteSentence } from "../lib/sentenceDetector";
import {
  createAgentPlan,
  createCoachStepPlan,
  pingWorker,
  type ScreenCapturePayload,
} from "../lib/workerClient";
import {
  getAppSnapshot,
  type ClaudeModel,
  useAppStore,
} from "../store/appStore";
import {
  getActiveAgentSession,
  useAgentSessionStore,
} from "../store/agentSessionStore";
import { useClaudeSSE } from "./useClaudeSSE";
import { useDeepgramStream } from "./useDeepgramStream";
import { useAssemblyAIStreaming } from "./useAssemblyAIStreaming";
import { useTTSPlayer } from "./useTTSPlayer";

function mutateAndPublish(mutation: () => void): void {
  mutation();
  publishAppSnapshot(getAppSnapshot());
}

let pendingSnapshotPublishTimer: number | null = null;

function mutateAndPublishSoon(mutation: () => void): void {
  mutation();
  if (pendingSnapshotPublishTimer !== null) {
    return;
  }
  pendingSnapshotPublishTimer = window.setTimeout(() => {
    pendingSnapshotPublishTimer = null;
    publishAppSnapshot(getAppSnapshot());
  }, 50);
}

function encodeVadAudioAsWav(audio: Float32Array): Blob {
  return new Blob([utils.encodeWAV(audio, 1, 16_000, 1, 16)], {
    type: "audio/wav",
  });
}

export function useVoiceController(): void {
  const isListeningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const vadRef = useRef<MicVAD | null>(null);
  const isVadStartingRef = useRef(false);

  const { transcribeRecordedAudio } = useDeepgramStream();
  const {
    startStreamingTranscription,
    stopStreamingTranscription,
    warmStreamingTranscription,
  } = useAssemblyAIStreaming();
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

  const processTranscript = useCallback(
    async (
      transcript: string,
      screenshotPromise: Promise<ScreenCapturePayload>,
    ) => {
      if (isProcessingRef.current) {
        return;
      }

      isProcessingRef.current = true;
      mutateAndPublish(() =>
        useAppStore.getState().setVoiceState("processing"),
      );

      try {
        const cleanTranscript = transcript.trim();
        mutateAndPublish(() =>
          useAppStore.getState().setInterimTranscript(cleanTranscript),
        );

        if (!cleanTranscript) {
          mutateAndPublish(() => useAppStore.getState().setVoiceState("idle"));
          return;
        }

        mutateAndPublish(() =>
          useAppStore
            .getState()
            .appendConversationMessage({ role: "user", text: cleanTranscript }),
        );

        if (shouldBlockPlannedRequest(cleanTranscript)) {
          const displayedResponse = "I can't do that.";
          useAgentSessionStore.getState().endSession();
          mutateAndPublish(() => {
            const appState = useAppStore.getState();
            appState.setResponseText(displayedResponse);
            appState.appendConversationMessage({
              role: "assistant",
              text: displayedResponse,
            });
            appState.setVoiceState("idle");
          });
          return;
        }

        const activeAgentSession = getActiveAgentSession();
        if (
          /\b(stop|cancel|end|quit)\b/i.test(cleanTranscript) &&
          activeAgentSession
        ) {
          useAgentSessionStore.getState().endSession();
          const displayedResponse = "Done.";
          mutateAndPublish(() => {
            const appState = useAppStore.getState();
            appState.setResponseText(displayedResponse);
            appState.appendConversationMessage({
              role: "assistant",
              text: displayedResponse,
            });
            appState.setVoiceState("idle");
          });
          return;
        }

        if (
          shouldStartCoachSession(cleanTranscript) ||
          shouldContinueCoachSession(cleanTranscript, activeAgentSession)
        ) {
          const session =
            activeAgentSession?.mode === "coach"
              ? activeAgentSession
              : useAgentSessionStore
                  .getState()
                  .startSession("coach", extractCoachGoal(cleanTranscript));
          useAgentSessionStore.getState().setSessionStatus("observing");
          const observation = await observeCurrentContext(screenshotPromise);
          useAgentSessionStore.getState().setSessionStatus("thinking");
          const coachStep = await createCoachStepPlan(
            session,
            cleanTranscript,
            observation,
          );
          if (coachStep.memory) {
            useAgentSessionStore
              .getState()
              .appendWorkingMemory(coachStep.memory);
          }
          useAgentSessionStore.getState().appendSessionStep({
            instruction: coachStep.instruction,
            expectedResult: coachStep.expectedResult,
            target: coachStep.target,
            observedAt: observation.observedAt,
          });
          useAgentSessionStore
            .getState()
            .setSessionStatus(coachStep.done ? "idle" : "waiting");
          if (coachStep.done || !coachStep.continueSession) {
            useAgentSessionStore.getState().endSession();
          }

          const displayedResponse = formatCoachResponse(coachStep);
          mutateAndPublish(() => {
            const appState = useAppStore.getState();
            appState.setResponseText(displayedResponse);
            appState.appendConversationMessage({
              role: "assistant",
              text: parsePointTags(displayedResponse).cleanText,
            });
            appState.setVoiceState("responding");
          });
          void playTTS(parsePointTags(displayedResponse).cleanText);
          await drainTTS();
          mutateAndPublish(() => useAppStore.getState().setVoiceState("idle"));
          return;
        }

        if (shouldPlanRequest(cleanTranscript)) {
          const agentPlan = await createAgentPlan(cleanTranscript);
          const actionErrors = await executeAgentPlan(agentPlan);
          if (actionErrors.length > 0) {
            console.warn("Awaaz agent plan failed", {
              transcript: cleanTranscript,
              goal: agentPlan.goal,
              errors: actionErrors,
            });
          }
          const displayedResponse =
            actionErrors.length === 0
              ? agentPlan.response
              : friendlyActionFailure(cleanTranscript);
          mutateAndPublish(() => {
            const appState = useAppStore.getState();
            appState.setResponseText(displayedResponse);
            appState.appendConversationMessage({
              role: "assistant",
              text: displayedResponse,
            });
            appState.setVoiceState("responding");
          });
          void playTTS(displayedResponse);
          await drainTTS();
          mutateAndPublish(() => useAppStore.getState().setVoiceState("idle"));
          return;
        }

        const inferredAction = inferExplicitWindowsAction(cleanTranscript);
        if (inferredAction) {
          const actionErrors = await executeWindowsActions([inferredAction]);
          if (actionErrors.length > 0) {
            console.warn("Awaaz Windows action failed", {
              transcript: cleanTranscript,
              action: inferredAction,
              errors: actionErrors,
            });
          }
          const displayedResponse =
            actionErrors.length === 0
              ? actionResponseFor(inferredAction)
              : friendlyActionFailure(cleanTranscript);
          mutateAndPublish(() => {
            const appState = useAppStore.getState();
            appState.setResponseText(displayedResponse);
            appState.appendConversationMessage({
              role: "assistant",
              text: displayedResponse,
            });
            appState.setVoiceState("responding");
          });
          void playTTS(displayedResponse);
          await drainTTS();
          mutateAndPublish(() => useAppStore.getState().setVoiceState("idle"));
          return;
        }

        const screenshot = await screenshotPromise;
        let textWaitingForSpeech = "";
        let receivedFirstToken = false;
        mutateAndPublish(() => useAppStore.getState().setResponseText(""));
        const stateBeforeResponse = getAppSnapshot();

        const assistantResponseText = await streamClaudeResponse(
          {
            transcript: cleanTranscript,
            screenshot,
            conversationHistory: stateBeforeResponse.conversationHistory.slice(
              0,
              -1,
            ),
            model: stateBeforeResponse.selectedModel,
          },
          (textDelta) => {
            mutateAndPublishSoon(() => {
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
        const cleanAssistantResponse = parsePointTags(
          parsedAssistantResponse.cleanText,
        ).cleanText;
        const displayedResponse = cleanAssistantResponse;
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
        console.error("Awaaz request failed", error);
        mutateAndPublish(() => {
          const appState = useAppStore.getState();
          appState.setErrorMessage("I couldn't finish that. Try once more.");
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
    ],
  );

  const processRecordedAudio = useCallback(
    async (recordedAudioBlob: Blob) => {
      const transcriptionResult =
        await transcribeRecordedAudio(recordedAudioBlob);
      await processTranscript(
        transcriptionResult.text,
        invoke<ScreenCapturePayload>("capture_screen"),
      );
    },
    [processTranscript, transcribeRecordedAudio],
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
      await startStreamingTranscription((transcript) => {
        mutateAndPublishSoon(() =>
          useAppStore.getState().setInterimTranscript(transcript),
        );
      });
    } catch (error) {
      console.error("Awaaz push-to-talk start failed", error);
      isListeningRef.current = false;
      mutateAndPublish(() => {
        const appState = useAppStore.getState();
        appState.setErrorMessage("I couldn't start listening.");
        appState.setVoiceState("idle");
      });
      await resumeVadIfEnabled().catch(() => undefined);
    }
  }, [cancelTTS, resumeVadIfEnabled, startStreamingTranscription]);

  const stopPushToTalk = useCallback(async () => {
    if (!isListeningRef.current || isProcessingRef.current) {
      return;
    }

    isListeningRef.current = false;
    try {
      const transcriptPromise = stopStreamingTranscription();
      const screenshotPromise = invoke<ScreenCapturePayload>("capture_screen");
      await processTranscript(await transcriptPromise, screenshotPromise);
    } catch (error) {
      console.error("Awaaz push-to-talk stop failed", error);
      mutateAndPublish(() => {
        const appState = useAppStore.getState();
        appState.setErrorMessage("I couldn't process that. Try once more.");
        appState.setVoiceState("idle");
      });
      await resumeVadIfEnabled().catch(() => undefined);
    }
  }, [processTranscript, resumeVadIfEnabled, stopStreamingTranscription]);

  useEffect(() => {
    void pingWorker().catch(() => undefined);
    void warmStreamingTranscription().catch(() => undefined);
    const workerWarmupInterval = window.setInterval(() => {
      void pingWorker().catch(() => undefined);
      void warmStreamingTranscription().catch(() => undefined);
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
  }, [
    startPushToTalk,
    startVad,
    stopPushToTalk,
    stopVad,
    warmStreamingTranscription,
  ]);
}

function friendlyActionFailure(transcript: string): string {
  const normalizedTranscript = transcript.toLowerCase();
  if (normalizedTranscript.includes("spotify")) {
    return "I couldn't finish that in Spotify. Try once more with Spotify visible.";
  }
  if (
    normalizedTranscript.includes("chrome") ||
    normalizedTranscript.includes("search")
  ) {
    return "I couldn't finish that search. Try once more.";
  }
  return "I couldn't finish that. Try once more.";
}

function actionResponseFor(action: WindowsAction): string {
  switch (action.kind) {
    case "open_app":
      return `Opening ${action.target}.`;
    case "open_folder":
      return `Opening ${action.target}.`;
    case "open_url":
      return "Opening that link.";
    case "web_search":
      return `Searching for ${action.target}.`;
    case "type_text":
      return "Typing that now.";
  }
}
