import { DeepBaseDriver, DeepBaseDriverOptions } from 'deepbase';

export interface SqliteBusyRetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
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
}

export { SqliteDriver as SqliteFastDriver };
export default SqliteDriver;
