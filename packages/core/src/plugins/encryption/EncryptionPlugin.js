import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync } from 'node:crypto';
import { evaluateQuery } from '../../query.js';
import { deleteAtPath, getAtPath, setAtPath } from '../../schema.js';

const MARKER = '$deepbase';
const PLUGIN_NAME = 'encryption';
const VERSION = 2;
const ALGORITHM = 'A256GCM';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const DEFAULT_SCRYPT = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });
const MIN_SCRYPT_N = 2 ** 14;
const MAX_SCRYPT_P = 16;
// Bounds stored headers too, so a forged header cannot exhaust memory before authentication fails.
const MAX_SCRYPT_MEMORY = 256 * 1024 * 1024;
const ENVELOPE_FIELDS = ['plugin', 'version', 'algorithm', 'kdf', 'iv', 'tag', 'ciphertext'];
const RAW_KDF_FIELDS = ['name', 'keyId'];
const SCRYPT_KDF_FIELDS = ['name', 'N', 'r', 'p', 'salt'];

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactFields(value, fields) {
  return isPlainObject(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function isScryptCost({ N, r, p }) {
  return Number.isSafeInteger(r) && r >= 1
    && Number.isSafeInteger(p) && p >= 1 && p <= MAX_SCRYPT_P
    && Number.isSafeInteger(N) && N >= MIN_SCRYPT_N && 128 * N * r <= MAX_SCRYPT_MEMORY
    && (N & (N - 1)) === 0;
}

function scryptOptions({ N, r, p }) {
  return { N, r, p, maxmem: 128 * r * (N + p + 2) };
}

function kdfId(kdf) {
  return kdf.name === 'raw'
    ? `raw:${kdf.keyId}`
    : `scrypt:${kdf.N}:${kdf.r}:${kdf.p}:${kdf.salt}`;
}

function additionalData(kdf) {
  const kdfFields = kdf.name === 'raw'
    ? [kdf.name, kdf.keyId]
    : [kdf.name, kdf.N, kdf.r, kdf.p, kdf.salt];
  return Buffer.from(JSON.stringify([PLUGIN_NAME, VERSION, ALGORITHM, ...kdfFields]), 'utf8');
}

function decodeBase64(value, length) {
  if (typeof value !== 'string') return null;
  const bytes = Buffer.from(value, 'base64');
  return length === undefined || bytes.byteLength === length ? bytes : null;
}

function boundaryKey(value, fromEnd) {
  if (value === null || typeof value !== 'object') return undefined;
  const keys = Object.keys(value);
  return fromEnd ? keys.at(-1) : keys[0];
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
  constructor({ password, kdf, activeKeyId, keys } = {}) {
    this.name = PLUGIN_NAME;
    this._password = null;
    this._rawKeys = null;
    this._scrypt = null;
    this._writeKdf = null;

    if (password !== undefined) {
      if (activeKeyId !== undefined || keys !== undefined) {
        throw new TypeError('encryptedDocument() accepts either a password or activeKeyId and keys');
      }
      const validPassword = typeof password === 'string'
        ? password.length > 0
        : password instanceof Uint8Array && password.byteLength > 0;
      if (!validPassword) {
        throw new TypeError('encryptedDocument() password must be a non-empty string or Uint8Array');
      }
      if (kdf !== undefined && (!isPlainObject(kdf) || Object.keys(kdf).some((field) => !['N', 'r', 'p'].includes(field)))) {
        throw new TypeError('encryptedDocument() kdf accepts only N, r and p');
      }
      const cost = { ...DEFAULT_SCRYPT, ...kdf };
      if (!isScryptCost(cost)) {
        throw new TypeError(
          `encryptedDocument() kdf requires N to be a power of two of at least ${MIN_SCRYPT_N}, `
          + `1 <= p <= ${MAX_SCRYPT_P}, and 128 * N * r <= ${MAX_SCRYPT_MEMORY}`,
        );
      }
      this._scrypt = cost;
      this._password = typeof password === 'string' ? Buffer.from(password, 'utf8') : Buffer.from(password);
    } else {
      if (kdf !== undefined) {
        throw new TypeError('encryptedDocument() kdf requires a password');
      }
      if (typeof activeKeyId !== 'string' || activeKeyId.length === 0) {
        throw new TypeError('encryptedDocument() requires a password or a non-empty activeKeyId');
      }
      if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
        throw new TypeError('encryptedDocument() requires a keys object');
      }
      this._rawKeys = new Map();
      for (const [keyId, key] of Object.entries(keys)) {
        if (!(key instanceof Uint8Array) || key.byteLength !== KEY_LENGTH) {
          throw new TypeError(`Encryption key ${keyId} must be a 32-byte Buffer or Uint8Array`);
        }
        this._rawKeys.set(keyId, Buffer.from(key));
      }
      if (!this._rawKeys.has(activeKeyId)) {
        throw new TypeError(`Encryption activeKeyId ${activeKeyId} is not present in keys`);
      }
      this._writeKdf = { name: 'raw', keyId: activeKeyId };
    }

    this._derivedKeys = new Map();
    this._pendingKeys = new Map();
    this._opened = false;
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

  _malformed(path, message = 'Malformed encrypted document') {
    return new DeepBaseEncryptionError(message, { code: 'ENCRYPTION_MALFORMED_DOCUMENT', path });
  }

  _parseKdf(kdf) {
    if (hasExactFields(kdf, RAW_KDF_FIELDS) && kdf.name === 'raw') {
      return typeof kdf.keyId === 'string' && kdf.keyId.length > 0 ? kdf : null;
    }
    if (hasExactFields(kdf, SCRYPT_KDF_FIELDS) && kdf.name === 'scrypt') {
      return isScryptCost(kdf) && decodeBase64(kdf.salt, SALT_LENGTH) ? kdf : null;
    }
    return null;
  }

  _envelope(stored, path) {
    if (stored === null || stored === undefined) {
      if (this._opened) {
        throw new DeepBaseEncryptionError('Encrypted document is missing from storage', {
          code: 'ENCRYPTION_DOCUMENT_MISSING',
          path,
        });
      }
      return null;
    }
    if (!hasExactFields(stored, ENVELOPE_FIELDS)
      || stored.plugin !== PLUGIN_NAME
      || stored.version !== VERSION
      || stored.algorithm !== ALGORITHM) {
      throw this._malformed(path);
    }
    const kdf = this._parseKdf(stored.kdf);
    const iv = decodeBase64(stored.iv, IV_LENGTH);
    const tag = decodeBase64(stored.tag, TAG_LENGTH);
    const ciphertext = decodeBase64(stored.ciphertext);
    if (!kdf || !iv || !tag || !ciphertext) throw this._malformed(path);
    return { kdf, iv, tag, ciphertext };
  }

  _storedEnvelope(root, path) {
    if (root === null || root === undefined) return this._envelope(null, path);
    if (!isPlainObject(root) || Object.keys(root).some((key) => key !== MARKER)) {
      throw this._malformed(path, 'Storage holds data outside the encrypted document');
    }
    return this._envelope(root[MARKER], path);
  }

  _keySync(kdf, path) {
    this._assertUsable();
    if (kdf.name === 'raw') {
      const key = this._rawKeys?.get(kdf.keyId);
      if (!key) {
        throw new DeepBaseEncryptionError(`Unknown encryption key ${kdf.keyId}`, {
          code: 'ENCRYPTION_UNKNOWN_KEY',
          path,
          keyId: kdf.keyId,
        });
      }
      return key;
    }

    if (!this._password) {
      throw new DeepBaseEncryptionError('Encrypted document requires a password', {
        code: 'ENCRYPTION_UNKNOWN_KEY',
        path,
      });
    }
    const id = kdfId(kdf);
    let key = this._derivedKeys.get(id);
    if (!key) {
      key = scryptSync(this._password, decodeBase64(kdf.salt), KEY_LENGTH, scryptOptions(kdf));
      this._derivedKeys.set(id, key);
    }
    return key;
  }

  async _deriveKey(kdf) {
    if (kdf.name !== 'scrypt' || !this._password) return;
    const id = kdfId(kdf);
    if (this._derivedKeys.has(id)) return;

    let pending = this._pendingKeys.get(id);
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        scrypt(this._password, decodeBase64(kdf.salt), KEY_LENGTH, scryptOptions(kdf), (error, key) => {
          if (error) reject(error);
          else resolve(key);
        });
      }).then((key) => {
        if (this._disposed || this._derivedKeys.has(id)) key.fill(0);
        else this._derivedKeys.set(id, key);
      }).finally(() => this._pendingKeys.delete(id));
      this._pendingKeys.set(id, pending);
    }
    await pending;
  }

  _isAtLeastConfigured(kdf) {
    return kdf.name === 'scrypt'
      && kdf.N >= this._scrypt.N
      && kdf.r >= this._scrypt.r
      && kdf.p >= this._scrypt.p;
  }

  _freshKdf() {
    return { name: 'scrypt', ...this._scrypt, salt: randomBytes(SALT_LENGTH).toString('base64') };
  }

  _decrypt(envelope, path) {
    if (!envelope) return {};
    const key = this._keySync(envelope.kdf, path);
    const keyId = envelope.kdf.name === 'raw' ? envelope.kdf.keyId : null;

    let plaintext;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, envelope.iv, { authTagLength: TAG_LENGTH });
      decipher.setAAD(additionalData(envelope.kdf));
      decipher.setAuthTag(envelope.tag);
      plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    } catch (cause) {
      throw new DeepBaseEncryptionError('Encrypted document authentication failed', {
        code: 'ENCRYPTION_AUTHENTICATION_FAILED',
        path,
        keyId,
        cause,
      });
    }

    let document;
    try {
      document = JSON.parse(plaintext.toString('utf8'));
    } catch {
      // The parser's message can quote plaintext, so it is not attached as a cause.
      throw new DeepBaseEncryptionError('Encrypted document is not valid JSON', {
        code: 'ENCRYPTION_MALFORMED_DOCUMENT',
        path,
        keyId,
      });
    } finally {
      plaintext.fill(0);
    }

    this._opened = true;
    if (!this._writeKdf) {
      this._writeKdf = this._isAtLeastConfigured(envelope.kdf) ? envelope.kdf : this._freshKdf();
    }
    return document;
  }

  async _readDocument(root, path) {
    const envelope = this._storedEnvelope(root, path);
    if (envelope) await this._deriveKey(envelope.kdf);
    return this._decrypt(envelope, path);
  }

  _seal(document, path) {
    this._writeKdf ??= this._freshKdf();
    const kdf = this._writeKdf;
    const key = this._keySync(kdf, path);

    let plaintext;
    try {
      plaintext = Buffer.from(JSON.stringify(document), 'utf8');
    } catch {
      // Serializer messages can name object keys, which are part of the encrypted document.
      throw new DeepBaseEncryptionError('Cannot serialize encrypted document', {
        code: 'ENCRYPTION_SERIALIZATION_FAILED',
        path,
      });
    }

    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
      cipher.setAAD(additionalData(kdf));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        plugin: PLUGIN_NAME,
        version: VERSION,
        algorithm: ALGORITHM,
        kdf: { ...kdf },
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      };
    } finally {
      plaintext.fill(0);
    }
  }

  _mutation(operation, args) {
    if (operation === 'set') {
      if (args.length === 0) throw new TypeError('set() requires at least one argument');
      const path = args.slice(0, -1);
      const value = args.at(-1);
      return { path, result: path, apply: (document) => setAtPath(document, path, value) };
    }
    if (operation === 'del') {
      return { path: args, result: undefined, apply: (document) => deleteAtPath(document, args) };
    }
    if (operation === 'upd') {
      const path = args.slice(0, -1);
      const update = args.at(-1);
      if (typeof update !== 'function') throw new TypeError('upd() requires an update function');
      return {
        path,
        result: path,
        apply: (document) => setAtPath(document, path, update(getAtPath(document, path))),
      };
    }
    if (operation === 'inc' || operation === 'dec') {
      const path = args.slice(0, -1);
      const amount = args.at(-1);
      const delta = operation === 'dec' ? -amount : amount;
      return {
        path,
        result: path,
        apply: (document) => setAtPath(document, path, getAtPath(document, path) + delta),
      };
    }
    throw this._unsupported(operation);
  }

  _reader(operation, args) {
    if (operation === 'get') {
      return { path: args, run: (document) => getAtPath(document, args) };
    }
    if (operation === 'first' || operation === 'last') {
      return {
        path: args,
        run: (document) => boundaryKey(getAtPath(document, args), operation === 'last'),
      };
    }
    if (operation === 'query') {
      const [path, steps] = args;
      return { path, run: (document) => evaluateQuery(getAtPath(document, path), steps, { path }) };
    }
    throw this._unsupported(operation);
  }

  _unsupported(operation) {
    return new DeepBaseEncryptionError(`${operation}() is not supported with an encrypted document`, {
      code: 'ENCRYPTION_OPERATION_UNSUPPORTED',
    });
  }

  async execute(context, next) {
    this._assertUsable();
    const { operation, args } = context;

    if (context.kind === 'write') {
      const mutation = this._mutation(operation, args);
      if (this._writeKdf) await this._deriveKey(this._writeKdf);
      await next({
        operation: 'upd',
        args: [
          MARKER,
          (stored) => this._seal(
            mutation.apply(this._decrypt(this._envelope(stored, mutation.path), mutation.path)),
            mutation.path,
          ),
        ],
      });
      this._opened = true;
      return mutation.result;
    }

    const reader = this._reader(operation, args);
    const root = await next({ operation: 'get', args: [] });
    return reader.run(await this._readDocument(root, reader.path));
  }

  executeSync(context, next) {
    this._assertUsable();
    const reader = this._reader(context.operation, context.args);
    const root = next({ operation: 'get', args: [] });
    return reader.run(this._decrypt(this._storedEnvelope(root, reader.path), reader.path));
  }

  dispose() {
    this._password?.fill(0);
    this._password = null;
    for (const key of this._rawKeys?.values() ?? []) key.fill(0);
    this._rawKeys?.clear();
    for (const key of this._derivedKeys.values()) key.fill(0);
    this._derivedKeys.clear();
    this._disposed = true;
    this._db = null;
  }
}

export function encryptedDocument(options) {
  return new EncryptionPlugin(options);
}
