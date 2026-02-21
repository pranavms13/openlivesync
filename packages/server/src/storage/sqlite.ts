/**
 * SQLite chat storage. Requires optional peer dependency: better-sqlite3
 * Install with: npm install better-sqlite3
 */

import { createRequire } from "node:module";
import type { ChatMessageInput, StoredChatMessage } from "../protocol.js";
import type { ChatStorage } from "./chat-storage.js";

const require = createRequire(import.meta.url);

export interface SQLiteChatStorageOptions {
  tableName?: string;
  historyLimit?: number;
}

const DEFAULT_TABLE = "openlivesync_chat";

export type SQLiteConnectionConfig = string | { filename: string; [key: string]: unknown };

export function createSQLiteChatStorage(
  connectionConfig: SQLiteConnectionConfig,
  options: SQLiteChatStorageOptions = {}
): ChatStorage {
  let Database: new (filename: string, options?: Record<string, unknown>) => {
    exec(sql: string): unknown;
    prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
    close(): void;
  };
  try {
    Database = require("better-sqlite3") as typeof Database;
  } catch {
    throw new Error(
      'SQLite storage requires the "better-sqlite3" package. Install it with: npm install better-sqlite3'
    );
  }

  const config =
    typeof connectionConfig === "string"
      ? { filename: connectionConfig }
      : connectionConfig;
  const db = new Database(config.filename as string);
  const tableName = options.tableName ?? DEFAULT_TABLE;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      user_id TEXT,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_${tableName.replace(/-/g, "_")}_room_created ON ${tableName}(room_id, created_at);
  `);

  const appendStmt = db.prepare(`
    INSERT INTO ${tableName} (id, room_id, connection_id, user_id, message, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  return {
    append(roomId: string, message: ChatMessageInput): Promise<void> {
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const createdAt = Date.now();
      appendStmt.run(
        id,
        roomId,
        message.connectionId,
        message.userId ?? null,
        message.message,
        message.metadata ? JSON.stringify(message.metadata) : null,
        createdAt
      );
      return Promise.resolve();
    },

    getHistory(
      roomId: string,
      limit: number = (options.historyLimit ?? 100),
      offset: number = 0
    ): Promise<StoredChatMessage[]> {
      const rows = db
        .prepare(
          `SELECT id, room_id AS roomId, connection_id AS connectionId, user_id AS userId, message, metadata, created_at AS createdAt
           FROM ${tableName}
           WHERE room_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
        )
        .all(roomId, limit, offset) as Array<{
        id: string;
        roomId: string;
        connectionId: string;
        userId: string | null;
        message: string;
        metadata: string | null;
        createdAt: number;
      }>;
      const result = rows
        .map((r) => ({
          id: r.id,
          roomId: r.roomId,
          connectionId: r.connectionId,
          userId: r.userId ?? undefined,
          message: r.message,
          metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
          createdAt: r.createdAt,
        }))
        .reverse();
      return Promise.resolve(result);
    },

    close(): Promise<void> {
      db.close();
      return Promise.resolve();
    },
  };
}
