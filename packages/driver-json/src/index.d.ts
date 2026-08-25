import { DeepBaseDriver, DeepBaseDriverOptions, DisposeOptions } from 'deepbase';

export type MemoryTransform = (value: unknown, path: string[]) => unknown;

export interface JsonDriverOptions extends DeepBaseDriverOptions {
    name?: string;
    /** Required absolute storage directory. */
    path: string;
    stringify?: (obj: any) => string;
    parse?: (str: string) => any;
    /** Enable cross-process file locking for safe multi-process access */
    multiProcess?: boolean;
    /** Transform a defensive copy before it enters the in-memory cache */
    encodeForMemory?: MemoryTransform;
    /** Transform a defensive copy when it leaves the in-memory cache */
    decodeFromMemory?: MemoryTransform;
}

export class JsonDriver extends DeepBaseDriver {
    constructor(options: JsonDriverOptions);

    name: string;
    path: string;
    fileName: string;
    stringify: (obj: any) => string;
    parse: (str: string) => any;
    encodeForMemory: MemoryTransform;
    decodeFromMemory: MemoryTransform;
    obj: unknown;

    dispose(options?: DisposeOptions): Promise<void>;
}

export default JsonDriver;
