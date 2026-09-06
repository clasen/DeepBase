import type { DeepBase, DeepBasePathSegment, DeepBasePlugin, DeepBasePluginContext, DeepBasePluginNext, DeepBasePluginNextSync } from 'deepbase';

export interface EncryptionPluginOptions {
    activeKeyId: string;
    keys: Record<string, Uint8Array>;
}

export class DeepBaseEncryptionError extends Error {
    code: string;
    path: DeepBasePathSegment[];
    keyId: string | null;
}

export class EncryptionPlugin implements DeepBasePlugin {
    constructor(options: EncryptionPluginOptions);
    readonly name: 'encryption';
    readonly activeKeyId: string;
    setup(db: DeepBase): void;
    execute(context: DeepBasePluginContext, next: DeepBasePluginNext): Promise<any>;
    executeSync(context: DeepBasePluginContext, next: DeepBasePluginNextSync): any;
    dispose(): void;
}

export function encryptedValues(options: EncryptionPluginOptions): EncryptionPlugin;
export default encryptedValues;
