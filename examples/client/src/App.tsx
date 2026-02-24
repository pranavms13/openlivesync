/**
 * OpenLiveSync example client (React).
 * Demonstrates: LiveSyncProvider, useConnectionStatus, useRoom, usePresence, useChat, useLiveSyncClient.
 */

import { useMemo, useState } from "react";
import {
  LiveSyncProvider,
  useConnectionStatus,
  useRoom,
  usePresence,
  useChat,
  useLiveSyncClient,
} from "@openlivesync/client/react";

// In dev, connect via Vite dev server so /live is proxied to the backend; otherwise use env or default.
const WS_URL =
  typeof location !== "undefined" && import.meta.env.DEV
    ? `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live`
    : import.meta.env.VITE_WS_URL ?? "ws://localhost:3000/live";

function ConnectionStatusBadge() {
  const status = useConnectionStatus();
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`badge ${status}`}>{label}</span>
  );
}

function RoomControls({ roomId }: { roomId: string }) {
  const [name, setName] = useState("Guest");
  const [email, setEmail] = useState("");
  const [broadcastPayload, setBroadcastPayload] = useState("");
  const roomOptions = useMemo(
    () => ({
      initialPresence: { color: "#0d6efd" },
      autoJoin: true,
      name,
      email: email || undefined,
    }),
    [name, email]
  );
  const { join, leave, isInRoom, connectionId, updatePresence, broadcastEvent } = useRoom(
    roomId,
    roomOptions
  );

  return (
    <section>
      <h2>useRoom — Join / Leave / Presence / Broadcast</h2>
      <p>
        Room: <strong>{roomId}</strong>
        {isInRoom && connectionId && (
          <> · Your connection ID: <code>{connectionId.slice(0, 8)}…</code></>
        )}
      </p>
      <div className="form-row">
        <button onClick={() => join(roomId)} disabled={isInRoom}>Join</button>
        <button className="secondary" onClick={() => leave()} disabled={!isInRoom}>Leave</button>
      </div>
      {isInRoom && (
        <>
          <div className="form-row" style={{ marginTop: "0.75rem" }}>
            <label>
              Your name (updatePresence):
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => updatePresence({ name, color: "#0d6efd" })}
              />
            </label>
          </div>
          <div className="form-row" style={{ marginTop: "0.5rem" }}>
            <label>
              Your email (shared via identity; optional):
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          </div>
          <div className="form-row" style={{ marginTop: "0.5rem" }}>
            <input
              type="text"
              placeholder="Broadcast payload"
              value={broadcastPayload}
              onChange={(e) => setBroadcastPayload(e.target.value)}
            />
            <button
              onClick={() => {
                broadcastEvent("example_event", { text: broadcastPayload });
                setBroadcastPayload("");
              }}
            >
              Broadcast event
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function PresenceList({ roomId }: { roomId: string }) {
  const presence = usePresence(roomId);
  const entries = Object.entries(presence);

  return (
    <section>
      <h2>usePresence</h2>
      {entries.length === 0 ? (
        <p>No one in this room (or not in room).</p>
      ) : (
        <ul className="presence-list">
          {entries.map(([connectionId, entry]) => (
            <li key={connectionId}>
              <span
                className="presence-dot"
                style={{ background: (entry.presence as { color?: string })?.color ?? "#0d6efd" }}
              />
              <span>
                {(entry.presence as { name?: string })?.name ?? entry.name ?? connectionId.slice(0, 8)}
              </span>
              {entry.email && <span style={{ fontSize: "0.85rem", color: "#666" }}> ({entry.email})</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ChatPanel({ roomId }: { roomId: string }) {
  const { messages, sendMessage } = useChat(roomId);
  const [input, setInput] = useState("");

  return (
    <section>
      <h2>useChat</h2>
      <ul className="chat-list">
        {messages.map((m) => (
          <li key={m.id}>
            <span>{m.message}</span>
            <div className="chat-meta">
              {m.userId ?? m.connectionId} · {new Date(m.createdAt).toLocaleTimeString()}
            </div>
          </li>
        ))}
      </ul>
      <div className="form-row">
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              sendMessage(input);
              setInput("");
            }
          }}
        />
        <button onClick={() => { sendMessage(input); setInput(""); }}>Send</button>
      </div>
    </section>
  );
}

function ClientStateDebug() {
  const client = useLiveSyncClient();
  const state = client.getState();
  return (
    <section style={{ fontSize: "0.85rem", color: "#555" }}>
      <h2>useLiveSyncClient (getState)</h2>
      <pre style={{ margin: 0, overflow: "auto", whiteSpace: "pre-wrap" }}>
        {JSON.stringify(
          {
            connectionStatus: state.connectionStatus,
            currentRoomId: state.currentRoomId,
            connectionId: state.connectionId,
            presenceCount: Object.keys(state.presence).length,
            chatMessageCount: state.chatMessages.length,
            lastError: state.lastError,
          },
          null,
          2
        )}
      </pre>
    </section>
  );
}

function DemoApp() {
  const [roomId, setRoomId] = useState("demo-room");
  const [roomInput, setRoomInput] = useState(roomId);

  return (
    <>
      <h1>OpenLiveSync example client</h1>
      <section>
        <h2>useConnectionStatus</h2>
        <p>Status: <ConnectionStatusBadge /></p>
      </section>

      <section>
        <h2>Room</h2>
        <div className="form-row">
          <input
            type="text"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            placeholder="Room ID"
          />
          <button onClick={() => setRoomId(roomInput)}>Switch room</button>
        </div>
      </section>

      <RoomControls roomId={roomId} />
      <PresenceList roomId={roomId} />
      <ChatPanel roomId={roomId} />
      <ClientStateDebug />
    </>
  );
}

export default function App() {
  return (
    <LiveSyncProvider url={WS_URL} reconnect>
      <DemoApp />
    </LiveSyncProvider>
  );
}
