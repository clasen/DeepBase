import type { DeepBase, DeepBasePathSegment, DeepBasePlugin, DeepBasePluginContext, DeepBasePluginNext, DeepBasePluginNextSync } from 'deepbase';

export interface ScryptParameters {
    /** CPU/memory cost, a power of two. Default 2 ** 17. */
    N?: number;
    /** Block size. Default 8. */
    r?: number;
    /** Parallelization. Default 1. */
    p?: number;
}

export interface PasswordEncryptionOptions {
    password: string | Uint8Array;
    kdf?: ScryptParameters;
    activeKeyId?: never;
    keys?: never;
}

export interface KeyringEncryptionOptions {
    activeKeyId: string;
    keys: Record<string, Uint8Array>;
    password?: never;
    kdf?: never;
}

export type EncryptedDocumentOptions = PasswordEncryptionOptions | KeyringEncryptionOptions;

export type DeepBaseEncryptionErrorCode =
    | 'ENCRYPTION_AUTHENTICATION_FAILED'
    | 'ENCRYPTION_DOCUMENT_MISSING'
    | 'ENCRYPTION_MALFORMED_DOCUMENT'
    | 'ENCRYPTION_OPERATION_UNSUPPORTED'
    | 'ENCRYPTION_PLUGIN_DISPOSED'
    | 'ENCRYPTION_SERIALIZATION_FAILED'
    | 'ENCRYPTION_UNKNOWN_KEY';

export class DeepBaseEncryptionError extends Error {
    code: DeepBaseEncryptionErrorCode;
    path: DeepBasePathSegment[];
    keyId: string | null;
}

export class EncryptionPlugin implements DeepBasePlugin {
    constructor(options: EncryptedDocumentOptions);
    readonly name: 'encryption';
    setup(db: DeepBase): void;
    execute(context: DeepBasePluginContext, next: DeepBasePluginNext): Promise<any>;
    executeSync(context: DeepBasePluginContext, next: DeepBasePluginNextSync): any;
    dispose(): void;
}

export function encryptedDocument(options: EncryptedDocumentOptions): EncryptionPlugin;
export default encryptedDocument;
