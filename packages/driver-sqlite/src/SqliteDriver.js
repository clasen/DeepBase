import { DeepBaseDriver } from 'deepbase';
import Database from 'better-sqlite3';
import fs from 'fs';
import * as pathModule from 'path';

const PRAGMA = {
  none: null,
  safe: {
    journal_mode: 'WAL',
    synchronous: 'FULL',
    temp_store: 'MEMORY',
    cache_size: -2000,
    busy_timeout: 5000,
    mmap_size: 0,
  },
  balanced: {
    journal_mode: 'WAL',
    synchronous: 'NORMAL',
    temp_store: 'MEMORY',
    cache_size: -8000,
    busy_timeout: 5000,
    mmap_size: 268435456,
  },
  fast: {
    journal_mode: 'WAL',
    synchronous: 'OFF',
    temp_store: 'MEMORY',
    cache_size: -16000,
    busy_timeout: 5000,
    mmap_size: 268435456,
  },
};

export class SqliteDriver extends DeepBaseDriver {
  static _instances = {};

  constructor({ name, path, pragma, ...opts } = {}) {
    super(opts);

    this.name = name || 'default';
    this.path = path || new URL('../../../db', import.meta.url).pathname;
    this.pragma = pragma || 'balanced';

    this.path = pathModule.resolve(this.path);
    this.fileName = pathModule.join(this.path, `${this.name}.db`);

    if (SqliteDriver._instances[this.fileName]) {
      return SqliteDriver._instances[this.fileName];
    }

    this.db = null;
    SqliteDriver._instances[this.fileName] = this;
  }

  async connect() {
    if (this._connected) return;

    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path, { recursive: true });
    }

    this.db = new Database(this.fileName);

    const cfg = PRAGMA[this.pragma];
    if (cfg) {
      this.db.pragma(`journal_mode = ${cfg.journal_mode}`);
      this.db.pragma(`synchronous = ${cfg.synchronous}`);
      this.db.pragma(`temp_store = ${cfg.temp_store}`);
      this.db.pragma(`cache_size = ${cfg.cache_size}`);
      this.db.pragma(`busy_timeout = ${cfg.busy_timeout}`);
      this.db.pragma(`mmap_size = ${cfg.mmap_size}`);
    }

    const withoutRowid = cfg ? ' WITHOUT ROWID' : '';
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deepbase (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )${withoutRowid}
    `);

    this.getStmt = this.db.prepare('SELECT value FROM deepbase WHERE key = ?');
    this.setStmt = this.db.prepare('INSERT OR REPLACE INTO deepbase (key, value) VALUES (?, ?)');
    this.delStmt = this.db.prepare('DELETE FROM deepbase WHERE key = ?');
    this.getAllStmt = this.db.prepare('SELECT key, value FROM deepbase');
    this.getKeysLikeStmt = this.db.prepare("SELECT key, value FROM deepbase WHERE key LIKE ? ESCAPE '!'");
    this.delChildrenStmt = this.db.prepare("DELETE FROM deepbase WHERE key LIKE ? ESCAPE '!'");
    this.hasChildrenStmt = this.db.prepare("SELECT 1 FROM deepbase WHERE key LIKE ? ESCAPE '!' LIMIT 1");

    this._setTxn = this.db.transaction((key, jsonValue, keys) => {
      this._expandParentObjects(keys);
      this.setStmt.run(key, jsonValue);
    });

    this._delTxn = this.db.transaction((key, likePattern) => {
      this.delStmt.run(key);
      this.delChildrenStmt.run(likePattern);
    });

    this._updTxn = this.db.transaction((keys, func) => {
      const currentValue = this._getSync(keys);
      const newValue = func(currentValue);
      const key = this._pathToKey(keys);
      this._expandParentObjects(keys);
      this.setStmt.run(key, JSON.stringify(newValue));
      return keys;
    });

    this._setRootTxn = this.db.transaction((entries) => {
      this.db.exec('DELETE FROM deepbase');
      for (const [key, value] of entries) {
        this.setStmt.run(key, JSON.stringify(value));
      }
    });

    this._connected = true;
  }

  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this._connected = false;
  }

  async get(...args) {
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
      await this._setRootObject(args[0]);
      return [];
    }

    return this._setSync(args);
  }

  _setSync(args) {
    const keys = args.slice(0, -1);
    const value = args[args.length - 1];
    const key = this._pathToKey(keys);
    this._setTxn(key, JSON.stringify(value), keys);
    return keys;
  }

  async del(...keys) {
    if (keys.length === 0) {
      this.db.exec('DELETE FROM deepbase');
      return;
    }

    const key = this._pathToKey(keys);
    this._delTxn(key, this._likePrefix(key));
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
    return this._updTxn(keys, func);
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

  async _setRootObject(obj) {
    const entries = this._flattenObject(obj);
    this._setRootTxn(entries);
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

  _escapeLikePattern(str) {
    return str.replace(/[!%_]/g, '!$&');
  }

  _likePrefix(key) {
    return this._escapeLikePattern(key) + '.%';
  }

  _setNestedValue(obj, path, value) {
    if (path.length === 0) return;

    if (path.length === 1) {
      obj[path[0]] = value;
      return;
    }

    const key = path[0];
    if (!obj.hasOwnProperty(key) || typeof obj[key] !== 'object') {
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
