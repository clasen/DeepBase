import { DeepBaseDriver, DeepBaseDriverOptions } from 'deepbase';

export interface SqliteDriverOptions extends DeepBaseDriverOptions {
    name?: string;
    path?: string;
    pragma?: 'none' | 'safe' | 'balanced' | 'fast';
}

export class SqliteDriver extends DeepBaseDriver {
    constructor(options?: SqliteDriverOptions);

    name: string;
    path: string;
    fileName: string;
    pragma: string;
}

export { SqliteDriver as SqliteFastDriver };
export default SqliteDriver;
