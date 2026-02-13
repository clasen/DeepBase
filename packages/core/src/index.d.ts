export interface DeepBaseDriverOptions {
    nidAlphabet?: string;
    nidLength?: number;
    [key: string]: any;
}

export class DeepBaseDriver {
    constructor(options?: DeepBaseDriverOptions);

    opts: Record<string, any>;
    nidAlphabet: string;
    nidLength: number;
    nanoid: () => string;
    _connected: boolean;

    connect(): Promise<void>;
    disconnect(): Promise<void>;

    get(...args: any[]): Promise<any>;
    set(...args: any[]): Promise<any>;
    del(...args: any[]): Promise<any>;
    inc(...args: any[]): Promise<any>;
    dec(...args: any[]): Promise<any>;
    add(...args: any[]): Promise<string[]>;
    upd(...args: any[]): Promise<any>;
    pop(...args: any[]): Promise<any>;
    shift(...args: any[]): Promise<any>;

    keys(...args: any[]): Promise<string[]>;
    values(...args: any[]): Promise<any[]>;
    entries(...args: any[]): Promise<[string, any][]>;
    len(...args: any[]): Promise<number>;

    protected _escapeDots(str: string): string;
    protected _unescapeDots(str: string): string;
    protected _pathToKey(path: string[]): string;
    protected _keyToPath(key: string): string[];
}

export interface DeepBaseOptions {
    writeAll?: boolean;
    readFirst?: boolean;
    failOnPrimaryError?: boolean;
    lazyConnect?: boolean;
    timeout?: number;
    readTimeout?: number;
    writeTimeout?: number;
    connectTimeout?: number;
    [key: string]: any;
}

export interface ConnectResult {
    connected: number;
    total: number;
}

export interface MigrateOptions {
    clear?: boolean;
    batchSize?: number;
    onProgress?: (progress: { migrated: number; errors: number; current: string }) => void;
    [key: string]: any;
}

export interface MigrateResult {
    migrated: number;
    errors: number;
}

export interface SyncResult extends MigrateResult {
    driverIndex: number;
}

export class DeepBase {
    constructor(drivers?: DeepBaseDriver | DeepBaseDriver[], options?: DeepBaseOptions);
    constructor(jsonDriverOptions?: Record<string, any>);

    drivers: DeepBaseDriver[];
    opts: DeepBaseOptions;

    connect(): Promise<ConnectResult>;
    disconnect(): Promise<void>;

    get(...args: any[]): Promise<any>;
    set(...args: any[]): Promise<any>;
    del(...args: any[]): Promise<any>;
    inc(...args: any[]): Promise<any>;
    dec(...args: any[]): Promise<any>;
    add(...args: any[]): Promise<string[]>;
    upd(...args: any[]): Promise<any>;
    pop(...args: any[]): Promise<any>;
    shift(...args: any[]): Promise<any>;

    keys(...args: any[]): Promise<string[]>;
    values(...args: any[]): Promise<any[]>;
    entries(...args: any[]): Promise<[string, any][]>;
    len(...args: any[]): Promise<number>;

    migrate(fromIndex?: number, toIndex?: number, opts?: MigrateOptions): Promise<MigrateResult>;
    syncAll(opts?: MigrateOptions): Promise<SyncResult[]>;

    getDriver(index?: number): DeepBaseDriver;
    getDrivers(): DeepBaseDriver[];
}

export default DeepBase;
