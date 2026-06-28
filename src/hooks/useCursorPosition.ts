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
    let overlayScaleFactor = 1;
    const overlayWindow = getCurrentWindow();

    const initializeOverlayGeometry = async () => {
      const [position, scaleFactor] = await Promise.all([
        overlayWindow.outerPosition(),
        overlayWindow.scaleFactor(),
      ]);
      overlayOrigin = position;
      overlayScaleFactor = scaleFactor;
    };
    void initializeOverlayGeometry();

    const cursorPollingTimer = window.setInterval(() => {
      void invoke<[number, number]>("get_cursor_pos").then(
        ([absoluteX, absoluteY]) => {
          if (isMounted) {
            setCursorPosition({
              x: (absoluteX - overlayOrigin.x) / overlayScaleFactor,
              y: (absoluteY - overlayOrigin.y) / overlayScaleFactor,
            });
          }
        },
      );
    }, 33);

    return () => {
      isMounted = false;
      window.clearInterval(cursorPollingTimer);
    };
  }, []);

  return cursorPosition;
}
