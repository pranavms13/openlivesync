/**
 * Postgres chat storage. Requires optional peer dependency: pg
 * Install with: npm install pg
 */

import type { ChatMessageInput, StoredChatMessage } from "../protocol.js";
import type { ChatStorage } from "./chat-storage.js";

export interface PostgresChatStorageOptions {
  tableName?: string;
  historyLimit?: number;
}

const DEFAULT_TABLE = "openlivesync_chat";

export type PostgresConnectionConfig =
  | { connectionString: string }
  | {
      host?: string;
      port?: number;
      database?: string;
      user?: string;
      password?: string;
      [key: string]: unknown;
    };

export async function createPostgresChatStorage(
  connectionConfig: PostgresConnectionConfig,
  options: PostgresChatStorageOptions = {}
): Promise<ChatStorage> {
  let Pool: typeof import("pg").Pool;
  try {
    const pg = await import("pg");
    Pool = pg.Pool;
  } catch {
    throw new Error(
      'Postgres storage requires the "pg" package. Install it with: npm install pg'
    );
  }

  const pool = new Pool(connectionConfig as import("pg").PoolConfig);
  const tableName = options.tableName ?? DEFAULT_TABLE;

  const init = async (): Promise<void> => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        user_id TEXT,
        message TEXT NOT NULL,
        metadata JSONB,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${tableName.replace(/-/g, "_")}_room_created ON ${tableName}(room_id, created_at);
    `);
  };
  await init();

  return {
    async append(roomId: string, message: ChatMessageInput): Promise<void> {
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const createdAt = Date.now();
      await pool.query(
        `INSERT INTO ${tableName} (id, room_id, connection_id, user_id, message, metadata, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
      const result = await pool.query(
        `SELECT id, room_id AS "roomId", connection_id AS "connectionId", user_id AS "userId", message, metadata, created_at AS "createdAt"
         FROM ${tableName}
         WHERE room_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [roomId, limit, offset]
      );
      const rows = result.rows as Array<{
        id: string;
        roomId: string;
        connectionId: string;
        userId: string | null;
        message: string;
        metadata: string | null;
        createdAt: string;
      }>;
      return rows
        .map((r) => ({
          id: r.id,
          roomId: r.roomId,
          connectionId: r.connectionId,
          userId: r.userId ?? undefined,
          message: r.message,
          metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : undefined,
          createdAt: Number(r.createdAt),
        }))
        .reverse();
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
