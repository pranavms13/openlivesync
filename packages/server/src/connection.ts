/**
 * Wraps a WebSocket: parse messages, throttle presence, dispatch to room.
 */

import type { WebSocket } from "ws";
import type {
  ClientMessage,
  ServerMessage,
  Presence,
} from "./protocol.js";
import {
  MSG_JOIN_ROOM,
  MSG_LEAVE_ROOM,
  MSG_UPDATE_PRESENCE,
  MSG_BROADCAST_EVENT,
  MSG_SEND_CHAT,
  MSG_ERROR,
} from "./protocol.js";
import type { RoomManager } from "./room-manager.js";
import type { RoomConnectionHandle } from "./room.js";
import { decodeAccessToken } from "./auth/index.js";
import type { AuthOptions } from "./auth/index.js";

function isClientMessage(msg: unknown): msg is ClientMessage {
  if (msg === null || typeof msg !== "object" || !("type" in msg)) return false;
  const t = (msg as { type: string }).type;
  return [
    MSG_JOIN_ROOM,
    MSG_LEAVE_ROOM,
    MSG_UPDATE_PRESENCE,
    MSG_BROADCAST_EVENT,
    MSG_SEND_CHAT,
  ].includes(t);
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

export interface ConnectionOptions {
  connectionId: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  provider?: string;
  presenceThrottleMs: number;
  roomManager: RoomManager;
  auth?: AuthOptions;
}

export class Connection {
  private readonly ws: WebSocket;
  private readonly connectionId: string;
  private userId: string | undefined;
  private userName: string | undefined;
  private userEmail: string | undefined;
  private provider: string | undefined;
  private readonly presenceThrottleMs: number;
  private readonly roomManager: RoomManager;
  private readonly auth: AuthOptions | undefined;
  private currentRoomId: string | null = null;
  private lastPresenceUpdate = 0;
  private closed = false;

  constructor(ws: WebSocket, options: ConnectionOptions) {
    this.ws = ws;
    this.connectionId = options.connectionId;
    this.userId = options.userId;
    this.userName = options.userName;
    this.userEmail = options.userEmail;
    this.provider = options.provider;
    this.presenceThrottleMs = options.presenceThrottleMs;
    this.roomManager = options.roomManager;
    this.auth = options.auth;

    this.ws.on("message", (data: Buffer | string) => this.handleMessage(data));
    this.ws.on("close", () => this.handleClose());
  }

  private send(msg: ServerMessage): void {
    send(this.ws, msg);
  }

  private handleMessage(data: Buffer | string): void {
    if (this.closed) return;
    let msg: unknown;
    try {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      msg = JSON.parse(raw) as unknown;
    } catch {
      this.send({
        type: MSG_ERROR,
        payload: { code: "INVALID_JSON", message: "Invalid JSON" },
      });
      return;
    }
    if (!isClientMessage(msg)) {
      this.send({
        type: MSG_ERROR,
        payload: { code: "INVALID_MESSAGE", message: "Unknown or invalid message type" },
      });
      return;
    }
    this.dispatch(msg).catch((err) => {
      this.send({
        type: MSG_ERROR,
        payload: {
          code: "SERVER_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    });
  }

  private async dispatch(clientMsg: ClientMessage): Promise<void> {
    switch (clientMsg.type) {
      case MSG_JOIN_ROOM: {
        const { roomId, presence, accessToken, name, email } = clientMsg.payload;
        if (accessToken && this.userId === undefined) {
          const decoded = await decodeAccessToken(accessToken, this.auth);
          if (decoded) {
            this.userId = decoded.sub;
            this.userName = decoded.name;
            this.userEmail = decoded.email;
            this.provider = decoded.provider;
          } else if (name || email) {
            // Fallback to provided name/email if token decoding fails.
            if (name && this.userName === undefined) this.userName = name;
            if (email && this.userEmail === undefined) this.userEmail = email;
          }
        } else if (!accessToken && (name || email)) {
          // No token: allow client-provided name/email.
          if (name && this.userName === undefined) this.userName = name;
          if (email && this.userEmail === undefined) this.userEmail = email;
        }
        if (this.currentRoomId) {
          const room = this.roomManager.get(this.currentRoomId);
          if (room) room.leave(this.connectionId);
          this.roomManager.removeIfEmpty(this.currentRoomId);
        }
        this.currentRoomId = roomId;
        const room = this.roomManager.getOrCreate(roomId);
        const handle: RoomConnectionHandle = {
          connectionId: this.connectionId,
          userId: this.userId,
          name: this.userName,
          email: this.userEmail,
          provider: this.provider,
          presence: {},
          send: (m) => this.send(m),
        };
        await room.join(handle, presence);
        break;
      }
      case MSG_LEAVE_ROOM: {
        const roomId = clientMsg.payload?.roomId ?? this.currentRoomId;
        if (roomId && this.currentRoomId === roomId) {
          const room = this.roomManager.get(roomId);
          if (room) room.leave(this.connectionId);
          this.roomManager.removeIfEmpty(roomId);
          this.currentRoomId = null;
        }
        break;
      }
      case MSG_UPDATE_PRESENCE: {
        const now = Date.now();
        if (now - this.lastPresenceUpdate < this.presenceThrottleMs) return;
        this.lastPresenceUpdate = now;
        if (!this.currentRoomId) return;
        const room = this.roomManager.get(this.currentRoomId);
        if (room) room.updatePresence(this.connectionId, clientMsg.payload.presence as Presence);
        break;
      }
      case MSG_BROADCAST_EVENT: {
        if (!this.currentRoomId) return;
        const room = this.roomManager.get(this.currentRoomId);
        if (room) {
          room.broadcastEvent(
            this.connectionId,
            clientMsg.payload.event,
            clientMsg.payload.payload,
            this.userId
          );
        }
        break;
      }
      case MSG_SEND_CHAT: {
        if (!this.currentRoomId) return;
        const room = this.roomManager.get(this.currentRoomId);
        if (room) {
          await room.sendChat(
            this.connectionId,
            clientMsg.payload.message,
            clientMsg.payload.metadata,
            this.userId
          );
        }
        break;
      }
    }
  }

  private handleClose(): void {
    this.closed = true;
    if (this.currentRoomId) {
      const room = this.roomManager.get(this.currentRoomId);
      if (room) room.leave(this.connectionId);
      this.roomManager.removeIfEmpty(this.currentRoomId);
    }
  }
}
