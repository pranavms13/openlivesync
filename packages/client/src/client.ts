/**
 * Core WebSocket client for @openlivesync.
 * Connects to @openlivesync/server, manages room/presence/chat state, and notifies subscribers.
 */

import type {
  ClientMessage,
  ServerMessage,
  Presence,
  PresenceEntry,
  StoredChatMessage,
  JoinRoomPayload,
} from "./protocol.js";
import {
  MSG_JOIN_ROOM,
  MSG_LEAVE_ROOM,
  MSG_UPDATE_PRESENCE,
  MSG_BROADCAST_EVENT,
  MSG_SEND_CHAT,
  MSG_ROOM_JOINED,
  MSG_PRESENCE_UPDATED,
  MSG_BROADCAST_EVENT_RELAY,
  MSG_CHAT_MESSAGE,
  MSG_ERROR,
} from "./protocol.js";

export type ConnectionStatus = "connecting" | "open" | "closing" | "closed";

export interface LiveSyncClientState {
  connectionStatus: ConnectionStatus;
  currentRoomId: string | null;
  connectionId: string | null;
  presence: Record<string, PresenceEntry>;
  chatMessages: StoredChatMessage[];
  lastError: { code: string; message: string } | null;
}

export interface JoinRoomIdentity {
  /** Optional display name if not using accessToken. */
  name?: string;
  /** Optional email if not using accessToken. */
  email?: string;
  /** Optional OAuth/OpenID access token; server decodes to get name, email, provider. */
  accessToken?: string;
}

export interface LiveSyncClientConfig {
  /** WebSocket URL (e.g. wss://host/live). */
  url: string;
  /** Auto-reconnect on close (default true). */
  reconnect?: boolean;
  /** Initial reconnect delay in ms (default 1000). */
  reconnectIntervalMs?: number;
  /** Max reconnect delay in ms (default 30000). */
  maxReconnectIntervalMs?: number;
  /** Optional: return token for auth; appended as query param (e.g. ?access_token=). */
  getAuthToken?: () => string | Promise<string>;
  /** Throttle presence updates in ms (default 100, match server). */
  presenceThrottleMs?: number;
}

const DEFAULT_RECONNECT_INTERVAL_MS = 1000;
const DEFAULT_MAX_RECONNECT_INTERVAL_MS = 30000;
const DEFAULT_PRESENCE_THROTTLE_MS = 100;

function isServerMessage(msg: unknown): msg is ServerMessage {
  if (msg === null || typeof msg !== "object" || !("type" in msg)) return false;
  const t = (msg as { type: string }).type;
  return [
    MSG_ROOM_JOINED,
    MSG_PRESENCE_UPDATED,
    MSG_BROADCAST_EVENT_RELAY,
    MSG_CHAT_MESSAGE,
    MSG_ERROR,
  ].includes(t);
}

export interface LiveSyncClient {
  connect(): void;
  disconnect(): void;
  joinRoom(roomId: string, presence?: Presence, identity?: JoinRoomIdentity): void;
  leaveRoom(roomId?: string): void;
  updatePresence(presence: Presence): void;
  broadcastEvent(event: string, payload?: unknown): void;
  sendChat(message: string, metadata?: Record<string, unknown>): void;
  getConnectionStatus(): ConnectionStatus;
  getPresence(): Record<string, PresenceEntry>;
  getChatMessages(): StoredChatMessage[];
  getCurrentRoomId(): string | null;
  getState(): LiveSyncClientState;
  subscribe(listener: (state: LiveSyncClientState) => void): () => void;
}

export function createLiveSyncClient(config: LiveSyncClientConfig): LiveSyncClient {
  const {
    url: baseUrl,
    reconnect: reconnectEnabled = true,
    reconnectIntervalMs = DEFAULT_RECONNECT_INTERVAL_MS,
    maxReconnectIntervalMs = DEFAULT_MAX_RECONNECT_INTERVAL_MS,
    getAuthToken,
    presenceThrottleMs = DEFAULT_PRESENCE_THROTTLE_MS,
  } = config;

  let ws: WebSocket | null = null;
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let nextReconnectMs = reconnectIntervalMs;
  let intentionalClose = false;
  let lastPresenceUpdate = 0;
  let pendingPresence: Presence | null = null;
  let lastJoinIdentity: JoinRoomIdentity | null = null;

  const state: LiveSyncClientState = {
    connectionStatus: "closed",
    currentRoomId: null,
    connectionId: null,
    presence: {},
    chatMessages: [],
    lastError: null,
  };

  const listeners = new Set<(s: LiveSyncClientState) => void>();

  function emit() {
    const snapshot: LiveSyncClientState = {
      connectionStatus: state.connectionStatus,
      currentRoomId: state.currentRoomId,
      connectionId: state.connectionId,
      presence: { ...state.presence },
      chatMessages: [...state.chatMessages],
      lastError: state.lastError ? { ...state.lastError } : null,
    };
    listeners.forEach((cb) => cb(snapshot));
  }

  function setStatus(status: ConnectionStatus) {
    state.connectionStatus = status;
    emit();
  }

  function send(msg: ClientMessage) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  function clearReconnect() {
    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    nextReconnectMs = reconnectIntervalMs;
  }

  function scheduleReconnect() {
    if (!reconnectEnabled || intentionalClose) return;
    clearReconnect();
    reconnectTimeoutId = setTimeout(() => {
      reconnectTimeoutId = null;
      nextReconnectMs = Math.min(
        nextReconnectMs * 2,
        maxReconnectIntervalMs
      );
      connect();
    }, nextReconnectMs);
  }

  function applyPresenceUpdated(
    joined?: PresenceEntry[],
    left?: string[],
    updated?: PresenceEntry[]
  ) {
    if (joined) {
      for (const e of joined) state.presence[e.connectionId] = e;
    }
    if (left) {
      for (const id of left) delete state.presence[id];
    }
    if (updated) {
      for (const e of updated) state.presence[e.connectionId] = e;
    }
    emit();
  }

  function handleMessage(data: string) {
    let msg: unknown;
    try {
      msg = JSON.parse(data) as unknown;
    } catch {
      state.lastError = { code: "INVALID_JSON", message: "Invalid JSON from server" };
      emit();
      return;
    }
    if (!isServerMessage(msg)) {
      state.lastError = { code: "UNKNOWN_MESSAGE", message: "Unknown message type" };
      emit();
      return;
    }
    switch (msg.type) {
      case MSG_ROOM_JOINED: {
        const { roomId, connectionId, presence, chatHistory } = msg.payload;
        state.currentRoomId = roomId;
        state.connectionId = connectionId;
        state.presence = presence ?? {};
        state.chatMessages = chatHistory ?? [];
        state.lastError = null;
        emit();
        break;
      }
      case MSG_PRESENCE_UPDATED: {
        const { joined, left, updated } = msg.payload;
        applyPresenceUpdated(joined, left, updated);
        break;
      }
      case MSG_BROADCAST_EVENT_RELAY:
        // Application can subscribe to custom events if we add an event emitter; for now we only update state for presence/chat.
        break;
      case MSG_CHAT_MESSAGE: {
        const p = msg.payload;
        const stored: StoredChatMessage = {
          id: p.id ?? `${p.connectionId}-${p.createdAt ?? Date.now()}`,
          roomId: p.roomId,
          connectionId: p.connectionId,
          userId: p.userId,
          message: p.message,
          metadata: p.metadata,
          createdAt: p.createdAt ?? Date.now(),
        };
        if (state.currentRoomId === p.roomId) {
          state.chatMessages = [...state.chatMessages, stored];
          emit();
        }
        break;
      }
      case MSG_ERROR: {
        state.lastError = msg.payload;
        emit();
        break;
      }
    }
  }

  function reconnectAndRejoin() {
    const roomId = state.currentRoomId;
    if (!roomId) return;
    const presence = pendingPresence ?? (state.connectionId ? state.presence[state.connectionId]?.presence : undefined);
    const identity = lastJoinIdentity;
    const payload: JoinRoomPayload = { roomId };
    if (presence !== undefined) payload.presence = presence;
    if (identity?.accessToken !== undefined) payload.accessToken = identity.accessToken;
    if (identity?.name !== undefined) payload.name = identity.name;
    if (identity?.email !== undefined) payload.email = identity.email;
    send({ type: MSG_JOIN_ROOM, payload });
  }

  function connect() {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    intentionalClose = false;
    setStatus("connecting");

    (async () => {
      let url = baseUrl;
      if (getAuthToken) {
        try {
          const token = await getAuthToken();
          if (token) {
            const sep = baseUrl.includes("?") ? "&" : "?";
            url = `${baseUrl}${sep}access_token=${encodeURIComponent(token)}`;
          }
        } catch (e) {
          state.lastError = {
            code: "AUTH_ERROR",
            message: e instanceof Error ? e.message : String(e),
          };
          setStatus("closed");
          emit();
          return;
        }
      }

      ws = new WebSocket(url);

      ws.onopen = () => {
        setStatus("open");
        nextReconnectMs = reconnectIntervalMs;
        reconnectAndRejoin();
      };

      ws.onmessage = (event) => {
        const data = typeof event.data === "string" ? event.data : event.data.toString();
        handleMessage(data);
      };

      ws.onclose = () => {
        ws = null;
        setStatus("closed");
        if (!intentionalClose) {
          scheduleReconnect();
        } else {
          clearReconnect();
        }
      };

      ws.onerror = () => {
        state.lastError = { code: "WEBSOCKET_ERROR", message: "WebSocket error" };
        emit();
      };
    })();
  }

  function disconnect() {
    intentionalClose = true;
    clearReconnect();
    state.currentRoomId = null;
    state.connectionId = null;
    state.presence = {};
    state.chatMessages = [];
    pendingPresence = null;
    if (ws) {
      setStatus("closing");
      ws.close();
      ws = null;
    }
    setStatus("closed");
  }

  function joinRoom(roomId: string, presence?: Presence, identity?: JoinRoomIdentity) {
    if (state.currentRoomId) {
      send({ type: MSG_LEAVE_ROOM, payload: { roomId: state.currentRoomId } });
    }
    state.currentRoomId = roomId;
    state.presence = {};
    state.chatMessages = [];
    pendingPresence = presence ?? null;
    lastJoinIdentity = identity ?? null;
    const payload: JoinRoomPayload = { roomId };
    if (presence !== undefined) payload.presence = presence;
    if (identity?.accessToken !== undefined) payload.accessToken = identity.accessToken;
    if (identity?.name !== undefined) payload.name = identity.name;
    if (identity?.email !== undefined) payload.email = identity.email;
    send({ type: MSG_JOIN_ROOM, payload });
    emit();
  }

  function leaveRoom(roomId?: string) {
    const target = roomId ?? state.currentRoomId;
    if (target) {
      send({ type: MSG_LEAVE_ROOM, payload: { roomId: target } });
      if (target === state.currentRoomId) {
        state.currentRoomId = null;
        state.connectionId = null;
        state.presence = {};
        state.chatMessages = [];
        pendingPresence = null;
      }
      emit();
    }
  }

  function updatePresence(presence: Presence) {
    pendingPresence = presence;
    const now = Date.now();
    if (now - lastPresenceUpdate < presenceThrottleMs) return;
    lastPresenceUpdate = now;
    send({ type: MSG_UPDATE_PRESENCE, payload: { presence } });
  }

  function broadcastEvent(event: string, payload?: unknown) {
    send({ type: MSG_BROADCAST_EVENT, payload: { event, payload } });
  }

  function sendChat(message: string, metadata?: Record<string, unknown>) {
    send({ type: MSG_SEND_CHAT, payload: { message, metadata } });
  }

  function subscribe(listener: (state: LiveSyncClientState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    connect,
    disconnect,
    joinRoom,
    leaveRoom,
    updatePresence,
    broadcastEvent,
    sendChat,
    getConnectionStatus: () => state.connectionStatus,
    getPresence: () => ({ ...state.presence }),
    getChatMessages: () => [...state.chatMessages],
    getCurrentRoomId: () => state.currentRoomId,
    getState: () => ({
      connectionStatus: state.connectionStatus,
      currentRoomId: state.currentRoomId,
      connectionId: state.connectionId,
      presence: { ...state.presence },
      chatMessages: [...state.chatMessages],
      lastError: state.lastError ? { ...state.lastError } : null,
    }),
    subscribe,
  };
}
