import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeepBase, DeepBaseDriver } from 'deepbase';
import { JsonDriver } from '../../driver-json/src/index.js';
import { SqliteDriver } from '../../driver-sqlite/src/index.js';
import {
  DeepBaseEncryptionError,
  encryptedValues,
} from 'deepbase/plugins/encryption';

const require = createRequire(import.meta.url);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class MemoryDriver extends DeepBaseDriver {
  constructor() {
    super();
    this.data = {};
    this.operations = [];
  }

  async get(...path) {
    return this._get(path);
  }

  getSync(...path) {
    return this._get(path);
  }

  _get(path) {
    let value = this.data;
    for (const segment of path) {
      if (value === null || typeof value !== 'object' || !(segment in value)) return null;
      value = value[segment];
    }
    return clone(value);
  }

  async set(...args) {
    this.operations.push('set');
    if (args.length === 1) {
      this.data = clone(args[0]);
      return [];
    }
    const path = args.slice(0, -1);
    let target = this.data;
    for (const segment of path.slice(0, -1)) {
      if (!target[segment] || typeof target[segment] !== 'object') target[segment] = {};
      target = target[segment];
    }
    target[path.at(-1)] = clone(args.at(-1));
    return path;
  }

  async del(...path) {
    if (path.length === 0) {
      this.data = {};
      return;
    }
    let target = this.data;
    for (const segment of path.slice(0, -1)) {
      if (!target[segment] || typeof target[segment] !== 'object') return;
      target = target[segment];
    }
    delete target[path.at(-1)];
  }

  async inc(...args) {
    this.operations.push('inc');
    const amount = args.pop();
    return this.upd(...args, (value) => value + amount);
  }

  async dec(...args) {
    this.operations.push('dec');
    const amount = args.pop();
    return this.upd(...args, (value) => value - amount);
  }

  async upd(...args) {
    this.operations.push('upd');
    const update = args.pop();
    return this.set(...args, update(await this.get(...args)));
  }
}

const keyA = () => Buffer.alloc(32, 0x11);
const keyB = () => Buffer.alloc(32, 0x22);

describe('deepbase/plugins/encryption', function() {
  it('validates keyrings without requiring path selectors', function() {
    assert.throws(() => encryptedValues(), /activeKeyId/);
    assert.throws(
      () => encryptedValues({ activeKeyId: 'a', keys: { a: Buffer.alloc(31) } }),
      /32-byte/,
    );
    assert.throws(
      () => encryptedValues({ activeKeyId: 'missing', keys: { a: keyA() } }),
      /not present/,
    );
    assert.doesNotThrow(
      () => encryptedValues({ activeKeyId: 'a', keys: { a: new Uint8Array(32) } }),
    );
  });

  it('encrypts every leaf without selectors while preserving paths and array shapes', async function() {
    const driver = new MemoryDriver();
    const db = new DeepBase(driver).use(encryptedValues({
      activeKeyId: 'primary',
      keys: { primary: keyA() },
    }));
    const value = {
      config: { token: 'secret', nested: [1, null, true] },
      users: { alice: { name: 'Alice', privateKey: 'private' } },
      public: 'visible',
      emptyObject: {},
      emptyArray: [],
    };

    await db.set(value);
    const raw = await driver.get();

    function assertEncryptedTree(stored, plaintext) {
      if (plaintext !== null && typeof plaintext === 'object') {
        assert.strictEqual(Array.isArray(stored), Array.isArray(plaintext));
        assert.deepStrictEqual(Object.keys(stored), Object.keys(plaintext));
        for (const key of Object.keys(plaintext)) assertEncryptedTree(stored[key], plaintext[key]);
      } else {
        assert.strictEqual(stored.$deepbase.plugin, 'encryption');
        assert.strictEqual(stored.$deepbase.algorithm, 'A256GCM');
        assert.strictEqual(stored.$deepbase.keyId, 'primary');
      }
    }
    assertEncryptedTree(raw, value);
    assert.deepStrictEqual(await db.get(), value);
    assert.deepStrictEqual(await db.get('config'), value.config);
    assert.strictEqual(await db.get('config', 'nested', 1), null);

    await db.set('config', 'anotherToken', 'another secret');
    assert.strictEqual((await driver.get('config', 'anotherToken')).$deepbase.plugin, 'encryption');
    assert.strictEqual(await db.get('config', 'anotherToken'), 'another secret');
  });

  it('decrypts through getSync and rejects async-only plugin gaps in core', async function() {
    const driver = new MemoryDriver();
    const db = new DeepBase(driver).use(encryptedValues({
      activeKeyId: 'primary',
      keys: { primary: keyA() },
    }));

    await db.set('secret', { token: 'value' });
    assert.deepStrictEqual(db.getSync('secret'), { token: 'value' });
  });

  it('reads previous keys and rewrites values with the active key', async function() {
    const driver = new MemoryDriver();
    const oldDb = new DeepBase(driver).use(encryptedValues({
      activeKeyId: 'old',
      keys: { old: keyA() },
    }));
    await oldDb.set('secret', 'value');
    assert.strictEqual((await driver.get('secret')).$deepbase.keyId, 'old');

    const newDb = new DeepBase(driver).use(encryptedValues({
      activeKeyId: 'new',
      keys: { old: keyA(), new: keyB() },
    }));
    assert.strictEqual(await newDb.get('secret'), 'value');
    await newDb.set('secret', await newDb.get('secret'));
    assert.strictEqual((await driver.get('secret')).$deepbase.keyId, 'new');
  });

  it('translates encrypted inc and dec to upd and decodes upd callbacks', async function() {
    const driver = new MemoryDriver();
    const db = new DeepBase(driver).use(encryptedValues({
      activeKeyId: 'primary',
      keys: { primary: keyA() },
    }));

    await db.set('private', 'counter', 10);
    await db.inc('private', 'counter', 5);
    await db.dec('private', 'counter', 2);
    await db.upd('private', (value) => ({ ...value, label: 'updated' }));
    await db.set('publicCounter', 1);
    await db.inc('publicCounter', 1);
    await db.dec('missingCounter', 2);

    assert.deepStrictEqual(await db.get('private'), { counter: 13, label: 'updated' });
    assert.strictEqual(await db.get('publicCounter'), 2);
    assert.strictEqual(await db.get('missingCounter'), -2);
    assert.strictEqual((await driver.get('publicCounter')).$deepbase.plugin, 'encryption');
    assert.strictEqual((await driver.get('missingCounter')).$deepbase.plugin, 'encryption');
    assert.strictEqual((await driver.get('private', 'label')).$deepbase.plugin, 'encryption');
    assert.ok(driver.operations.every((operation) => operation !== 'inc' && operation !== 'dec'));
    assert.strictEqual(driver.operations.filter((operation) => operation === 'upd').length, 5);
  });

  it('fails closed for tampering, malformed envelopes and unknown keys', async function() {
    const driver = new MemoryDriver();
    const db = new DeepBase(driver).use(encryptedValues({
      activeKeyId: 'primary',
      keys: { primary: keyA() },
    }));
    await db.set('secret', 'value');

    const ciphertext = driver.data.secret.$deepbase.ciphertext;
    driver.data.secret.$deepbase.ciphertext = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;
    await assert.rejects(
      db.get('secret'),
      (error) => error instanceof DeepBaseEncryptionError && error.code === 'ENCRYPTION_AUTHENTICATION_FAILED',
    );

    driver.data.secret = { $deepbase: { plugin: 'encryption', version: 1 } };
    await assert.rejects(
      db.get('secret'),
      (error) => error.code === 'ENCRYPTION_MALFORMED_ENVELOPE',
    );

    const writer = new DeepBase(driver).use(encryptedValues({
      activeKeyId: 'old',
      keys: { old: keyA() },
    }));
    await writer.set('secret', 'old value');
    const reader = new DeepBase(driver).use(encryptedValues({
      activeKeyId: 'new',
      keys: { new: keyB() },
    }));
    await assert.rejects(
      reader.get('secret'),
      (error) => error.code === 'ENCRYPTION_UNKNOWN_KEY' && error.keyId === 'old',
    );
  });

  it('validates schema against plaintext and writes identical ciphertext to every driver', async function() {
    const primary = new MemoryDriver();
    const secondary = new MemoryDriver();
    const schema = {
      entities: {
        configs: {
          path: ['configs', ':id'],
          additionalFields: false,
          fields: { token: { type: 'string', required: true } },
        },
      },
    };
    const db = new DeepBase([primary, secondary], { schema }).use(encryptedValues({
      activeKeyId: 'primary',
      keys: { primary: keyA() },
    }));

    await db.set('configs', 'app', { token: 'secret' });
    assert.deepStrictEqual(primary.data, secondary.data);
    assert.deepStrictEqual(await db.validateSchema(), { valid: true, errors: [] });
    assert.strictEqual((await primary.get('configs', 'app', 'token')).$deepbase.plugin, 'encryption');
  });

  it('keeps migrate() on raw ciphertext', async function() {
    const source = new MemoryDriver();
    const target = new MemoryDriver();
    const plugin = encryptedValues({
      activeKeyId: 'primary',
      keys: { primary: keyA() },
    });
    const db = new DeepBase([source, target], { writeAll: false }).use(plugin);
    await db.set('secret', 'value');
    const sourceRaw = await source.get('secret');

    await db.migrate(0, 1);

    assert.deepStrictEqual(await target.get('secret'), sourceRaw);
    assert.notStrictEqual(await target.get('secret'), 'value');
  });

  it('works through the real JSON and SQLite driver contracts', async function() {
    const directory = await mkdtemp(path.join(tmpdir(), 'deepbase-encryption-'));

    try {
      for (const [name, driver] of [
        ['json', new JsonDriver({ path: directory, name: 'encrypted-json' })],
        ['sqlite', new SqliteDriver({ path: directory, name: 'encrypted-sqlite' })],
      ]) {
        const db = new DeepBase(driver).use(encryptedValues({
          activeKeyId: 'primary',
          keys: { primary: keyA() },
        }));

        await db.set('private', 'counter', 1);
        await db.inc('private', 'counter', 2);
        assert.strictEqual(await db.get('private', 'counter'), 3, name);
        assert.strictEqual((await driver.get('private', 'counter')).$deepbase.plugin, 'encryption', name);
        await db.dispose({ clearMemory: true, releaseInstance: true });
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('exports the factory and error through CommonJS', function() {
    const commonjs = require('deepbase/plugins/encryption');
    assert.strictEqual(commonjs, encryptedValues);
    assert.strictEqual(commonjs.encryptedValues, encryptedValues);
    assert.strictEqual(commonjs.DeepBaseEncryptionError, DeepBaseEncryptionError);
  });
});
