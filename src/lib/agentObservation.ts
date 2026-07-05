import { invoke } from "@tauri-apps/api/core";
import type { ScreenCapturePayload } from "./workerClient";

export interface ActiveWindowInfo {
  title: string;
  appName: string | null;
}

export interface AgentObservation {
  screenshot: ScreenCapturePayload;
  cursor: { x: number; y: number };
  activeWindow: ActiveWindowInfo;
  observedAt: number;
}

export async function observeCurrentContext(
  screenshotPromise?: Promise<ScreenCapturePayload>,
): Promise<AgentObservation> {
  const [screenshot, cursor, activeWindow] = await Promise.all([
    screenshotPromise ?? invoke<ScreenCapturePayload>("capture_screen"),
    invoke<[number, number]>("get_cursor_pos").catch(
      () => [0, 0] as [number, number],
    ),
    invoke<ActiveWindowInfo>("get_active_window_context").catch(() => ({
      title: "",
      appName: null,
    })),
  ]);

  return {
    screenshot,
    cursor: { x: cursor[0], y: cursor[1] },
    activeWindow,
    observedAt: Date.now(),
  };
}
