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
  /** Table with primary key `key`, JSON/text `value`, integer `seq` (insert order). */
  table: DeepbaseDrizzleTable;
  /** Optional native client; if it has `.close()`, used on disconnect() unless onDisconnect is set. */
  client?: object;
  onDisconnect?: () => void | Promise<void>;
  /** If set, disconnect() clears db/client; connect() calls this to obtain a new session (e.g. reopen file DB). */
  reopen?: () => { db: object; client?: object } | Promise<{ db: object; client?: object }>;
}

export class DrizzleDriver extends DeepBaseDriver {
  constructor(options: DrizzleDriverOptions);

  drizzle: object | null;
  table: DeepbaseDrizzleTable;
  client: object | null;
  onDisconnect: (() => void | Promise<void>) | null;
  reopen: DrizzleDriverOptions['reopen'] | null;
}

export default DrizzleDriver;
