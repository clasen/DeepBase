import { DeepBaseDriver, evaluateQuery, removeKey, resolveQueryWindow } from 'deepbase';
import Database from 'better-sqlite3';
import fs from 'fs';
import * as pathModule from 'path';
import { withBusyRetry } from './busy.js';
import { resolveSqliteConfig } from './config.js';
import { backupFrom, checkIntegrityAt, checkpoint, vacuum } from './maintenance.js';
import { ensureSchema } from './schema.js';

export class SqliteDriver extends DeepBaseDriver {
  constructor({
    name,
    path,
    pragma,
    busyTimeoutMs,
    busyRetry,
    queryWindowMaxRecords,
    queryWindowMaxProbes,
    ...opts
  } = {}) {
    super(opts);

    if (typeof path !== 'string' || path.trim() === '' || !pathModule.isAbsolute(path)) {
      throw new TypeError('SqliteDriver requires an absolute "path" option.');
    }

    const config = resolveSqliteConfig({
      pragma,
      busyTimeoutMs,
      busyRetry,
      queryWindowMaxRecords,
      queryWindowMaxProbes,
    });
    this.name = name || 'default';
    this.path = path;
    this.pragma = config.pragma;
    this.pragmaConfig = config.pragmaConfig;
    this.busyTimeoutMs = config.busyTimeoutMs;
    this.busyRetry = config.busyRetry;
    this.queryWindowMaxRecords = config.queryWindowMaxRecords;
    this.queryWindowMaxProbes = config.queryWindowMaxProbes;

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
    this.getChildrenStmt = this.db.prepare(
      'SELECT key, value FROM deepbase WHERE key >= ? AND key < ? ORDER BY seq, key',
    );
    this.getFirstChildKeyStmt = this.db.prepare(
      'SELECT key FROM deepbase WHERE key >= ? AND key < ? ORDER BY seq, key LIMIT 1',
    );
    this.getLastChildKeyStmt = this.db.prepare(
      'SELECT key FROM deepbase WHERE key >= ? AND key < ? ORDER BY seq DESC, key DESC LIMIT 1',
    );
    this.getFirstKeyStmt = this.db.prepare('SELECT key FROM deepbase ORDER BY seq, key LIMIT 1');
    this.getLastKeyStmt = this.db.prepare('SELECT key FROM deepbase ORDER BY seq DESC, key DESC LIMIT 1');
    this.delChildrenStmt = this.db.prepare('DELETE FROM deepbase WHERE key >= ? AND key < ?');
    this.hasChildrenStmt = this.db.prepare('SELECT 1 FROM deepbase WHERE key >= ? AND key < ? LIMIT 1');
    this.hasRangeStmt = this.db.prepare('SELECT 1 FROM deepbase WHERE key >= ? AND key < ? LIMIT 1');
    this.getChildKeysStmt = this.db.prepare('SELECT key FROM deepbase WHERE key >= ? AND key < ? ORDER BY key');
    this.getAllKeysStmt = this.db.prepare('SELECT key FROM deepbase ORDER BY key');

    const setTxn = this.db.transaction((key, jsonValue, keys) => {
      this._expandParentObjects(keys);
      this._replaceRow(key, jsonValue);
    });
    this._setTxn = (...args) => setTxn.immediate(...args);

    const delTxn = this.db.transaction((key, childLowerBound, childUpperBound, keys) => {
      this._expandParentObjects(keys);
      this.delStmt.run(key);
      this.delChildrenStmt.run(childLowerBound, childUpperBound);
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

  async checkIntegrity() {
    return checkIntegrityAt(this.fileName, this.busyTimeoutMs);
  }

  async backup(destination) {
    return backupFrom(this.fileName, destination, this.busyTimeoutMs);
  }

  async vacuum() {
    return this._runWrite(() => vacuum(this.db));
  }

  async checkpoint(mode = 'PASSIVE') {
    return this._runWrite(() => checkpoint(this.db, mode));
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

  async query(path, steps) {
    await this.connect();
    const window = resolveQueryWindow(steps);
    if (window) {
      const records = this._readQueryWindow(path, window);
      if (records) return evaluateQuery(records, window.rest, { path });
    }
    return evaluateQuery(this._getSync(path), steps, { path });
  }

  /**
   * Answer a leading skip()/take() window from the key index, so only the kept
   * records are rebuilt. Returns null when the window cannot be proven
   * equivalent to reading the collection in record order.
   * @param {Array<string|number>} path - Path to the queried object
   * @param {{offset: number, limit: number|null}} window - Resolved window
   * @returns {object|null} Records keyed by id, or null for the generic path
   */
  _readQueryWindow(path, { offset, limit }) {
    const needed = limit === null ? Infinity : offset + limit;
    if (needed === 0 || needed > this.queryWindowMaxRecords) return null;

    const ids = [];
    const seen = new Set();
    let probes = 0;
    let previous;

    const scan = path.length === 0
      ? this.getAllKeysStmt.iterate()
      : this.getChildKeysStmt.iterate(...this._childRange(this._pathToKey(path)));

    for (const row of scan) {
      const id = this._keyToPath(row.key)[path.length];
      if (id === undefined || id === previous) continue;
      // Record ids must sit in one run of rows, in ascending key order, for the
      // key index order to match the record order evaluateQuery() establishes.
      if (seen.has(id)) return null;
      // One probe per id character, plus the children probe below, keeps the
      // guard cheaper than reading the collection for any window we accept.
      probes += id.length + 1;
      if (probes > this.queryWindowMaxProbes) return null;
      // The first id sizes the whole window: long ids cost a probe each, so a
      // window that cannot fit the budget falls back before probing further.
      if (ids.length === 0 && needed * probes > this.queryWindowMaxProbes) return null;
      if (this._isWindowEdgeUnsafe(path, id)) return null;
      seen.add(id);
      previous = id;
      ids.push(id);
      if (ids.length >= needed) break;
    }

    // No rows means either a missing path or a value that is not an object;
    // both keep the generic path so it can report the same error.
    if (ids.length === 0) return null;

    const selected = limit === null ? ids.slice(offset) : ids.slice(offset, offset + limit);
    const records = {};
    for (const id of selected) {
      records[id] = this._getSync([...path, id]);
    }
    return records;
  }

  /**
   * Stored keys escape "." and "\\", and records expand into "<key>.<field>"
   * rows, so a key-order scan can disagree with the record order evaluateQuery()
   * uses. Probe the two shapes that can produce that disagreement.
   * @param {Array<string|number>} path - Path to the queried object
   * @param {string} id - Record id to check
   * @returns {boolean} True when a native window could skip an earlier record
   */
  _isWindowEdgeUnsafe(path, id) {
    for (let index = 0; index < id.length; index++) {
      const prefix = this._pathToKey([...path, id.slice(0, index)]);
      if (this.hasRangeStmt.get(`${prefix}\\`, `${prefix}]`)) return true;
      if (id[index] < '.' && this.hasChildrenStmt.get(...this._childRange(prefix))) return true;
    }
    return false;
  }

  _getSync(args) {
    if (args.length === 0) {
      return this._getRootObject();
    }

    const key = this._pathToKey(args);
    const row = this.getStmt.get(key);
    const childRange = this._childRange(key);

    if (row) {
      if (this.hasChildrenStmt.get(...childRange)) {
        return this._buildObjectFromChildren(key, childRange);
      }
      return JSON.parse(row.value);
    }

    if (this.hasChildrenStmt.get(...childRange)) {
      return this._buildObjectFromChildren(key, childRange);
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
    this.delChildrenStmt.run(...this._childRange(key));
    this.setStmt.run(key, jsonValue);
  }

  async del(...keys) {
    if (keys.length === 0) {
      return this._runWrite(() => {
        this._clearTxn();
      });
    }

    const key = this._pathToKey(keys);
    const childRange = this._childRange(key);
    return this._runWrite(() => {
      if (this._delArrayElement(keys)) return;
      this._delTxn(key, ...childRange, keys);
    });
  }

  /**
   * A stored array lives in one row, so deleting one of its indexes has to
   * splice the array and rewrite that row instead of deleting a child row that
   * does not exist. Returns true when the array handled the delete.
   * @param {Array<string|number>} keys - Path to the parent plus the index
   * @returns {boolean} True when an array element was removed
   */
  _delArrayElement(keys) {
    if (keys.length < 2) return false;

    const parentPath = keys.slice(0, -1);
    const parent = this._getSync(parentPath);
    if (!Array.isArray(parent)) return false;

    const index = keys[keys.length - 1];
    // removeKey() splices real indexes and ignores everything else.
    if (!removeKey(parent, index)) return false;

    this._setTxn(this._pathToKey(parentPath), JSON.stringify(parent), keys);
    return true;
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
    const row = path.length === 0
      ? (fromEnd ? this.getLastKeyStmt : this.getFirstKeyStmt).get()
      : (fromEnd ? this.getLastChildKeyStmt : this.getFirstChildKeyStmt)
        .get(...this._childRange(this._pathToKey(path)));
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

  _buildObjectFromChildren(parentKey, childRange) {
    const rows = this.getChildrenStmt.all(...childRange);
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

  _childRange(key) {
    // Stored descendants start with `${key}.`. Since '/' is the next ASCII
    // character after '.', this half-open range matches exactly that prefix
    // while allowing SQLite to seek through the primary-key index.
    return [`${key}.`, `${key}/`];
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
