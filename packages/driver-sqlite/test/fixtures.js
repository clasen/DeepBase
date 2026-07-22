import Database from 'better-sqlite3';

export function createLegacyDatabase(fileName, rows) {
  const db = new Database(fileName);
  db.exec('CREATE TABLE deepbase (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO deepbase (key, value) VALUES (?, ?)');
  const insertRows = db.transaction((entries) => {
    for (const [key, value] of entries) {
      insert.run(key, JSON.stringify(value));
    }
  });
  insertRows(rows);
  db.close();
}

export function createSequencedDatabase(fileName, rows, { failMigration = false } = {}) {
  const db = new Database(fileName);
  db.exec(`
    CREATE TABLE deepbase (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0
    )
  `);
  const insert = db.prepare('INSERT INTO deepbase (key, value, seq) VALUES (?, ?, ?)');
  const insertRows = db.transaction((entries) => {
    for (const [key, value, seq] of entries) {
      insert.run(key, JSON.stringify(value), seq);
    }
  });
  insertRows(rows);

  if (failMigration) {
    db.exec(`
      CREATE TRIGGER fail_seq_migration
      BEFORE UPDATE OF seq ON deepbase
      BEGIN
        SELECT RAISE(ABORT, 'forced migration failure');
      END
    `);
  }
  db.close();
}

export function inspectDatabase(fileName) {
  const db = new Database(fileName);
  const rows = db.prepare('SELECT key, seq FROM deepbase ORDER BY seq, key').all();
  const indexes = db.prepare("PRAGMA index_list('deepbase')").all();
  const metaTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deepbase_meta'",
  ).get();
  const schemaVersion = metaTable
    ? db.prepare("SELECT value FROM deepbase_meta WHERE key = 'schema_version'").get()?.value
    : undefined;
  db.close();
  return { rows, indexes, schemaVersion };
}
