import { useRef, useCallback } from "react";

export function OrbitCube({
  theta,
  phi,
  onChangeTheta,
  onChangePhi,
  size = 120,
}: {
  theta: number;
  phi: number;
  onChangeTheta: (v: number) => void;
  onChangePhi: (v: number) => void;
  size?: number;
}) {
  const draggingRef = useRef(false);
  const startRef = useRef({ x: 0, y: 0, theta: 0, phi: 0 });

  // 8 cube vertices at +/-1
  const verts: [number, number, number][] = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  // 12 edges
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  // Axis tips and labels
  const axisTips: { label: string; pos: [number, number, number] }[] = [
    { label: "X", pos: [1.4, 0, 0] },
    { label: "Y", pos: [0, 1.4, 0] },
    { label: "Z", pos: [0, 0, 1.4] },
  ];

  // Rotate point: phi around X, then theta around Y
  const rotatePoint = (x: number, y: number, z: number): [number, number, number] => {
    // Rotate around X by phi
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const y1 = y * cosP - z * sinP;
    const z1 = y * sinP + z * cosP;
    // Rotate around Y by theta
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const x2 = x * cosT + z1 * sinT;
    const z2 = -x * sinT + z1 * cosT;
    return [x2, y1, z2];
  };

  const half = size / 2;
  const scale = size * 0.28;

  // Project vertices
  const projected = verts.map(([x, y, z]) => {
    const [rx, ry, rz] = rotatePoint(x, y, z);
    return { x: half + rx * scale, y: half - ry * scale, z: rz };
  });

  // Project axis tips
  const projectedAxes = axisTips.map(({ label, pos: [x, y, z] }) => {
    const [rx, ry, rz] = rotatePoint(x, y, z);
    return { label, x: half + rx * scale, y: half - ry * scale, z: rz };
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, y: e.clientY, theta, phi };
    },
    [theta, phi],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      onChangeTheta(startRef.current.theta + dx * 0.008);
      onChangePhi(Math.max(-1.4, Math.min(1.4, startRef.current.phi + dy * 0.008)));
    },
    [onChangeTheta, onChangePhi],
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChangeTheta(0.6);
      onChangePhi(0.35);
    },
    [onChangeTheta, onChangePhi],
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      style={{
        border: "1px solid var(--fg)",
        cursor: "grab",
        touchAction: "none",
        flexShrink: 0,
      }}
    >
      {edges.map(([a, b], i) => {
        const avgZ = (projected[a].z + projected[b].z) / 2;
        const opacity = 0.25 + 0.75 * Math.max(0, Math.min(1, (avgZ + 1.5) / 3));
        return (
          <line
            key={i}
            x1={projected[a].x}
            y1={projected[a].y}
            x2={projected[b].x}
            y2={projected[b].y}
            stroke="var(--fg)"
            strokeWidth={1}
            opacity={opacity}
          />
        );
      })}
      {projectedAxes.map((ax) => (
        <text
          key={ax.label}
          x={ax.x}
          y={ax.y}
          fill="var(--fg)"
          fontSize={9}
          fontFamily="inherit"
          fontWeight={600}
          textAnchor="middle"
          dominantBaseline="central"
          opacity={0.3 + 0.7 * Math.max(0, Math.min(1, (ax.z + 1.5) / 3))}
          style={{ pointerEvents: "none" }}
        >
          {ax.label}
        </text>
      ))}
    </svg>
  );
}
