import { describe, expect, it } from "vitest";
import {
  inferExplicitOpenAction,
  inferExplicitWindowsAction,
  parseActionTags,
} from "./actionParser";

describe("parseActionTags", () => {
  it("extracts allowlisted actions from assistant text", () => {
    expect(
      parseActionTags(
        "Opening Spotify. [ACTION:open_app:Spotify] Searching. [ACTION:web_search:best tacos]",
      ),
    ).toEqual({
      cleanText: "Opening Spotify. Searching.",
      actions: [
        {
          kind: "open_app",
          target: "Spotify",
          rawTag: "[ACTION:open_app:Spotify]",
        },
        {
          kind: "web_search",
          target: "best tacos",
          rawTag: "[ACTION:web_search:best tacos]",
        },
      ],
    });
  });
});

describe("inferExplicitOpenAction", () => {
  it("recognizes an application command", () => {
    expect(inferExplicitOpenAction("Open Spotify.")).toMatchObject({
      kind: "open_app",
      target: "Spotify",
    });
  });

  it("recognizes and cleans a folder command", () => {
    expect(
      inferExplicitOpenAction("Please open the Job Apply folder."),
    ).toMatchObject({
      kind: "open_folder",
      target: "Job Apply",
    });
  });

  it("does not infer actions from advice", () => {
    expect(inferExplicitOpenAction("How do I open Spotify?")).toBeNull();
  });
});

describe("inferExplicitWindowsAction", () => {
  it("recognizes a web search command", () => {
    expect(inferExplicitWindowsAction("Search for React docs.")).toMatchObject({
      kind: "web_search",
      target: "React docs",
    });
  });

  it("recognizes a URL open command", () => {
    expect(inferExplicitWindowsAction("Open localhost:3000.")).toMatchObject({
      kind: "open_url",
      target: "http://localhost:3000",
    });
  });

  it("recognizes an explicit typing command", () => {
    expect(inferExplicitWindowsAction('Type "hello Awaaz"')).toMatchObject({
      kind: "type_text",
      target: "hello Awaaz",
    });
  });
});
