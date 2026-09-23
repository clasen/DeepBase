export interface DeepBaseDriverOptions {
    nidAlphabet?: string;
    nidLength?: number;
    [key: string]: any;
}

export interface DisposeOptions {
    clearMemory?: boolean;
    releaseInstance?: boolean;
}

export type DeepBasePluginKind = 'read' | 'write';

export interface DeepBasePluginContext {
    readonly db: DeepBase;
    readonly operation: string;
    readonly kind: DeepBasePluginKind;
    readonly args: any[];
    readonly sync: boolean;
}

export interface DeepBasePluginNextOptions {
    operation?: string;
    args?: any[];
}

export type DeepBasePluginNext = (options?: DeepBasePluginNextOptions) => Promise<any>;
export type DeepBasePluginNextSync = (options?: DeepBasePluginNextOptions) => any;

export interface DeepBasePlugin {
    name: string;
    setup?(db: DeepBase): void;
    execute?(context: DeepBasePluginContext, next: DeepBasePluginNext): any | Promise<any>;
    executeSync?(context: DeepBasePluginContext, next: DeepBasePluginNextSync): any;
    dispose?(db: DeepBase): void | Promise<void>;
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

/**
 * Remove one key from an object or an array. Array indices are spliced so the
 * array shrinks, matching `pop()` / `shift()`; a key that does not exist is
 * left untouched. Drivers use this for `del()`.
 * @returns True when something was removed
 */
export function removeKey(target: any, key: string | number): boolean;

export type DeepBaseQueryOperator = '=' | '==' | '!=' | '<>' | '>' | '>=' | '<' | '<=' | 'in';
export type DeepBaseQueryDirection = 'asc' | 'desc';
export type DeepBaseQueryField = string | string[];

export interface DeepBaseQueryWhereStep {
    type: 'where';
    field: string[];
    operator: DeepBaseQueryOperator;
    value: any;
}

export interface DeepBaseQueryOrderByStep {
    type: 'orderBy';
    field: string[];
    direction: DeepBaseQueryDirection;
}

export interface DeepBaseQuerySkipStep {
    type: 'skip';
    count: number;
}

export interface DeepBaseQueryTakeStep {
    type: 'take';
    count: number;
}

export interface DeepBaseQuerySelectStep {
    type: 'select';
    fields: string[][];
}

export type DeepBaseQueryStep =
    | DeepBaseQueryWhereStep
    | DeepBaseQueryOrderByStep
    | DeepBaseQuerySkipStep
    | DeepBaseQueryTakeStep
    | DeepBaseQuerySelectStep;

export interface DeepBaseQueryRecord<T = any> {
    id: string;
    value: T;
}

/**
 * Turn the value stored at a path into records and apply the query steps in
 * chain order. Shared evaluator: drivers read the value from their own storage
 * and delegate to this function.
 */
export function evaluateQuery<T = any>(
    collection: unknown,
    steps?: DeepBaseQueryStep[],
    options?: { path?: Array<string | number> },
): DeepBaseQueryRecord<T>[];

/**
 * Translate a leading run of `skip()`/`take()` steps into an offset/limit
 * window. `limit` is `null` when the run leaves the result unbounded. Drivers
 * that can address a sub-range of their storage read only that window and then
 * evaluate `rest` in memory.
 */
export function resolveQueryWindow(steps: DeepBaseQueryStep[]): {
    offset: number;
    limit: number | null;
    rest: DeepBaseQueryStep[];
} | null;

/** Chainable query. Building the chain performs no I/O. */
export class DeepBaseQuery<T = any> {
    constructor(db: DeepBase, path?: Array<string | number>);

    where(field: DeepBaseQueryField, operator: DeepBaseQueryOperator, value: any): this;
    orderBy(field: DeepBaseQueryField, direction?: DeepBaseQueryDirection): this;
    skip(count: number): this;
    take(count: number): this;
    select(field: DeepBaseQueryField, ...fields: DeepBaseQueryField[]): this;

    toArray(): Promise<DeepBaseQueryRecord<T>[]>;
    first(): Promise<DeepBaseQueryRecord<T> | null>;
    count(): Promise<number>;
    any(): Promise<boolean>;
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
    /** Drivers override this; the base class reports that query() is unsupported. */
    query(path: Array<string | number>, steps: DeepBaseQueryStep[]): Promise<DeepBaseQueryRecord[]>;
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
    constructor(drivers: DeepBaseDriver | DeepBaseDriver[], options?: DeepBaseOptions);
    constructor(jsonDriverOptions: {
        /** Required absolute storage directory for the implicit JSON driver. */
        path: string;
        [key: string]: any;
    });

    drivers: DeepBaseDriver[];
    opts: DeepBaseOptions;
    schema: DeepBaseSchemaDefinition | null;

    use(plugin: DeepBasePlugin): this;

    connect(): Promise<ConnectResult>;
    disconnect(): Promise<void>;
    dispose(options?: DisposeOptions): Promise<void>;

    get(...args: any[]): Promise<any>;
    getSync(...args: any[]): any;
    query(...path: (string | number)[]): DeepBaseQuery;
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
