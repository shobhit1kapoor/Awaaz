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
    .replace(/\s+(?:in|on|with|using)\s+(?:google\s+)?chrome$/i, "")
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

  const calendarAction = inferCalendarAction(normalizedTranscript);
  if (calendarAction) {
    return calendarAction;
  }

  const openAction = inferExplicitOpenAction(normalizedTranscript);
  if (openAction) {
    const webAppUrl = webAppUrlFor(openAction.target);
    if (webAppUrl) {
      return {
        kind: "open_url",
        target: webAppUrl,
        rawTag: "",
      };
    }
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
    /^(?:please\s+)?(?:(?:search|google|look up|find)\s+(?:(?:the\s+web|chrome|google chrome)\s+)?(?:for\s+)?)(.+?)[.!?]*$/i,
  );
  if (searchMatch?.[1]?.trim()) {
    return {
      kind: "web_search",
      target: cleanSearchTarget(searchMatch[1].trim()),
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
  const trimmedText = text.trim();
  const quotedText = trimmedText.match(/^["'](.+?)["']$/);
  return quotedText ? quotedText[1] : trimmedText;
}

function cleanSearchTarget(text: string): string {
  return text
    .replace(/\s+(?:in|on|with|using)\s+(?:google\s+)?chrome$/i, "")
    .replace(/\s+(?:in|on|with|using)\s+google$/i, "")
    .trim();
}

function webAppUrlFor(target: string): string | null {
  switch (normalizeSpokenTarget(target)) {
    case "gmail":
    case "google mail":
    case "mail":
      return "https://mail.google.com/mail/u/0/#inbox";
    case "google calendar":
    case "calendar":
      return "https://calendar.google.com/calendar/u/0/r";
    case "google docs":
    case "google doc":
    case "docs":
      return "https://docs.google.com/document/u/0/";
    case "new google doc":
    case "new google docs":
    case "blank google doc":
      return "https://docs.new";
    case "google drive":
    case "drive":
      return "https://drive.google.com/drive/my-drive";
    default:
      return null;
  }
}

function inferCalendarAction(transcript: string): WindowsAction | null {
  const match = transcript.match(
    /^(?:please\s+)?(?:add|create|schedule)\s+(.+?)\s+(?:to|on|in)\s+(?:my\s+)?calendar(?:\s+(?:(?:on|for)\s+)?(.+?))?[.!?]*$/i,
  );
  if (!match?.[1]?.trim()) {
    return null;
  }

  const title = match[1].trim();
  const datePhrase = match[2]?.trim() ?? "";
  return {
    kind: "open_url",
    target: googleCalendarTemplateUrl(title, datePhrase),
    rawTag: "",
  };
}

function googleCalendarTemplateUrl(title: string, datePhrase: string): string {
  const eventDate = parseSimpleCalendarDate(datePhrase);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
  });
  if (eventDate) {
    const endDate = new Date(eventDate.getTime() + 60 * 60 * 1000);
    params.set("dates", `${formatGoogleDate(eventDate)}/${formatGoogleDate(endDate)}`);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function parseSimpleCalendarDate(phrase: string): Date | null {
  const normalizedPhrase = phrase.toLowerCase().trim();
  if (!normalizedPhrase) {
    return null;
  }

  const date = new Date();
  date.setSeconds(0, 0);
  if (/\btomorrow\b/.test(normalizedPhrase)) {
    date.setDate(date.getDate() + 1);
  } else if (!/\btoday\b/.test(normalizedPhrase)) {
    const weekdayIndex = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ].findIndex((weekday) => normalizedPhrase.includes(weekday));
    if (weekdayIndex >= 0) {
      const delta = (weekdayIndex - date.getDay() + 7) % 7 || 7;
      date.setDate(date.getDate() + delta);
    }
  }

  const timeMatch = normalizedPhrase.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? "0");
    const meridiem = timeMatch[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    }
    if (meridiem === "am" && hour === 12) {
      hour = 0;
    }
    date.setHours(hour, minute, 0, 0);
  } else {
    date.setHours(9, 0, 0, 0);
  }

  return date;
}

function formatGoogleDate(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function normalizeSpokenTarget(target: string): string {
  return target
    .toLowerCase()
    .replace(/\s+(?:in|on|with|using)\s+(?:google\s+)?chrome$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
