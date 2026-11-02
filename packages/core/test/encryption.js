import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeepBase, DeepBaseDriver } from 'deepbase';
import { JsonDriver } from '../../driver-json/src/index.js';
import { SqliteDriver } from '../../driver-sqlite/src/index.js';
import {
  DeepBaseEncryptionError,
  encryptedDocument,
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
    this.operations.push('del');
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

const PASSWORD = 'correct horse battery staple';
const fastKdf = { N: 2 ** 14, r: 8, p: 1 };
const keyA = () => Buffer.alloc(32, 0x11);
const keyB = () => Buffer.alloc(32, 0x22);

const wallet = {
  account: { EthereumNetwork: { address: '0xUSERADDRESS', privateKey: 'PRIVATE-KEY-HEX' } },
  contact: {
    ethereum: {
      '0xALICEADDRESS': { name: 'Alice' },
      '0xMALLORYADDR': { name: 'Mallo' },
    },
  },
  transactions: { '0xUSERADDRESS': { ETH: { tx1: { amount: '1.5' } } } },
  mnemonic: 'abandon abandon abandon about',
};

function passwordDb(driver, options = {}) {
  const plugin = encryptedDocument({ password: PASSWORD, kdf: fastKdf, ...options });
  return { db: new DeepBase(driver).use(plugin), plugin };
}

function isEncryptionError(code) {
  return (error) => error instanceof DeepBaseEncryptionError && error.code === code;
}

function plaintextStrings(value, found = []) {
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.push(key);
      plaintextStrings(item, found);
    }
  } else if (typeof value === 'string') {
    found.push(value);
  }
  return found;
}

function assertOpaque(serialized) {
  // Shorter strings ('name', 'ETH') also occur in headers, stack traces or random base64.
  for (const text of plaintextStrings(wallet).filter((item) => item.length >= 5)) {
    assert.ok(!serialized.includes(text), `stored data reveals ${text}`);
  }
}

describe('deepbase/plugins/encryption', function() {
  this.timeout(20000);

  it('validates password, KDF and keyring options', function() {
    assert.throws(() => encryptedDocument(), /password or a non-empty activeKeyId/);
    assert.throws(() => encryptedDocument({ password: '' }), /non-empty string or Uint8Array/);
    assert.throws(
      () => encryptedDocument({ password: PASSWORD, activeKeyId: 'a', keys: { a: keyA() } }),
      /either a password or activeKeyId and keys/,
    );
    assert.throws(() => encryptedDocument({ password: PASSWORD, kdf: { N: 3 * 2 ** 14 } }), /power of two/);
    assert.throws(() => encryptedDocument({ password: PASSWORD, kdf: { N: 2 ** 12 } }), /power of two/);
    assert.throws(() => encryptedDocument({ password: PASSWORD, kdf: { N: 2 ** 20, r: 8 } }), /128 \* N \* r/);
    assert.throws(() => encryptedDocument({ password: PASSWORD, kdf: { salt: 'x' } }), /only N, r and p/);
    assert.throws(
      () => encryptedDocument({ activeKeyId: 'a', keys: { a: keyA() }, kdf: fastKdf }),
      /kdf requires a password/,
    );
    assert.throws(() => encryptedDocument({ activeKeyId: 'a', keys: { a: Buffer.alloc(31) } }), /32-byte/);
    assert.throws(() => encryptedDocument({ activeKeyId: 'missing', keys: { a: keyA() } }), /not present/);
    assert.doesNotThrow(() => encryptedDocument({ password: new Uint8Array([1, 2, 3]) }));
    assert.doesNotThrow(() => encryptedDocument({ activeKeyId: 'a', keys: { a: new Uint8Array(32) } }));
  });

  it('stores the whole document as one authenticated envelope with no visible structure', async function() {
    const driver = new MemoryDriver();
    const { db } = passwordDb(driver);

    await db.set(wallet);

    assert.deepStrictEqual(Object.keys(driver.data), ['$deepbase']);
    const envelope = driver.data.$deepbase;
    assert.deepStrictEqual(Object.keys(envelope), ['plugin', 'version', 'algorithm', 'kdf', 'iv', 'tag', 'ciphertext']);
    assert.strictEqual(envelope.plugin, 'encryption');
    assert.strictEqual(envelope.version, 2);
    assert.strictEqual(envelope.algorithm, 'A256GCM');
    assert.deepStrictEqual(Object.keys(envelope.kdf), ['name', 'N', 'r', 'p', 'salt']);
    assert.deepStrictEqual({ ...envelope.kdf, salt: undefined }, { name: 'scrypt', ...fastKdf, salt: undefined });
    assertOpaque(JSON.stringify(driver.data));

    assert.deepStrictEqual(await db.get(), wallet);
    assert.deepStrictEqual(await db.get('contact', 'ethereum'), wallet.contact.ethereum);
    assert.strictEqual(await db.get('account', 'EthereumNetwork', 'privateKey'), 'PRIVATE-KEY-HEX');
    assert.strictEqual(await db.get('contact', 'missing', 'name'), null);
  });

  it('derives the key once per open and only re-encrypts with a fresh IV on writes', async function() {
    const driver = new MemoryDriver();
    const { db, plugin } = passwordDb(driver);

    await db.set('profile', { name: 'first' });
    const first = driver.data.$deepbase;
    await db.set('profile', 'name', 'second');
    await db.set('networkUsage', 'ethereum', 1);
    const latest = driver.data.$deepbase;

    assert.strictEqual(plugin._derivedKeys.size, 1);
    assert.deepStrictEqual(latest.kdf, first.kdf);
    assert.notStrictEqual(latest.iv, first.iv);
    assert.deepStrictEqual(await db.get(), { profile: { name: 'second' }, networkUsage: { ethereum: 1 } });
  });

  it('fails closed when the ciphertext, tag or authenticated header is tampered with', async function() {
    const driver = new MemoryDriver();
    const { db } = passwordDb(driver);
    await db.set(wallet);
    const original = clone(driver.data.$deepbase);

    async function assertTamperFails(mutate, code) {
      driver.data.$deepbase = clone(original);
      mutate(driver.data.$deepbase);
      await assert.rejects(db.get('mnemonic'), isEncryptionError(code));
    }

    const flipFirstByte = (base64) => {
      const bytes = Buffer.from(base64, 'base64');
      bytes[0] ^= 0x01;
      return bytes.toString('base64');
    };

    await assertTamperFails((envelope) => { envelope.ciphertext = flipFirstByte(envelope.ciphertext); }, 'ENCRYPTION_AUTHENTICATION_FAILED');
    await assertTamperFails((envelope) => { envelope.tag = flipFirstByte(envelope.tag); }, 'ENCRYPTION_AUTHENTICATION_FAILED');
    await assertTamperFails((envelope) => { envelope.iv = flipFirstByte(envelope.iv); }, 'ENCRYPTION_AUTHENTICATION_FAILED');
    await assertTamperFails((envelope) => { envelope.kdf.salt = flipFirstByte(envelope.kdf.salt); }, 'ENCRYPTION_AUTHENTICATION_FAILED');
    await assertTamperFails((envelope) => { envelope.kdf.N = 2 ** 15; }, 'ENCRYPTION_AUTHENTICATION_FAILED');
    await assertTamperFails((envelope) => { envelope.version = 1; }, 'ENCRYPTION_MALFORMED_DOCUMENT');
    await assertTamperFails((envelope) => { envelope.extra = true; }, 'ENCRYPTION_MALFORMED_DOCUMENT');
    await assertTamperFails((envelope) => { envelope.kdf.N = 2 ** 30; }, 'ENCRYPTION_MALFORMED_DOCUMENT');
    await assertTamperFails((envelope) => { envelope.kdf.p = 1000; }, 'ENCRYPTION_MALFORMED_DOCUMENT');
    await assertTamperFails((envelope) => { envelope.kdf = { name: 'none' }; }, 'ENCRYPTION_MALFORMED_DOCUMENT');

    driver.data.$deepbase = clone(original);
    assert.deepStrictEqual(await db.get(), wallet);
  });

  it('rejects transplanted, truncated and rolled-back leaves inside the document', async function() {
    const driver = new MemoryDriver();
    const { db } = passwordDb(driver);
    await db.set(wallet);
    const older = clone(driver.data.$deepbase);
    await db.set('transactions', '0xUSERADDRESS', 'ETH', 'tx1', 'amount', '9.9');
    const current = clone(driver.data.$deepbase);
    const plaintext = JSON.stringify(await db.get());

    async function assertCiphertextFails(mutateBytes) {
      const bytes = Buffer.from(current.ciphertext, 'base64');
      mutateBytes(bytes);
      driver.data.$deepbase = { ...clone(current), ciphertext: bytes.toString('base64') };
      await assert.rejects(db.get(), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));
    }

    // AES-GCM is a stream cipher, so plaintext offsets locate the bytes an attacker would move.
    const alice = plaintext.indexOf('"Alice"') + 1;
    const mallory = plaintext.indexOf('"Mallo"') + 1;
    await assertCiphertextFails((bytes) => {
      const aliceBytes = Buffer.from(bytes.subarray(alice, alice + 5));
      bytes.copy(bytes, alice, mallory, mallory + 5);
      aliceBytes.copy(bytes, mallory);
    });

    await assertCiphertextFails((bytes) => {
      const target = Buffer.from('Mallo');
      for (let index = 0; index < 5; index++) bytes[alice + index] ^= 'Alice'.charCodeAt(index) ^ target[index];
    });

    const amount = plaintext.indexOf('"9.9"') + 1;
    const olderBytes = Buffer.from(older.ciphertext, 'base64');
    await assertCiphertextFails((bytes) => {
      const olderIv = Buffer.from(older.iv, 'base64');
      assert.notDeepStrictEqual(olderIv, Buffer.from(current.iv, 'base64'));
      olderBytes.copy(bytes, amount, amount, amount + 3);
    });

    driver.data.$deepbase = { ...clone(current), ciphertext: Buffer.from(current.ciphertext, 'base64').subarray(0, -1).toString('base64') };
    await assert.rejects(db.get(), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));

    driver.data.$deepbase = { ...clone(current), ciphertext: older.ciphertext };
    await assert.rejects(db.get(), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));

    driver.data.$deepbase = { ...clone(current), tag: older.tag };
    await assert.rejects(db.get(), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));

    driver.data.$deepbase = clone(current);
    assert.strictEqual(await db.get('contact', 'ethereum', '0xALICEADDRESS', 'name'), 'Alice');
  });

  it('refuses to write over a document it cannot authenticate', async function() {
    const driver = new MemoryDriver();
    await passwordDb(driver).db.set(wallet);
    const stored = clone(driver.data);

    const { db } = passwordDb(driver, { password: 'wrong password' });
    await assert.rejects(db.get('mnemonic'), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));
    await assert.rejects(db.set('mnemonic', 'attacker'), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));
    await assert.rejects(db.set({}), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));
    await assert.rejects(db.del(), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));
    assert.deepStrictEqual(driver.data, stored);
  });

  it('detects a document removed after open and plaintext stored beside it', async function() {
    const driver = new MemoryDriver();
    const { db } = passwordDb(driver);
    await db.set('profile', 'name', 'Ana');

    const envelope = driver.data.$deepbase;
    driver.data = {};
    await assert.rejects(db.get('profile'), isEncryptionError('ENCRYPTION_DOCUMENT_MISSING'));
    await assert.rejects(db.set('profile', 'name', 'Eve'), isEncryptionError('ENCRYPTION_DOCUMENT_MISSING'));

    driver.data = { $deepbase: envelope, leaked: 'plaintext' };
    await assert.rejects(db.get('profile'), isEncryptionError('ENCRYPTION_MALFORMED_DOCUMENT'));

    await db.del();
    driver.data = { $deepbase: driver.data.$deepbase };
    assert.deepStrictEqual(await db.get(), {});
    assert.ok(driver.data.$deepbase.ciphertext);
  });

  it('upgrades weaker KDF parameters on the next write and never downgrades stronger ones', async function() {
    const driver = new MemoryDriver();
    await passwordDb(driver).db.set('profile', 'name', 'Ana');
    const weakSalt = driver.data.$deepbase.kdf.salt;

    const stronger = passwordDb(driver, { kdf: { N: 2 ** 15 } }).db;
    assert.strictEqual(await stronger.get('profile', 'name'), 'Ana');
    assert.strictEqual(driver.data.$deepbase.kdf.N, 2 ** 14);
    await stronger.set('profile', 'age', 30);
    assert.strictEqual(driver.data.$deepbase.kdf.N, 2 ** 15);
    assert.notStrictEqual(driver.data.$deepbase.kdf.salt, weakSalt);

    const configuredWeaker = passwordDb(driver).db;
    assert.deepStrictEqual(await configuredWeaker.get('profile'), { name: 'Ana', age: 30 });
    await configuredWeaker.set('profile', 'age', 31);
    assert.strictEqual(driver.data.$deepbase.kdf.N, 2 ** 15);

    await assert.rejects(
      passwordDb(driver, { password: 'wrong password', kdf: { N: 2 ** 15 } }).db.get(),
      isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'),
    );
  });

  it('uses scrypt N=2^17, r=8, p=1 by default', async function() {
    const driver = new MemoryDriver();
    await new DeepBase(driver).use(encryptedDocument({ password: PASSWORD })).set('secret', 'value');
    assert.deepStrictEqual(
      { ...driver.data.$deepbase.kdf, salt: undefined },
      { name: 'scrypt', N: 2 ** 17, r: 8, p: 1, salt: undefined },
    );

    const reopened = new DeepBase(driver).use(encryptedDocument({ password: PASSWORD }));
    assert.strictEqual(await reopened.get('secret'), 'value');
  });

  it('supports raw keyrings with rotation by keyId', async function() {
    const driver = new MemoryDriver();
    const oldDb = new DeepBase(driver).use(encryptedDocument({ activeKeyId: 'old', keys: { old: keyA() } }));
    await oldDb.set('secret', 'value');
    assert.deepStrictEqual(driver.data.$deepbase.kdf, { name: 'raw', keyId: 'old' });

    const newDb = new DeepBase(driver).use(encryptedDocument({ activeKeyId: 'new', keys: { old: keyA(), new: keyB() } }));
    assert.strictEqual(await newDb.get('secret'), 'value');
    await newDb.set('other', 'value');
    assert.deepStrictEqual(driver.data.$deepbase.kdf, { name: 'raw', keyId: 'new' });

    await assert.rejects(
      new DeepBase(driver).use(encryptedDocument({ activeKeyId: 'old', keys: { old: keyA() } })).get('secret'),
      (error) => isEncryptionError('ENCRYPTION_UNKNOWN_KEY')(error) && error.keyId === 'new',
    );
    await assert.rejects(passwordDb(driver).db.get('secret'), isEncryptionError('ENCRYPTION_UNKNOWN_KEY'));

    driver.data.$deepbase.kdf.keyId = 'old';
    await assert.rejects(
      new DeepBase(driver).use(encryptedDocument({ activeKeyId: 'old', keys: { old: keyB() } })).get('secret'),
      isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'),
    );

    const scryptDriver = new MemoryDriver();
    await passwordDb(scryptDriver).db.set('secret', 'value');
    await assert.rejects(
      new DeepBase(scryptDriver).use(encryptedDocument({ activeKeyId: 'old', keys: { old: keyA() } })).get('secret'),
      isEncryptionError('ENCRYPTION_UNKNOWN_KEY'),
    );
  });

  it('runs every DeepBase operation against the decrypted document', async function() {
    const driver = new MemoryDriver();
    const { db } = passwordDb(driver);

    await db.set('counter', 10);
    await db.inc('counter', 5);
    await db.dec('counter', 2);
    await db.dec('missingCounter', 2);
    await db.upd('profile', (profile) => ({ ...profile, label: 'updated' }));
    const [, id] = await db.add('sendRequest', { state: 'pending' });
    await db.set('queue', { a: 1, b: 2, c: 3 });

    assert.strictEqual(await db.get('counter'), 13);
    assert.strictEqual(await db.get('missingCounter'), -2);
    assert.deepStrictEqual(await db.get('profile'), { label: 'updated' });
    assert.deepStrictEqual(await db.get('sendRequest', id), { state: 'pending' });
    assert.deepStrictEqual(db.getSync('sendRequest', id), { state: 'pending' });
    assert.deepStrictEqual(await db.entries('sendRequest'), [[id, { state: 'pending' }]]);
    assert.deepStrictEqual(await db.values('queue'), [1, 2, 3]);
    assert.strictEqual(await db.first('queue'), 'a');
    assert.strictEqual(await db.last('queue'), 'c');
    assert.strictEqual(await db.pop('queue'), 3);
    assert.strictEqual(await db.shift('queue'), 1);
    assert.deepStrictEqual(await db.get('queue'), { b: 2 });
    await db.set('users', { u1: { age: 31 }, u2: { age: 17 } });
    assert.deepStrictEqual(await db.query('users').where('age', '>=', 18).toArray(), [{ id: 'u1', value: { age: 31 } }]);
    await db.del('sendRequest', id);
    assert.deepStrictEqual(await db.get('sendRequest'), {});

    assert.deepStrictEqual(Object.keys(driver.data), ['$deepbase']);
    assert.ok(driver.operations.every((operation) => operation === 'upd' || operation === 'set'));
  });

  it('never exposes plaintext in errors', async function() {
    const driver = new MemoryDriver();
    const { db } = passwordDb(driver);
    await db.set(wallet);

    const circular = { '0xSECRETKEY': {} };
    circular['0xSECRETKEY'].self = circular;
    await assert.rejects(db.set('broken', circular), (error) => {
      assert.ok(isEncryptionError('ENCRYPTION_SERIALIZATION_FAILED')(error));
      assert.strictEqual(error.cause, undefined);
      assert.ok(!error.stack.includes('0xSECRETKEY'));
      return true;
    });

    const bytes = Buffer.from(driver.data.$deepbase.ciphertext, 'base64');
    bytes[3] ^= 0xff;
    driver.data.$deepbase.ciphertext = bytes.toString('base64');
    await assert.rejects(db.get(), (error) => {
      const text = `${error.stack}${error.cause?.stack ?? ''}${JSON.stringify(error)}`;
      assertOpaque(text);
      return isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED')(error);
    });
  });

  it('zeroes the password, raw keys and derived keys on dispose', async function() {
    const driver = new MemoryDriver();
    const { db, plugin } = passwordDb(driver);
    await db.set('secret', 'value');
    const secrets = [plugin._password, ...plugin._derivedKeys.values()];
    assert.strictEqual(secrets.length, 2);

    await db.dispose();
    for (const secret of secrets) assert.ok(secret.every((byte) => byte === 0));
    await assert.rejects(db.get('secret'), isEncryptionError('ENCRYPTION_PLUGIN_DISPOSED'));
    assert.throws(() => db.getSync('secret'), isEncryptionError('ENCRYPTION_PLUGIN_DISPOSED'));

    const raw = encryptedDocument({ activeKeyId: 'a', keys: { a: keyA() } });
    const rawKeys = [...raw._rawKeys.values()];
    raw.dispose();
    for (const key of rawKeys) assert.ok(key.every((byte) => byte === 0));
  });

  it('validates schema against plaintext across drivers', async function() {
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
    const db = new DeepBase([primary, secondary], { schema })
      .use(encryptedDocument({ password: PASSWORD, kdf: fastKdf }));

    await db.set('configs', 'app', { token: 'secret' });
    await assert.rejects(db.set('configs', 'app', { token: 1 }), /violates the DeepBase schema/);
    assert.deepStrictEqual(await db.validateSchema(), { valid: true, errors: [] });
    assert.deepStrictEqual(
      await passwordDb(secondary).db.get('configs'),
      await passwordDb(primary).db.get('configs'),
    );
  });

  it('keeps migrate() on raw ciphertext', async function() {
    const source = new MemoryDriver();
    const target = new MemoryDriver();
    const db = new DeepBase([source, target], { writeAll: false })
      .use(encryptedDocument({ password: PASSWORD, kdf: fastKdf }));
    await db.set('secret', 'value');

    await db.migrate(0, 1);

    assert.deepStrictEqual(target.data, source.data);
    assert.strictEqual(await passwordDb(target).db.get('secret'), 'value');
  });

  it('keeps the JSON file and the JSON driver cache opaque across reopen', async function() {
    const directory = await mkdtemp(path.join(tmpdir(), 'deepbase-encryption-'));
    const fileName = path.join(directory, 'persist.json');
    const open = () => {
      const driver = new JsonDriver({ path: directory, name: 'persist' });
      return { driver, db: new DeepBase(driver).use(encryptedDocument({ password: PASSWORD, kdf: fastKdf })) };
    };

    try {
      let { driver, db } = open();
      await db.set(wallet);
      await Promise.all(Array.from({ length: 20 }, () => db.inc('networkUsage', 'ethereum', 1)));

      assertOpaque(JSON.stringify(driver.obj));
      const file = await readFile(fileName, 'utf8');
      assertOpaque(file);
      assert.deepStrictEqual(Object.keys(JSON.parse(file)), ['$deepbase']);
      await db.dispose({ clearMemory: true, releaseInstance: true });

      ({ db } = open());
      assert.deepStrictEqual(await db.get(), { ...wallet, networkUsage: { ethereum: 20 } });
      assert.strictEqual(db.getSync('mnemonic'), wallet.mnemonic);
      await db.dispose({ clearMemory: true, releaseInstance: true });

      const tampered = JSON.parse(file);
      tampered.$deepbase.tag = Buffer.alloc(16).toString('base64');
      await writeFile(fileName, JSON.stringify(tampered));
      ({ db } = open());
      await assert.rejects(db.get('mnemonic'), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));
      await assert.rejects(db.set('mnemonic', 'attacker'), isEncryptionError('ENCRYPTION_AUTHENTICATION_FAILED'));
      assert.deepStrictEqual(JSON.parse(await readFile(fileName, 'utf8')), tampered);
      await db.dispose({ clearMemory: true, releaseInstance: true });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('works through the SQLite driver contract', async function() {
    const directory = await mkdtemp(path.join(tmpdir(), 'deepbase-encryption-'));

    try {
      const driver = new SqliteDriver({ path: directory, name: 'encrypted-sqlite' });
      const { db } = passwordDb(driver);
      await db.set('private', 'counter', 1);
      await db.inc('private', 'counter', 2);
      assert.strictEqual(await db.get('private', 'counter'), 3);
      assert.deepStrictEqual(Object.keys(await driver.get()), ['$deepbase']);
      await db.dispose({ clearMemory: true, releaseInstance: true });

      const reopened = passwordDb(new SqliteDriver({ path: directory, name: 'encrypted-sqlite' })).db;
      assert.strictEqual(await reopened.get('private', 'counter'), 3);
      await reopened.dispose({ clearMemory: true, releaseInstance: true });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('exports the factory and error through CommonJS', function() {
    const commonjs = require('deepbase/plugins/encryption');
    assert.strictEqual(commonjs, encryptedDocument);
    assert.strictEqual(commonjs.encryptedDocument, encryptedDocument);
    assert.strictEqual(commonjs.DeepBaseEncryptionError, DeepBaseEncryptionError);
  });
});
