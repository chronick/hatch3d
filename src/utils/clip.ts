/**
 * Polyline-to-rectangle clipping using Cohen-Sutherland algorithm.
 */

export interface Rect {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface Point {
  x: number;
  y: number;
}

// Cohen-Sutherland outcode bits
const INSIDE = 0b0000;
const LEFT   = 0b0001;
const RIGHT  = 0b0010;
const BOTTOM = 0b0100;
const TOP    = 0b1000;

function outcode(x: number, y: number, rect: Rect): number {
  let code = INSIDE;
  if (x < rect.xMin) code |= LEFT;
  else if (x > rect.xMax) code |= RIGHT;
  if (y < rect.yMin) code |= BOTTOM;
  else if (y > rect.yMax) code |= TOP;
  return code;
}

/**
 * Clip a single line segment to a rectangle using Cohen-Sutherland.
 * Returns the clipped segment [x0, y0, x1, y1] or null if entirely outside.
 */
export function clipSegment(
  x0: number, y0: number, x1: number, y1: number,
  rect: Rect,
): [number, number, number, number] | null {
  let code0 = outcode(x0, y0, rect);
  let code1 = outcode(x1, y1, rect);

  while (true) {
    if ((code0 | code1) === 0) {
      // Both inside
      return [x0, y0, x1, y1];
    }
    if ((code0 & code1) !== 0) {
      // Both in same outside zone
      return null;
    }

    // Pick the point that is outside
    const codeOut = code0 !== 0 ? code0 : code1;
    let x: number, y: number;

    if (codeOut & TOP) {
      x = x0 + (x1 - x0) * (rect.yMax - y0) / (y1 - y0);
      y = rect.yMax;
    } else if (codeOut & BOTTOM) {
      x = x0 + (x1 - x0) * (rect.yMin - y0) / (y1 - y0);
      y = rect.yMin;
    } else if (codeOut & RIGHT) {
      y = y0 + (y1 - y0) * (rect.xMax - x0) / (x1 - x0);
      x = rect.xMax;
    } else {
      // LEFT
      y = y0 + (y1 - y0) * (rect.xMin - x0) / (x1 - x0);
      x = rect.xMin;
    }

    if (codeOut === code0) {
      x0 = x;
      y0 = y;
      code0 = outcode(x0, y0, rect);
    } else {
      x1 = x;
      y1 = y;
      code1 = outcode(x1, y1, rect);
    }
  }
}

/**
 * Clip a polyline (array of points) to a rectangle.
 * A single input polyline may produce multiple output polylines
 * (when the line exits and re-enters the rect).
 */
export function clipPolylineToRect(points: Point[], rect: Rect): Point[][] {
  if (points.length < 2) return [];

  const result: Point[][] = [];
  let current: Point[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const clipped = clipSegment(p0.x, p0.y, p1.x, p1.y, rect);

    if (clipped === null) {
      // Segment entirely outside -- break the current polyline
      if (current.length >= 2) {
        result.push(current);
      }
      current = [];
      continue;
    }

    const [cx0, cy0, cx1, cy1] = clipped;

    if (current.length === 0) {
      // Start a new polyline with the clipped start point
      current.push({ x: cx0, y: cy0 });
    } else {
      // Check if the clipped start connects to the end of current polyline
      const last = current[current.length - 1];
      if (last.x !== cx0 || last.y !== cy0) {
        // Discontinuity -- the segment was clipped at its start,
        // meaning the original start was outside. Break polyline.
        if (current.length >= 2) {
          result.push(current);
        }
        current = [{ x: cx0, y: cy0 }];
      }
    }

    current.push({ x: cx1, y: cy1 });
  }

  if (current.length >= 2) {
    result.push(current);
  }

  return result;
}

/**
 * Parse an SVG path d-string (M/L commands only) into an array of points.
 * Handles format: M0.00,0.00L1.00,1.00L2.00,2.00
 * Robust to whitespace around commands and coordinates.
 */
export function parseDString(d: string): Point[] {
  const points: Point[] = [];
  // Match M or L followed by coordinates (x,y)
  const re = /[ML]\s*([-\d.eE]+)\s*[,\s]\s*([-\d.eE]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    points.push({
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
    });
  }
  return points;
}

/**
 * Convert an array of points back to an SVG path d-string.
 * Output format: M{x},{y}L{x},{y}L... with 2 decimal places.
 */
export function pointsToDString(points: Point[]): string {
  if (points.length === 0) return "";
  const parts = points.map((p, i) => {
    const cmd = i === 0 ? "M" : "L";
    return `${cmd}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  });
  return parts.join("");
}

/**
 * Full pipeline: parse d-string, apply transform (translate + scale), clip to rect,
 * return new d-strings. A single input path may become multiple output paths after clipping.
 */
export function clipSVGPath(
  d: string,
  transform: { cx: number; cy: number; scale: number },
  clipRect: Rect,
): string[] {
  const points = parseDString(d);
  if (points.length < 2) return [];

  // Apply transform: scale then translate
  const transformed = points.map((p) => ({
    x: p.x * transform.scale + transform.cx,
    y: p.y * transform.scale + transform.cy,
  }));

  const clippedPolylines = clipPolylineToRect(transformed, clipRect);

  return clippedPolylines
    .map(pointsToDString)
    .filter((s) => s.length > 0);
}
