import { DeepBaseDriver, DeepBaseDriverOptions } from 'deepbase';

export interface JsonDriverOptions extends DeepBaseDriverOptions {
    name?: string;
    path?: string;
    stringify?: (obj: any) => string;
    parse?: (str: string) => any;
}

export class JsonDriver extends DeepBaseDriver {
    constructor(options?: JsonDriverOptions);

    name: string;
    path: string;
    fileName: string;
    stringify: (obj: any) => string;
    parse: (str: string) => any;
    obj: Record<string, any>;
}

export default JsonDriver;
