/**
 * React bindings for @openlivesync/client.
 * Provider + hooks; import from "@openlivesync/client/react".
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createLiveSyncClient,
  type LiveSyncClient,
  type LiveSyncClientConfig,
  type LiveSyncClientState,
} from "./client.js";
import type { Presence, PresenceEntry, StoredChatMessage } from "./protocol.js";

const LiveSyncContext = createContext<LiveSyncClient | null>(null);

export interface LiveSyncProviderProps {
  children: ReactNode;
  /** Pre-created client (call createLiveSyncClient yourself). */
  client?: LiveSyncClient;
  /** Or pass config and the provider will create the client and connect on mount. */
  url?: string;
  reconnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectIntervalMs?: number;
  getAuthToken?: () => string | Promise<string>;
  presenceThrottleMs?: number;
}

/**
 * Provides the LiveSync client to the tree. Pass either `client` or config (`url`, etc.).
 * If config is passed, the client is created on mount and connect() is called; disconnect on unmount.
 */
export function LiveSyncProvider(props: LiveSyncProviderProps) {
  const { children, client: clientProp } = props;
  const configRef = useRef<LiveSyncClientConfig | null>(null);
  if (!configRef.current && !clientProp && props.url) {
    configRef.current = {
      url: props.url,
      reconnect: props.reconnect,
      reconnectIntervalMs: props.reconnectIntervalMs,
      maxReconnectIntervalMs: props.maxReconnectIntervalMs,
      getAuthToken: props.getAuthToken,
      presenceThrottleMs: props.presenceThrottleMs,
    };
  }
  const config = configRef.current;

  const clientFromConfig = useMemo(() => {
    if (clientProp || !config) return null;
    return createLiveSyncClient(config);
  }, [clientProp, config?.url]);

  const client = clientProp ?? clientFromConfig;

  useEffect(() => {
    if (!client) return;
    if (!clientProp && config) {
      client.connect();
      return () => client.disconnect();
    }
  }, [client, clientProp, config]);

  if (!client) {
    throw new Error(
      "LiveSyncProvider: pass either `client` or config (e.g. `url`) to create the client."
    );
  }

  return React.createElement(LiveSyncContext.Provider, { value: client }, children);
}

export function useLiveSyncClient(): LiveSyncClient {
  const client = useContext(LiveSyncContext);
  if (!client) {
    throw new Error("useLiveSyncClient must be used within LiveSyncProvider");
  }
  return client;
}

function useClientState(): LiveSyncClientState {
  const client = useLiveSyncClient();
  const [state, setState] = useState<LiveSyncClientState>(() =>
    client.getState()
  );
  useEffect(() => {
    return client.subscribe(setState);
  }, [client]);
  return state;
}

/** Returns current connection status and triggers re-renders when it changes. */
export function useConnectionStatus(): LiveSyncClientState["connectionStatus"] {
  return useClientState().connectionStatus;
}

export interface UseRoomOptions {
  /** Initial presence when joining (optional). */
  initialPresence?: Presence;
  /** If true, join the room when roomId is set and leave on cleanup or when roomId changes. */
  autoJoin?: boolean;
  /** Optional access token sent with join_room (server can decode for name/email). */
  accessToken?: string;
  /** Optional getter for access token (e.g. refreshed token); used when auto-joining. */
  getAccessToken?: () => string | Promise<string>;
}

export interface UseRoomReturn {
  join: (roomId: string, presence?: Presence, accessToken?: string) => void;
  leave: (roomId?: string) => void;
  updatePresence: (presence: Presence) => void;
  broadcastEvent: (event: string, payload?: unknown) => void;
  presence: Record<string, PresenceEntry>;
  connectionId: string | null;
  isInRoom: boolean;
  currentRoomId: string | null;
}

/**
 * Subscribe to room state and get methods to join/leave/update presence/broadcast.
 * If autoJoin is true (default), joining happens when roomId is set and leaving on unmount or roomId change.
 */
export function useRoom(
  roomId: string | null,
  options: UseRoomOptions = {}
): UseRoomReturn {
  const { initialPresence, autoJoin = true, accessToken, getAccessToken } = options;
  const client = useLiveSyncClient();
  const state = useClientState();
  const joinedRef = useRef<string | null>(null);

  const join = useCallback(
    (id: string, presence?: Presence, token?: string) => {
      const t = token ?? accessToken;
      client.joinRoom(id, presence ?? initialPresence, t);
      joinedRef.current = id;
    },
    [client, initialPresence, accessToken]
  );

  const leave = useCallback(
    (id?: string) => {
      client.leaveRoom(id);
      if (!id || id === joinedRef.current) joinedRef.current = null;
    },
    [client]
  );

  useEffect(() => {
    if (!autoJoin || roomId === null) return;
    let cancelled = false;
    (async () => {
      const token = accessToken ?? (getAccessToken ? await getAccessToken() : undefined);
      if (!cancelled) {
        client.joinRoom(roomId, initialPresence, token);
        joinedRef.current = roomId;
      }
    })();
    return () => {
      cancelled = true;
      leave(roomId);
    };
  }, [autoJoin, roomId, initialPresence, accessToken, getAccessToken, client, leave]);

  const updatePresence = useCallback(
    (presence: Presence) => client.updatePresence(presence),
    [client]
  );

  const broadcastEvent = useCallback(
    (event: string, payload?: unknown) => client.broadcastEvent(event, payload),
    [client]
  );

  const isInRoom =
    state.currentRoomId !== null && state.currentRoomId === roomId;

  return {
    join,
    leave,
    updatePresence,
    broadcastEvent,
    presence: roomId && isInRoom ? state.presence : {},
    connectionId: isInRoom ? state.connectionId : null,
    isInRoom,
    currentRoomId: state.currentRoomId,
  };
}

/** Returns presence map for the current room (or empty if not in room). */
export function usePresence(roomId: string | null): Record<string, PresenceEntry> {
  useLiveSyncClient(); // ensure we're inside provider
  const state = useClientState();
  const isInRoom =
    roomId !== null &&
    state.currentRoomId === roomId;
  return isInRoom ? state.presence : {};
}

export interface UseChatReturn {
  messages: StoredChatMessage[];
  sendMessage: (message: string, metadata?: Record<string, unknown>) => void;
}

/** Returns chat messages for the given room and sendMessage. Ensure the room is joined (e.g. via useRoom). */
export function useChat(roomId: string | null): UseChatReturn {
  const client = useLiveSyncClient();
  const state = useClientState();
  const isInRoom =
    roomId !== null && state.currentRoomId === roomId;
  const messages = isInRoom ? state.chatMessages : [];

  const sendMessage = useCallback(
    (message: string, metadata?: Record<string, unknown>) => {
      client.sendChat(message, metadata);
    },
    [client]
  );

  return { messages, sendMessage };
}
