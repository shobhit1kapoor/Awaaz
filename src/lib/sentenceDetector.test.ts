import { describe, expect, it } from "vitest";
import { detectFirstCompleteSentence } from "./sentenceDetector";

describe("detectFirstCompleteSentence", () => {
  it("returns only the first complete sentence", () => {
    expect(detectFirstCompleteSentence("First answer. Second answer.")).toBe(
      "First answer.",
    );
  });

  it("waits for sentence-ending punctuation", () => {
    expect(detectFirstCompleteSentence("Still streaming")).toBeNull();
  });
});
