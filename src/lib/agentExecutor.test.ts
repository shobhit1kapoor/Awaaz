import { describe, expect, it } from "vitest";
import { stepToExecutionPayload } from "./agentExecutor";

describe("stepToExecutionPayload", () => {
  it("maps wait_for_window to the native snake/camel bridge payload", () => {
    expect(
      stepToExecutionPayload({
        type: "wait_for_window",
        titleIncludes: "Spotify",
        timeoutMs: 4_000,
      }),
    ).toEqual({
      stepType: "wait_for_window",
      titleIncludes: "Spotify",
      durationMs: 4_000,
    });
  });

  it("maps browser type steps without inventing selectors", () => {
    expect(
      stepToExecutionPayload({
        type: "browser_type",
        text: "hello",
      }),
    ).toEqual({
      stepType: "browser_type",
      selector: undefined,
      text: "hello",
    });
  });
});
