/**
 * @openlivesync/server - Node.js package for collaboration, presence, and chat.
 * Export all public API and protocol types for use in a Node.js backend.
 */

// Server API
export {
  createServer,
  createWebSocketServer,
  createWebSocketHandler,
  type ServerOptions,
  type WebSocketServerOptions,
  type ChatOptions,
} from "./server.js";

// Protocol (for client compatibility and typing)
export type {
  Presence,
  UserInfo,
  ClientMessage,
  ServerMessage,
  JoinRoomPayload,
  LeaveRoomPayload,
  UpdatePresencePayload,
  BroadcastEventPayload,
  SendChatPayload,
  PresenceEntry,
  RoomJoinedPayload,
  PresenceUpdatedPayload,
  BroadcastEventRelayPayload,
  ChatMessagePayload,
  StoredChatMessage,
  ErrorPayload,
  ChatMessageInput,
} from "./protocol.js";
export {
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

// Chat storage interface and in-memory (no extra deps)
export type { ChatStorage } from "./storage/chat-storage.js";
export { createInMemoryChatStorage } from "./storage/in-memory.js";
export type { InMemoryChatStorageOptions } from "./storage/in-memory.js";

// Optional DB adapters (require pg / mysql2 / better-sqlite3 to be installed)
export { createPostgresChatStorage } from "./storage/postgres.js";
export type {
  PostgresChatStorageOptions,
  PostgresConnectionConfig,
} from "./storage/postgres.js";
export { createMySQLChatStorage } from "./storage/mysql.js";
export type {
  MySQLChatStorageOptions,
  MySQLConnectionConfig,
} from "./storage/mysql.js";
export { createSQLiteChatStorage } from "./storage/sqlite.js";
export type {
  SQLiteChatStorageOptions,
  SQLiteConnectionConfig,
} from "./storage/sqlite.js";
