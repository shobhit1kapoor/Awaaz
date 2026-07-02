import type { ConversationMessage } from "../store/appStore";
import { parseAgentPlan, type AgentPlan } from "./agentPlan";

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

When you reference something on screen that has a specific location, include a POINT tag immediately after mentioning it:
[POINT:x:y:short_label:screen0]

x and y are pixel coordinates of the element on screen0 (primary monitor).
Only use POINT tags when you're referencing something clearly visible and locatable on screen.
Never include POINT tags for abstract concepts.

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

Rules:
- Do not ask for confirmation for safe allowlisted actions.
- Do not plan purchases, deletes, payments, password/PIN/OTP/security-code entry, form submission, or sending messages.
- Prefer app-agnostic UI Automation steps for desktop apps.
- Prefer browser_* steps for websites.
- Keep plans under 12 steps.
- Use response as the short thing Awaaz should say after executing.

JSON shape:
{"goal":"...","shouldExecute":true,"response":"...","steps":[{"type":"open_app","target":"Spotify"}]}`;

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
  const response = await fetch(`${getWorkerUrl()}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chatRequestPayload.model || defaultChatModel,
      max_tokens: 512,
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
  });

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
  const response = await fetch(`${getWorkerUrl()}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  });

  if (!response.ok) {
    throw new Error(`Agent planner failed: ${await response.text()}`);
  }

  const responseText = await response.text();
  return parseAgentPlan(extractChatContent(responseText));
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
