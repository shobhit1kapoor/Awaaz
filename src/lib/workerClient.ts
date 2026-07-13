import type { ConversationMessage } from "../store/appStore";
import type { AgentSession, StoredAgentTask } from "../store/agentSessionStore";
import {
  createDocumentDraftPlan,
  createDeterministicAgentPlan,
  extractDocumentDraftRequest,
  parseAgentPlan,
  type AgentPlan,
} from "./agentPlan";
import type { AgentObservation } from "./agentObservation";
import {
  buildCoachProgressSummary,
  buildObservationSummary,
  type CoachStepPlan,
} from "./coachSession";

export interface ScreenCapturePayload {
  base64: string;
  cursor_x: number;
  cursor_y: number;
  monitor_id: number;
  monitor_x: number;
  monitor_y: number;
  monitor_width: number;
  monitor_height: number;
  image_width: number;
  image_height: number;
}

export interface ChatRequestPayload {
  transcript: string;
  screenshot: ScreenCapturePayload;
  conversationHistory: ConversationMessage[];
  model: string;
}

export interface TranscriptionResult {
  text: string;
}

interface TranscriptionTokenResult {
  token: string;
}

const workerUrl = import.meta.env.VITE_WORKER_URL;
const defaultChatModel =
  import.meta.env.VITE_DEFAULT_CHAT_MODEL ??
  "meta/llama-4-maverick-17b-128e-instruct";
const defaultVisionModel =
  import.meta.env.VITE_DEFAULT_VISION_MODEL ?? "nvidia/nemotron-nano-12b-v2-vl";
const CHAT_REQUEST_TIMEOUT_MS = 35_000;

let cachedTranscriptionToken: {
  token: string;
  expiresAtMilliseconds: number;
} | null = null;

export const CLICKY_SYSTEM_PROMPT = `You are Awaaz, an AI buddy that lives next to the user's cursor on Windows.
You can see their screen, hear their spoken request, and help with safe local actions.
You are not a chatbot. Be present, warm, fast, and brief.
Default to 1 or 2 speakable sentences unless the user asks for detail.

Never say "certainly", "of course", "I'd be happy to", "as an AI", or "please note".
Use direct language: "Opening it now.", "I see it.", "That error is from the missing bracket."

Do not include POINT tags in normal chat. Target highlights are reserved for structured coach mode only.

If the user asks how to use the current app, where to click, what to do next, or asks for help while learning Figma, Photoshop, Chrome, Gmail, Outlook, or another visible app:
- Do not emit an ACTION tag.
- Look at the screenshot and give one clear next step.
- Mention visible labels/icons and visible regions like top-left, left sidebar, center, or bottom toolbar.
- If the screen is not enough, ask them to open the needed page/app first.

When the user explicitly asks for one of these actions, append exactly one action tag:
[ACTION:open_app:Application Name]
[ACTION:open_folder:Folder Name]
[ACTION:open_url:https://example.com]
[ACTION:web_search:Search query]
[ACTION:type_text:Text to type]

Only emit action tags for explicit commands from the user's current spoken request.
Never infer actions from the screenshot, from previous messages, or from your own suggestion.
Do not ask for confirmation before safe allowlisted actions like opening apps, searching, typing dictated text, clicking obvious controls, or navigating pages.
Never emit actions for deleting, purchases, passwords, PINs, OTPs, payment data, or security codes. For those, briefly say you cannot do that.
For typing, only emit type_text when the user explicitly says to type, write, or enter the exact text.
Never explain what you're doing or that you're an AI. Just help.`;

const AGENT_PLANNER_SYSTEM_PROMPT = `You are the action planner for Awaaz, a Windows desktop agent.
Return only compact JSON. No markdown. No commentary.

Plan safe UI actions using only these tools:
- open_app target
- open_folder target
- open_url target
- web_search query
- type_text text
- wait_ms durationMs
- press_key key: Enter, Escape, Tab, Space
- wait_for_window titleIncludes timeoutMs
- find_control role nameIncludes automationId
- click_control controlId
- set_value controlId text
- browser_open url
- browser_snapshot
- browser_click selector text
- browser_type selector text
- browser_wait durationMs
- spotify_play_first_result
- spotify_like_first_result
- word_create_document text

Rules:
- Do not ask for confirmation for safe allowlisted actions.
- Do not plan purchases, deletes, payments, password/PIN/OTP/security-code entry, form submission, or sending messages.
- Prefer app-agnostic UI Automation steps for desktop apps.
- Prefer browser_* steps for websites.
- For Spotify song requests, prefer the deterministic Spotify tools when available.
- Do not plan when the user is asking for guidance, "where do I click", "how do I", "now what", or learning help. Those should be answered from the screenshot.
- Keep plans under 12 steps.
- Use response as the short thing Awaaz should say after executing.

JSON shape:
{"goal":"...","shouldExecute":true,"response":"...","steps":[{"type":"open_app","target":"Spotify"}]}`;

const COACH_STEP_SYSTEM_PROMPT = `You are Awaaz coach mode, a low-latency screen tutor.
Return only compact JSON. No markdown. No commentary.

Your job:
- Remember the user's goal.
- Use the current screenshot and observation.
- Give exactly one next step.
- Prefer guiding the user instead of doing the action.
- If there is a visible target, include target coordinates relative to the resized screenshot image you receive.
- Use only the latest screenshot for visible UI. Treat memory as progress, not proof of current UI.
- If the previous expected result is not visible, give a recovery step instead of blindly continuing.
- Keep instruction under 18 words and make it speakable.
- Ground wording in what is visibly on screen. Never claim text exists unless you can see that text.
- If a control is icon-only, describe its visible appearance and location: "Click the blue pencil icon on the left sidebar."
- Include a rough region when useful: top-left, left sidebar, top-right, center panel, bottom toolbar.
- Prefer visible labels/icons and landmarks over app-memory labels. Bad: "Click Compose" if the word Compose is not visible.
- If the right control is not visible, tell the user what page/app/state to open first.
- Set target to null if you are not at least medium-confident about the visible click location.
- Never put a target in a generic corner just to satisfy the schema.
- Do not mention hidden implementation details, JSON, screenshots, or confidence.
- For risky actions like Send, Delete, Purchase, password, OTP, or payment, guide the user to review and ask before the final action.
- Continue until the goal is complete.

JSON shape:
{"instruction":"Click the blue pencil icon on the left sidebar.","target":{"x":123,"y":456,"label":"blue pencil icon","screenIndex":0},"expectedResult":"A compose window opens.","memory":"User is learning Gmail compose.","verifier":"A draft compose box is visible.","confidence":"high","continueSession":true,"done":false}`;

export function getWorkerUrl(): string {
  if (!workerUrl) {
    throw new Error(
      "VITE_WORKER_URL is not configured. Copy .env.example to .env and set it.",
    );
  }

  return workerUrl;
}

export async function pingWorker(): Promise<void> {
  await fetch(`${getWorkerUrl()}/ping`, {
    method: "GET",
    cache: "no-store",
  });
}

export async function createChatCompletionStream(
  chatRequestPayload: ChatRequestPayload,
): Promise<Response> {
  const requestTimeout = createAbortTimeout(CHAT_REQUEST_TIMEOUT_MS);
  const response = await fetch(`${getWorkerUrl()}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: requestTimeout.signal,
    body: JSON.stringify({
      model: defaultVisionModel,
      max_tokens: 260,
      stream: true,
      messages: [
        { role: "system", content: CLICKY_SYSTEM_PROMPT },
        ...chatRequestPayload.conversationHistory.map(
          (conversationMessage) => ({
            role: conversationMessage.role,
            content: conversationMessage.text,
          }),
        ),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${chatRequestPayload.transcript}\n\nThe attached image is screen${chatRequestPayload.screenshot.monitor_id} resized to ${chatRequestPayload.screenshot.image_width}x${chatRequestPayload.screenshot.image_height}. The physical monitor bounds are (${chatRequestPayload.screenshot.monitor_x}, ${chatRequestPayload.screenshot.monitor_y}) with size ${chatRequestPayload.screenshot.monitor_width}x${chatRequestPayload.screenshot.monitor_height}. The cursor is at absolute screen coordinate (${chatRequestPayload.screenshot.cursor_x}, ${chatRequestPayload.screenshot.cursor_y}). Return POINT coordinates in physical pixels relative to this monitor's top-left corner.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${chatRequestPayload.screenshot.base64}`,
              },
            },
          ],
        },
      ],
    }),
  }).finally(requestTimeout.clear);

  if (!response.ok) {
    throw new Error(`Chat request failed: ${await response.text()}`);
  }

  return response;
}

export async function transcribeAudio(
  audioBlob: Blob,
): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.set("file", audioBlob, "speech.webm");

  const response = await fetch(`${getWorkerUrl()}/transcribe`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Transcription failed: ${await response.text()}`);
  }

  return response.json() as Promise<TranscriptionResult>;
}

export async function getAssemblyAIStreamingToken(): Promise<string> {
  const nowMilliseconds = Date.now();
  if (
    cachedTranscriptionToken &&
    cachedTranscriptionToken.expiresAtMilliseconds - nowMilliseconds > 60_000
  ) {
    return cachedTranscriptionToken.token;
  }

  const response = await fetch(`${getWorkerUrl()}/transcribe-token`, {
    method: "POST",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Transcription token failed: ${await response.text()}`);
  }

  const tokenResult = (await response.json()) as TranscriptionTokenResult;
  if (!tokenResult.token) {
    throw new Error("Transcription token response did not include a token.");
  }

  cachedTranscriptionToken = {
    token: tokenResult.token,
    expiresAtMilliseconds: nowMilliseconds + 480_000,
  };
  return tokenResult.token;
}

export async function fetchTextToSpeechAudio(
  sentence: string,
): Promise<Response> {
  const response = await fetch(`${getWorkerUrl()}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: sentence }),
  });

  if (!response.ok) {
    throw new Error(`TTS request failed: ${await response.text()}`);
  }

  return response;
}

export async function createAgentPlan(transcript: string): Promise<AgentPlan> {
  const deterministicPlan = createDeterministicAgentPlan(transcript);
  if (deterministicPlan) {
    return deterministicPlan;
  }

  const documentDraftRequest = extractDocumentDraftRequest(transcript);
  if (documentDraftRequest) {
    const draft = await generateDocumentDraft(documentDraftRequest.topic);
    return createDocumentDraftPlan(documentDraftRequest, draft);
  }

  const requestTimeout = createAbortTimeout(CHAT_REQUEST_TIMEOUT_MS);
  const response = await fetch(`${getWorkerUrl()}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: requestTimeout.signal,
    body: JSON.stringify({
      model: defaultChatModel,
      max_tokens: 700,
      temperature: 0,
      stream: false,
      messages: [
        { role: "system", content: AGENT_PLANNER_SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
    }),
  }).finally(requestTimeout.clear);

  if (!response.ok) {
    throw new Error(`Agent planner failed: ${await response.text()}`);
  }

  const responseText = await response.text();
  return parseAgentPlan(extractChatContent(responseText));
}

export async function createCoachStepPlan(
  session: AgentSession,
  transcript: string,
  observation: AgentObservation,
  storedTasks: StoredAgentTask[] = [],
): Promise<CoachStepPlan> {
  const requestTimeout = createAbortTimeout(CHAT_REQUEST_TIMEOUT_MS);
  const response = await fetch(`${getWorkerUrl()}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: requestTimeout.signal,
    body: JSON.stringify({
      model: defaultVisionModel,
      max_tokens: 260,
      temperature: 0.1,
      stream: false,
      messages: [
        { role: "system", content: COACH_STEP_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Goal: ${session.goal}`,
                `User said: ${transcript}`,
                `Session steps so far: ${session.steps.length}`,
                `Progress summary:\n${buildCoachProgressSummary(session)}`,
                `Working memory: ${session.workingMemory.join(" | ") || "none"}`,
                `Similar saved tasks: ${formatStoredTasksForPrompt(
                  session.goal,
                  storedTasks,
                )}`,
                `Observation: ${buildObservationSummary(observation)}`,
                `Previous expected result: ${
                  session.steps[session.steps.length - 1]?.expectedResult ||
                  "none"
                }`,
                "Return one next guided step now. If no useful target is visible, say what to open or inspect next.",
              ].join("\n"),
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${observation.screenshot.base64}`,
              },
            },
          ],
        },
      ],
    }),
  }).finally(requestTimeout.clear);

  if (!response.ok) {
    throw new Error(`Coach planner failed: ${await response.text()}`);
  }

  return parseCoachStepPlan(extractChatContent(await response.text()));
}

async function generateDocumentDraft(topic: string): Promise<string> {
  const requestTimeout = createAbortTimeout(CHAT_REQUEST_TIMEOUT_MS);
  const response = await fetch(`${getWorkerUrl()}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: requestTimeout.signal,
    body: JSON.stringify({
      model: defaultChatModel,
      max_tokens: 900,
      temperature: 0.4,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "Write clean, useful document drafts for a voice assistant. Return only the draft text. Use a title, short introduction, 3-5 concise sections, and a closing paragraph. No markdown fences.",
        },
        {
          role: "user",
          content: `Write a blog about ${topic}.`,
        },
      ],
    }),
  }).finally(requestTimeout.clear);

  if (!response.ok) {
    throw new Error(`Document draft failed: ${await response.text()}`);
  }

  return extractChatContent(await response.text()).trim();
}

function extractChatContent(responseText: string): string {
  const parsedResponse = JSON.parse(responseText) as {
    choices?: Array<{
      message?: { content?: string };
      text?: string;
    }>;
    content?: string;
  };

  const content =
    parsedResponse.choices?.[0]?.message?.content ??
    parsedResponse.choices?.[0]?.text ??
    parsedResponse.content;
  if (!content) {
    throw new Error("Agent planner response did not include content.");
  }
  return content;
}

function parseCoachStepPlan(rawText: string): CoachStepPlan {
  const parsedValue = JSON.parse(extractJsonObject(rawText)) as {
    instruction?: unknown;
    target?: unknown;
    expectedResult?: unknown;
    memory?: unknown;
    verifier?: unknown;
    confidence?: unknown;
    continueSession?: unknown;
    done?: unknown;
  };

  return {
    instruction: stringField(
      parsedValue.instruction,
      "Try the next visible step.",
    ),
    target: parseCoachTarget(parsedValue.target),
    expectedResult: stringField(parsedValue.expectedResult, ""),
    memory:
      typeof parsedValue.memory === "string" && parsedValue.memory.trim()
        ? parsedValue.memory.trim()
        : null,
    verifier: stringField(parsedValue.verifier, ""),
    confidence: parseConfidence(parsedValue.confidence),
    continueSession: parsedValue.continueSession !== false,
    done: parsedValue.done === true,
  };
}

function formatStoredTasksForPrompt(
  goal: string,
  storedTasks: StoredAgentTask[],
): string {
  const normalizedGoal = goal.toLowerCase();
  const matchingTasks = storedTasks
    .filter((task) => {
      const taskText = `${task.goal} ${task.appName ?? ""}`.toLowerCase();
      return normalizedGoal
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .some((word) => taskText.includes(word));
    })
    .slice(0, 3);

  if (matchingTasks.length === 0) {
    return "none";
  }

  return matchingTasks
    .map((task) => {
      const steps = task.steps
        .slice(0, 5)
        .map((step) => step.instruction)
        .join(" -> ");
      return `${task.goal}${task.appName ? ` in ${task.appName}` : ""}: ${steps}`;
    })
    .join(" | ");
}

function parseCoachTarget(value: unknown): CoachStepPlan["target"] {
  if (!isRecord(value)) {
    return null;
  }

  const x = numberField(value.x, Number.NaN);
  const y = numberField(value.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x,
    y,
    label: stringField(value.label, "Target").replace(/[:\]]/g, " ").trim(),
    screenIndex: Math.max(0, Math.round(numberField(value.screenIndex, 0))),
  };
}

function parseConfidence(value: unknown): CoachStepPlan["confidence"] {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : "medium";
}

function extractJsonObject(rawText: string): string {
  const trimmedText = rawText.trim();
  const fencedMatch = trimmedText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBraceIndex = trimmedText.indexOf("{");
  const lastBraceIndex = trimmedText.lastIndexOf("}");
  if (firstBraceIndex === -1 || lastBraceIndex <= firstBraceIndex) {
    throw new Error("Model did not return JSON.");
  }
  return trimmedText.slice(firstBraceIndex, lastBraceIndex + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim().slice(0, 1_000) : fallback;
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function createAbortTimeout(timeoutMilliseconds: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(
    () => abortController.abort(),
    timeoutMilliseconds,
  );
  return {
    signal: abortController.signal,
    clear: () => window.clearTimeout(timeoutId),
  };
}
