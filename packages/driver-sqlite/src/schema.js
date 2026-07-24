export function ensureSchema(db, { withoutRowid = '' } = {}) {
  const setup = db.transaction(() => {
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

    db.exec('CREATE INDEX IF NOT EXISTS deepbase_seq_idx ON deepbase(seq)');
  });

  setup.immediate();
}
