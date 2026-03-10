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

/** Handle the room uses to send messages to a connection. */
export interface RoomConnectionHandle {
  connectionId: string;
  userId?: string;
  name?: string;
  email?: string;
  provider?: string;
  presence: Presence;
  send(msg: ServerMessage): void;
}

export interface RoomOptions {
  roomId: string;
  chatStorage: ChatStorage;
  historyLimit: number;
  adapter?: RoomAdapter;
}

export class Room {
  private readonly roomId: string;
  private readonly chatStorage: ChatStorage;
  private readonly historyLimit: number;
  private readonly adapter: RoomAdapter | undefined;
  private readonly connections = new Map<string, RoomConnectionHandle>();

  constructor(options: RoomOptions) {
    this.roomId = options.roomId;
    this.chatStorage = options.chatStorage;
    this.historyLimit = options.historyLimit;
    this.adapter = options.adapter;
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
  }

  /** Remove connection and notify others. */
  leave(connectionId: string): void {
    const leftId = this.adapter
      ? `${this.adapter.instanceId}:${connectionId}`
      : connectionId;
    if (this.adapter) {
      this.adapter.leaveRoom(this.roomId, connectionId).catch(() => {});
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
