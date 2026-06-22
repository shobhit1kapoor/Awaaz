import { useCallback } from 'react';
import { createChatCompletionStream, type ChatRequestPayload } from '../lib/workerClient';

interface UseClaudeSSEResult {
  streamClaudeResponse: (
    chatRequestPayload: ChatRequestPayload,
    onTextDelta: (textDelta: string) => void,
  ) => Promise<string>;
}

export function useClaudeSSE(): UseClaudeSSEResult {
  const streamClaudeResponse = useCallback(
    async (chatRequestPayload: ChatRequestPayload, onTextDelta: (textDelta: string) => void) => {
      const response = await createChatCompletionStream(chatRequestPayload);
      const responseReader = response.body?.getReader();
      if (!responseReader) {
        throw new Error('Chat response did not include a readable stream.');
      }

      const textDecoder = new TextDecoder();
      let pendingSseText = '';
      let fullResponseText = '';

      while (true) {
        const readResult = await responseReader.read();
        if (readResult.done) {
          break;
        }

        pendingSseText += textDecoder.decode(readResult.value, { stream: true });
        const sseLines = pendingSseText.split('\n');
        pendingSseText = sseLines.pop() ?? '';

        for (const sseLine of sseLines) {
          const textDelta = extractTextDeltaFromSseLine(sseLine);
          if (textDelta) {
            fullResponseText += textDelta;
            onTextDelta(textDelta);
          }
        }
      }

      return fullResponseText;
    },
    [],
  );

  return { streamClaudeResponse };
}

function extractTextDeltaFromSseLine(sseLine: string): string | null {
  if (!sseLine.startsWith('data:')) {
    return null;
  }

  const dataText = sseLine.slice('data:'.length).trim();
  if (!dataText || dataText === '[DONE]') {
    return null;
  }

  try {
    const parsedData = JSON.parse(dataText) as {
      choices?: Array<{ delta?: { content?: string }; text?: string }>;
      delta?: { content?: string; text?: string };
      content?: string;
    };

    return (
      parsedData.choices?.[0]?.delta?.content ??
      parsedData.choices?.[0]?.text ??
      parsedData.delta?.content ??
      parsedData.delta?.text ??
      parsedData.content ??
      null
    );
  } catch {
    return null;
  }
}
