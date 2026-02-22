/**
 * @openlivesync/client - Browser package for collaboration and presence.
 */

export { createLiveSyncClient } from "./client.js";
export type {
  LiveSyncClient,
  LiveSyncClientConfig,
  LiveSyncClientState,
  ConnectionStatus,
} from "./client.js";

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
