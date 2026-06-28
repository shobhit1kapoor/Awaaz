export interface MonitorInfo {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor: number;
  is_primary: boolean;
}

export function mapPointToAbsoluteCoordinates(
  x: number,
  y: number,
  screenIndex: number,
  monitors: MonitorInfo[],
): { absX: number; absY: number } {
  const targetMonitor = monitors[screenIndex] ?? monitors[0];
  if (!targetMonitor) {
    return { absX: x, absY: y };
  }

  return {
    absX: targetMonitor.x + Math.round(x),
    absY: targetMonitor.y + Math.round(y),
  };
}
