import type { AgentSession } from "../store/agentSessionStore";
import type { AgentObservation } from "./agentObservation";

export interface CoachStepPlan {
  instruction: string;
  target: {
    x: number;
    y: number;
    label: string;
    screenIndex: number;
  } | null;
  expectedResult: string;
  memory: string | null;
  continueSession: boolean;
  done: boolean;
}

export function shouldStartCoachSession(transcript: string): boolean {
  const normalizedTranscript = transcript.trim().toLowerCase();
  return /\b(teach me|show me how|walk me through|guide me|help me learn|how do i|how to)\b/.test(
    normalizedTranscript,
  );
}

export function shouldContinueCoachSession(
  transcript: string,
  activeSession: AgentSession | null,
): boolean {
  if (!activeSession || activeSession.mode !== "coach") {
    return false;
  }

  const normalizedTranscript = transcript.trim().toLowerCase();
  if (/\b(stop|cancel|end|done|quit)\b/.test(normalizedTranscript)) {
    return false;
  }

  return (
    /\b(next|now what|what next|continue|i clicked|done|okay|ok|then|where)\b/.test(
      normalizedTranscript,
    ) || normalizedTranscript.length <= 80
  );
}

export function extractCoachGoal(transcript: string): string {
  return transcript
    .trim()
    .replace(
      /^(?:please\s+)?(?:teach me|show me how|walk me through|guide me|help me learn)\s+/i,
      "",
    )
    .replace(/^how (?:do i|to)\s+/i, "")
    .trim()
    .replace(/[.!?]+$/g, "");
}

export function formatCoachResponse(coachStep: CoachStepPlan): string {
  if (!coachStep.target) {
    return coachStep.instruction;
  }

  return `${coachStep.instruction} [POINT:${Math.round(
    coachStep.target.x,
  )}:${Math.round(coachStep.target.y)}:${coachStep.target.label}:screen${
    coachStep.target.screenIndex
  }]`;
}

export function buildObservationSummary(observation: AgentObservation): string {
  const windowTitle = observation.activeWindow.title || "unknown window";
  const appName = observation.activeWindow.appName || "unknown app";
  return `Active app: ${appName}. Window: ${windowTitle}. Cursor: (${observation.cursor.x}, ${observation.cursor.y}). Screenshot: ${observation.screenshot.image_width}x${observation.screenshot.image_height} on screen${observation.screenshot.monitor_id}.`;
}
