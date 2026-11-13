import { DeepBaseDriver, evaluateQuery, removeKey, resolveQueryWindow } from 'deepbase';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import * as pathModule from 'path';
import { isSqliteBusyError, withBusyRetry } from './busy.js';
import { SQLITE_CONFIG, resolveSqliteConfig } from './config.js';
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
    this._pendingWrites = [];
    this._drainingWrites = false;
  }

  _connectSync() {
    if (this._connected) return;

    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path, { recursive: true });
    }

    this.db = new DatabaseSync(this.fileName, { timeout: this.busyTimeoutMs });

    const cfg = this.pragmaConfig;
    if (cfg) {
      this.db.exec(`
        PRAGMA journal_mode = ${cfg.journal_mode};
        PRAGMA synchronous = ${cfg.synchronous};
        PRAGMA temp_store = ${cfg.temp_store};
        PRAGMA cache_size = ${cfg.cache_size};
        PRAGMA mmap_size = ${cfg.mmap_size};
      `);
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

    this._connected = true;
  }

  async checkIntegrity() {
    return checkIntegrityAt(this.fileName, this.busyTimeoutMs);
  }

  async backup(destination) {
    return backupFrom(this.fileName, destination, this.busyTimeoutMs);
  }

  async vacuum() {
    return this._runMaintenance(() => vacuum(this.db));
  }

  async checkpoint(mode = 'PASSIVE') {
    return this._runMaintenance(() => checkpoint(this.db, mode));
  }

  _runMaintenance(operation) {
    return this._runExclusive(async () => {
      await this.connect();
      return withBusyRetry(operation, this.busyRetry);
    });
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
    return this._runExclusive(async () => {
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

  /**
   * Queue a synchronous write. Writes that pile up while a commit runs are
   * committed together, so concurrent callers share one transaction.
   * @param {Function} operation - Runs inside the write transaction
   * @returns {Promise<unknown>} Resolves with operation's result after COMMIT
   */
  _runWrite(operation) {
    return this._enqueueWrite(operation, true);
  }

  /**
   * Queue an async operation that must run alone, outside any transaction,
   * after every write queued before it.
   * @param {Function} operation - Async operation
   * @returns {Promise<unknown>} Operation's result
   */
  _runExclusive(operation) {
    return this._enqueueWrite(operation, false);
  }

  _enqueueWrite(operation, batchable) {
    return new Promise((resolve, reject) => {
      this._pendingWrites.push({ operation, batchable, resolve, reject });
      if (!this._drainingWrites) {
        this._drainingWrites = true;
        queueMicrotask(() => this._drainWrites());
      }
    });
  }

  async _drainWrites() {
    try {
      while (this._pendingWrites.length > 0) {
        if (!this._pendingWrites[0].batchable) {
          const entry = this._pendingWrites.shift();
          try {
            entry.resolve(await entry.operation());
          } catch (error) {
            entry.reject(error);
          }
          continue;
        }

        // Awaiting the connection also yields, so writes issued in the same
        // tick join this batch.
        let connectError = null;
        try {
          await this.connect();
        } catch (error) {
          connectError = error;
        }
        const batch = this._takeWriteBatch();
        if (connectError) {
          for (const entry of batch) entry.reject(connectError);
          continue;
        }

        let results;
        try {
          results = await withBusyRetry(() => this._commitWriteBatch(batch), this.busyRetry);
        } catch (error) {
          for (const entry of batch) entry.reject(error);
          continue;
        }
        batch.forEach((entry, index) => {
          const result = results[index];
          if (result.ok) entry.resolve(result.value);
          else entry.reject(result.error);
        });
      }
    } finally {
      this._drainingWrites = false;
    }
  }

  _takeWriteBatch() {
    const pending = this._pendingWrites;
    let count = 0;
    while (count < pending.length && count < SQLITE_CONFIG.writeBatchMaxOps && pending[count].batchable) {
      count += 1;
    }
    return pending.splice(0, count);
  }

  _commitWriteBatch(batch) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results = batch.length === 1
        ? [{ ok: true, value: batch[0].operation() }]
        : batch.map(entry => this._runInSavepoint(entry.operation));
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * Run one batched write so its failure undoes only its own changes.
   * Rethrows when the whole batch has to fail or retry: a busy error, or an
   * error after which SQLite already rolled the transaction back.
   */
  _runInSavepoint(operation) {
    this.db.exec('SAVEPOINT deepbase_write');
    try {
      const value = operation();
      this.db.exec('RELEASE deepbase_write');
      return { ok: true, value };
    } catch (error) {
      if (!this.db.isTransaction || isSqliteBusyError(error)) throw error;
      this.db.exec('ROLLBACK TO deepbase_write');
      this.db.exec('RELEASE deepbase_write');
      return { ok: false, error };
    }
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
        this.db.exec('DELETE FROM deepbase');
        for (const [entryKey, entryValue] of entries) {
          this.setStmt.run(entryKey, JSON.stringify(entryValue));
        }
        return [];
      });
    }

    const keys = args.slice(0, -1);
    const value = args[args.length - 1];
    const key = this._pathToKey(keys);
    const jsonValue = JSON.stringify(value);
    return this._runWrite(() => {
      this._setRows(key, jsonValue, keys);
      return keys;
    });
  }

  _setRows(key, jsonValue, keys) {
    this._expandParentObjects(keys);
    this._replaceRow(key, jsonValue);
  }

  _replaceRow(key, jsonValue) {
    this.delChildrenStmt.run(...this._childRange(key));
    this.setStmt.run(key, jsonValue);
  }

  async del(...keys) {
    if (keys.length === 0) {
      return this._runWrite(() => {
        this.db.exec('DELETE FROM deepbase');
      });
    }

    const key = this._pathToKey(keys);
    const childRange = this._childRange(key);
    return this._runWrite(() => {
      if (this._delArrayElement(keys)) return;
      this._expandParentObjects(keys);
      this.delStmt.run(key);
      this.delChildrenStmt.run(...childRange);
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

    this._setRows(this._pathToKey(parentPath), JSON.stringify(parent), keys);
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
    return this._runWrite(() => {
      const newValue = func(this._getSync(keys));
      this._setRows(this._pathToKey(keys), JSON.stringify(newValue), keys);
      return keys;
    });
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
