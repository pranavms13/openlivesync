/**
 * OpenLiveSync ReactFlow example client.
 * Demonstrates collaborative graph editing with Yjs CRDT sync.
 */

import { useCallback, useRef } from "react";
import {
  LiveSyncProvider,
  useConnectionStatus,
  useRoom,
} from "@openlivesync/client/react";
import Flow from "./Flow";

const WS_URL =
  typeof location !== "undefined" && import.meta.env.DEV
    ? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live`
    : import.meta.env.VITE_WS_URL ?? "ws://localhost:3000/live";

function ConnectionBadge() {
  const status = useConnectionStatus();
  return <span className={`badge ${status}`}>{status}</span>;
}

function FlowApp() {
  const { isInRoom } = useRoom("flow-room", { autoJoin: true });
  const addNodeRef = useRef<(() => void) | null>(null);

  const handleAddNode = useCallback(() => {
    addNodeRef.current?.();
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>ReactFlow + Yjs</h1>
        <ConnectionBadge />
        <button onClick={handleAddNode} disabled={!isInRoom}>
          Add Node
        </button>
      </header>
      <div className="canvas">
        {isInRoom ? (
          <Flow onAddNodeRef={addNodeRef} />
        ) : (
          <div className="loading">Connecting to room...</div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <LiveSyncProvider url={WS_URL} reconnect>
      <FlowApp />
    </LiveSyncProvider>
  );
}
