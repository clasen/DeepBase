import sqlite from 'node:sqlite';
import fs from 'fs';
import * as pathModule from 'path';
import { pathToFileURL } from 'url';

const CHECKPOINT_MODES = ['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'];

function pragmaValue(db, pragma) {
  const row = db.prepare(`PRAGMA ${pragma}`).get();
  return row === undefined ? undefined : Object.values(row)[0];
}

function checkIntegrity(db) {
  return pragmaValue(db, 'integrity_check');
}

// mode=rw fails instead of creating a missing file. A readOnly connection would
// fit better, but Apple's system SQLite (used by Bun on macOS) cannot open a
// WAL database read-only once the last writer has removed its -shm file.
function openExisting(fileName, timeout) {
  return new sqlite.DatabaseSync(`${pathToFileURL(fileName).href}?mode=rw`, { timeout });
}

export function checkIntegrityAt(fileName, timeout) {
  const db = openExisting(fileName, timeout);
  try {
    return checkIntegrity(db);
  } finally {
    db.close();
  }
}

export async function backupFrom(fileName, destination, timeout) {
  const source = openExisting(fileName, timeout);
  try {
    fs.mkdirSync(pathModule.dirname(pathModule.resolve(destination)), { recursive: true });
    await sqlite.backup(source, destination);
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

  if (pragmaValue(db, 'journal_mode') !== 'wal') {
    const error = new Error(
      "deepbase-sqlite: checkpoint requires journal_mode=WAL. Databases opened with pragma: 'none' " +
      'use a rollback journal and have no WAL to checkpoint.',
    );
    error.code = 'DEEPBASE_SQLITE_NOT_WAL';
    throw error;
  }

  return { ...db.prepare(`PRAGMA wal_checkpoint(${mode})`).get() };
}
