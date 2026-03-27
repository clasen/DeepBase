/**
 * SQLite + better-sqlite3 + drizzle-orm/better-sqlite3 setup for tests and monorepo benchmarks only.
 * The published driver does not depend on SQLite.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'fs';
import * as pathModule from 'path';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { DrizzleDriver } from '../src/DrizzleDriver.js';

export const deepbaseTable = sqliteTable('deepbase', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  seq: integer('seq').notNull().default(0),
});

const PRAGMA = {
  none: null,
  safe: {
    journal_mode: 'WAL',
    synchronous: 'FULL',
    temp_store: 'MEMORY',
    cache_size: -2000,
    busy_timeout: 5000,
    mmap_size: 0,
  },
  balanced: {
    journal_mode: 'WAL',
    synchronous: 'NORMAL',
    temp_store: 'MEMORY',
    cache_size: -8000,
    busy_timeout: 5000,
    mmap_size: 268435456,
  },
  fast: {
    journal_mode: 'WAL',
    synchronous: 'OFF',
    temp_store: 'MEMORY',
    cache_size: -16000,
    busy_timeout: 5000,
    mmap_size: 268435456,
  },
};

function applyPragma(sqlite, pragma) {
  const cfg = PRAGMA[pragma];
  if (!cfg) return null;
  sqlite.pragma(`journal_mode = ${cfg.journal_mode}`);
  sqlite.pragma(`synchronous = ${cfg.synchronous}`);
  sqlite.pragma(`temp_store = ${cfg.temp_store}`);
  sqlite.pragma(`cache_size = ${cfg.cache_size}`);
  sqlite.pragma(`busy_timeout = ${cfg.busy_timeout}`);
  sqlite.pragma(`mmap_size = ${cfg.mmap_size}`);
  return cfg;
}

function ensureSchema(sqlite, pragma) {
  const cfg = applyPragma(sqlite, pragma);
  const withoutRowid = cfg ? ' WITHOUT ROWID' : '';
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS deepbase (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0
    )${withoutRowid}
  `);
  const tableCols = sqlite.prepare('PRAGMA table_info(deepbase)').all();
  if (!tableCols.some((c) => c.name === 'seq')) {
    sqlite.exec('ALTER TABLE deepbase ADD COLUMN seq INTEGER NOT NULL DEFAULT 0');
  }
}

/**
 * Returns a factory that opens the same file-backed DB (for DrizzleDriver.reopen).
 */
function makeReopen(opts) {
  const { name, path: dir, pragma = 'balanced' } = opts;
  return function reopen() {
    const resolved = pathModule.resolve(dir);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    const fileName = pathModule.join(resolved, `${name}.db`);
    const sqlite = new Database(fileName);
    ensureSchema(sqlite, pragma);
    const db = drizzle({ client: sqlite });
    return { db, client: sqlite };
  };
}

/**
 * Opens a file-backed SQLite DB, ensures `deepbase` table, returns DrizzleDriver with reconnect support.
 * @param {{ name: string, path: string, pragma?: string }} opts
 */
export function createSqliteDrizzleDriver(opts) {
  const reopen = makeReopen(opts);
  const first = reopen();
  return new DrizzleDriver({
    db: first.db,
    table: deepbaseTable,
    client: first.client,
    reopen,
  });
}
