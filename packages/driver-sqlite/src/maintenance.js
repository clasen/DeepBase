import Database from 'better-sqlite3';
import fs from 'fs';
import * as pathModule from 'path';

const CHECKPOINT_MODES = ['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'];

export function checkIntegrity(db) {
  return db.pragma('integrity_check', { simple: true });
}

export async function backupTo(db, destination) {
  fs.mkdirSync(pathModule.dirname(pathModule.resolve(destination)), { recursive: true });

  await db.backup(destination);

  const copy = new Database(destination, { readonly: true });
  let status;
  try {
    status = checkIntegrity(copy);
  } finally {
    copy.close();
  }

  if (status !== 'ok') {
    const error = new Error(
      `deepbase-sqlite: backup verification failed for ${destination}: ${status}. ` +
      'The corrupt file was left in place for inspection; do not restore from it.',
    );
    error.code = 'DEEPBASE_SQLITE_BACKUP_CORRUPT';
    throw error;
  }

  return destination;
}

export function vacuum(db) {
  db.exec('VACUUM');
}

export function checkpoint(db, mode) {
  if (!CHECKPOINT_MODES.includes(mode)) {
    throw new TypeError(
      `deepbase-sqlite: checkpoint mode must be one of ${CHECKPOINT_MODES.join(', ')}; received ${mode}`,
    );
  }

  if (db.pragma('journal_mode', { simple: true }) !== 'wal') {
    const error = new Error(
      "deepbase-sqlite: checkpoint requires journal_mode=WAL. Databases opened with pragma: 'none' " +
      'use a rollback journal and have no WAL to checkpoint.',
    );
    error.code = 'DEEPBASE_SQLITE_NOT_WAL';
    throw error;
  }

  const [result] = db.pragma(`wal_checkpoint(${mode})`);
  return result;
}
