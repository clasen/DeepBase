/**
 * Example 14: DeepBase + Drizzle ORM + SQLite (better-sqlite3)
 *
 * You bring your own Drizzle `db` and table schema; this mirrors what `deepbase-drizzle` expects.
 * Run from repo root: npm run example14
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import DeepBase from '../packages/core/src/index.js';
import DrizzleDriver from '../packages/driver-drizzle/src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');

/** Table layout required by DrizzleDriver (see deepbase-drizzle README). */
const deepbase = sqliteTable('deepbase', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  seq: integer('seq').notNull().default(0),
});

function openSession() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const filePath = path.join(dataDir, 'example-drizzle.db');
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS deepbase (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0
    )
  `);
  const cols = sqlite.prepare('PRAGMA table_info(deepbase)').all();
  if (!cols.some((c) => c.name === 'seq')) {
    sqlite.exec('ALTER TABLE deepbase ADD COLUMN seq INTEGER NOT NULL DEFAULT 0');
  }

  const db = drizzle({ client: sqlite });
  return { db, client: sqlite, filePath };
}

async function main() {
  console.log('🌳 DeepBase Example 14: Drizzle ORM + SQLite\n');

  const reopen = () => {
    const { db, client } = openSession();
    return { db, client };
  };

  const first = openSession();
  console.log(`📁 Database file: ${first.filePath}\n`);

  const store = new DeepBase(
    new DrizzleDriver({
      db: first.db,
      table: deepbase,
      client: first.client,
      reopen,
    }),
  );

  await store.connect();
  console.log('✅ Connected\n');

  await store.set('config', 'theme', 'dark');
  await store.set('user', 'demo', { name: 'Ada', role: 'admin' });

  console.log('config.theme =', await store.get('config', 'theme'));
  console.log('user.demo     =', await store.get('user', 'demo'));

  await store.disconnect();
  console.log('\n✅ Disconnected (SQLite file kept under examples/data/)');
}

main().catch(console.error);
