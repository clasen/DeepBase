import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const MARKER = '$deepbase';
const PLUGIN_NAME = 'encryption';
const VERSION = 1;
const ALGORITHM = 'A256GCM';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export class DeepBaseEncryptionError extends Error {
  constructor(message, { code, path = [], keyId = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DeepBaseEncryptionError';
    this.code = code;
    this.path = [...path];
    this.keyId = keyId;
  }
}

export class EncryptionPlugin {
  constructor({ activeKeyId, keys } = {}) {
    if (typeof activeKeyId !== 'string' || activeKeyId.length === 0) {
      throw new TypeError('encryptedValues() requires a non-empty activeKeyId');
    }
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
      throw new TypeError('encryptedValues() requires a keys object');
    }

    this.name = PLUGIN_NAME;
    this.activeKeyId = activeKeyId;
    this.keys = new Map();
    for (const [keyId, key] of Object.entries(keys)) {
      if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
        throw new TypeError(`Encryption key ${keyId} must be a 32-byte Buffer or Uint8Array`);
      }
      this.keys.set(keyId, Buffer.from(key));
    }
    if (!this.keys.has(activeKeyId)) {
      throw new TypeError(`Encryption activeKeyId ${activeKeyId} is not present in keys`);
    }

    this._db = null;
    this._disposed = false;
  }

  setup(db) {
    if (this._db && this._db !== db) {
      throw new Error('Encryption plugin instances cannot be shared between DeepBase instances');
    }
    this._db = db;
  }

  _assertUsable() {
    if (this._disposed) {
      throw new DeepBaseEncryptionError('Encryption plugin has been disposed', {
        code: 'ENCRYPTION_PLUGIN_DISPOSED',
      });
    }
  }

  _isEnvelope(value) {
    return isPlainObject(value)
      && isPlainObject(value[MARKER])
      && value[MARKER].plugin === PLUGIN_NAME;
  }

  _encrypt(value, path) {
    let plaintext;
    try {
      plaintext = JSON.stringify(value);
    } catch (cause) {
      throw new DeepBaseEncryptionError(`Cannot serialize encrypted value at ${path.join('.')}`, {
        code: 'ENCRYPTION_SERIALIZATION_FAILED',
        path,
        keyId: this.activeKeyId,
        cause,
      });
    }
    if (plaintext === undefined) {
      throw new DeepBaseEncryptionError(`Cannot serialize encrypted value at ${path.join('.')}`, {
        code: 'ENCRYPTION_SERIALIZATION_FAILED',
        path,
        keyId: this.activeKeyId,
      });
    }

    const iv = randomBytes(12);
    const key = this.keys.get(this.activeKeyId);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    return {
      [MARKER]: {
        plugin: PLUGIN_NAME,
        version: VERSION,
        algorithm: ALGORITHM,
        keyId: this.activeKeyId,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
    };
  }

  _decrypt(value, path) {
    const envelope = value[MARKER];
    if (
      Object.keys(value).length !== 1
      || envelope.version !== VERSION
      || envelope.algorithm !== ALGORITHM
      || typeof envelope.keyId !== 'string'
      || typeof envelope.iv !== 'string'
      || typeof envelope.tag !== 'string'
      || typeof envelope.ciphertext !== 'string'
    ) {
      throw new DeepBaseEncryptionError(`Malformed encrypted value at ${path.join('.')}`, {
        code: 'ENCRYPTION_MALFORMED_ENVELOPE',
        path,
        keyId: typeof envelope.keyId === 'string' ? envelope.keyId : null,
      });
    }

    const key = this.keys.get(envelope.keyId);
    if (!key) {
      throw new DeepBaseEncryptionError(`Unknown encryption key ${envelope.keyId}`, {
        code: 'ENCRYPTION_UNKNOWN_KEY',
        path,
        keyId: envelope.keyId,
      });
    }

    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    if (iv.byteLength !== 12 || tag.byteLength !== 16) {
      throw new DeepBaseEncryptionError(`Malformed encrypted value at ${path.join('.')}`, {
        code: 'ENCRYPTION_MALFORMED_ENVELOPE',
        path,
        keyId: envelope.keyId,
      });
    }

    let plaintext;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch (cause) {
      throw new DeepBaseEncryptionError(`Encrypted value authentication failed at ${path.join('.')}`, {
        code: 'ENCRYPTION_AUTHENTICATION_FAILED',
        path,
        keyId: envelope.keyId,
        cause,
      });
    }

    try {
      return JSON.parse(plaintext);
    } catch (cause) {
      throw new DeepBaseEncryptionError(`Malformed encrypted value at ${path.join('.')}`, {
        code: 'ENCRYPTION_MALFORMED_ENVELOPE',
        path,
        keyId: envelope.keyId,
        cause,
      });
    }
  }

  _encode(value, path) {
    if (this._isEnvelope(value)) {
      return this._encode(this._decrypt(value, path), path);
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => this._encode(item, [...path, index]));
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this._encode(item, [...path, key])]),
      );
    }
    return this._encrypt(value, path);
  }

  _decode(value, path) {
    if (this._isEnvelope(value)) return this._decrypt(value, path);
    if (Array.isArray(value)) {
      return value.map((item, index) => this._decode(item, [...path, index]));
    }
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, this._decode(item, [...path, key])]),
      );
    }
    return value;
  }

  _writeOverride(context) {
    const { operation, args } = context;
    if (operation === 'set') {
      if (args.length === 0) return undefined;
      const path = args.length === 1 ? [] : args.slice(0, -1);
      return { args: [...args.slice(0, -1), this._encode(args.at(-1), path)] };
    }

    if (operation === 'upd') {
      const path = args.slice(0, -1);
      const update = args.at(-1);
      if (typeof update !== 'function') return undefined;
      return {
        args: [
          ...path,
          (storedValue) => this._encode(update(this._decode(storedValue, path)), path),
        ],
      };
    }

    if (operation === 'inc' || operation === 'dec') {
      const path = args.slice(0, -1);
      const amount = args.at(-1);
      const delta = operation === 'dec' ? -amount : amount;
      return {
        operation: 'upd',
        args: [
          ...path,
          (storedValue) => this._encode(this._decode(storedValue, path) + delta, path),
        ],
      };
    }

    return undefined;
  }

  async execute(context, next) {
    this._assertUsable();
    if (context.kind === 'write') return next(this._writeOverride(context));
    const result = await next();
    return context.operation === 'get' ? this._decode(result, context.args) : result;
  }

  executeSync(context, next) {
    this._assertUsable();
    const result = next();
    return context.operation === 'get' ? this._decode(result, context.args) : result;
  }

  dispose() {
    for (const key of this.keys.values()) key.fill(0);
    this.keys.clear();
    this._disposed = true;
    this._db = null;
  }
}

export function encryptedValues(options) {
  return new EncryptionPlugin(options);
}
