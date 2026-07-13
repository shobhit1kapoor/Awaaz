import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import type { PointTag } from "../../lib/pointParser";
import {
  mapPointToAbsoluteCoordinates,
  type MonitorInfo,
} from "../../lib/monitorMapping";

interface PointerAnimationProps {
  activePoint: PointTag | null;
}

interface OverlayGeometry {
  originX: number;
  originY: number;
  pixelsPerCssX: number;
  pixelsPerCssY: number;
}

export function PointerAnimation({ activePoint }: PointerAnimationProps) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [geometry, setGeometry] = useState<OverlayGeometry>({
    originX: 0,
    originY: 0,
    pixelsPerCssX: 1,
    pixelsPerCssY: 1,
  });

  useEffect(() => {
    let mounted = true;
    const overlayWindow = getCurrentWindow();

    const refreshOverlayContext = async () => {
      const [monitorList, position, size] = await Promise.all([
        invoke<MonitorInfo[]>("list_monitors"),
        overlayWindow.outerPosition(),
        overlayWindow.outerSize(),
      ]);
      if (!mounted) {
        return;
      }
      setMonitors(monitorList);
      setGeometry({
        originX: position.x,
        originY: position.y,
        pixelsPerCssX: size.width / Math.max(window.innerWidth, 1),
        pixelsPerCssY: size.height / Math.max(window.innerHeight, 1),
      });
    };

    void refreshOverlayContext().catch(() => undefined);
    const refreshTimer = window.setInterval(() => {
      void refreshOverlayContext().catch(() => undefined);
    }, 1_000);
    window.addEventListener("resize", refreshOverlayContext);

    return () => {
      mounted = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("resize", refreshOverlayContext);
    };
  }, []);

  const targetPosition = useMemo(() => {
    if (!activePoint || monitors.length === 0) {
      return null;
    }
    const absolutePoint = mapPointToAbsoluteCoordinates(
      activePoint.x,
      activePoint.y,
      activePoint.screenIndex,
      monitors,
    );
    return {
      x: (absolutePoint.absX - geometry.originX) / geometry.pixelsPerCssX,
      y: (absolutePoint.absY - geometry.originY) / geometry.pixelsPerCssY,
    };
  }, [activePoint, geometry, monitors]);

  if (!activePoint || !targetPosition) {
    return null;
  }

  return (
    <div
      key={activePoint.rawTag}
      className="point-target"
      style={{
        left: targetPosition.x,
        top: targetPosition.y,
      }}
    >
      <div className="point-target-ring" />
      <div className="point-label">{activePoint.label}</div>
    </div>
  );
}
