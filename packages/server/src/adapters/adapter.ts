/**
 * Room adapter interface for multi-instance coordination.
 * Implementations (e.g. Redis) sync presence, chat, and custom events across server instances.
 */

import type { PresenceEntry, ServerMessage } from "../protocol.js";

/**
 * Adapter for coordinating rooms across multiple Node.js instances.
 * When provided, presence and events are synced via the adapter; otherwise only local state is used.
 */
export interface RoomAdapter {
  /** Unique id for this server instance (e.g. UUID or hostname:pid). */
  readonly instanceId: string;

  /**
   * Register a connection in the room's global presence and publish joined to other instances.
   */
  joinRoom(roomId: string, entry: PresenceEntry): Promise<void>;

  /**
   * Remove a connection from global presence and publish left to other instances.
   */
  leaveRoom(roomId: string, connectionId: string): Promise<void>;

  /**
   * Update presence for a connection and publish update to other instances.
   */
  updatePresence(roomId: string, entry: PresenceEntry): Promise<void>;

  /**
   * Return the full presence map for the room across all instances.
   * Keys are connection ids (for remote members, a stable global id such as instanceId:connectionId).
   */
  getGlobalPresence(roomId: string): Promise<Record<string, PresenceEntry>>;

  /**
   * Publish a server message to the room so other instances can relay to their clients.
   * The adapter may add instanceId so subscribers can ignore messages from self.
   */
  publish(roomId: string, message: ServerMessage): Promise<void>;

  /**
   * Subscribe to messages for the room from other instances. Handler receives messages
   * that should be relayed to local connections (adapter should not deliver own messages).
   */
  subscribe(roomId: string, handler: (message: ServerMessage) => void): Promise<void>;

  /**
   * Unsubscribe from the room's channel (e.g. when last local connection leaves).
   */
  unsubscribe(roomId: string): Promise<void>;

  /**
   * Publish binary data (Yjs updates) to the room so other instances can relay to their clients.
   * Optional: only needed when Yjs is enabled in a multi-instance setup.
   */
  publishBinary?(roomId: string, data: Uint8Array): Promise<void>;

  /**
   * Subscribe to binary data for the room from other instances.
   * Optional: only needed when Yjs is enabled in a multi-instance setup.
   */
  subscribeBinary?(roomId: string, handler: (data: Uint8Array) => void): Promise<void>;

  /** Optional: close connections and release resources. */
  close?(): Promise<void>;
}
