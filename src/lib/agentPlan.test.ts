import { describe, expect, it } from "vitest";
import {
  parseAgentPlan,
  shouldBlockAgenticRequest,
  shouldUseAgenticPlanner,
} from "./agentPlan";

describe("parseAgentPlan", () => {
  it("parses allowlisted desktop and browser steps from model JSON", () => {
    expect(
      parseAgentPlan(`Here is the plan:
      {
        "goal": "Play a song",
        "response": "Playing it.",
        "steps": [
          { "type": "open_app", "target": "Spotify" },
          { "type": "wait_for_window", "titleIncludes": "Spotify" },
          { "type": "find_control", "role": "Edit", "nameIncludes": "Search" },
          { "type": "set_value", "text": "Timeless" },
          { "type": "press_key", "key": "Enter" },
          { "type": "browser_open", "url": "https://example.com" }
        ]
      }`),
    ).toMatchObject({
      goal: "Play a song",
      response: "Playing it.",
      steps: [
        { type: "open_app", target: "Spotify" },
        { type: "wait_for_window", titleIncludes: "Spotify" },
        { type: "find_control", role: "Edit", nameIncludes: "Search" },
        { type: "set_value", text: "Timeless" },
        { type: "press_key", key: "Enter" },
        { type: "browser_open", url: "https://example.com" },
      ],
    });
  });

  it("drops unknown or malformed steps instead of executing them", () => {
    expect(
      parseAgentPlan(
        {
          toString: () =>
            JSON.stringify({
              steps: [
                { type: "shell", command: "rm -rf ." },
                { type: "press_key", key: "Meta" },
                { type: "wait_ms", durationMs: 999_999 },
              ],
            }),
        }.toString(),
      ),
    ).toMatchObject({
      steps: [{ type: "wait_ms", durationMs: 15_000 }],
    });
  });
});

describe("shouldUseAgenticPlanner", () => {
  it("routes multi-step app requests to the planner", () => {
    expect(shouldUseAgenticPlanner("Open Spotify and play Timeless")).toBe(
      true,
    );
    expect(shouldUseAgenticPlanner("Open Notepad")).toBe(false);
  });
});

describe("shouldBlockAgenticRequest", () => {
  it("blocks dangerous high-impact intents without asking for confirmation", () => {
    expect(shouldBlockAgenticRequest("Buy this item and checkout")).toBe(true);
    expect(shouldBlockAgenticRequest("Open Spotify and play Timeless")).toBe(
      false,
    );
  });
});
