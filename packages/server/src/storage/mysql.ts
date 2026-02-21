/**
 * MySQL chat storage. Requires optional peer dependency: mysql2
 * Install with: npm install mysql2
 */

import type { ChatMessageInput, StoredChatMessage } from "../protocol.js";
import type { ChatStorage } from "./chat-storage.js";

export interface MySQLChatStorageOptions {
  tableName?: string;
  historyLimit?: number;
}

const DEFAULT_TABLE = "openlivesync_chat";

export interface MySQLConnectionConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  [key: string]: unknown;
}

export async function createMySQLChatStorage(
  connectionConfig: MySQLConnectionConfig,
  options: MySQLChatStorageOptions = {}
): Promise<ChatStorage> {
  let createPool: typeof import("mysql2/promise").createPool;
  try {
    const mysql = await import("mysql2/promise");
    createPool = mysql.createPool;
  } catch {
    throw new Error(
      'MySQL storage requires the "mysql2" package. Install it with: npm install mysql2'
    );
  }

  const pool = createPool(connectionConfig);
  const tableName = options.tableName ?? DEFAULT_TABLE;

  const init = async (): Promise<void> => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS \`${tableName}\` (
        id VARCHAR(64) PRIMARY KEY,
        room_id VARCHAR(255) NOT NULL,
        connection_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255),
        message TEXT NOT NULL,
        metadata JSON,
        created_at BIGINT NOT NULL,
        INDEX idx_room_created (room_id, created_at)
      )
    `);
  };
  await init();

  return {
    async append(roomId: string, message: ChatMessageInput): Promise<void> {
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const createdAt = Date.now();
      await pool.query(
        `INSERT INTO \`${tableName}\` (id, room_id, connection_id, user_id, message, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          roomId,
          message.connectionId,
          message.userId ?? null,
          message.message,
          message.metadata ? JSON.stringify(message.metadata) : null,
          createdAt,
        ]
      );
    },

    async getHistory(
      roomId: string,
      limit: number = (options.historyLimit ?? 100),
      offset: number = 0
    ): Promise<StoredChatMessage[]> {
      const [rows] = await pool.query<
        Array<{
          id: string;
          room_id: string;
          connection_id: string;
          user_id: string | null;
          message: string;
          metadata: string | null;
          created_at: number | string;
        }>
      >(
        `SELECT id, room_id, connection_id, user_id, message, metadata, created_at
         FROM \`${tableName}\`
         WHERE room_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [roomId, limit, offset]
      );
      const list = Array.isArray(rows) ? rows : [];
      return list
        .map((r) => ({
          id: r.id,
          roomId: r.room_id,
          connectionId: r.connection_id,
          userId: r.user_id ?? undefined,
          message: r.message,
          metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
          createdAt: Number(r.created_at),
        }))
        .reverse();
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
