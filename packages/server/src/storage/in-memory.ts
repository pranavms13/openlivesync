/**
 * In-memory chat storage. Keeps last N messages per room.
 * No DB required; default when no storage is configured.
 */

import type { ChatMessageInput, StoredChatMessage } from "../protocol.js";
import type { ChatStorage } from "./chat-storage.js";

export interface InMemoryChatStorageOptions {
  /** Max messages to keep per room (default 100). */
  historyLimit?: number;
}

const DEFAULT_HISTORY_LIMIT = 100;

export function createInMemoryChatStorage(
  options: InMemoryChatStorageOptions = {}
): ChatStorage {
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const store = new Map<string, StoredChatMessage[]>();
  let idCounter = 0;

  return {
    async append(roomId: string, message: ChatMessageInput): Promise<void> {
      const list = store.get(roomId) ?? [];
      const stored: StoredChatMessage = {
        id: `msg_${++idCounter}_${Date.now()}`,
        roomId,
        connectionId: message.connectionId,
        userId: message.userId,
        message: message.message,
        metadata: message.metadata,
        createdAt: Date.now(),
      };
      list.push(stored);
      if (list.length > historyLimit) {
        list.splice(0, list.length - historyLimit);
      }
      store.set(roomId, list);
    },

    async getHistory(
      roomId: string,
      limit: number = historyLimit,
      offset: number = 0
    ): Promise<StoredChatMessage[]> {
      const list = store.get(roomId) ?? [];
      const start = Math.max(0, offset);
      return list.slice(start, start + limit);
    },
  };
}
