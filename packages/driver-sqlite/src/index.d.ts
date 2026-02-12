import { DeepBaseDriver, DeepBaseDriverOptions } from 'deepbase';

export interface SqliteDriverOptions extends DeepBaseDriverOptions {
    name?: string;
    path?: string;
}

export class SqliteDriver extends DeepBaseDriver {
    constructor(options?: SqliteDriverOptions);

    name: string;
    path: string;
    fileName: string;
}

export default SqliteDriver;
