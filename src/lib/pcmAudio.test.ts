import { describe, expect, it } from "vitest";
import { downsampleFloat32To16Khz, encodeFloat32AsPcm16 } from "./pcmAudio";

describe("downsampleFloat32To16Khz", () => {
  it("averages source samples into 16 kHz buckets", () => {
    const output = downsampleFloat32To16Khz(
      new Float32Array([0, 0.5, 1, -1, 0.25, 0.75]),
      48_000,
    );

    expect(Array.from(output)).toEqual([0.5, 0]);
  });
});

describe("encodeFloat32AsPcm16", () => {
  it("clamps and encodes little-endian signed 16-bit PCM", () => {
    const output = new DataView(
      encodeFloat32AsPcm16(new Float32Array([-2, -0.5, 0, 0.5, 2])),
    );

    expect(output.getInt16(0, true)).toBe(-32768);
    expect(output.getInt16(2, true)).toBe(-16384);
    expect(output.getInt16(4, true)).toBe(0);
    expect(output.getInt16(6, true)).toBe(16383);
    expect(output.getInt16(8, true)).toBe(32767);
  });
});
