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
  verifier: string;
  confidence: "low" | "medium" | "high";
  continueSession: boolean;
  done: boolean;
}

export function shouldStartCoachSession(transcript: string): boolean {
  const normalizedTranscript = transcript.trim().toLowerCase();
  return (
    /\b(teach me|show me how|walk me through|guide me|help me learn|how do i|how to)\b/.test(
      normalizedTranscript,
    ) ||
    /\b(tell me|show me|help me|assist me|what should i|where should i|where do i|what do i)\b.*\b(click|do|use|edit|send|make|create|fix|change|open|select|choose)\b/.test(
      normalizedTranscript,
    ) ||
    /\b(i don't know|i do not know|not sure|confused|stuck)\b.*\b(what|where|how|next|do|click)\b/.test(
      normalizedTranscript,
    ) ||
    /\b(figma|photoshop|gmail|outlook|chrome|word|excel|canva|premiere|illustrator)\b.*\b(help|guide|teach|where|what|how|edit|send|create|make)\b/.test(
      normalizedTranscript,
    )
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
  if (/\b(stop|cancel|end|quit|exit coaching|stop coaching)\b/.test(normalizedTranscript)) {
    return false;
  }

  return (
    /\b(next|now what|what next|continue|i clicked|clicked it|i did it|done|okay|ok|then|where|what now|go on|keep going)\b/.test(
      normalizedTranscript,
    ) || normalizedTranscript.length <= 80
  );
}

export function extractCoachGoal(transcript: string): string {
  return transcript
    .trim()
    .replace(
      /^(?:please\s+)?(?:teach me|show me how|walk me through|guide me|help me learn|help me|assist me|tell me how to|tell me where to|show me where to)\s+/i,
      "",
    )
    .replace(/^how (?:do i|to)\s+/i, "")
    .replace(/^what should i\s+/i, "")
    .trim()
    .replace(/[.!?]+$/g, "");
}

export function formatCoachResponse(
  coachStep: CoachStepPlan,
  observation?: AgentObservation,
): string {
  if (!coachStep.target || coachStep.confidence !== "high") {
    return coachStep.instruction;
  }
  if (observation && !isTargetInsideScreenshot(coachStep.target, observation)) {
    return coachStep.instruction;
  }
  const target = observation
    ? mapTargetToPhysicalPixels(coachStep.target, observation)
    : coachStep.target;

  return `${coachStep.instruction} [POINT:${Math.round(
    target.x,
  )}:${Math.round(target.y)}:${target.label}:screen${target.screenIndex}]`;
}

export function buildObservationSummary(observation: AgentObservation): string {
  const windowTitle = observation.activeWindow.title || "unknown window";
  const appName = observation.activeWindow.appName || "unknown app";
  return `Active app: ${appName}. Window: ${windowTitle}. Cursor: (${observation.cursor.x}, ${observation.cursor.y}). Screenshot: ${observation.screenshot.image_width}x${observation.screenshot.image_height} on screen${observation.screenshot.monitor_id}. Screen signature: ${screenSignatureForObservation(observation)}.`;
}

export function screenSignatureForObservation(
  observation: AgentObservation,
): string {
  const title = observation.activeWindow.title || "unknown";
  const app = observation.activeWindow.appName || "unknown";
  return [
    app.toLowerCase(),
    title.toLowerCase(),
    observation.screenshot.monitor_id,
    observation.screenshot.image_width,
    observation.screenshot.image_height,
  ].join("|");
}

function mapTargetToPhysicalPixels(
  target: NonNullable<CoachStepPlan["target"]>,
  observation: AgentObservation,
): NonNullable<CoachStepPlan["target"]> {
  const widthScale =
    observation.screenshot.monitor_width /
    Math.max(observation.screenshot.image_width, 1);
  const heightScale =
    observation.screenshot.monitor_height /
    Math.max(observation.screenshot.image_height, 1);
  return {
    ...target,
    x: target.x * widthScale,
    y: target.y * heightScale,
    screenIndex: observation.screenshot.monitor_id,
  };
}

function isTargetInsideScreenshot(
  target: NonNullable<CoachStepPlan["target"]>,
  observation: AgentObservation,
): boolean {
  return (
    target.x > 2 &&
    target.y > 2 &&
    target.x < observation.screenshot.image_width - 2 &&
    target.y < observation.screenshot.image_height - 2
  );
}

export function buildCoachProgressSummary(session: AgentSession): string {
  const recentSteps = session.steps.slice(-5);
  if (recentSteps.length === 0) {
    return "No prior guided steps yet.";
  }

  return recentSteps
    .map((step, index) => {
      const target = step.target ? ` Target: ${step.target.label}.` : "";
      const expected = step.expectedResult
        ? ` Expected: ${step.expectedResult}.`
        : "";
      return `${index + 1}. User said "${step.userTranscript}". Awaaz said "${step.instruction}".${target}${expected}`;
    })
    .join("\n");
}

export function isSensitiveObservation(observation: AgentObservation): boolean {
  const combinedText =
    `${observation.activeWindow.title} ${observation.activeWindow.appName ?? ""}`.toLowerCase();
  return /\b(password|passcode|otp|one-time|authenticator|bank|banking|credit card|card number|security code|login|sign in|signin|1password|bitwarden|lastpass|keeper|dashlane|\\.env|secret|api key)\b/.test(
    combinedText,
  );
}
