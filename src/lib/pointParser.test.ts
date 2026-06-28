import { describe, expect, it } from "vitest";
import { parsePointTags } from "./pointParser";

describe("parsePointTags", () => {
  it("strips point tags and preserves their monitor coordinates", () => {
    expect(
      parsePointTags("Use this button [POINT:450:320:Click here:screen1]."),
    ).toEqual({
      cleanText: "Use this button.",
      points: [
        {
          x: 450,
          y: 320,
          label: "Click here",
          screenIndex: 1,
          rawTag: "[POINT:450:320:Click here:screen1]",
        },
      ],
    });
  });
});
