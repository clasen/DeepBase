import { DeepBaseDriver } from 'deepbase';
import { asc, eq, sql } from 'drizzle-orm';
import { integer as pgInteger, pgTable, text as pgText } from 'drizzle-orm/pg-core';
import { int as mysqlInt, mysqlTable, text as mysqlText, varchar as mysqlVarchar } from 'drizzle-orm/mysql-core';
import { integer as sqliteInteger, sqliteTable, text as sqliteText } from 'drizzle-orm/sqlite-core';

function resolveDialectName(db) {
  return db?.dialect?.constructor?.name ?? 'UnknownDialect';
}

function createDefaultTable(dialectName, tableName) {
  const normalizedName = typeof tableName === 'string' && tableName.trim()
    ? tableName.trim()
    : 'deepbase_main';

  if (/mysql/i.test(dialectName)) {
    return mysqlTable(normalizedName, {
      key: mysqlVarchar('key', { length: 512 }).primaryKey(),
      value: mysqlText('value').notNull(),
      seq: mysqlInt('seq').notNull().default(0),
    });
  }

  if (/pg|postgres/i.test(dialectName)) {
    return pgTable(normalizedName, {
      key: pgText('key').primaryKey(),
      value: pgText('value').notNull(),
      seq: pgInteger('seq').notNull().default(0),
    });
  }

  if (/sqlite|libsql|turso/i.test(dialectName)) {
    return sqliteTable(normalizedName, {
      key: sqliteText('key').primaryKey(),
      value: sqliteText('value').notNull(),
      seq: sqliteInteger('seq').notNull().default(0),
    });
  }

  throw new Error(
    `DrizzleDriver could not infer default table for dialect "${dialectName}". Provide table explicitly.`,
  );
}

/**
 * DeepBase driver backed by a user-supplied Drizzle ORM instance.
 * The SQL dialect and client (SQLite, PostgreSQL, MySQL, etc.) are chosen when constructing `db` outside this package.
 *
 * If `table` is omitted, the driver creates a default Drizzle table schema named `deepbase_main`
 * (or the provided `tableName`) for sqlite/postgres/mysql dialects.
 * The physical table is auto-created on connect by default.
 */
export class DrizzleDriver extends DeepBaseDriver {
  /**
   * @param {object} opts
   * @param {object} opts.db - Drizzle database (e.g. drizzle({ client }) from your dialect entrypoint)
   * @param {object} [opts.table] - Optional Drizzle table with `.key`, `.value`, `.seq` columns
   * @param {string} [opts.tableName='deepbase_main'] - Used only when `table` is omitted
   * @param {object} [opts.client] - Underlying driver handle; if it has `.close()`, it is called on disconnect() unless onDisconnect is set
   * @param {() => void | Promise<void>} [opts.onDisconnect] - Overrides default disconnect behavior when set
   * @param {() => { db: object, client?: object } | Promise<{ db: object, client?: object }>} [opts.reopen] - After disconnect, connect() calls this to obtain a new db (and optional client), e.g. reopen a file pool
   * @param {boolean | ((ctx: { db: object, table: object, dialect: string }) => void | Promise<void>)} [opts.ensureTable=true]
   * - true: create `key/value/seq` table automatically if missing (default)
   * - false: skip auto-create
   * - function: custom ensure logic per dialect
   */
  constructor({ db, table, tableName = 'deepbase_main', client, onDisconnect, reopen, ensureTable = true, ...opts } = {}) {
    super(opts);

    if (!db) {
      throw new Error('DrizzleDriver requires db (drizzle instance)');
    }

    const resolvedTable = table ?? createDefaultTable(resolveDialectName(db), tableName);

    if (!resolvedTable || !resolvedTable.key || !resolvedTable.value || !resolvedTable.seq) {
      throw new Error('DrizzleDriver requires table with key, value, and seq columns');
    }

    this.drizzle = db;
    this.table = resolvedTable;
    this.client = client ?? null;
    this.onDisconnect = onDisconnect ?? null;
    this.reopen = reopen ?? null;
    this.ensureTable = ensureTable;
    this._schemaEnsured = false;
  }

  _ensureReady() {
    if (!this.table) {
      throw new Error('DrizzleDriver requires table');
    }
    if (!this.drizzle) {
      throw new Error('DrizzleDriver has no active db; call connect() after disconnect if reopen is configured');
    }
  }

  _setTxn(key, jsonValue, keys) {
    this.drizzle.transaction((tx) => {
      this._expandParentObjects(tx, keys);
      this._setRow(tx, key, jsonValue);
    });
  }

  _delTxn(key, likePattern) {
    this.drizzle.transaction((tx) => {
      this._delRow(tx, key);
      this._deleteLike(tx, likePattern);
    });
  }

  _dialectName() {
    return this.drizzle?.dialect?.constructor?.name ?? 'UnknownDialect';
  }

  _getTableName() {
    const symbols = Object.getOwnPropertySymbols(this.table);
    const nameSymbol = symbols.find((s) => s.description === 'drizzle:Name');
    const tableName = nameSymbol ? this.table[nameSymbol] : null;
    if (!tableName || typeof tableName !== 'string') {
      throw new Error('DrizzleDriver could not resolve table name from schema');
    }
    return tableName;
  }

  _quoteIdent(ident, dialectName) {
    if (/mysql|singlestore/i.test(dialectName)) {
      return `\`${String(ident).replace(/`/g, '``')}\``;
    }
    if (/mssql/i.test(dialectName)) {
      return `[${String(ident).replace(/]/g, ']]')}]`;
    }
    return `"${String(ident).replace(/"/g, '""')}"`;
  }

  _buildCreateTableSql() {
    const dialect = this._dialectName();
    const tableName = this._quoteIdent(this._getTableName(), dialect);
    const keyCol = this._quoteIdent(this.table.key?.name ?? 'key', dialect);
    const valueCol = this._quoteIdent(this.table.value?.name ?? 'value', dialect);
    const seqCol = this._quoteIdent(this.table.seq?.name ?? 'seq', dialect);

    if (/mysql|singlestore/i.test(dialect)) {
      return `CREATE TABLE IF NOT EXISTS ${tableName} (${keyCol} VARCHAR(512) PRIMARY KEY, ${valueCol} LONGTEXT NOT NULL, ${seqCol} BIGINT NOT NULL DEFAULT 0)`;
    }
    if (/mssql/i.test(dialect)) {
      return `IF OBJECT_ID(N'${this._getTableName()}', N'U') IS NULL CREATE TABLE ${tableName} (${keyCol} NVARCHAR(450) NOT NULL PRIMARY KEY, ${valueCol} NVARCHAR(MAX) NOT NULL, ${seqCol} BIGINT NOT NULL DEFAULT 0)`;
    }
    return `CREATE TABLE IF NOT EXISTS ${tableName} (${keyCol} TEXT PRIMARY KEY, ${valueCol} TEXT NOT NULL, ${seqCol} INTEGER NOT NULL DEFAULT 0)`;
  }

  _buildAlterSeqSql() {
    const dialect = this._dialectName();
    const tableName = this._quoteIdent(this._getTableName(), dialect);
    const seqCol = this._quoteIdent(this.table.seq?.name ?? 'seq', dialect);

    if (/mysql|singlestore/i.test(dialect)) {
      return `ALTER TABLE ${tableName} ADD COLUMN ${seqCol} BIGINT NOT NULL DEFAULT 0`;
    }
    if (/mssql/i.test(dialect)) {
      return `ALTER TABLE ${tableName} ADD ${seqCol} BIGINT NOT NULL DEFAULT 0`;
    }
    return `ALTER TABLE ${tableName} ADD COLUMN ${seqCol} INTEGER NOT NULL DEFAULT 0`;
  }

  _isDuplicateColumnError(error) {
    const msg = String(error?.message ?? '').toLowerCase();
    const causeMsg = String(error?.cause?.message ?? '').toLowerCase();
    const full = `${msg} ${causeMsg}`;
    return (
      full.includes('duplicate column') ||
      full.includes('already exists') ||
      full.includes('column exists')
    );
  }

  _executeRaw(sqlText) {
    if (typeof this.drizzle?.execute === 'function') {
      return this.drizzle.execute(sql.raw(sqlText));
    }
    if (typeof this.drizzle?.run === 'function') {
      return this.drizzle.run(sql.raw(sqlText));
    }
    if (this.client && typeof this.client.exec === 'function') {
      return this.client.exec(sqlText);
    }
    if (this.client && typeof this.client.query === 'function') {
      return this.client.query(sqlText);
    }
    throw new Error('DrizzleDriver cannot execute raw SQL for ensureTable');
  }

  async _ensureTableIfNeeded() {
    if (this._schemaEnsured) return;
    if (this.ensureTable === false) {
      this._schemaEnsured = true;
      return;
    }

    if (typeof this.ensureTable === 'function') {
      await Promise.resolve(
        this.ensureTable({
          db: this.drizzle,
          table: this.table,
          dialect: this._dialectName(),
        }),
      );
      this._schemaEnsured = true;
      return;
    }

    await Promise.resolve(this._executeRaw(this._buildCreateTableSql()));
    try {
      await Promise.resolve(this._executeRaw(this._buildAlterSeqSql()));
    } catch (error) {
      if (!this._isDuplicateColumnError(error)) {
        throw error;
      }
    }
    this._schemaEnsured = true;
  }

  _ensureTableForSyncAccess() {
    if (this._schemaEnsured) return;
    if (this.ensureTable !== true) return;
    this._executeRaw(this._buildCreateTableSql());
    try {
      this._executeRaw(this._buildAlterSeqSql());
    } catch (error) {
      if (!this._isDuplicateColumnError(error)) {
        throw error;
      }
    }
    this._schemaEnsured = true;
  }

  _updTxn(keys, func) {
    return this.drizzle.transaction((tx) => {
      const currentValue = this._getSyncFrom(tx, keys);
      const newValue = func(currentValue);
      const key = this._pathToKey(keys);
      this._expandParentObjects(tx, keys);
      this._setRow(tx, key, JSON.stringify(newValue));
      return keys;
    });
  }

  /** @param {any} d drizzle or transaction */
  _getRow(d, key) {
    const t = this.table;
    return d.select().from(t).where(eq(t.key, key)).limit(1).get();
  }

  /** Upsert: new keys get next seq; existing key updates value only (seq unchanged). */
  _setRow(d, key, jsonStr) {
    const t = this.table;
    d.insert(t)
      .values({
        key,
        value: jsonStr,
        seq: sql`(SELECT COALESCE(MAX(${t.seq}), 0) + 1 FROM ${t})`,
      })
      .onConflictDoUpdate({
        target: t.key,
        set: { value: sql`excluded.value` },
      })
      .run();
  }

  /** @param {any} d */
  _delRow(d, key) {
    const t = this.table;
    d.delete(t).where(eq(t.key, key)).run();
  }

  /** @param {any} d */
  _hasChildren(d, likePattern) {
    const t = this.table;
    const row = d
      .select({ k: t.key })
      .from(t)
      .where(sql`${t.key} LIKE ${likePattern} ESCAPE '!'`)
      .limit(1)
      .get();
    return !!row;
  }

  /** @param {any} d */
  _selectKeysLike(d, likePattern) {
    const t = this.table;
    return d
      .select()
      .from(t)
      .where(sql`${t.key} LIKE ${likePattern} ESCAPE '!'`)
      .orderBy(asc(t.seq), asc(t.key))
      .all();
  }

  /** @param {any} d */
  _deleteLike(d, likePattern) {
    const t = this.table;
    d.delete(t).where(sql`${t.key} LIKE ${likePattern} ESCAPE '!'`).run();
  }

  async connect() {
    if (this.reopen && !this.drizzle) {
      const r = await Promise.resolve(this.reopen());
      this.drizzle = r.db;
      this.client = r.client ?? null;
      this._schemaEnsured = false;
    }
    this._ensureReady();
    await this._ensureTableIfNeeded();
    this._connected = true;
  }

  async disconnect() {
    if (typeof this.onDisconnect === 'function') {
      await Promise.resolve(this.onDisconnect());
    } else if (this.client && typeof this.client.close === 'function') {
      this.client.close();
    }
    if (this.reopen) {
      this.drizzle = null;
      this.client = null;
    }
    this._connected = false;
  }

  async get(...args) {
    return this._getSync(args);
  }

  getSync(...args) {
    this._ensureReady();
    this._ensureTableForSyncAccess();
    this._connected = true;
    return this._getSync(args);
  }

  _getSync(args) {
    return this._getSyncFrom(this.drizzle, args);
  }

  /** @param {any} d */
  _getSyncFrom(d, args) {
    if (args.length === 0) {
      return this._getRootObject(d);
    }

    const key = this._pathToKey(args);
    const row = this._getRow(d, key);
    const likePattern = this._likePrefix(key);

    if (row) {
      if (this._hasChildren(d, likePattern)) {
        return this._buildObjectFromChildren(d, key, likePattern);
      }
      return JSON.parse(row.value);
    }

    if (this._hasChildren(d, likePattern)) {
      return this._buildObjectFromChildren(d, key, likePattern);
    }

    return this._getFromParent(d, args);
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
    this._ensureReady();
    if (keys.length === 0) {
      const t = this.table;
      this.drizzle.delete(t).run();
      return;
    }

    const key = this._pathToKey(keys);
    this._delTxn(key, this._likePrefix(key));
  }

  async inc(...args) {
    const i = args.pop();
    return this.upd(...args, (n) => n + i);
  }

  async dec(...args) {
    const i = args.pop();
    return this.upd(...args, (n) => n - i);
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

  /** @param {any} d */
  _getRootObject(d) {
    const t = this.table;
    const rows = d.select().from(t).orderBy(asc(t.seq), asc(t.key)).all();
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
    const t = this.table;
    this.drizzle.transaction((tx) => {
      tx.delete(t).run();
      for (const [key, value] of entries) {
        this._setRow(tx, key, JSON.stringify(value));
      }
    });
  }

  /** @param {any} d */
  _buildObjectFromChildren(d, parentKey, likePattern) {
    const rows = this._selectKeysLike(d, likePattern || (parentKey ? this._likePrefix(parentKey) : '%'));
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
    if (!Object.prototype.hasOwnProperty.call(obj, key) || typeof obj[key] !== 'object') {
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

  /** @param {any} d */
  _getFromParent(d, path) {
    for (let i = path.length - 1; i > 0; i--) {
      const parentPath = path.slice(0, i);
      const parentKey = this._pathToKey(parentPath);
      const row = this._getRow(d, parentKey);
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
    if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;

    return this._getFromObject(obj[key], path.slice(1));
  }

  /** @param {any} d */
  _expandParentObjects(d, path) {
    for (let i = 1; i < path.length; i++) {
      const parentPath = path.slice(0, i);
      const parentKey = this._pathToKey(parentPath);
      const parentRow = this._getRow(d, parentKey);

      if (parentRow) {
        const parentValue = JSON.parse(parentRow.value);

        if (parentValue !== null && typeof parentValue === 'object' && !Array.isArray(parentValue)) {
          this._delRow(d, parentKey);

          const entries = this._flattenObject(parentValue, parentKey);
          for (const [key, value] of entries) {
            this._setRow(d, key, JSON.stringify(value));
          }
        }
      }
    }
  }
}

export default DrizzleDriver;
