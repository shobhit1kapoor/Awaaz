/**
 * AI Buddy Proxy Worker
 *
 * Keeps provider API keys out of the app binary. Routes are intentionally thin:
 * the Tauri app owns product logic, this Worker only normalizes provider access.
 */

interface Env {
  NVIDIA_API_KEY: string;
  NVIDIA_CHAT_MODEL?: string;
  NVIDIA_STT_MODEL?: string;
  NVIDIA_TTS_MODEL?: string;
  ASSEMBLYAI_API_KEY?: string;
}

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_NVIDIA_CHAT_MODEL = 'moonshotai/kimi-k2-thinking';
const DEFAULT_NVIDIA_STT_MODEL = 'openai/whisper-large-v3';
const DEFAULT_NVIDIA_TTS_MODEL = 'openai/whisper-large-v3';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (request.method === 'POST' && url.pathname === '/chat') {
        return await handleNvidiaChat(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/transcribe') {
        return await handleNvidiaTranscribe(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/tts') {
        return await handleNvidiaTTS(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/transcribe-token') {
        return await handleAssemblyAIToken(env);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error(`[${url.pathname}] Unhandled error:`, error);
      return jsonResponse({ error: String(error) }, 500);
    }
  },
};

async function handleNvidiaChat(request: Request, env: Env): Promise<Response> {
  const requestBody = await request.json<{
    model?: string;
    messages: unknown[];
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
  }>();

  const upstreamResponse = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: nvidiaJsonHeaders(env),
    body: JSON.stringify({
      model: requestBody.model ?? env.NVIDIA_CHAT_MODEL ?? DEFAULT_NVIDIA_CHAT_MODEL,
      messages: requestBody.messages,
      max_tokens: requestBody.max_tokens ?? 512,
      temperature: requestBody.temperature ?? 0.2,
      stream: requestBody.stream ?? true,
    }),
  });

  return proxyUpstreamResponse('/chat', upstreamResponse, 'text/event-stream');
}

async function handleNvidiaTranscribe(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  if (!formData.has('model')) {
    formData.set('model', env.NVIDIA_STT_MODEL ?? DEFAULT_NVIDIA_STT_MODEL);
  }

  const upstreamResponse = await fetch(`${NVIDIA_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}` },
    body: formData,
  });

  return proxyUpstreamResponse('/transcribe', upstreamResponse, 'application/json');
}

async function handleNvidiaTTS(request: Request, env: Env): Promise<Response> {
  const requestBody = await request.json<{ text: string; voice?: string; model?: string }>();

  const upstreamResponse = await fetch(`${NVIDIA_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: nvidiaJsonHeaders(env),
    body: JSON.stringify({
      model: requestBody.model ?? env.NVIDIA_TTS_MODEL ?? DEFAULT_NVIDIA_TTS_MODEL,
      input: requestBody.text,
      voice: requestBody.voice ?? 'alloy',
      response_format: 'mp3',
    }),
  });

  return proxyUpstreamResponse('/tts', upstreamResponse, 'audio/mpeg');
}

async function handleAssemblyAIToken(env: Env): Promise<Response> {
  if (!env.ASSEMBLYAI_API_KEY) {
    return jsonResponse({ error: 'ASSEMBLYAI_API_KEY is not configured' }, 501);
  }

  const upstreamResponse = await fetch(
    'https://streaming.assemblyai.com/v3/token?expires_in_seconds=480',
    {
      method: 'GET',
      headers: { authorization: env.ASSEMBLYAI_API_KEY },
    },
  );

  return proxyUpstreamResponse('/transcribe-token', upstreamResponse, 'application/json');
}

function nvidiaJsonHeaders(env: Env): HeadersInit {
  return {
    authorization: `Bearer ${env.NVIDIA_API_KEY}`,
    'content-type': 'application/json',
  };
}

async function proxyUpstreamResponse(
  routeName: string,
  upstreamResponse: Response,
  fallbackContentType: string,
): Promise<Response> {
  if (!upstreamResponse.ok) {
    const errorBody = await upstreamResponse.text();
    console.error(`[${routeName}] Upstream error ${upstreamResponse.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: upstreamResponse.status,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      ...corsHeaders,
      'content-type': upstreamResponse.headers.get('content-type') || fallbackContentType,
      'cache-control': 'no-cache',
    },
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
