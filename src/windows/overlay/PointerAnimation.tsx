import type { PointTag } from "../../lib/pointParser";

interface PointerAnimationProps {
  activePoint: PointTag | null;
}

export function PointerAnimation({ activePoint }: PointerAnimationProps) {
  if (!activePoint) {
    return null;
  }

  return <div className="point-label">{activePoint.label}</div>;
}
