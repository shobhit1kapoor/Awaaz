import { describe, expect, it } from "vitest";
import {
  createDocumentDraftPlan,
  createDeterministicAgentPlan,
  extractDocumentDraftRequest,
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

describe("createDeterministicAgentPlan", () => {
  it("turns Chrome search requests into direct Google search URLs", () => {
    const plan = createDeterministicAgentPlan(
      "Open Chrome and search Kanye West",
    );
    expect(plan).toMatchObject({
      goal: "Search the web for Kanye West",
      response: "Searching for Kanye West.",
      steps: [
        {
          type: "browser_open",
          url: "https://www.google.com/search?q=Kanye%20West",
        },
      ],
    });
  });

  it("turns Spotify play requests into a search-first plan", () => {
    const plan = createDeterministicAgentPlan("Open Spotify and play Timeless");
    expect(plan).toMatchObject({
      goal: "Play Timeless in Spotify",
      response: "Playing Timeless.",
      steps: [
        { type: "browser_open", url: "spotify:search:Timeless" },
        { type: "wait_for_window", titleIncludes: "Spotify" },
        { type: "wait_ms" },
        { type: "spotify_play_first_result" },
      ],
    });
  });

  it("turns Spotify liked-song requests into a search-first like plan", () => {
    const plan = createDeterministicAgentPlan(
      "Open Spotify and add Timeless to my liked songs",
    );
    expect(plan).toMatchObject({
      goal: "Add Timeless to liked songs in Spotify",
      response: "Adding Timeless to your liked songs.",
      steps: [
        { type: "browser_open", url: "spotify:search:Timeless" },
        { type: "wait_for_window", titleIncludes: "Spotify" },
        { type: "wait_ms" },
        { type: "spotify_like_first_result" },
      ],
    });
  });

  it("treats standalone play requests as Spotify music requests", () => {
    expect(createDeterministicAgentPlan("Play Timeless")).toMatchObject({
      goal: "Play Timeless in Spotify",
    });
  });
});

describe("document draft plans", () => {
  it("detects Word blog writing requests", () => {
    expect(
      extractDocumentDraftRequest("Open Word and write a blog about Apple"),
    ).toEqual({
      app: "word",
      topic: "Apple",
    });
  });

  it("detects Google Docs blog writing requests", () => {
    expect(
      extractDocumentDraftRequest(
        "Open Google Doc and write a blog about stock market",
      ),
    ).toEqual({
      app: "google_docs",
      topic: "stock market",
    });
  });

  it("creates native Word document plans", () => {
    expect(
      createDocumentDraftPlan({ app: "word", topic: "Apple" }, "Draft text"),
    ).toMatchObject({
      steps: [{ type: "word_create_document", text: "Draft text" }],
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

  it("keeps guidance questions in vision chat instead of the action planner", () => {
    expect(shouldUseAgenticPlanner("Tell me where to click in Figma")).toBe(
      false,
    );
    expect(shouldUseAgenticPlanner("How do I send an email in Gmail?")).toBe(
      false,
    );
    expect(shouldUseAgenticPlanner("Now what do I do in Photoshop?")).toBe(
      false,
    );
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
