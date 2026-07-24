import { DeepBaseDriver } from 'deepbase';
import Database from 'better-sqlite3';
import fs from 'fs';
import * as pathModule from 'path';
import { withBusyRetry } from './busy.js';
import { resolveSqliteConfig } from './config.js';
import { ensureSchema } from './schema.js';

export class SqliteDriver extends DeepBaseDriver {
  constructor({ name, path, pragma, busyTimeoutMs, busyRetry, ...opts } = {}) {
    super(opts);

    const config = resolveSqliteConfig({ pragma, busyTimeoutMs, busyRetry });
    this.name = name || 'default';
    this.path = path || pathModule.join(process.cwd(), 'db');
    this.pragma = config.pragma;
    this.pragmaConfig = config.pragmaConfig;
    this.busyTimeoutMs = config.busyTimeoutMs;
    this.busyRetry = config.busyRetry;

    this.path = pathModule.resolve(this.path);
    this.fileName = pathModule.join(this.path, `${this.name}.db`);

    this.db = null;
    this._connectPromise = null;
    this._writeQueue = Promise.resolve();
  }

  _connectSync() {
    if (this._connected) return;

    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path, { recursive: true });
    }

    try {
      this.db = new Database(this.fileName, { timeout: this.busyTimeoutMs });
    } catch (err) {
      if (this._isMissingNativeBinding(err)) {
        const hint =
          'deepbase-sqlite: the native binding for "better-sqlite3" is missing. ' +
          'This usually means npm install scripts were disabled (e.g. `ignore-scripts=true` in your .npmrc). ' +
          'Fix it with: `npm rebuild better-sqlite3 --ignore-scripts=false`, ' +
          'or reinstall with `npm i --ignore-scripts=false`. ' +
          'See https://github.com/clasen/DeepBase/tree/main/packages/driver-sqlite#troubleshooting';
        const wrapped = new Error(hint);
        wrapped.cause = err;
        wrapped.code = 'DEEPBASE_SQLITE_BINDING_MISSING';
        throw wrapped;
      }
      throw err;
    }

    const cfg = this.pragmaConfig;
    if (cfg) {
      this.db.pragma(`journal_mode = ${cfg.journal_mode}`);
      this.db.pragma(`synchronous = ${cfg.synchronous}`);
      this.db.pragma(`temp_store = ${cfg.temp_store}`);
      this.db.pragma(`cache_size = ${cfg.cache_size}`);
      this.db.pragma(`mmap_size = ${cfg.mmap_size}`);
    }

    const withoutRowid = cfg ? ' WITHOUT ROWID' : '';
    ensureSchema(this.db, { withoutRowid });

    this.getStmt = this.db.prepare('SELECT value FROM deepbase WHERE key = ?');
    this.setStmt = this.db.prepare(`
      INSERT INTO deepbase (key, value, seq)
      VALUES (?, ?, (SELECT IFNULL(MAX(seq), 0) + 1 FROM deepbase))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    this.delStmt = this.db.prepare('DELETE FROM deepbase WHERE key = ?');
    this.getAllStmt = this.db.prepare('SELECT key, value FROM deepbase ORDER BY seq, key');
    this.getKeysLikeStmt = this.db.prepare(
      "SELECT key, value FROM deepbase WHERE key LIKE ? ESCAPE '!' ORDER BY seq, key",
    );
    this.getFirstChildKeyStmt = this.db.prepare(
      "SELECT key FROM deepbase WHERE key LIKE ? ESCAPE '!' ORDER BY seq, key LIMIT 1",
    );
    this.getLastChildKeyStmt = this.db.prepare(
      "SELECT key FROM deepbase WHERE key LIKE ? ESCAPE '!' ORDER BY seq DESC, key DESC LIMIT 1",
    );
    this.delChildrenStmt = this.db.prepare("DELETE FROM deepbase WHERE key LIKE ? ESCAPE '!'");
    this.hasChildrenStmt = this.db.prepare("SELECT 1 FROM deepbase WHERE key LIKE ? ESCAPE '!' LIMIT 1");

    const setTxn = this.db.transaction((key, jsonValue, keys) => {
      this._expandParentObjects(keys);
      this._replaceRow(key, jsonValue);
    });
    this._setTxn = (...args) => setTxn.immediate(...args);

    const delTxn = this.db.transaction((key, likePattern, keys) => {
      this._expandParentObjects(keys);
      this.delStmt.run(key);
      this.delChildrenStmt.run(likePattern);
    });
    this._delTxn = (...args) => delTxn.immediate(...args);

    const updTxn = this.db.transaction((keys, func) => {
      const currentValue = this._getSync(keys);
      const newValue = func(currentValue);
      const key = this._pathToKey(keys);
      this._expandParentObjects(keys);
      this._replaceRow(key, JSON.stringify(newValue));
      return keys;
    });
    this._updTxn = (...args) => updTxn.immediate(...args);

    const setRootTxn = this.db.transaction((entries) => {
      this.db.exec('DELETE FROM deepbase');
      for (const [key, value] of entries) {
        this.setStmt.run(key, JSON.stringify(value));
      }
    });
    this._setRootTxn = (...args) => setRootTxn.immediate(...args);

    const clearTxn = this.db.transaction(() => {
      this.db.exec('DELETE FROM deepbase');
    });
    this._clearTxn = (...args) => clearTxn.immediate(...args);

    this._connected = true;
  }

  async connect() {
    if (this._connected) return;
    if (!this._connectPromise) {
      this._connectPromise = withBusyRetry(() => this._openSync(), this.busyRetry)
        .finally(() => {
          this._connectPromise = null;
        });
    }
    return this._connectPromise;
  }

  _openSync() {
    try {
      this._connectSync();
    } catch (error) {
      this._closeConnection();
      throw error;
    }
  }

  async disconnect() {
    return this._queueWrite(async () => {
      if (this._connectPromise) {
        await this._connectPromise;
      }
      this._closeConnection();
    });
  }

  _closeConnection() {
    if (this.db) {
      this.db.close();
    }
    this.db = null;
    this._connected = false;
  }

  _queueWrite(operation) {
    const result = this._writeQueue.then(operation, operation);
    this._writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  _runWrite(operation) {
    return this._queueWrite(async () => {
      await this.connect();
      return withBusyRetry(operation, this.busyRetry);
    });
  }

  async get(...args) {
    await this.connect();
    return this._getSync(args);
  }

  getSync(...args) {
    this._openSync();
    return this._getSync(args);
  }

  _getSync(args) {
    if (args.length === 0) {
      return this._getRootObject();
    }

    const key = this._pathToKey(args);
    const row = this.getStmt.get(key);
    const likePattern = this._likePrefix(key);

    if (row) {
      if (this.hasChildrenStmt.get(likePattern)) {
        return this._buildObjectFromChildren(key, likePattern);
      }
      return JSON.parse(row.value);
    }

    if (this.hasChildrenStmt.get(likePattern)) {
      return this._buildObjectFromChildren(key, likePattern);
    }

    return this._getFromParent(args);
  }

  async set(...args) {
    if (args.length === 0) {
      throw new Error('set() requires at least one argument');
    }

    if (args.length === 1) {
      const entries = this._flattenObject(args[0]);
      return this._runWrite(() => {
        this._setRootTxn(entries);
        return [];
      });
    }

    const keys = args.slice(0, -1);
    const value = args[args.length - 1];
    const key = this._pathToKey(keys);
    const jsonValue = JSON.stringify(value);
    return this._runWrite(() => {
      this._setTxn(key, jsonValue, keys);
      return keys;
    });
  }

  _replaceRow(key, jsonValue) {
    this.delChildrenStmt.run(this._likePrefix(key));
    this.setStmt.run(key, jsonValue);
  }

  async del(...keys) {
    if (keys.length === 0) {
      return this._runWrite(() => {
        this._clearTxn();
      });
    }

    const key = this._pathToKey(keys);
    const likePattern = this._likePrefix(key);
    return this._runWrite(() => {
      this._delTxn(key, likePattern, keys);
    });
  }

  async inc(...args) {
    const i = args.pop();
    return this.upd(...args, n => n + i);
  }

  async dec(...args) {
    const i = args.pop();
    return this.upd(...args, n => n - i);
  }

  async add(...keys) {
    const value = keys.pop();
    const id = this.nanoid();
    await this.set(...[...keys, id], value);
    return [...keys, id];
  }

  async upd(...args) {
    const func = args.pop();
    const keys = args;
    return this._runWrite(() => this._updTxn(keys, func));
  }

  async first(...args) {
    await this.connect();
    return this._firstOrLastKey(args, false);
  }

  async last(...args) {
    await this.connect();
    return this._firstOrLastKey(args, true);
  }

  _firstOrLastKey(path, fromEnd) {
    const nestedKey = this._findBoundaryNestedKey(path, fromEnd);
    if (nestedKey !== undefined) {
      return nestedKey;
    }

    const value = this._getSync(path);
    if (value === null || typeof value !== 'object') {
      return undefined;
    }

    let keyResult;
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        if (!fromEnd) return key;
        keyResult = key;
      }
    }
    return keyResult;
  }

  _findBoundaryNestedKey(path, fromEnd) {
    const likePattern = path.length === 0 ? '%' : this._likePrefix(this._pathToKey(path));
    const row = (fromEnd ? this.getLastChildKeyStmt : this.getFirstChildKeyStmt).get(likePattern);
    if (!row) return undefined;

    const fullPath = this._keyToPath(row.key);
    if (fullPath.length <= path.length) return undefined;

    return fullPath[path.length];
  }

  _getRootObject() {
    const rows = this.getAllStmt.all();
    const result = {};
    for (const row of rows) {
      const path = this._keyToPath(row.key);
      const value = JSON.parse(row.value);
      this._setNestedValue(result, path, value);
    }
    return result;
  }

  _buildObjectFromChildren(parentKey, likePattern) {
    const rows = this.getKeysLikeStmt.all(likePattern || (parentKey ? this._likePrefix(parentKey) : '%'));
    const result = {};
    const parentPathLen = parentKey ? this._keyToPath(parentKey).length : 0;

    for (const row of rows) {
      const fullPath = this._keyToPath(row.key);
      const relativePath = fullPath.slice(parentPathLen);
      const value = JSON.parse(row.value);
      this._setNestedValue(result, relativePath, value);
    }

    return result;
  }

  _isMissingNativeBinding(err) {
    if (!err) return false;
    const msg = String(err.message || '');
    return (
      err.code === 'MODULE_NOT_FOUND' ||
      msg.includes('Could not locate the bindings file') ||
      msg.includes('better_sqlite3.node')
    );
  }

  _escapeLikePattern(str) {
    return str.replace(/[!%_]/g, '!$&');
  }

  _likePrefix(key) {
    return this._escapeLikePattern(key) + '.%';
  }

  _setNestedValue(obj, path, value) {
    if (path.length === 0) return;

    if (path.length === 1) {
      const key = path[0];
      const existing = obj[key];
      if (
        value === null &&
        existing !== null &&
        typeof existing === 'object' &&
        !Array.isArray(existing) &&
        Object.keys(existing).length > 0
      ) {
        return;
      }
      obj[key] = value;
      return;
    }

    const key = path[0];
    const current = obj[key];
    if (!obj.hasOwnProperty(key) || current === null || typeof current !== 'object' || Array.isArray(current)) {
      obj[key] = {};
    }

    this._setNestedValue(obj[key], path.slice(1), value);
  }

  _flattenObject(obj, prefix = '') {
    const entries = [];

    for (const [key, value] of Object.entries(obj)) {
      const escapedKey = this._escapeDots(String(key));
      const fullKey = prefix ? `${prefix}.${escapedKey}` : escapedKey;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        entries.push(...this._flattenObject(value, fullKey));
      } else {
        entries.push([fullKey, value]);
      }
    }

    return entries;
  }

  _getFromParent(path) {
    for (let i = path.length - 1; i > 0; i--) {
      const parentPath = path.slice(0, i);
      const parentKey = this._pathToKey(parentPath);
      const row = this.getStmt.get(parentKey);
      if (row) {
        const parentValue = JSON.parse(row.value);
        if (parentValue !== null && typeof parentValue === 'object') {
          return this._getFromObject(parentValue, path.slice(i));
        }
      }
    }
    return null;
  }

  _getFromObject(obj, path) {
    if (path.length === 0) return obj;
    if (path.length === 1) {
      return obj === null || obj[path[0]] === undefined ? null : obj[path[0]];
    }

    const key = path[0];
    if (!obj.hasOwnProperty(key)) return null;

    return this._getFromObject(obj[key], path.slice(1));
  }

  _expandParentObjects(path) {
    for (let i = 1; i < path.length; i++) {
      const parentPath = path.slice(0, i);
      const parentKey = this._pathToKey(parentPath);
      const parentRow = this.getStmt.get(parentKey);

      if (parentRow) {
        const parentValue = JSON.parse(parentRow.value);

        if (parentValue !== null && typeof parentValue === 'object' && !Array.isArray(parentValue)) {
          this.delStmt.run(parentKey);

          const entries = this._flattenObject(parentValue, parentKey);
          for (const [key, value] of entries) {
            this.setStmt.run(key, JSON.stringify(value));
          }
        }
      }
    }
  }
}

export default SqliteDriver;
