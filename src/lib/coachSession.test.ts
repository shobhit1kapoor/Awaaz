import { describe, expect, it } from "vitest";
import {
  extractCoachGoal,
  formatCoachResponse,
  shouldContinueCoachSession,
  shouldStartCoachSession,
} from "./coachSession";
import type { AgentSession } from "../store/agentSessionStore";

describe("coach session routing", () => {
  it("detects teaching requests", () => {
    expect(
      shouldStartCoachSession("Teach me how to remove bg in Photoshop"),
    ).toBe(true);
    expect(
      shouldStartCoachSession("What should I click to send an email in Gmail?"),
    ).toBe(true);
    expect(
      shouldStartCoachSession("I am stuck in Figma, what should I do next?"),
    ).toBe(true);
    expect(shouldStartCoachSession("Open Spotify")).toBe(false);
  });

  it("continues active sessions on natural follow-up phrases", () => {
    const session: AgentSession = {
      id: "test",
      mode: "coach",
      goal: "send email in Gmail",
      appName: "Chrome",
      status: "waiting",
      steps: [],
      workingMemory: [],
      lastScreenSignature: null,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(shouldContinueCoachSession("done", session)).toBe(true);
    expect(shouldContinueCoachSession("now what?", session)).toBe(true);
    expect(shouldContinueCoachSession("stop coaching", session)).toBe(false);
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
        verifier: "The background is gone.",
        confidence: "high",
        continueSession: true,
        done: false,
      }),
    ).toBe("Click Remove Background. [POINT:120:89:Remove BG:screen0]");
  });

  it("scales screenshot coordinates back to physical monitor pixels", () => {
    expect(
      formatCoachResponse(
        {
          instruction: "Click Compose.",
          target: { x: 100, y: 50, label: "Compose", screenIndex: 0 },
          expectedResult: "Draft opens.",
          memory: null,
          verifier: "Draft opens.",
          confidence: "high",
          continueSession: true,
          done: false,
        },
        {
          activeWindow: { title: "Gmail - Chrome", appName: "Chrome" },
          cursor: { x: 0, y: 0 },
          observedAt: 1,
          screenshot: {
            base64: "",
            cursor_x: 0,
            cursor_y: 0,
            monitor_id: 1,
            monitor_x: 0,
            monitor_y: 0,
            monitor_width: 2000,
            monitor_height: 1000,
            image_width: 1000,
            image_height: 500,
          },
        },
      ),
    ).toBe("Click Compose. [POINT:200:100:Compose:screen1]");
  });

  it("does not add a POINT tag for low-confidence targets", () => {
    expect(
      formatCoachResponse({
        instruction: "Look for the compose control on the left side.",
        target: { x: 20, y: 20, label: "Maybe compose", screenIndex: 0 },
        expectedResult: "Draft opens.",
        memory: null,
        verifier: "Draft opens.",
        confidence: "low",
        continueSession: true,
        done: false,
      }),
    ).toBe("Look for the compose control on the left side.");
  });

  it("does not add a POINT tag for medium-confidence targets", () => {
    expect(
      formatCoachResponse({
        instruction: "Click the visible compose icon.",
        target: { x: 40, y: 40, label: "compose icon", screenIndex: 0 },
        expectedResult: "Draft opens.",
        memory: null,
        verifier: "Draft opens.",
        confidence: "medium",
        continueSession: true,
        done: false,
      }),
    ).toBe("Click the visible compose icon.");
  });

  it("does not add a POINT tag when model coordinates are outside the screenshot", () => {
    expect(
      formatCoachResponse(
        {
          instruction: "Open the relevant page first.",
          target: { x: 9_999, y: 9_999, label: "Wrong corner", screenIndex: 0 },
          expectedResult: "Relevant page is visible.",
          memory: null,
          verifier: "Relevant page is visible.",
          confidence: "medium",
          continueSession: true,
          done: false,
        },
        {
          activeWindow: { title: "Gmail - Chrome", appName: "Chrome" },
          cursor: { x: 0, y: 0 },
          observedAt: 1,
          screenshot: {
            base64: "",
            cursor_x: 0,
            cursor_y: 0,
            monitor_id: 0,
            monitor_x: 0,
            monitor_y: 0,
            monitor_width: 2000,
            monitor_height: 1000,
            image_width: 1000,
            image_height: 500,
          },
        },
      ),
    ).toBe("Open the relevant page first.");
  });
});
