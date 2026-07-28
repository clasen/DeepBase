import { DeepBaseDriver, DeepBaseDriverOptions } from 'deepbase';

export interface SqliteBusyRetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
}

export type SqliteCheckpointMode = 'PASSIVE' | 'FULL' | 'RESTART' | 'TRUNCATE';

export interface SqliteCheckpointResult {
    /** `1` when readers or writers prevented the checkpoint from completing. */
    busy: number;
    /** Pages in the WAL file. */
    log: number;
    /** Pages moved into the database file. */
    checkpointed: number;
}

export interface SqliteDriverOptions extends DeepBaseDriverOptions {
    name?: string;
    path?: string;
    pragma?: 'none' | 'safe' | 'balanced' | 'fast';
    busyTimeoutMs?: number;
    busyRetry?: SqliteBusyRetryOptions;
}

export class SqliteDriver extends DeepBaseDriver {
    constructor(options?: SqliteDriverOptions);

    name: string;
    path: string;
    fileName: string;
    pragma: string;
    busyTimeoutMs: number;
    busyRetry: Required<SqliteBusyRetryOptions>;

    /** Runs `PRAGMA integrity_check` and returns its status: `'ok'` when the
     *  database is sound, otherwise SQLite's description of the damage. */
    checkIntegrity(): Promise<string>;

    /**
     * Writes an online backup to `destination`, creating parent directories as
     * needed, then verifies the copy with `integrity_check`. Resolves with
     * `destination`, or rejects with code `DEEPBASE_SQLITE_BACKUP_CORRUPT` when
     * the copy does not verify.
     */
    backup(destination: string): Promise<string>;

    /** Rebuilds the database file to reclaim free pages. Takes the write lock. */
    vacuum(): Promise<void>;

    /**
     * Runs `PRAGMA wal_checkpoint`. Rejects with code `DEEPBASE_SQLITE_NOT_WAL`
     * when the database uses a rollback journal (`pragma: 'none'`).
     */
    checkpoint(mode?: SqliteCheckpointMode): Promise<SqliteCheckpointResult>;
}

export { SqliteDriver as SqliteFastDriver };
export default SqliteDriver;
