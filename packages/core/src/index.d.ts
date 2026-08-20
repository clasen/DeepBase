export interface DeepBaseDriverOptions {
    nidAlphabet?: string;
    nidLength?: number;
    [key: string]: any;
}

export interface DisposeOptions {
    clearMemory?: boolean;
    releaseInstance?: boolean;
}

export type DeepBaseSchemaType = 'array' | 'boolean' | 'null' | 'number' | 'object' | 'string';
export type DeepBasePathSegment = string | number;

export interface DeepBaseSchemaField {
    type: DeepBaseSchemaType | DeepBaseSchemaType[];
    required?: boolean;
    ref?: string;
    properties?: Record<string, DeepBaseSchemaField>;
    items?: DeepBaseSchemaField;
}

export interface DeepBaseSchemaEntity {
    path: string[];
    additionalFields: boolean;
    fields: Record<string, DeepBaseSchemaField>;
}

export interface DeepBaseSchemaDefinition {
    entities: Record<string, DeepBaseSchemaEntity>;
}

export interface DeepBaseSchemaIssue {
    code: string;
    entity?: string;
    path: DeepBasePathSegment[];
    message: string;
    field?: string[];
    expected?: string | string[];
    actual?: string;
    targetEntity?: string;
    value?: unknown;
}

export class DeepBaseSchemaError extends Error {
    constructor(message: string, options?: {
        operation?: string | null;
        path?: DeepBasePathSegment[];
        issues?: DeepBaseSchemaIssue[];
        code?: string;
    });

    code: string;
    operation: string | null;
    path: DeepBasePathSegment[];
    issues: DeepBaseSchemaIssue[];
}

export interface DeepBaseSchemaRelation {
    from: { entity: string; field: string };
    to: { entity: string; parameter: string };
    candidate: boolean;
}

export interface DeepBaseSchemaDescriptionField {
    path: string[];
    type: DeepBaseSchemaType[];
    required: boolean;
    ref?: string;
    present: number;
    coverage: number;
}

export interface DeepBaseSchemaDescriptionEntity {
    name: string;
    path: string[];
    additionalFields: boolean;
    records: number;
    fields: DeepBaseSchemaDescriptionField[];
}

export interface DeepBaseSchemaWarning {
    code: string;
    path: string[];
    message: string;
}

export interface DeepBaseSchemaDescription {
    source: 'declared' | 'inferred';
    schema: DeepBaseSchemaDefinition;
    entities: DeepBaseSchemaDescriptionEntity[];
    relations: DeepBaseSchemaRelation[];
    warnings: DeepBaseSchemaWarning[];
}

export interface DeepBaseSchemaValidationResult {
    valid: boolean;
    errors: DeepBaseSchemaIssue[];
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
    dispose(options?: DisposeOptions): Promise<void>;

    get(...args: any[]): Promise<any>;
    getSync(...args: any[]): any;
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
    schema?: DeepBaseSchemaDefinition;
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
    schema: DeepBaseSchemaDefinition | null;

    connect(): Promise<ConnectResult>;
    disconnect(): Promise<void>;
    dispose(options?: DisposeOptions): Promise<void>;

    get(...args: any[]): Promise<any>;
    getSync(...args: any[]): any;
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

    describeSchema(): Promise<DeepBaseSchemaDescription>;
    validateSchema(): Promise<DeepBaseSchemaValidationResult>;
    schemaDiagram(): Promise<string>;

    migrate(fromIndex?: number, toIndex?: number, opts?: MigrateOptions): Promise<MigrateResult>;
    syncAll(opts?: MigrateOptions): Promise<SyncResult[]>;

    getDriver(index?: number): DeepBaseDriver;
    getDrivers(): DeepBaseDriver[];
}

export default DeepBase;
