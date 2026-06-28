/**
 * AI Buddy Proxy Worker
 *
 * Keeps provider API keys out of the app binary. Routes are intentionally thin:
 * the Tauri app owns product logic, this Worker only normalizes provider access.
 */

interface Env {
  NVIDIA_API_KEY: string;
  NVIDIA_CHAT_MODEL?: string;
  NVIDIA_TTS_MODEL?: string;
  ASSEMBLYAI_API_KEY?: string;
}

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com";
const DEFAULT_NVIDIA_CHAT_MODEL = "moonshotai/kimi-k2.6";
const ASSEMBLYAI_SPEECH_MODELS = ["universal-3-pro", "universal-2"];
const TRANSCRIPTION_POLL_INTERVAL_MS = 1000;
const TRANSCRIPTION_MAX_POLL_ATTEMPTS = 90;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse(
          {
            ok: true,
            providers: {
              nvidiaConfigured: Boolean(env.NVIDIA_API_KEY),
              chatModel: env.NVIDIA_CHAT_MODEL ?? DEFAULT_NVIDIA_CHAT_MODEL,
              assemblyAiConfigured: Boolean(env.ASSEMBLYAI_API_KEY),
              transcriptionModels: ASSEMBLYAI_SPEECH_MODELS,
              ttsConfigured: Boolean(env.NVIDIA_TTS_MODEL),
            },
          },
          200,
        );
      }

      if (request.method === "GET" && url.pathname === "/ping") {
        return new Response("ok", {
          status: 200,
          headers: {
            ...corsHeaders,
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (request.method === "POST" && url.pathname === "/chat") {
        return await handleNvidiaChat(request, env);
      }

      if (request.method === "POST" && url.pathname === "/transcribe") {
        return await handleAssemblyAITranscribe(request, env);
      }

      if (request.method === "POST" && url.pathname === "/tts") {
        return await handleNvidiaTTS(request, env);
      }

      if (request.method === "POST" && url.pathname === "/transcribe-token") {
        return await handleAssemblyAIToken(env);
      }

      return jsonResponse({ error: "Not found" }, 404);
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
    method: "POST",
    headers: nvidiaJsonHeaders(env),
    body: JSON.stringify({
      model:
        requestBody.model ?? env.NVIDIA_CHAT_MODEL ?? DEFAULT_NVIDIA_CHAT_MODEL,
      messages: requestBody.messages,
      max_tokens: requestBody.max_tokens ?? 512,
      temperature: requestBody.temperature ?? 0.2,
      stream: requestBody.stream ?? true,
    }),
  });

  return proxyUpstreamResponse("/chat", upstreamResponse, "text/event-stream");
}

async function handleAssemblyAITranscribe(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.ASSEMBLYAI_API_KEY) {
    return jsonResponse({ error: "ASSEMBLYAI_API_KEY is not configured" }, 501);
  }

  const formData = await request.formData();
  const audioFile = formData.get("file");
  if (!(audioFile instanceof File) || audioFile.size === 0) {
    return jsonResponse({ error: "A non-empty audio file is required" }, 400);
  }

  const assemblyHeaders = { authorization: env.ASSEMBLYAI_API_KEY };
  const uploadResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/v2/upload`, {
    method: "POST",
    headers: {
      ...assemblyHeaders,
      "content-type": audioFile.type || "application/octet-stream",
    },
    body: audioFile,
  });
  if (!uploadResponse.ok) {
    return proxyAssemblyAIError("/transcribe upload", uploadResponse);
  }

  const uploadResult = await uploadResponse.json<{ upload_url?: string }>();
  if (!uploadResult.upload_url) {
    return jsonResponse(
      { error: "AssemblyAI upload did not return an audio URL" },
      502,
    );
  }

  const submitResponse = await fetch(`${ASSEMBLYAI_BASE_URL}/v2/transcript`, {
    method: "POST",
    headers: {
      ...assemblyHeaders,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: uploadResult.upload_url,
      speech_models: ASSEMBLYAI_SPEECH_MODELS,
    }),
  });
  if (!submitResponse.ok) {
    return proxyAssemblyAIError("/transcribe submit", submitResponse);
  }

  const submittedTranscript = await submitResponse.json<{
    id?: string;
    status?: string;
    text?: string;
    error?: string;
  }>();
  if (!submittedTranscript.id) {
    return jsonResponse(
      { error: "AssemblyAI did not return a transcript ID" },
      502,
    );
  }

  for (
    let pollAttempt = 0;
    pollAttempt < TRANSCRIPTION_MAX_POLL_ATTEMPTS;
    pollAttempt += 1
  ) {
    const transcript =
      pollAttempt === 0
        ? submittedTranscript
        : await fetchAssemblyAITranscript(
            submittedTranscript.id,
            assemblyHeaders,
          );

    if (transcript.status === "completed") {
      return jsonResponse({ text: transcript.text ?? "" }, 200);
    }
    if (transcript.status === "error") {
      return jsonResponse(
        { error: transcript.error ?? "AssemblyAI transcription failed" },
        502,
      );
    }

    await delay(TRANSCRIPTION_POLL_INTERVAL_MS);
  }

  return jsonResponse(
    { error: "AssemblyAI transcription timed out after 90 seconds" },
    504,
  );
}

interface AssemblyAITranscript {
  status?: string;
  text?: string;
  error?: string;
}

async function fetchAssemblyAITranscript(
  transcriptId: string,
  headers: HeadersInit,
): Promise<AssemblyAITranscript> {
  const response = await fetch(
    `${ASSEMBLYAI_BASE_URL}/v2/transcript/${transcriptId}`,
    { headers },
  );
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `AssemblyAI polling failed (${response.status}): ${errorBody}`,
    );
  }
  return response.json<AssemblyAITranscript>();
}

async function proxyAssemblyAIError(
  operation: string,
  response: Response,
): Promise<Response> {
  const errorBody = await response.text();
  console.error(
    `[${operation}] AssemblyAI error ${response.status}: ${errorBody}`,
  );
  return new Response(errorBody, {
    status: response.status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function handleNvidiaTTS(request: Request, env: Env): Promise<Response> {
  const requestBody = await request.json<{
    text: string;
    voice?: string;
    model?: string;
  }>();
  const ttsModel = requestBody.model ?? env.NVIDIA_TTS_MODEL;
  if (!ttsModel) {
    return jsonResponse(
      {
        error:
          "Worker TTS is not configured. Use local TTS or set NVIDIA_TTS_MODEL to a verified speech model.",
      },
      501,
    );
  }

  const upstreamResponse = await fetch(`${NVIDIA_BASE_URL}/audio/speech`, {
    method: "POST",
    headers: nvidiaJsonHeaders(env),
    body: JSON.stringify({
      model: ttsModel,
      input: requestBody.text,
      voice: requestBody.voice ?? "alloy",
      response_format: "mp3",
    }),
  });

  return proxyUpstreamResponse("/tts", upstreamResponse, "audio/mpeg");
}

async function handleAssemblyAIToken(env: Env): Promise<Response> {
  if (!env.ASSEMBLYAI_API_KEY) {
    return jsonResponse({ error: "ASSEMBLYAI_API_KEY is not configured" }, 501);
  }

  const upstreamResponse = await fetch(
    "https://streaming.assemblyai.com/v3/token?expires_in_seconds=480",
    {
      method: "GET",
      headers: { authorization: env.ASSEMBLYAI_API_KEY },
    },
  );

  return proxyUpstreamResponse(
    "/transcribe-token",
    upstreamResponse,
    "application/json",
  );
}

function nvidiaJsonHeaders(env: Env): HeadersInit {
  return {
    authorization: `Bearer ${env.NVIDIA_API_KEY}`,
    "content-type": "application/json",
  };
}

async function proxyUpstreamResponse(
  routeName: string,
  upstreamResponse: Response,
  fallbackContentType: string,
): Promise<Response> {
  if (!upstreamResponse.ok) {
    const errorBody = await upstreamResponse.text();
    console.error(
      `[${routeName}] Upstream error ${upstreamResponse.status}: ${errorBody}`,
    );
    return new Response(errorBody, {
      status: upstreamResponse.status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: {
      ...corsHeaders,
      "content-type":
        upstreamResponse.headers.get("content-type") || fallbackContentType,
      "cache-control": "no-cache",
    },
  });
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
