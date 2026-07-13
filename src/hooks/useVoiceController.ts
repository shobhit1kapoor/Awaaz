import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MicVAD, utils } from "@ricky0123/vad-web";
import { useCallback, useEffect, useRef } from "react";
import ortWasmModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmBinaryUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import {
  CLICKY_VISIBILITY_CHANGED_EVENT,
  APP_STATE_REQUESTED_EVENT,
  LISTENING_CANCELLED_EVENT,
  MODEL_SELECTED_EVENT,
  PUSH_TO_TALK_PRESSED_EVENT,
  PUSH_TO_TALK_RELEASED_EVENT,
  TASK_CONTEXT_RESET_EVENT,
  VAD_ENABLED_CHANGED_EVENT,
  WAKE_WORD_ENABLED_CHANGED_EVENT,
  publishAppSnapshot,
} from "../lib/appEvents";
import {
  inferExplicitWindowsAction,
  parseActionTags,
  type WindowsAction,
} from "../lib/actionParser";
import { executeAgentPlan } from "../lib/agentExecutor";
import {
  createDeterministicAgentPlan,
  shouldBlockAgenticRequest as shouldBlockPlannedRequest,
  shouldUseAgenticPlanner as shouldPlanRequest,
} from "../lib/agentPlan";
import { observeCurrentContext } from "../lib/agentObservation";
import {
  extractCoachGoal,
  formatCoachResponse,
  isSensitiveObservation,
  screenSignatureForObservation,
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
  getStoredAgentTasks,
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

const WAKE_WORD_ACTIVE_WINDOW_MS = 12_000;
const AUTO_LISTEN_MAX_SPEECH_MS = 12_000;

function shouldResetTaskContext(transcript: string): boolean {
  return /\b(fresh task|new task|reset(?: the)?(?: talk| chat| context| task)?|refresh(?: the)? talk|forget this|start over|clear context)\b/i.test(
    transcript,
  );
}

function shouldCompleteCurrentTask(transcript: string): boolean {
  return /\b(we'?re done|task done|that'?s done|finished this|complete this task)\b/i.test(
    transcript,
  );
}

function stripWakeWord(transcript: string): {
  heardWakeWord: boolean;
  command: string;
} {
  const wakeWordPattern =
    /\b(?:hey|hi|hello|okay|ok)?\s*(?:clicky|chat\s*gpt|chatgpt|awaaz|a\s*waaz|ai\s*buddy)\b[\s,.:;!?-]*/i;
  const heardWakeWord = wakeWordPattern.test(transcript);
  return {
    heardWakeWord,
    command: heardWakeWord
      ? transcript.replace(wakeWordPattern, "").trim()
      : transcript.trim(),
  };
}

export function useVoiceController(): void {
  const isListeningRef = useRef(false);
  const isProcessingRef = useRef(false);
  const vadRef = useRef<MicVAD | null>(null);
  const isVadStartingRef = useRef(false);
  const wakeWordActiveUntilRef = useRef(0);
  const autoListenTimeoutRef = useRef<number | null>(null);

  const { transcribeRecordedAudio } = useDeepgramStream();
  const {
    cancelStreamingTranscription,
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

  const clearAutoListenTimeout = useCallback(() => {
    if (autoListenTimeoutRef.current !== null) {
      window.clearTimeout(autoListenTimeoutRef.current);
      autoListenTimeoutRef.current = null;
    }
  }, []);

  const cancelCurrentListening = useCallback(
    async (message = "Stopped listening.") => {
      clearAutoListenTimeout();
      isListeningRef.current = false;
      cancelTTS();
      await cancelStreamingTranscription().catch(() => undefined);
      await vadRef.current?.pause().catch(() => undefined);
      mutateAndPublish(() => {
        const appState = useAppStore.getState();
        appState.setIsVadEnabled(false);
        appState.setInterimTranscript("");
        appState.setResponseText(message);
        appState.setVoiceState("idle");
      });
    },
    [cancelStreamingTranscription, cancelTTS, clearAutoListenTimeout],
  );

  const processTranscript = useCallback(
    async (
      transcript: string,
      screenshotPromise: Promise<ScreenCapturePayload>,
      options: { requireWakeWord?: boolean } = {},
    ) => {
      if (isProcessingRef.current) {
        return;
      }

      isProcessingRef.current = true;
      mutateAndPublish(() =>
        useAppStore.getState().setVoiceState("processing"),
      );

      try {
        let cleanTranscript = transcript.trim();
        mutateAndPublish(() =>
          useAppStore.getState().setInterimTranscript(cleanTranscript),
        );

        if (!cleanTranscript) {
          mutateAndPublish(() => useAppStore.getState().setVoiceState("idle"));
          return;
        }

        if (options.requireWakeWord) {
          const wakeWordResult = stripWakeWord(cleanTranscript);
          const isWakeWindowActive =
            Date.now() < wakeWordActiveUntilRef.current;

          if (!wakeWordResult.heardWakeWord && !isWakeWindowActive) {
            mutateAndPublish(() => {
              const appState = useAppStore.getState();
              appState.setInterimTranscript("");
              appState.setResponseText("");
              appState.setVoiceState("idle");
            });
            return;
          }

          if (wakeWordResult.heardWakeWord) {
            wakeWordActiveUntilRef.current =
              Date.now() + WAKE_WORD_ACTIVE_WINDOW_MS;
            cleanTranscript = wakeWordResult.command;
          }

          if (!cleanTranscript) {
            const displayedResponse = "I'm listening.";
            mutateAndPublish(() => {
              const appState = useAppStore.getState();
              appState.setInterimTranscript("");
              appState.setResponseText(displayedResponse);
              appState.setVoiceState("responding");
            });
            void playTTS(displayedResponse);
            await drainTTS();
            mutateAndPublish(() =>
              useAppStore.getState().setVoiceState("idle"),
            );
            return;
          }
        }

        if (shouldResetTaskContext(cleanTranscript)) {
          useAgentSessionStore.getState().endSession();
          const displayedResponse = "Fresh task. What are we doing now?";
          mutateAndPublish(() => {
            const appState = useAppStore.getState();
            appState.clearConversation();
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

        if (shouldCompleteCurrentTask(cleanTranscript)) {
          if (getActiveAgentSession()) {
            useAgentSessionStore.getState().completeSession();
          }
          const displayedResponse =
            "Got it. I saved that task and cleared the current goal.";
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

        mutateAndPublish(() =>
          useAppStore
            .getState()
            .appendConversationMessage({ role: "user", text: cleanTranscript }),
        );

        const deterministicPlan = createDeterministicAgentPlan(cleanTranscript);
        const inferredAction = inferExplicitWindowsAction(cleanTranscript);

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

        if (deterministicPlan) {
          useAgentSessionStore.getState().endSession();
          const actionErrors = await executeAgentPlan(deterministicPlan);
          if (actionErrors.length > 0) {
            console.warn("Awaaz deterministic plan failed", {
              transcript: cleanTranscript,
              goal: deterministicPlan.goal,
              errors: actionErrors,
            });
          }
          const displayedResponse =
            actionErrors.length === 0
              ? deterministicPlan.response
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

        if (inferredAction) {
          useAgentSessionStore.getState().endSession();
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

        if (
          shouldStartCoachSession(cleanTranscript) ||
          shouldContinueCoachSession(cleanTranscript, activeAgentSession)
        ) {
          let session =
            activeAgentSession?.mode === "coach"
              ? activeAgentSession
              : useAgentSessionStore
                  .getState()
                  .startSession("coach", extractCoachGoal(cleanTranscript));
          useAgentSessionStore.getState().setSessionStatus("observing");
          const observation = await observeCurrentContext(screenshotPromise);
          if (isSensitiveObservation(observation)) {
            const displayedResponse =
              "I paused screen coaching here because this looks sensitive.";
            useAgentSessionStore.getState().setSessionStatus("waiting");
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
            mutateAndPublish(() =>
              useAppStore.getState().setVoiceState("idle"),
            );
            return;
          }
          useAgentSessionStore
            .getState()
            .updateSessionApp(observation.activeWindow.appName);
          session = getActiveAgentSession() ?? session;
          useAgentSessionStore.getState().setSessionStatus("thinking");
          let coachStep;
          try {
            coachStep = await createCoachStepPlan(
              session,
              cleanTranscript,
              observation,
              getStoredAgentTasks(),
            );
          } catch (error) {
            console.warn("Awaaz coach planner failed", {
              transcript: cleanTranscript,
              goal: session.goal,
              error,
            });
            coachStep = {
              instruction: fallbackCoachInstruction(observation, cleanTranscript),
              target: null,
              expectedResult: "The user has opened the relevant app or page.",
              memory: "Coach planner failed; used local fallback.",
              verifier: "Relevant app or page is visible.",
              confidence: "low" as const,
              continueSession: true,
              done: false,
            };
          }
          if (coachStep.memory) {
            useAgentSessionStore
              .getState()
              .appendWorkingMemory(coachStep.memory);
          }
          useAgentSessionStore.getState().appendSessionStep({
            instruction: coachStep.instruction,
            expectedResult: coachStep.expectedResult,
            target: coachStep.target,
            userTranscript: cleanTranscript,
            screenSignature: screenSignatureForObservation(observation),
            appName: observation.activeWindow.appName,
            observedAt: observation.observedAt,
          });
          useAgentSessionStore
            .getState()
            .setSessionStatus(coachStep.done ? "idle" : "waiting");
          if (coachStep.done || !coachStep.continueSession) {
            useAgentSessionStore.getState().completeSession();
          }

          const displayedResponse = formatCoachResponse(coachStep, observation);
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
          appState.setErrorMessage(friendlyRequestError(error));
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
        { requireWakeWord: getAppSnapshot().isWakeWordEnabled },
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
          clearAutoListenTimeout();
          autoListenTimeoutRef.current = window.setTimeout(() => {
            void cancelCurrentListening(
              "I stayed in listening too long, so I stopped. Try again with a short phrase.",
            );
          }, AUTO_LISTEN_MAX_SPEECH_MS);
          cancelTTS();
          mutateAndPublish(() => {
            const appState = useAppStore.getState();
            appState.setErrorMessage(null);
            appState.setInterimTranscript(
              getAppSnapshot().isWakeWordEnabled
                ? "Listening for Hey Clicky..."
                : "Listening...",
            );
            appState.setResponseText("");
            appState.setVoiceState("listening");
          });
        },
        onVADMisfire: () => {
          clearAutoListenTimeout();
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
          clearAutoListenTimeout();
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
  }, [
    cancelCurrentListening,
    cancelTTS,
    clearAutoListenTimeout,
    processRecordedAudio,
  ]);

  const stopVad = useCallback(async () => {
    clearAutoListenTimeout();
    isListeningRef.current = false;
    await vadRef.current?.pause();
    mutateAndPublish(() => {
      const appState = useAppStore.getState();
      appState.setInterimTranscript("");
      if (!isProcessingRef.current) {
        appState.setVoiceState("idle");
      }
    });
  }, [clearAutoListenTimeout]);

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
      listen(LISTENING_CANCELLED_EVENT, () => void cancelCurrentListening()),
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
      listen<boolean>(WAKE_WORD_ENABLED_CHANGED_EVENT, (event) => {
        mutateAndPublish(() =>
          useAppStore.getState().setIsWakeWordEnabled(event.payload),
        );
      }),
      listen(TASK_CONTEXT_RESET_EVENT, () => {
        useAgentSessionStore.getState().endSession();
        mutateAndPublish(() => {
          const appState = useAppStore.getState();
          appState.clearConversation();
          appState.setVoiceState("idle");
        });
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
    cancelCurrentListening,
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

function friendlyRequestError(error: unknown): string {
  const errorText = String(error).toLowerCase();
  if (
    errorText.includes("abort") ||
    errorText.includes("timeout") ||
    errorText.includes("504")
  ) {
    return "The AI model took too long. I stopped that request—try again with a shorter question.";
  }
  return "I couldn't finish that. Try once more.";
}

function fallbackCoachInstruction(
  observation: {
    activeWindow: { appName: string | null; title: string };
  },
  transcript = "",
): string {
  if (/\b(wallpaper|background|desktop background)\b/i.test(transcript)) {
    return "Right-click an empty area of the desktop, then click Personalize.";
  }
  if (/\b(display settings|change(?: my)? display|resolution|scale)\b/i.test(transcript)) {
    return "Right-click an empty area of the desktop, then click Display settings.";
  }
  const appName = observation.activeWindow.appName || observation.activeWindow.title;
  if (!appName) {
    return "Open the app or page you want help with, then ask me again.";
  }
  return `I can see ${appName}. Tell me the exact goal, then say “next.”`;
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
