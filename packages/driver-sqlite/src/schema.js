import { SQLITE_CONFIG } from './config.js';

const SCHEMA_VERSION_KEY = 'schema_version';

function createBaseSchema(db, withoutRowid) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deepbase (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0
    )${withoutRowid}
  `);

  const columns = db.prepare('PRAGMA table_info(deepbase)').all();
  if (!columns.some(column => column.name === 'seq')) {
    db.exec('ALTER TABLE deepbase ADD COLUMN seq INTEGER NOT NULL DEFAULT 0');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS deepbase_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    ) WITHOUT ROWID
  `);
}

function readSchemaVersion(db) {
  const row = db.prepare('SELECT value FROM deepbase_meta WHERE key = ?').get(SCHEMA_VERSION_KEY);
  return Number(row?.value ?? 0);
}

function normalizeSequence(db) {
  const nonPositive = db.prepare('SELECT 1 FROM deepbase WHERE seq < 1 LIMIT 1').get();
  const needsNormalization = nonPositive || db.prepare(`
      SELECT 1
      FROM deepbase
      GROUP BY seq
      HAVING COUNT(*) > 1
      LIMIT 1
    `).get();
  if (!needsNormalization) return;

  const rows = db.prepare('SELECT key FROM deepbase ORDER BY seq, key').all();
  const update = db.prepare('UPDATE deepbase SET seq = ? WHERE key = ?');

  rows.forEach((row, index) => {
    update.run(index + 1, row.key);
  });
}

function writeSchemaVersion(db) {
  db.prepare(`
    INSERT INTO deepbase_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(SCHEMA_VERSION_KEY, SQLITE_CONFIG.schemaVersion);
}

export function migrateSchema(db, { withoutRowid = '' } = {}) {
  const migration = db.transaction(() => {
    createBaseSchema(db, withoutRowid);

    const version = readSchemaVersion(db);
    if (version > SQLITE_CONFIG.schemaVersion) {
      throw new Error(
        `deepbase-sqlite schema version ${version} is newer than supported version ${SQLITE_CONFIG.schemaVersion}`,
      );
    }

    if (version < SQLITE_CONFIG.schemaVersion) {
      normalizeSequence(db);
      writeSchemaVersion(db);
    }

    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS deepbase_seq_unique ON deepbase(seq)');
  });

  migration.immediate();
}
