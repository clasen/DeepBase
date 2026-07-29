import Database from 'better-sqlite3';
import fs from 'fs';
import * as pathModule from 'path';

const CHECKPOINT_MODES = ['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'];

function checkIntegrity(db) {
  return db.pragma('integrity_check', { simple: true });
}

function openReadonly(fileName, timeout) {
  return new Database(fileName, {
    readonly: true,
    fileMustExist: true,
    timeout,
  });
}

export function checkIntegrityAt(fileName, timeout) {
  const db = openReadonly(fileName, timeout);
  try {
    return checkIntegrity(db);
  } finally {
    db.close();
  }
}

export async function backupFrom(fileName, destination, timeout) {
  const source = openReadonly(fileName, timeout);
  try {
    fs.mkdirSync(pathModule.dirname(pathModule.resolve(destination)), { recursive: true });
    await source.backup(destination);
  } finally {
    source.close();
  }

  const status = checkIntegrityAt(destination, timeout);
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
