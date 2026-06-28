import { describe, expect, it } from "vitest";
import {
  mapPointToAbsoluteCoordinates,
  type MonitorInfo,
} from "./monitorMapping";

const monitors: MonitorInfo[] = [
  {
    id: 0,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    scale_factor: 1,
    is_primary: true,
  },
  {
    id: 1,
    x: -2560,
    y: -200,
    width: 2560,
    height: 1440,
    scale_factor: 1,
    is_primary: false,
  },
];

describe("mapPointToAbsoluteCoordinates", () => {
  it("supports monitors with negative virtual-desktop origins", () => {
    expect(mapPointToAbsoluteCoordinates(120, 80, 1, monitors)).toEqual({
      absX: -2440,
      absY: -120,
    });
  });
});
