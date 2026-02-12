import { DeepBaseDriver, DeepBaseDriverOptions } from 'deepbase';

export interface MongoDriverOptions extends DeepBaseDriverOptions {
    base?: string;
    database?: string;
    name?: string;
    collection?: string;
    url?: string;
}

export class MongoDriver extends DeepBaseDriver {
    constructor(options?: MongoDriverOptions);

    base: string;
    name: string;
    url: string;
}

export default MongoDriver;
