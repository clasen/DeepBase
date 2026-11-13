import { DatabaseSync } from 'node:sqlite';

export function createLegacyDatabase(fileName, rows) {
  const db = new DatabaseSync(fileName);
  db.exec('CREATE TABLE deepbase (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO deepbase (key, value) VALUES (?, ?)');
  db.exec('BEGIN');
  for (const [key, value] of rows) {
    insert.run(key, JSON.stringify(value));
  }
  db.exec('COMMIT');
  db.close();
}

export function createSequencedDatabase(fileName, rows) {
  const db = new DatabaseSync(fileName);
  db.exec(`
    CREATE TABLE deepbase (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0
    )
  `);
  const insert = db.prepare('INSERT INTO deepbase (key, value, seq) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  for (const [key, value, seq] of rows) {
    insert.run(key, JSON.stringify(value), seq);
  }
  db.exec('COMMIT');
  db.close();
}

export function inspectDatabase(fileName) {
  const db = new DatabaseSync(fileName);
  // node:sqlite rows have a null prototype; spread them into plain objects.
  const rows = db.prepare('SELECT key, seq FROM deepbase ORDER BY seq, key').all().map(row => ({ ...row }));
  const indexes = db.prepare("PRAGMA index_list('deepbase')").all().map(row => ({ ...row }));
  db.close();
  return { rows, indexes };
}
