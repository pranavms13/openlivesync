/**
 * Chat storage interface for pluggable persistence.
 * Implementations: in-memory, Postgres, MySQL, SQLite.
 */

import type { ChatMessageInput, StoredChatMessage } from "../protocol.js";

export type { ChatMessageInput };

/**
 * Pluggable chat storage. Pass an implementation into server options
 * via chat.storage. Omit to use default in-memory storage.
 */
export interface ChatStorage {
  /** Append a message to the room's history. */
  append(roomId: string, message: ChatMessageInput): Promise<void>;

  /** Get messages for a room. Order: oldest first. Use limit and optional offset for pagination. */
  getHistory(roomId: string, limit?: number, offset?: number): Promise<StoredChatMessage[]>;

  /** Optional: release connections / cleanup. */
  close?(): Promise<void>;
}
