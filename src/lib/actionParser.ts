export type WindowsActionKind =
  | "open_app"
  | "open_folder"
  | "open_url"
  | "web_search"
  | "type_text";

export interface WindowsAction {
  kind: WindowsActionKind;
  target: string;
  rawTag: string;
}

const ACTION_REGEX =
  /\[ACTION:(open_app|open_folder|open_url|web_search|type_text):([^\]]+)\]/gi;

export function parseActionTags(text: string): {
  cleanText: string;
  actions: WindowsAction[];
} {
  const actions: WindowsAction[] = [];
  let cleanText = text;

  for (const actionMatch of text.matchAll(ACTION_REGEX)) {
    const rawTag = actionMatch[0];
    const target = actionMatch[2].trim();
    if (target) {
      actions.push({
        kind: actionMatch[1].toLowerCase() as WindowsActionKind,
        target,
        rawTag,
      });
    }
    cleanText = cleanText.replace(rawTag, "");
  }

  return {
    cleanText: cleanText
      .replace(/\s+([.,!?;:])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
    actions,
  };
}

export function inferExplicitOpenAction(
  transcript: string,
): WindowsAction | null {
  const commandMatch = transcript
    .trim()
    .match(/^(?:please\s+)?(?:open|launch|start)\s+(.+?)[.!?]*$/i);
  if (!commandMatch) {
    return null;
  }

  let target = commandMatch[1]
    .trim()
    .replace(/^(?:the|my)\s+/i, "")
    .trim();
  let kind: WindowsActionKind = "open_app";

  if (/\s+(?:folder|directory)$/i.test(target)) {
    kind = "open_folder";
    target = target.replace(/\s+(?:folder|directory)$/i, "").trim();
  } else {
    target = target.replace(/\s+(?:app|application)$/i, "").trim();
  }

  if (!target) {
    return null;
  }

  return { kind, target, rawTag: "" };
}

export function inferExplicitWindowsAction(
  transcript: string,
): WindowsAction | null {
  const normalizedTranscript = transcript.trim().replace(/\s+/g, " ");
  const openAction = inferExplicitOpenAction(normalizedTranscript);
  if (openAction) {
    if (looksLikeUrl(openAction.target)) {
      return {
        kind: "open_url",
        target: normalizeUrl(openAction.target),
        rawTag: "",
      };
    }
    return openAction;
  }

  const searchMatch = normalizedTranscript.match(
    /^(?:please\s+)?(?:(?:search|google|look up|find)\s+(?:the\s+web\s+)?(?:for\s+)?)(.+?)[.!?]*$/i,
  );
  if (searchMatch?.[1]?.trim()) {
    return {
      kind: "web_search",
      target: searchMatch[1].trim(),
      rawTag: "",
    };
  }

  const typeMatch = normalizedTranscript.match(
    /^(?:please\s+)?(?:type|write|enter)\s+(.+?)[.!?]*$/i,
  );
  if (typeMatch?.[1]?.trim()) {
    return {
      kind: "type_text",
      target: unwrapDictatedText(typeMatch[1].trim()),
      rawTag: "",
    };
  }

  return null;
}

function looksLikeUrl(text: string): boolean {
  return /^(?:https?:\/\/|www\.|localhost(?::\d+)?(?:\/|$)|[a-z0-9-]+\.[a-z]{2,})(?:\S*)$/i.test(
    text.trim(),
  );
}

function normalizeUrl(text: string): string {
  const trimmedText = text.trim();
  if (/^https?:\/\//i.test(trimmedText)) {
    return trimmedText;
  }
  if (/^localhost(?::\d+)?(?:\/|$)/i.test(trimmedText)) {
    return `http://${trimmedText}`;
  }
  return `https://${trimmedText}`;
}

function unwrapDictatedText(text: string): string {
  const quotedText = text.match(/^["'“‘](.+?)["'”’]$/);
  return quotedText ? quotedText[1] : text;
}
