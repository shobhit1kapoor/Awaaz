import { describe, expect, it } from "vitest";
import {
  extractCoachGoal,
  formatCoachResponse,
  shouldStartCoachSession,
} from "./coachSession";

describe("coach session routing", () => {
  it("detects teaching requests", () => {
    expect(
      shouldStartCoachSession("Teach me how to remove bg in Photoshop"),
    ).toBe(true);
    expect(shouldStartCoachSession("Open Spotify")).toBe(false);
  });

  it("extracts a concise goal", () => {
    expect(extractCoachGoal("Teach me how to remove bg in Photoshop.")).toBe(
      "remove bg in Photoshop",
    );
  });
});

describe("formatCoachResponse", () => {
  it("adds a POINT tag when a target exists", () => {
    expect(
      formatCoachResponse({
        instruction: "Click Remove Background.",
        target: { x: 120.4, y: 88.6, label: "Remove BG", screenIndex: 0 },
        expectedResult: "The background disappears.",
        memory: null,
        continueSession: true,
        done: false,
      }),
    ).toBe("Click Remove Background. [POINT:120:89:Remove BG:screen0]");
  });
});
