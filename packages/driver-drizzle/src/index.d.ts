import { DeepBaseDriver, DeepBaseDriverOptions } from 'deepbase';

/** Table shape expected by DrizzleDriver (column objects from drizzle-orm). */
export interface DeepbaseDrizzleTable {
  key: unknown;
  value: unknown;
  seq: unknown;
}

export interface DrizzleDriverOptions extends DeepBaseDriverOptions {
  /** Drizzle database instance from your dialect (e.g. drizzle-orm/better-sqlite3, node-postgres, …). */
  db: object;
  /**
   * Optional table with primary key `key`, JSON/text `value`, integer `seq` (insert order).
   * When omitted, DrizzleDriver infers a default schema from the db dialect.
   */
  table?: DeepbaseDrizzleTable;
  /** Table name used only when `table` is omitted (default: `deepbase_main`). */
  tableName?: string;
  /** Optional native client; if it has `.close()`, used on disconnect() unless onDisconnect is set. */
  client?: object;
  onDisconnect?: () => void | Promise<void>;
  /** If set, disconnect() clears db/client; connect() calls this to obtain a new session (e.g. reopen file DB). */
  reopen?: () => { db: object; client?: object } | Promise<{ db: object; client?: object }>;
  /**
   * Table bootstrap behavior:
   * - true (default): auto-create table (`key`, `value`, `seq`) if missing
   * - false: skip automatic table creation
   * - function: custom per-dialect bootstrap callback
   */
  ensureTable?: boolean | ((ctx: { db: object; table: DeepbaseDrizzleTable; dialect: string }) => void | Promise<void>);
}

export class DrizzleDriver extends DeepBaseDriver {
  constructor(options: DrizzleDriverOptions);

  drizzle: object | null;
  table: DeepbaseDrizzleTable;
  client: object | null;
  onDisconnect: (() => void | Promise<void>) | null;
  reopen: DrizzleDriverOptions['reopen'] | null;
  ensureTable: DrizzleDriverOptions['ensureTable'];
}

export default DrizzleDriver;
