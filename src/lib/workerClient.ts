import type { ConversationMessage } from "../store/appStore";

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

const workerUrl = import.meta.env.VITE_WORKER_URL;
const defaultChatModel =
  import.meta.env.VITE_DEFAULT_CHAT_MODEL ?? "moonshotai/kimi-k2.6";

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
Never emit actions for deleting, submitting forms, purchases, passwords, PINs, OTPs, payment data, or security codes.
For typing, only emit type_text when the user explicitly says to type, write, or enter the exact text.
Never explain what you're doing or that you're an AI. Just help.`;

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
