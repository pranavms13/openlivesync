/**
 * A single room: connections, presence map, broadcast, and chat.
 */

import type {
  Presence,
  PresenceEntry,
  ServerMessage,
  StoredChatMessage,
} from "./protocol.js";
import {
  MSG_CHAT_MESSAGE,
  MSG_PRESENCE_UPDATED,
  MSG_ROOM_JOINED,
  MSG_BROADCAST_EVENT_RELAY,
} from "./protocol.js";
import type { ChatStorage } from "./storage/chat-storage.js";
import type { RoomAdapter } from "./adapters/adapter.js";
import type { YjsDocStore } from "./yjs/doc-store.js";
import { handleYjsBinaryMessage, createSyncStep1Message, createAwarenessRemovalMessage, type YjsHandlerResult } from "./yjs/handler.js";

/** Handle the room uses to send messages to a connection. */
export interface RoomConnectionHandle {
  connectionId: string;
  userId?: string;
  name?: string;
  email?: string;
  provider?: string;
  presence: Presence;
  send(msg: ServerMessage): void;
  sendBinary?(data: Uint8Array): void;
}

export interface RoomOptions {
  roomId: string;
  chatStorage: ChatStorage;
  historyLimit: number;
  adapter?: RoomAdapter;
  yjsDocStore?: YjsDocStore;
}

export class Room {
  private readonly roomId: string;
  private readonly chatStorage: ChatStorage;
  private readonly historyLimit: number;
  private readonly adapter: RoomAdapter | undefined;
  private readonly yjsDocStore: YjsDocStore | undefined;
  private readonly connections = new Map<string, RoomConnectionHandle>();
  /** Tracks Yjs client IDs per connection for awareness cleanup on leave. */
  private readonly yjsClientIds = new Map<string, Set<number>>();

  constructor(options: RoomOptions) {
    this.roomId = options.roomId;
    this.chatStorage = options.chatStorage;
    this.historyLimit = options.historyLimit;
    this.adapter = options.adapter;
    this.yjsDocStore = options.yjsDocStore;
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  /** Add connection to room; send room_joined to connection and presence_updated (joined) to others. */
  async join(
    handle: RoomConnectionHandle,
    initialPresence: Presence = {}
  ): Promise<void> {
    const entry: RoomConnectionHandle = {
      ...handle,
      presence: { ...initialPresence },
    };
    this.connections.set(handle.connectionId, entry);

    let presenceMap: Record<string, PresenceEntry>;
    if (this.adapter) {
      await this.adapter.joinRoom(this.roomId, {
        connectionId: handle.connectionId,
        userId: handle.userId,
        name: handle.name,
        email: handle.email,
        provider: handle.provider,
        presence: entry.presence,
      });
      presenceMap = await this.adapter.getGlobalPresence(this.roomId);
      if (this.connections.size === 1) {
        await this.adapter.subscribe(this.roomId, (msg) => this.broadcast(msg));
      }
    } else {
      presenceMap = {};
      for (const [, c] of this.connections) {
        presenceMap[c.connectionId] = {
          connectionId: c.connectionId,
          userId: c.userId,
          name: c.name,
          email: c.email,
          provider: c.provider,
          presence: c.presence,
        };
      }
    }

    let chatHistory: StoredChatMessage[] | undefined;
    try {
      chatHistory = await this.chatStorage.getHistory(
        this.roomId,
        this.historyLimit
      );
    } catch {
      chatHistory = [];
    }

    const myConnectionId = this.adapter
      ? `${this.adapter.instanceId}:${handle.connectionId}`
      : handle.connectionId;
    handle.send({
      type: MSG_ROOM_JOINED,
      payload: {
        roomId: this.roomId,
        connectionId: myConnectionId,
        presence: presenceMap,
        chatHistory,
      },
    });

    this.broadcastExcept(handle.connectionId, {
      type: MSG_PRESENCE_UPDATED,
      payload: {
        roomId: this.roomId,
        joined: [
          {
            connectionId: myConnectionId,
            userId: handle.userId,
            name: handle.name,
            email: handle.email,
            provider: handle.provider,
            presence: entry.presence,
          },
        ],
      },
    });

    // Yjs: send sync step 1 to new client to initiate handshake
    if (this.yjsDocStore && handle.sendBinary) {
      createSyncStep1Message(this.roomId, this.yjsDocStore)
        .then((msg) => handle.sendBinary!(msg))
        .catch((err) => console.error(`[openlivesync] Yjs sync step 1 failed for room "${this.roomId}":`, err));
    }
  }

  /** Remove connection and notify others. */
  leave(connectionId: string): void {
    const leftId = this.adapter
      ? `${this.adapter.instanceId}:${connectionId}`
      : connectionId;
    if (this.adapter) {
      this.adapter.leaveRoom(this.roomId, connectionId).catch(() => {});
    }

    // Yjs: clean up awareness state for this connection
    if (this.yjsDocStore) {
      const clientIds = this.yjsClientIds.get(connectionId);
      if (clientIds && clientIds.size > 0) {
        const ids = Array.from(clientIds);
        this.yjsDocStore.removeAwarenessStates(this.roomId, ids);
        const removalMsg = createAwarenessRemovalMessage(ids);
        this.broadcastBinaryExcept(connectionId, removalMsg);
      }
      this.yjsClientIds.delete(connectionId);
    }

    this.connections.delete(connectionId);
    this.broadcast({
      type: MSG_PRESENCE_UPDATED,
      payload: {
        roomId: this.roomId,
        left: [leftId],
      },
    });
    if (this.adapter && this.connections.size === 0) {
      this.adapter.unsubscribe(this.roomId).catch(() => {});
    }
    // Yjs: destroy doc when room empties
    if (this.yjsDocStore && this.connections.size === 0) {
      this.yjsDocStore.destroyDoc(this.roomId);
    }
  }

  /** Update presence for a connection and broadcast updated entry. */
  async updatePresence(connectionId: string, presence: Presence): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    conn.presence = { ...presence };
    const connectionIdForPayload = this.adapter
      ? `${this.adapter.instanceId}:${conn.connectionId}`
      : conn.connectionId;
    const entry: PresenceEntry = {
      connectionId: connectionIdForPayload,
      userId: conn.userId,
      name: conn.name,
      email: conn.email,
      provider: conn.provider,
      presence: conn.presence,
    };
    if (this.adapter) {
      await this.adapter.updatePresence(this.roomId, {
        ...entry,
        connectionId: conn.connectionId,
      });
    }
    this.broadcastExcept(connectionId, {
      type: MSG_PRESENCE_UPDATED,
      payload: {
        roomId: this.roomId,
        updated: [entry],
      },
    });
  }

  /** Relay collaboration event to other clients in the room. */
  async broadcastEvent(
    connectionId: string,
    event: string,
    payload: unknown,
    userId?: string
  ): Promise<void> {
    const connectionIdForPayload = this.adapter
      ? `${this.adapter.instanceId}:${connectionId}`
      : connectionId;
    const msg: ServerMessage = {
      type: MSG_BROADCAST_EVENT_RELAY,
      payload: {
        roomId: this.roomId,
        connectionId: connectionIdForPayload,
        userId,
        event,
        payload,
      },
    };
    if (this.adapter) {
      await this.adapter.publish(this.roomId, msg);
    }
    this.broadcastExcept(connectionId, msg);
  }

  /** Append chat message to storage and broadcast to all in room. */
  async sendChat(
    connectionId: string,
    message: string,
    metadata: Record<string, unknown> | undefined,
    userId?: string
  ): Promise<void> {
    await this.chatStorage.append(this.roomId, {
      roomId: this.roomId,
      connectionId,
      userId,
      message,
      metadata,
    });
    const connectionIdForPayload = this.adapter
      ? `${this.adapter.instanceId}:${connectionId}`
      : connectionId;
    const payload = {
      roomId: this.roomId,
      connectionId: connectionIdForPayload,
      userId,
      message,
      metadata,
    };
    const msg: ServerMessage = { type: MSG_CHAT_MESSAGE, payload };
    this.broadcast(msg);
    if (this.adapter) {
      await this.adapter.publish(this.roomId, msg);
    }
  }

  /** Handle an incoming Yjs binary message from a connection. */
  handleYjsMessage(connectionId: string, data: Uint8Array): void {
    if (!this.yjsDocStore) return;
    handleYjsBinaryMessage(this.roomId, connectionId, data, this.yjsDocStore)
      .then((result: YjsHandlerResult) => {
        if (
          result.awarenessClientIdsAdded.length > 0 ||
          result.awarenessClientIdsRemoved.length > 0
        ) {
          const trackedClientIds = this.yjsClientIds.get(connectionId) ?? new Set<number>();
          for (const clientId of result.awarenessClientIdsAdded) {
            trackedClientIds.add(clientId);
          }
          for (const clientId of result.awarenessClientIdsRemoved) {
            trackedClientIds.delete(clientId);
          }
          if (trackedClientIds.size > 0) {
            this.yjsClientIds.set(connectionId, trackedClientIds);
          } else {
            this.yjsClientIds.delete(connectionId);
          }
        }
        const conn = this.connections.get(connectionId);
        if (conn?.sendBinary) {
          for (const msg of result.reply) {
            conn.sendBinary(msg);
          }
        }
        for (const msg of result.broadcast) {
          this.broadcastBinaryExcept(connectionId, msg);
        }
      })
      .catch((err) => console.error(`[openlivesync] Yjs message handling failed for room "${this.roomId}":`, err));
  }

  /** Send binary data to a specific connection. */
  sendBinary(connectionId: string, data: Uint8Array): void {
    const conn = this.connections.get(connectionId);
    if (conn?.sendBinary) conn.sendBinary(data);
  }

  /** Broadcast binary data to all connections except one. */
  broadcastBinaryExcept(exceptConnectionId: string, data: Uint8Array): void {
    for (const conn of this.connections.values()) {
      if (conn.connectionId !== exceptConnectionId && conn.sendBinary) {
        conn.sendBinary(data);
      }
    }
  }

  private broadcast(msg: ServerMessage): void {
    for (const conn of this.connections.values()) {
      conn.send(msg);
    }
  }

  private broadcastExcept(exceptConnectionId: string, msg: ServerMessage): void {
    for (const conn of this.connections.values()) {
      if (conn.connectionId !== exceptConnectionId) {
        conn.send(msg);
      }
    }
  }
}
