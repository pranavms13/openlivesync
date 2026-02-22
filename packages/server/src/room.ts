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
}

export class Room {
  private readonly roomId: string;
  private readonly chatStorage: ChatStorage;
  private readonly historyLimit: number;
  private readonly connections = new Map<string, RoomConnectionHandle>();

  constructor(options: RoomOptions) {
    this.roomId = options.roomId;
    this.chatStorage = options.chatStorage;
    this.historyLimit = options.historyLimit;
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

    const presenceMap: Record<string, PresenceEntry> = {};
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

    let chatHistory: StoredChatMessage[] | undefined;
    try {
      chatHistory = await this.chatStorage.getHistory(
        this.roomId,
        this.historyLimit
      );
    } catch {
      chatHistory = [];
    }

    handle.send({
      type: MSG_ROOM_JOINED,
      payload: {
        roomId: this.roomId,
        connectionId: handle.connectionId,
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
            connectionId: handle.connectionId,
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
    this.connections.delete(connectionId);
    this.broadcast({
      type: MSG_PRESENCE_UPDATED,
      payload: {
        roomId: this.roomId,
        left: [connectionId],
      },
    });
  }

  /** Update presence for a connection and broadcast updated entry. */
  updatePresence(connectionId: string, presence: Presence): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    conn.presence = { ...presence };
    this.broadcastExcept(connectionId, {
      type: MSG_PRESENCE_UPDATED,
      payload: {
        roomId: this.roomId,
        updated: [
          {
            connectionId: conn.connectionId,
            userId: conn.userId,
            name: conn.name,
            email: conn.email,
            provider: conn.provider,
            presence: conn.presence,
          },
        ],
      },
    });
  }

  /** Relay collaboration event to other clients in the room. */
  broadcastEvent(
    connectionId: string,
    event: string,
    payload: unknown,
    userId?: string
  ): void {
    this.broadcastExcept(connectionId, {
      type: MSG_BROADCAST_EVENT_RELAY,
      payload: {
        roomId: this.roomId,
        connectionId,
        userId,
        event,
        payload,
      },
    });
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
    const payload = {
      roomId: this.roomId,
      connectionId,
      userId,
      message,
      metadata,
    };
    this.broadcast({
      type: MSG_CHAT_MESSAGE,
      payload,
    });
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
