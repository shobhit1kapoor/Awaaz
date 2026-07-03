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

  it("routes Chrome search phrasing to a clean web search query", () => {
    expect(
      inferExplicitWindowsAction("Search Kanye West in Chrome."),
    ).toMatchObject({
      kind: "web_search",
      target: "Kanye West",
    });
    expect(
      inferExplicitWindowsAction("Search Chrome for Kanye West."),
    ).toMatchObject({
      kind: "web_search",
      target: "Kanye West",
    });
  });

  it("recognizes a URL open command", () => {
    expect(inferExplicitWindowsAction("Open localhost:3000.")).toMatchObject({
      kind: "open_url",
      target: "http://localhost:3000",
    });
  });

  it("opens Google web apps in the browser instead of as Windows apps", () => {
    expect(inferExplicitWindowsAction("Open Gmail.")).toMatchObject({
      kind: "open_url",
      target: "https://mail.google.com/mail/u/0/#inbox",
    });
    expect(inferExplicitWindowsAction("Open Gmail on Chrome.")).toMatchObject({
      kind: "open_url",
      target: "https://mail.google.com/mail/u/0/#inbox",
    });
    expect(inferExplicitWindowsAction("Open Google Calendar.")).toMatchObject({
      kind: "open_url",
      target: "https://calendar.google.com/calendar/u/0/r",
    });
  });

  it("creates a prefilled Google Calendar event URL", () => {
    const action = inferExplicitWindowsAction(
      "Add dentist appointment to my calendar tomorrow at 3 pm.",
    );
    expect(action).toMatchObject({
      kind: "open_url",
    });
    expect(action?.target).toContain(
      "https://calendar.google.com/calendar/render?",
    );
    expect(action?.target).toContain("text=dentist+appointment");
    expect(action?.target).toContain("dates=");
  });

  it("recognizes an explicit typing command", () => {
    expect(inferExplicitWindowsAction('Type "hello Awaaz"')).toMatchObject({
      kind: "type_text",
      target: "hello Awaaz",
    });
  });
});
