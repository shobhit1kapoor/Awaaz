import type { ConversationMessage } from '../store/appStore';

export interface ScreenCapturePayload {
  base64: string;
  cursor_x: number;
  cursor_y: number;
  monitor_id: number;
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
const defaultChatModel = import.meta.env.VITE_DEFAULT_CHAT_MODEL ?? 'moonshotai/kimi-k2-thinking';

export const CLICKY_SYSTEM_PROMPT = `You are an AI buddy that lives next to the user's cursor.
You can see their screen. Be extremely concise — 1 to 3 sentences max unless they explicitly ask for more.
Speak directly to the user as a helpful friend, not an assistant.

When you reference something on screen that has a specific location, include a POINT tag immediately after mentioning it:
[POINT:x:y:short_label:screen0]

x and y are pixel coordinates of the element on screen0 (primary monitor).
Only use POINT tags when you're referencing something clearly visible and locatable on screen.
Never include POINT tags for abstract concepts.
Never explain what you're doing or that you're an AI. Just help.`;

export function getWorkerUrl(): string {
  if (!workerUrl) {
    throw new Error('VITE_WORKER_URL is not configured. Copy .env.example to .env and set it.');
  }

  return workerUrl;
}

export async function createChatCompletionStream(chatRequestPayload: ChatRequestPayload): Promise<Response> {
  const response = await fetch(`${getWorkerUrl()}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: chatRequestPayload.model || defaultChatModel,
      max_tokens: 512,
      stream: true,
      messages: [
        { role: 'system', content: CLICKY_SYSTEM_PROMPT },
        ...chatRequestPayload.conversationHistory.map((conversationMessage) => ({
          role: conversationMessage.role,
          content: conversationMessage.text,
        })),
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${chatRequestPayload.transcript}\n\nCursor position: (${chatRequestPayload.screenshot.cursor_x}, ${chatRequestPayload.screenshot.cursor_y}) on screen${chatRequestPayload.screenshot.monitor_id}.`,
            },
            {
              type: 'image_url',
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

export async function transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.set('file', audioBlob, 'speech.webm');

  const response = await fetch(`${getWorkerUrl()}/transcribe`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Transcription failed: ${await response.text()}`);
  }

  return response.json() as Promise<TranscriptionResult>;
}

export async function fetchTextToSpeechAudio(sentence: string): Promise<Response> {
  const response = await fetch(`${getWorkerUrl()}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: sentence }),
  });

  if (!response.ok) {
    throw new Error(`TTS request failed: ${await response.text()}`);
  }

  return response;
}
