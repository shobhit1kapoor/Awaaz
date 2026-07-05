export type AgentPlanStep =
  | { type: "open_app"; target: string }
  | { type: "open_folder"; target: string }
  | { type: "open_url"; target: string }
  | { type: "web_search"; query: string }
  | { type: "type_text"; text: string }
  | { type: "wait_ms"; durationMs: number }
  | { type: "press_key"; key: "Enter" | "Escape" | "Tab" | "Space" }
  | { type: "wait_for_window"; titleIncludes: string; timeoutMs?: number }
  | {
      type: "find_control";
      role?: string;
      nameIncludes?: string;
      automationId?: string;
    }
  | { type: "click_control"; controlId?: string }
  | { type: "set_value"; controlId?: string; text: string }
  | { type: "browser_open"; url: string }
  | { type: "browser_snapshot" }
  | { type: "browser_click"; selector?: string; text?: string }
  | { type: "browser_type"; selector?: string; text: string }
  | { type: "browser_wait"; durationMs: number }
  | { type: "spotify_play_first_result" }
  | { type: "spotify_like_first_result" }
  | { type: "word_create_document"; text: string };

export interface AgentPlan {
  goal: string;
  shouldExecute: boolean;
  response: string;
  steps: AgentPlanStep[];
}

const MAX_AGENT_STEPS = 12;
const BLOCKED_INTENT_PATTERN =
  /\b(delete|remove|uninstall|purchase|buy|checkout|pay|password|otp|pin|security code|submit|send message|post|transfer money)\b/i;

export function shouldBlockAgenticRequest(transcript: string): boolean {
  return BLOCKED_INTENT_PATTERN.test(transcript);
}

export function shouldUseAgenticPlanner(transcript: string): boolean {
  const normalizedTranscript = transcript.trim().toLowerCase();
  if (isGuidanceQuestion(normalizedTranscript)) {
    return false;
  }

  return (
    /\b(and then|then|after that)\b/.test(normalizedTranscript) ||
    /\b(play|pause|search in|click|press|choose|select|fill|go to|open .* and)\b/.test(
      normalizedTranscript,
    )
  );
}

export function createDeterministicAgentPlan(
  transcript: string,
): AgentPlan | null {
  const browserSearch = extractBrowserSearchRequest(transcript);
  if (browserSearch) {
    return {
      goal: `Search the web for ${browserSearch}`,
      shouldExecute: true,
      response: `Searching for ${browserSearch}.`,
      steps: [{ type: "browser_open", url: googleSearchUrl(browserSearch) }],
    };
  }

  const spotifyLikeTrack = extractSpotifyLikeRequest(transcript);
  if (spotifyLikeTrack) {
    return {
      goal: `Add ${spotifyLikeTrack} to liked songs in Spotify`,
      shouldExecute: true,
      response: `Adding ${spotifyLikeTrack} to your liked songs.`,
      steps: [
        { type: "browser_open", url: spotifySearchUri(spotifyLikeTrack) },
        {
          type: "wait_for_window",
          titleIncludes: "Spotify",
          timeoutMs: 8_000,
        },
        { type: "wait_ms", durationMs: 1_200 },
        { type: "spotify_like_first_result" },
      ],
    };
  }

  const spotifyTrack = extractSpotifyTrackRequest(transcript);
  if (spotifyTrack) {
    return {
      goal: `Play ${spotifyTrack} in Spotify`,
      shouldExecute: true,
      response: `Playing ${spotifyTrack}.`,
      steps: [
        { type: "browser_open", url: spotifySearchUri(spotifyTrack) },
        {
          type: "wait_for_window",
          titleIncludes: "Spotify",
          timeoutMs: 8_000,
        },
        { type: "wait_ms", durationMs: 1_200 },
        { type: "spotify_play_first_result" },
      ],
    };
  }

  return null;
}

function extractBrowserSearchRequest(transcript: string): string | null {
  const normalizedTranscript = transcript.trim().replace(/\s+/g, " ");
  const searchMatch =
    normalizedTranscript.match(
      /^(?:please\s+)?(?:open|launch|start)\s+(?:google\s+)?chrome\s+(?:and\s+)?(?:then\s+)?(?:search|google|look up|find)\s+(?:for\s+)?(.+?)[.!?]*$/i,
    ) ??
    normalizedTranscript.match(
      /^(?:please\s+)?(?:search|google|look up|find)\s+(?:for\s+)?(.+?)\s+(?:in|on|with|using)\s+(?:google\s+)?chrome[.!?]*$/i,
    );

  const query = searchMatch?.[1]?.trim();
  return query ? query.replace(/\s+(?:in|on)\s+chrome$/i, "").trim() : null;
}

function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function isGuidanceQuestion(normalizedTranscript: string): boolean {
  return (
    /\b(?:how do i|how to|what do i|what should i|where do i|where should i|where to|tell me where|show me where|guide me|help me|teach me|now what|next what|what next)\b/.test(
      normalizedTranscript,
    ) ||
    (/\b(?:figma|photoshop|gmail|outlook|chrome|app|website|screen|page)\b/.test(
      normalizedTranscript,
    ) &&
      /\b(?:where|what|how|which|tell me|show me|guide|help|learn|learning|use)\b/.test(
        normalizedTranscript,
      ))
  );
}

export interface DocumentDraftRequest {
  app: "word" | "google_docs";
  topic: string;
}

export function extractDocumentDraftRequest(
  transcript: string,
): DocumentDraftRequest | null {
  const normalizedTranscript = transcript.trim().replace(/\s+/g, " ");
  const match = normalizedTranscript.match(
    /^(?:please\s+)?(?:open|launch|start)\s+(word|microsoft word|google docs?|docs?)(?:\s+(?:and|then))?\s+(?:write|draft|create)\s+(?:a\s+)?(?:blog|article|post|document)(?:\s+(?:about|on)\s+(.+?))?[.!?]*$/i,
  );
  if (!match) {
    return null;
  }
  const appName = match[1].toLowerCase();
  const topic = match[2]?.trim() || "the requested topic";
  return {
    app: appName.includes("word") ? "word" : "google_docs",
    topic,
  };
}

export function createDocumentDraftPlan(
  request: DocumentDraftRequest,
  draft: string,
): AgentPlan {
  if (request.app === "word") {
    return {
      goal: `Write a blog about ${request.topic} in Microsoft Word`,
      shouldExecute: true,
      response: `I drafted a blog about ${request.topic} in Word.`,
      steps: [{ type: "word_create_document", text: draft }],
    };
  }

  return {
    goal: `Write a blog about ${request.topic} in Google Docs`,
    shouldExecute: true,
    response: `I drafted a blog about ${request.topic} in Google Docs.`,
    steps: [
      { type: "browser_open", url: "https://docs.new" },
      { type: "wait_for_window", titleIncludes: "Chrome", timeoutMs: 10_000 },
      { type: "wait_ms", durationMs: 6_000 },
      { type: "type_text", text: draft },
    ],
  };
}

export function parseAgentPlan(rawText: string): AgentPlan {
  const parsedValue = JSON.parse(extractJsonObject(rawText)) as unknown;
  if (!isRecord(parsedValue)) {
    throw new Error("Agent plan must be a JSON object.");
  }

  const stepsValue = parsedValue.steps;
  if (!Array.isArray(stepsValue)) {
    throw new Error("Agent plan must include a steps array.");
  }

  const steps = stepsValue
    .slice(0, MAX_AGENT_STEPS)
    .map(parseAgentPlanStep)
    .filter((step): step is AgentPlanStep => step !== null);

  return {
    goal: stringField(parsedValue.goal, "Complete the requested task"),
    shouldExecute: parsedValue.shouldExecute !== false,
    response: stringField(parsedValue.response, "Done."),
    steps,
  };
}

function extractSpotifyTrackRequest(transcript: string): string | null {
  const normalizedTranscript = transcript.trim().replace(/\s+/g, " ");

  const playMatch =
    normalizedTranscript.match(
      /(?:open\s+spotify\s+(?:and\s+)?)?play\s+(.+?)(?:\s+(?:on|in)\s+spotify)?[.!?]*$/i,
    ) ??
    normalizedTranscript.match(/spotify\s+(?:and\s+)?play\s+(.+?)[.!?]*$/i);
  const rawTrack = playMatch?.[1]?.trim();
  if (!rawTrack) {
    return null;
  }

  const track = rawTrack
    .replace(/^(?:the\s+)?(?:song|track)\s+/i, "")
    .replace(/\s+on\s+spotify$/i, "")
    .trim();
  return track || null;
}

function extractSpotifyLikeRequest(transcript: string): string | null {
  const normalizedTranscript = transcript.trim().replace(/\s+/g, " ");

  const likeMatch =
    normalizedTranscript.match(
      /(?:open\s+spotify\s+(?:and\s+)?)?(?:add|save|like)\s+(.+?)\s+(?:to|in)\s+(?:my\s+)?(?:liked\s+songs|likes|library)(?:\s+(?:on|in)\s+spotify)?[.!?]*$/i,
    ) ??
    normalizedTranscript.match(
      /spotify\s+(?:and\s+)?(?:add|save|like)\s+(.+?)\s+(?:to|in)\s+(?:my\s+)?(?:liked\s+songs|likes|library)[.!?]*$/i,
    );

  const rawTrack = likeMatch?.[1]?.trim();
  if (!rawTrack) {
    return null;
  }

  const track = rawTrack
    .replace(/^(?:the\s+)?(?:song|track)\s+/i, "")
    .replace(/\s+on\s+spotify$/i, "")
    .trim();
  return track || null;
}

function spotifySearchUri(track: string): string {
  return `spotify:search:${encodeURIComponent(track)}`;
}

function parseAgentPlanStep(stepValue: unknown): AgentPlanStep | null {
  if (!isRecord(stepValue) || typeof stepValue.type !== "string") {
    return null;
  }

  switch (stepValue.type) {
    case "open_app":
    case "open_folder":
    case "open_url":
      return stringField(stepValue.target, "")
        ? { type: stepValue.type, target: stringField(stepValue.target, "") }
        : null;
    case "web_search":
      return stringField(stepValue.query, "")
        ? { type: "web_search", query: stringField(stepValue.query, "") }
        : null;
    case "type_text":
      return stringField(stepValue.text, "")
        ? { type: "type_text", text: stringField(stepValue.text, "") }
        : null;
    case "wait_ms":
    case "browser_wait":
      return {
        type: stepValue.type,
        durationMs: clampDuration(numberField(stepValue.durationMs, 500)),
      };
    case "press_key": {
      const key = stringField(stepValue.key, "");
      return isAllowedKey(key) ? { type: "press_key", key } : null;
    }
    case "wait_for_window":
      return stringField(stepValue.titleIncludes, "")
        ? {
            type: "wait_for_window",
            titleIncludes: stringField(stepValue.titleIncludes, ""),
            timeoutMs: clampDuration(numberField(stepValue.timeoutMs, 8_000)),
          }
        : null;
    case "find_control":
      return {
        type: "find_control",
        role: optionalString(stepValue.role),
        nameIncludes: optionalString(stepValue.nameIncludes),
        automationId: optionalString(stepValue.automationId),
      };
    case "click_control":
      return {
        type: "click_control",
        controlId: optionalString(stepValue.controlId),
      };
    case "set_value":
      return stringField(stepValue.text, "")
        ? {
            type: "set_value",
            controlId: optionalString(stepValue.controlId),
            text: stringField(stepValue.text, ""),
          }
        : null;
    case "browser_open":
      return stringField(stepValue.url, "")
        ? { type: "browser_open", url: stringField(stepValue.url, "") }
        : null;
    case "browser_snapshot":
      return { type: "browser_snapshot" };
    case "spotify_play_first_result":
      return { type: "spotify_play_first_result" };
    case "spotify_like_first_result":
      return { type: "spotify_like_first_result" };
    case "word_create_document":
      return stringField(stepValue.text, "")
        ? {
            type: "word_create_document",
            text: stringField(stepValue.text, ""),
          }
        : null;
    case "browser_click":
      return {
        type: "browser_click",
        selector: optionalString(stepValue.selector),
        text: optionalString(stepValue.text),
      };
    case "browser_type":
      return stringField(stepValue.text, "")
        ? {
            type: "browser_type",
            selector: optionalString(stepValue.selector),
            text: stringField(stepValue.text, ""),
          }
        : null;
    default:
      return null;
  }
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
    throw new Error("Agent planner did not return JSON.");
  }
  return trimmedText.slice(firstBraceIndex, lastBraceIndex + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim().slice(0, 1_000) : fallback;
}

function optionalString(value: unknown): string | undefined {
  const stringValue = stringField(value, "");
  return stringValue || undefined;
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampDuration(durationMs: number): number {
  return Math.max(0, Math.min(Math.round(durationMs), 15_000));
}

function isAllowedKey(
  key: string,
): key is "Enter" | "Escape" | "Tab" | "Space" {
  return (
    key === "Enter" || key === "Escape" || key === "Tab" || key === "Space"
  );
}
