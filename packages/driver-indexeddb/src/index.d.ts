import { DeepBaseDriver, DeepBaseDriverOptions } from 'deepbase';

export interface IndexedDBDriverOptions extends DeepBaseDriverOptions {
    name?: string;
    version?: number;
    storeName?: string;
}

export class IndexedDBDriver extends DeepBaseDriver {
    constructor(options?: IndexedDBDriverOptions);

    name: string;
    version: number;
    storeName: string;
}

export default IndexedDBDriver;
