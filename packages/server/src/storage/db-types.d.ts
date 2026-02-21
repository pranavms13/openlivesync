/**
 * Minimal type declarations for optional DB drivers.
 * Install pg / mysql2 / better-sqlite3 only when using those adapters.
 */
declare module "pg" {
  export interface PoolConfig {
    connectionString?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    [key: string]: unknown;
  }
  export class Pool {
    constructor(config?: PoolConfig);
    query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
    end(): Promise<void>;
  }
}

declare module "mysql2/promise" {
  export function createPool(config: Record<string, unknown>): {
    query<T>(sql: string, values?: unknown[]): Promise<[T]>;
    end(): Promise<void>;
  };
}

declare module "better-sqlite3" {
  interface BetterSqlite3Database {
    exec(sql: string): this;
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
    close(): void;
  }
  interface DatabaseConstructor {
    new (filename: string, options?: Record<string, unknown>): BetterSqlite3Database;
  }
  const Database: DatabaseConstructor;
  export default Database;
}
