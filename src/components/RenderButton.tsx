import { useRef, useEffect, useCallback } from "react";

interface RenderButtonProps {
  isStale: boolean;
  isRendering: boolean;
  onRender: () => void;
}

// SVG line config for the radiating animation
const LINE_COUNT = 16;
const LINE_LENGTH = 6;
const LINE_GAP = 4; // gap between button border and line start
const ANIM_DURATION = 2; // seconds for full pulse cycle

export function RenderButton({ isStale, isRendering, onRender }: RenderButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Position radiating lines around the button border
  const updateLines = useCallback(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg) return;

    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    svg.setAttribute("width", String(w + (LINE_LENGTH + LINE_GAP) * 2));
    svg.setAttribute("height", String(h + (LINE_LENGTH + LINE_GAP) * 2));
    svg.setAttribute(
      "viewBox",
      `${-(LINE_LENGTH + LINE_GAP)} ${-(LINE_LENGTH + LINE_GAP)} ${w + (LINE_LENGTH + LINE_GAP) * 2} ${h + (LINE_LENGTH + LINE_GAP) * 2}`
    );

    const lines = svg.querySelectorAll("line");
    const perimeter = 2 * (w + h);

    lines.forEach((line, i) => {
      const t = i / LINE_COUNT;
      const dist = t * perimeter;

      let x: number, y: number, dx: number, dy: number;

      if (dist < w) {
        // Top edge
        x = dist;
        y = 0;
        dx = 0;
        dy = -1;
      } else if (dist < w + h) {
        // Right edge
        x = w;
        y = dist - w;
        dx = 1;
        dy = 0;
      } else if (dist < 2 * w + h) {
        // Bottom edge
        x = w - (dist - w - h);
        y = h;
        dx = 0;
        dy = 1;
      } else {
        // Left edge
        x = 0;
        y = h - (dist - 2 * w - h);
        dx = -1;
        dy = 0;
      }

      line.setAttribute("x1", String(x + dx * LINE_GAP));
      line.setAttribute("y1", String(y + dy * LINE_GAP));
      line.setAttribute("x2", String(x + dx * (LINE_GAP + LINE_LENGTH)));
      line.setAttribute("y2", String(y + dy * (LINE_GAP + LINE_LENGTH)));
    });
  }, []);

  useEffect(() => {
    updateLines();
    const observer = new ResizeObserver(updateLines);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateLines]);

  const label = isRendering
    ? "RENDERING..."
    : isStale
      ? "RENDER — params changed"
      : "RENDER";

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%" }}
    >
      {/* SVG radiating lines overlay */}
      <svg
        ref={svgRef}
        style={{
          position: "absolute",
          top: -(LINE_LENGTH + LINE_GAP),
          left: -(LINE_LENGTH + LINE_GAP),
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        {Array.from({ length: LINE_COUNT }, (_, i) => (
          <line
            key={i}
            stroke="var(--fg)"
            strokeWidth={1}
            strokeLinecap="round"
            opacity={0}
            style={
              isStale && !isRendering
                ? {
                    animation: `render-btn-radiate ${ANIM_DURATION}s ease-in-out ${(i / LINE_COUNT) * ANIM_DURATION}s infinite`,
                  }
                : undefined
            }
          />
        ))}
      </svg>

      <button
        onClick={onRender}
        disabled={isRendering}
        style={{
          width: "100%",
          padding: "8px 0",
          fontSize: 11,
          fontFamily: "inherit",
          fontWeight: 700,
          letterSpacing: "0.06em",
          border: "1px solid var(--fg)",
          borderRadius: 0,
          cursor: isRendering ? "wait" : "pointer",
          background: isStale ? "var(--fg)" : "transparent",
          color: isStale ? "var(--bg-canvas)" : "var(--fg)",
          opacity: isRendering ? 0.5 : 1,
          transition: "background 0.2s, color 0.2s",
        }}
      >
        {label}
      </button>
    </div>
  );
}
