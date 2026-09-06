import type { DeepBase, DeepBasePathSegment, DeepBasePlugin } from 'deepbase';

export interface LinksPluginOptions {
    maxDepth: number;
}

export class DeepBaseLinkError extends Error {
    code: string;
    path: DeepBasePathSegment[];
    targetPath: DeepBasePathSegment[] | null;
    chain: DeepBasePathSegment[][];
}

export class LinksPlugin implements DeepBasePlugin {
    constructor(options: LinksPluginOptions);
    readonly name: 'links';
    readonly maxDepth: number;
    setup(db: DeepBase): void;
    dispose(): void;
    to(...path: DeepBasePathSegment[]): string;
    isLink(value: unknown): value is string;
    parse(value: string): DeepBasePathSegment[];
    resolve(...sourcePath: DeepBasePathSegment[]): Promise<any>;
}

export function linkedData(options: LinksPluginOptions): LinksPlugin;
export default linkedData;
