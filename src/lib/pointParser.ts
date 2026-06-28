export interface PointTag {
  x: number;
  y: number;
  label: string;
  screenIndex: number;
  rawTag: string;
}

const POINT_REGEX = /\[POINT:(\d+):(\d+):([^:\]]+):screen(\d+)\]/g;

export function parsePointTags(text: string): {
  cleanText: string;
  points: PointTag[];
} {
  const points: PointTag[] = [];
  let cleanText = text;

  for (const pointMatch of text.matchAll(POINT_REGEX)) {
    const rawTag = pointMatch[0];
    points.push({
      x: Number.parseInt(pointMatch[1], 10),
      y: Number.parseInt(pointMatch[2], 10),
      label: pointMatch[3],
      screenIndex: Number.parseInt(pointMatch[4], 10),
      rawTag,
    });
    cleanText = cleanText.replace(rawTag, "");
  }

  return {
    cleanText: cleanText.replace(/\s+([.,!?;:])/g, "$1").trim(),
    points,
  };
}
