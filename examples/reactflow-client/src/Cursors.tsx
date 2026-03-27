/**
 * Renders remote users' mouse cursors as overlays on the ReactFlow canvas.
 * Positioned absolutely within the canvas container using flowToScreenPosition.
 */

import { useReactFlow } from "@xyflow/react";

const CURSOR_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#e84393",
  "#00cec9",
  "#6c5ce7",
];

function getCursorColor(clientId: number): string {
  return CURSOR_COLORS[clientId % CURSOR_COLORS.length];
}

interface CursorState {
  cursor?: { x: number; y: number } | null;
  name?: string;
}

interface CursorsProps {
  awarenessStates: Map<number, Record<string, unknown>>;
  localClientId: number;
}

export default function Cursors({ awarenessStates, localClientId }: CursorsProps) {
  const reactFlow = useReactFlow();

  const cursors: { clientId: number; screenX: number; screenY: number; name: string; color: string }[] = [];

  awarenessStates.forEach((state, clientId) => {
    if (clientId === localClientId) return;
    const s = state as CursorState;
    if (!s.cursor) return;

    // Convert flow coordinates to screen coordinates
    const screenPos = reactFlow.flowToScreenPosition({
      x: s.cursor.x,
      y: s.cursor.y,
    });

    cursors.push({
      clientId,
      screenX: screenPos.x,
      screenY: screenPos.y,
      name: s.name || `User ${clientId}`,
      color: getCursorColor(clientId),
    });
  });

  if (cursors.length === 0) return null;

  return (
    <div className="cursors-layer">
      {cursors.map(({ clientId, screenX, screenY, name, color }) => (
        <div
          key={clientId}
          className="remote-cursor"
          style={{
            transform: `translate(${screenX}px, ${screenY}px)`,
          }}
        >
          <svg
            width="16"
            height="20"
            viewBox="0 0 16 20"
            fill="none"
            style={{ display: "block" }}
          >
            <path
              d="M0.5 0.5L15 10L8 10.5L4.5 19L0.5 0.5Z"
              fill={color}
              stroke="#fff"
              strokeWidth="1"
            />
          </svg>
          <span
            className="remote-cursor-label"
            style={{ background: color }}
          >
            {name}
          </span>
        </div>
      ))}
    </div>
  );
}
