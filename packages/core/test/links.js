import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DeepBase, DeepBaseDriver } from 'deepbase';
import { encryptedValues } from 'deepbase/plugins/encryption';
import {
  DeepBaseLinkError,
  linkedData,
} from 'deepbase/plugins/links';

const require = createRequire(import.meta.url);

class MemoryDriver extends DeepBaseDriver {
  constructor() {
    super();
    this.data = {};
  }

  async get(...path) {
    let value = this.data;
    for (const segment of path) {
      if (value === null || typeof value !== 'object' || !(segment in value)) return null;
      value = value[segment];
    }
    return structuredClone(value);
  }

  async set(...args) {
    if (args.length === 1) {
      this.data = structuredClone(args[0]);
      return [];
    }
    const path = args.slice(0, -1);
    let target = this.data;
    for (const segment of path.slice(0, -1)) {
      if (!target[segment] || typeof target[segment] !== 'object') target[segment] = {};
      target = target[segment];
    }
    target[path.at(-1)] = structuredClone(args.at(-1));
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

  async upd(...args) {
    const update = args.pop();
    return this.set(...args, update(await this.get(...args)));
  }
}

describe('deepbase/plugins/links', function() {
  it('requires an explicit positive maxDepth', function() {
    assert.throws(() => linkedData(), /maxDepth/);
    assert.throws(() => linkedData({ maxDepth: 0 }), /positive integer/);
    assert.throws(() => linkedData({ maxDepth: 1.5 }), /positive integer/);
  });

  it('round-trips versioned links with special, Unicode and numeric path segments', function() {
    const links = linkedData({ maxDepth: 8 });
    const path = ['nodes/with/slashes', 'mañana', 42, '', 'a.b'];
    const link = links.to(...path);

    assert.match(link, /^deepbase:link:v1:/);
    assert.strictEqual(links.isLink(link), true);
    assert.deepStrictEqual(links.parse(link), path);
    assert.strictEqual(links.isLink('plain string'), false);
    assert.strictEqual(links.isLink('deepbase:link:v1:not-json'), false);
    assert.throws(
      () => links.parse('deepbase:link:v1:not-json'),
      (error) => error instanceof DeepBaseLinkError && error.code === 'LINK_MALFORMED',
    );
    assert.throws(() => links.to(), /at least one path segment/);
  });

  it('resolves one or more links and returns non-link values unchanged', async function() {
    const driver = new MemoryDriver();
    const links = linkedData({ maxDepth: 8 });
    const db = new DeepBase(driver).use(links);

    await db.set({
      nodes: { root: { label: 'Root' } },
      aliases: {
        direct: links.to('nodes', 'root'),
        chained: links.to('aliases', 'direct'),
      },
      ordinary: 'value',
    });

    assert.deepStrictEqual(await links.resolve('aliases', 'direct'), { label: 'Root' });
    assert.deepStrictEqual(await links.resolve('aliases', 'chained'), { label: 'Root' });
    assert.strictEqual(await links.resolve('ordinary'), 'value');
    assert.strictEqual(await db.get('aliases', 'direct'), links.to('nodes', 'root'));
  });

  it('reports missing and null targets without preventing dangling writes', async function() {
    const driver = new MemoryDriver();
    const links = linkedData({ maxDepth: 8 });
    const db = new DeepBase(driver).use(links);

    await db.set('aliases', 'missing', links.to('nodes', 'missing'));
    await db.set('nodes', 'null', null);
    await db.set('aliases', 'null', links.to('nodes', 'null'));

    await assert.rejects(
      links.resolve('aliases', 'missing'),
      (error) => error.code === 'LINK_TARGET_MISSING'
        && assert.deepStrictEqual(error.targetPath, ['nodes', 'missing']) === undefined,
    );
    await assert.rejects(
      links.resolve('aliases', 'null'),
      (error) => error.code === 'LINK_TARGET_MISSING',
    );
  });

  it('detects cycles and max depth with the complete path chain', async function() {
    const driver = new MemoryDriver();
    const links = linkedData({ maxDepth: 2 });
    const db = new DeepBase(driver).use(links);

    await db.set('cycle', 'a', links.to('cycle', 'b'));
    await db.set('cycle', 'b', links.to('cycle', 'a'));
    await assert.rejects(
      links.resolve('cycle', 'a'),
      (error) => error.code === 'LINK_CYCLE'
        && error.chain.length === 3
        && assert.deepStrictEqual(error.chain.at(-1), ['cycle', 'a']) === undefined,
    );

    await db.set('chain', 'a', links.to('chain', 'b'));
    await db.set('chain', 'b', links.to('chain', 'c'));
    await db.set('chain', 'c', links.to('chain', 'd'));
    await db.set('chain', 'd', 'done');
    await assert.rejects(
      links.resolve('chain', 'a'),
      (error) => error.code === 'LINK_MAX_DEPTH' && error.chain.length === 4,
    );
  });

  it('composes with encrypted link values through normal db.get()', async function() {
    const driver = new MemoryDriver();
    const encryption = encryptedValues({
      activeKeyId: 'primary',
      keys: { primary: Buffer.alloc(32, 0x33) },
    });
    const links = linkedData({ maxDepth: 8 });
    const db = new DeepBase(driver).use(encryption).use(links);

    await db.set('nodes', 'root', { label: 'Root' });
    await db.set('aliases', 'home', links.to('nodes', 'root'));

    assert.strictEqual(driver.data.aliases.home.$deepbase.plugin, 'encryption');
    assert.strictEqual(driver.data.nodes.root.label.$deepbase.plugin, 'encryption');
    assert.deepStrictEqual(await links.resolve('aliases', 'home'), { label: 'Root' });
  });

  it('stores links as schema-compatible strings without changing schema.ref', async function() {
    const driver = new MemoryDriver();
    const links = linkedData({ maxDepth: 8 });
    const schema = {
      entities: {
        aliases: {
          path: ['aliases', ':id'],
          additionalFields: false,
          fields: { target: { type: 'string', required: true } },
        },
      },
    };
    const db = new DeepBase(driver, { schema }).use(links);

    await db.set('aliases', 'home', { target: links.to('nodes', 'root') });
    assert.deepStrictEqual(await db.validateSchema(), { valid: true, errors: [] });
  });

  it('cannot be resolved before registration or shared across instances', async function() {
    const links = linkedData({ maxDepth: 8 });
    await assert.rejects(links.resolve('alias'), /must be registered/);

    new DeepBase(new MemoryDriver()).use(links);
    assert.throws(
      () => new DeepBase(new MemoryDriver()).use(links),
      /cannot be shared/,
    );
  });

  it('exports the factory and error through CommonJS', function() {
    const commonjs = require('deepbase/plugins/links');
    assert.strictEqual(commonjs, linkedData);
    assert.strictEqual(commonjs.linkedData, linkedData);
    assert.strictEqual(commonjs.DeepBaseLinkError, DeepBaseLinkError);
  });
});
