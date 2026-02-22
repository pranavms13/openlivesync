/**
 * Wire protocol types for @openlivesync/client.
 * Must stay in sync with @openlivesync/server protocol (same message types and payload shapes).
 */

/** Generic presence payload (cursor, name, color, etc.). Server does not interpret. */
export type Presence = Record<string, unknown>;

/** User/session info attached by server from auth (optional). */
export interface UserInfo {
  userId?: string;
  name?: string;
  email?: string;
  provider?: string;
  [key: string]: unknown;
}

// ----- Client → Server message types -----

export const MSG_JOIN_ROOM = "join_room";
export const MSG_LEAVE_ROOM = "leave_room";
export const MSG_UPDATE_PRESENCE = "update_presence";
export const MSG_BROADCAST_EVENT = "broadcast_event";
export const MSG_SEND_CHAT = "send_chat";

export interface JoinRoomPayload {
  roomId: string;
  presence?: Presence;
  /** Optional OAuth/OpenID access token; server decodes to get name, email, provider. */
  accessToken?: string;
}

export interface LeaveRoomPayload {
  roomId?: string;
}

export interface UpdatePresencePayload {
  presence: Presence;
}

export interface BroadcastEventPayload {
  event: string;
  payload?: unknown;
}

export interface SendChatPayload {
  message: string;
  /** Optional application-defined metadata */
  metadata?: Record<string, unknown>;
}

export type ClientMessage =
  | { type: typeof MSG_JOIN_ROOM; payload: JoinRoomPayload }
  | { type: typeof MSG_LEAVE_ROOM; payload?: LeaveRoomPayload }
  | { type: typeof MSG_UPDATE_PRESENCE; payload: UpdatePresencePayload }
  | { type: typeof MSG_BROADCAST_EVENT; payload: BroadcastEventPayload }
  | { type: typeof MSG_SEND_CHAT; payload: SendChatPayload };

// ----- Server → Client message types -----

export const MSG_ROOM_JOINED = "room_joined";
export const MSG_PRESENCE_UPDATED = "presence_updated";
export const MSG_BROADCAST_EVENT_RELAY = "broadcast_event";
export const MSG_CHAT_MESSAGE = "chat_message";
export const MSG_ERROR = "error";

export interface PresenceEntry {
  connectionId: string;
  userId?: string;
  name?: string;
  email?: string;
  provider?: string;
  presence: Presence;
}

export interface RoomJoinedPayload {
  roomId: string;
  connectionId: string;
  presence: Record<string, PresenceEntry>;
  chatHistory?: StoredChatMessage[];
}

export interface PresenceUpdatedPayload {
  roomId: string;
  joined?: PresenceEntry[];
  left?: string[];
  updated?: PresenceEntry[];
}

export interface BroadcastEventRelayPayload {
  roomId: string;
  connectionId: string;
  userId?: string;
  event: string;
  payload?: unknown;
}

export interface ChatMessagePayload {
  roomId: string;
  connectionId: string;
  userId?: string;
  message: string;
  metadata?: Record<string, unknown>;
  id?: string;
  createdAt?: number;
}

export interface StoredChatMessage {
  id: string;
  roomId: string;
  connectionId: string;
  userId?: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export type ServerMessage =
  | { type: typeof MSG_ROOM_JOINED; payload: RoomJoinedPayload }
  | { type: typeof MSG_PRESENCE_UPDATED; payload: PresenceUpdatedPayload }
  | { type: typeof MSG_BROADCAST_EVENT_RELAY; payload: BroadcastEventRelayPayload }
  | { type: typeof MSG_CHAT_MESSAGE; payload: ChatMessagePayload }
  | { type: typeof MSG_ERROR; payload: ErrorPayload };

/** Chat message as provided when appending (before storage adds id/createdAt). */
export interface ChatMessageInput {
  roomId: string;
  connectionId: string;
  userId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}
