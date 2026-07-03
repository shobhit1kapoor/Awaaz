import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

interface CursorPosition {
  x: number;
  y: number;
}

export function useCursorPosition(): CursorPosition {
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({
    x: 0,
    y: 0,
  });

  useEffect(() => {
    let isMounted = true;
    let overlayOrigin = { x: 0, y: 0 };
    let overlayPixelsPerCssPixel = { x: 1, y: 1 };
    const overlayWindow = getCurrentWindow();

    const initializeOverlayGeometry = async () => {
      const [position, size] = await Promise.all([
        overlayWindow.outerPosition(),
        overlayWindow.outerSize(),
      ]);
      overlayOrigin = position;
      overlayPixelsPerCssPixel = {
        x: size.width / Math.max(window.innerWidth, 1),
        y: size.height / Math.max(window.innerHeight, 1),
      };
    };
    void initializeOverlayGeometry();

    const geometryRefreshTimer = window.setInterval(() => {
      void initializeOverlayGeometry();
    }, 1_000);
    window.addEventListener("resize", initializeOverlayGeometry);

    let cursorPollingTimer: number | null = null;
    const pollCursor = () => {
      void invoke<[number, number]>("get_cursor_pos")
        .then(([absoluteX, absoluteY]) => {
          if (isMounted) {
            setCursorPosition({
              x: (absoluteX - overlayOrigin.x) / overlayPixelsPerCssPixel.x,
              y: (absoluteY - overlayOrigin.y) / overlayPixelsPerCssPixel.y,
            });
          }
        })
        .finally(() => {
          if (isMounted) {
            cursorPollingTimer = window.setTimeout(pollCursor, 8);
          }
        });
    };
    pollCursor();

    return () => {
      isMounted = false;
      if (cursorPollingTimer !== null) {
        window.clearTimeout(cursorPollingTimer);
      }
      window.clearInterval(geometryRefreshTimer);
      window.removeEventListener("resize", initializeOverlayGeometry);
    };
  }, []);

  return cursorPosition;
}
