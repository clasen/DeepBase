import { DeepBaseDriver, DeepBaseDriverOptions } from 'deepbase';

export interface RedisDriverOptions extends DeepBaseDriverOptions {
    name?: string;
    prefix?: string;
    url?: string;
}

export class RedisDriver extends DeepBaseDriver {
    constructor(options?: RedisDriverOptions);

    name: string;
    url: string;
}

export default RedisDriver;
