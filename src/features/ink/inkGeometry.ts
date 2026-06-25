export type InkSpace = "pdf-page" | "epub-section";

export interface InkPoint {
  x: number;
  y: number;
}

export interface InkAnchor {
  version: 1;
  space: InkSpace;
  points: InkPoint[];
  width: number;
  sectionIndex?: number;
  href?: string;
}

export interface InkToolState {
  activeTool: "none" | "pen" | "eraser";
  color: string;
  penWidth: number;
}

export interface InkSize {
  width: number;
  height: number;
}

export const INK_COLORS = ["#111827", "#dc2626", "#2563eb", "#16a34a", "#f97316", "#9333ea"];
export const PEN_WIDTHS = [2, 4, 8, 12];

export function parseInkAnchor(value: string | null): InkAnchor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<InkAnchor>;
    if (
      parsed.version !== 1 ||
      (parsed.space !== "pdf-page" && parsed.space !== "epub-section") ||
      !Array.isArray(parsed.points) ||
      typeof parsed.width !== "number"
    ) {
      return null;
    }
    const points = parsed.points
      .filter((p): p is InkPoint => typeof p?.x === "number" && typeof p?.y === "number")
      .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }));
    if (points.length < 2) return null;
    return {
      version: 1,
      space: parsed.space,
      points,
      width: Math.max(0.5, parsed.width),
      sectionIndex: typeof parsed.sectionIndex === "number" ? parsed.sectionIndex : undefined,
      href: typeof parsed.href === "string" ? parsed.href : undefined,
    };
  } catch {
    return null;
  }
}

export function normalizePoint(point: InkPoint, size: InkSize): InkPoint {
  return {
    x: size.width > 0 ? clamp01(point.x / size.width) : 0,
    y: size.height > 0 ? clamp01(point.y / size.height) : 0,
  };
}

export function denormalizePoint(point: InkPoint, size: InkSize): InkPoint {
  return {
    x: point.x * size.width,
    y: point.y * size.height,
  };
}

export function simplifyLocalPoints(points: InkPoint[], minDistance = 1.5): InkPoint[] {
  if (points.length <= 2) return points;
  const simplified = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distance(simplified[simplified.length - 1], points[i]) >= minDistance) {
      simplified.push(points[i]);
    }
  }
  const last = points[points.length - 1];
  if (distance(simplified[simplified.length - 1], last) > 0) simplified.push(last);
  return simplified;
}

export function strokeInsideLasso(
  stroke: InkAnchor,
  lassoPoints: InkPoint[],
  size: InkSize,
): boolean {
  if (lassoPoints.length < 3) return false;
  const local = stroke.points.map((p) => denormalizePoint(p, size));
  if (!local.every((point) => pointInPolygon(point, lassoPoints))) return false;

  for (let i = 0; i < local.length - 1; i++) {
    for (let j = 0; j < lassoPoints.length; j++) {
      const next = (j + 1) % lassoPoints.length;
      if (segmentsIntersect(local[i], local[i + 1], lassoPoints[j], lassoPoints[next])) {
        return false;
      }
    }
  }
  return true;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function distance(a: InkPoint, b: InkPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointInPolygon(point: InkPoint, polygon: InkPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (pointOnSegment(point, polygon[j], polygon[i])) return true;
    const crosses = polygon[i].y > point.y !== polygon[j].y > point.y;
    if (crosses) {
      const x = ((polygon[j].x - polygon[i].x) * (point.y - polygon[i].y)) / (polygon[j].y - polygon[i].y) + polygon[i].x;
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect(a: InkPoint, b: InkPoint, c: InkPoint, d: InkPoint): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  if (o4 === 0 && pointOnSegment(b, c, d)) return true;
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function pointOnSegment(point: InkPoint, a: InkPoint, b: InkPoint): boolean {
  return (
    orientation(a, b, point) === 0 &&
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y)
  );
}

function orientation(a: InkPoint, b: InkPoint, c: InkPoint): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}
