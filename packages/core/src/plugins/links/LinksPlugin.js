const PREFIX = 'deepbase:link:v1:';

function validatePath(path, label) {
  if (!Array.isArray(path) || path.length === 0) {
    throw new DeepBaseLinkError(`${label} must contain at least one path segment`, {
      code: 'LINK_INVALID_PATH',
      path: Array.isArray(path) ? path : [],
    });
  }
  if (!path.every((segment) => typeof segment === 'string' || typeof segment === 'number')) {
    throw new DeepBaseLinkError(`${label} contains an invalid path segment`, {
      code: 'LINK_INVALID_PATH',
      path,
    });
  }
  return [...path];
}

function pathKey(path) {
  return JSON.stringify(path);
}

export class DeepBaseLinkError extends Error {
  constructor(message, { code, path = [], targetPath = null, chain = [], cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DeepBaseLinkError';
    this.code = code;
    this.path = [...path];
    this.targetPath = targetPath === null ? null : [...targetPath];
    this.chain = chain.map((entry) => [...entry]);
  }
}

export class LinksPlugin {
  constructor({ maxDepth } = {}) {
    if (!Number.isInteger(maxDepth) || maxDepth <= 0) {
      throw new TypeError('linkedData() requires maxDepth to be a positive integer');
    }
    this.name = 'links';
    this.maxDepth = maxDepth;
    this._db = null;
  }

  setup(db) {
    if (this._db && this._db !== db) {
      throw new Error('Links plugin instances cannot be shared between DeepBase instances');
    }
    this._db = db;
  }

  dispose() {
    this._db = null;
  }

  to(...path) {
    const targetPath = validatePath(path, 'Link target');
    return `${PREFIX}${encodeURIComponent(JSON.stringify(targetPath))}`;
  }

  isLink(value) {
    if (typeof value !== 'string' || !value.startsWith(PREFIX)) return false;
    try {
      this.parse(value);
      return true;
    } catch {
      return false;
    }
  }

  parse(value) {
    if (typeof value !== 'string' || !value.startsWith(PREFIX)) {
      throw new DeepBaseLinkError('Value is not a DeepBase link', {
        code: 'LINK_MALFORMED',
      });
    }

    try {
      const path = JSON.parse(decodeURIComponent(value.slice(PREFIX.length)));
      return validatePath(path, 'Link target');
    } catch (cause) {
      if (cause instanceof DeepBaseLinkError) {
        throw new DeepBaseLinkError('Malformed DeepBase link', {
          code: 'LINK_MALFORMED',
          path: cause.path,
          cause,
        });
      }
      throw new DeepBaseLinkError('Malformed DeepBase link', {
        code: 'LINK_MALFORMED',
        cause,
      });
    }
  }

  async resolve(...sourcePath) {
    if (!this._db) {
      throw new Error('Links plugin must be registered with db.use() before resolve()');
    }

    const initialPath = validatePath(sourcePath, 'Link source');
    const chain = [initialPath];
    const visited = new Set([pathKey(initialPath)]);
    let currentPath = initialPath;
    let followed = 0;

    while (true) {
      const value = await this._db.get(...currentPath);
      if (value === null) {
        throw new DeepBaseLinkError(`Link target is missing at ${currentPath.join('.')}`, {
          code: 'LINK_TARGET_MISSING',
          path: initialPath,
          targetPath: currentPath,
          chain,
        });
      }
      if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;

      const targetPath = this.parse(value);
      if (followed >= this.maxDepth) {
        throw new DeepBaseLinkError(`Link resolution exceeded maxDepth ${this.maxDepth}`, {
          code: 'LINK_MAX_DEPTH',
          path: initialPath,
          targetPath,
          chain: [...chain, targetPath],
        });
      }

      const targetKey = pathKey(targetPath);
      if (visited.has(targetKey)) {
        throw new DeepBaseLinkError(`Link cycle detected at ${targetPath.join('.')}`, {
          code: 'LINK_CYCLE',
          path: initialPath,
          targetPath,
          chain: [...chain, targetPath],
        });
      }

      followed++;
      visited.add(targetKey);
      chain.push(targetPath);
      currentPath = targetPath;
    }
  }
}

export function linkedData(options) {
  return new LinksPlugin(options);
}
