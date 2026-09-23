import assert from 'node:assert/strict';
import { DeepBase, DeepBaseQuery, evaluateQuery, resolveQueryWindow } from '../src/index.js';
import { DeepBaseEncryptionError, encryptedValues } from '../src/plugins/encryption/index.js';
import { GetOnlyDriver, MemoryDriver } from './memory-driver.js';
import { seedQueryFixture, queryScenarios } from './query-scenario.js';

function createDb(driver, options = {}) {
  return new DeepBase(driver, options);
}

describe('evaluateQuery', function() {
  it('turns an object into records ordered by key', function() {
    assert.deepStrictEqual(evaluateQuery({ b: 2, a: 1 }), [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ]);
  });

  it('returns an empty collection for a missing path', function() {
    assert.deepStrictEqual(evaluateQuery(null), []);
    assert.deepStrictEqual(evaluateQuery(undefined), []);
  });

  it('rejects values that are not objects', function() {
    assert.throws(
      () => evaluateQuery(5, [], { path: ['users', 'age'] }),
      /query\(\) requires an object at "users.age", received number/,
    );
    assert.throws(() => evaluateQuery([1, 2], [], { path: ['list'] }), /received array/);
    assert.throws(() => evaluateQuery('text', []), /received string/);
  });

  it('rejects unknown descriptor steps', function() {
    assert.throws(() => evaluateQuery({ a: 1 }, [{ type: 'group' }]), /Unknown query step "group"/);
  });
});

describe('resolveQueryWindow', function() {
  const take = count => ({ type: 'take', count });
  const skip = count => ({ type: 'skip', count });
  const where = field => ({ type: 'where', field: [field], operator: '=', value: 1 });

  it('returns null when the chain does not start with skip() or take()', function() {
    assert.strictEqual(resolveQueryWindow([]), null);
    assert.strictEqual(resolveQueryWindow([where('age')]), null);
    assert.strictEqual(resolveQueryWindow([where('age'), take(5)]), null);
  });

  it('translates a leading window into an offset and a limit', function() {
    assert.deepStrictEqual(resolveQueryWindow([take(10)]), { offset: 0, limit: 10, rest: [] });
    assert.deepStrictEqual(resolveQueryWindow([skip(5)]), { offset: 5, limit: null, rest: [] });
    assert.deepStrictEqual(resolveQueryWindow([take(10), skip(3)]), { offset: 3, limit: 7, rest: [] });
    assert.deepStrictEqual(resolveQueryWindow([skip(3), take(10)]), { offset: 3, limit: 10, rest: [] });
    assert.deepStrictEqual(resolveQueryWindow([take(5), take(2)]), { offset: 0, limit: 2, rest: [] });
    assert.deepStrictEqual(resolveQueryWindow([take(2), skip(5)]), { offset: 5, limit: 0, rest: [] });
    assert.deepStrictEqual(resolveQueryWindow([take(0)]), { offset: 0, limit: 0, rest: [] });
  });

  it('keeps the steps that still have to run in memory', function() {
    assert.deepStrictEqual(resolveQueryWindow([take(2), where('age'), take(1)]), {
      offset: 0,
      limit: 2,
      rest: [where('age'), take(1)],
    });
  });
});

describe('db.query()', function() {
  let driver;
  let db;

  beforeEach(async function() {
    driver = new MemoryDriver();
    db = createDb(driver);
    await db.connect();
    await seedQueryFixture(db);
  });

  it('returns a DeepBaseQuery instance', function() {
    assert.ok(db.query('users') instanceof DeepBaseQuery);
  });

  for (const scenario of queryScenarios) {
    it(scenario.title, async function() {
      await scenario.run(db);
    });
  }

  it('does not touch the driver until a terminal method runs', async function() {
    const query = db
      .query('users')
      .where('age', '>', 18)
      .orderBy('age')
      .skip(1)
      .take(2)
      .select('name');

    assert.strictEqual(driver.queryCalls, 0);

    const records = await query.toArray();
    assert.strictEqual(driver.queryCalls, 1);
    assert.deepStrictEqual(records.map(record => record.id), ['u3']);
  });

  it('re-executes the descriptor on every terminal call', async function() {
    const query = db.query('users');

    assert.strictEqual(await query.count(), 6);
    assert.strictEqual(await query.any(), true);
    assert.strictEqual(driver.queryCalls, 2);
  });

  it('validates the chain synchronously', function() {
    assert.throws(() => db.query('users').where('age', '~', 18), /unsupported operator "~"/);
    assert.throws(() => db.query('users').where('name', 'in', 'Ana'), /requires an array value/);
    assert.throws(() => db.query('users').where(42, '=', 1), /requires a field name/);
    assert.throws(() => db.query('users').where('', '=', 1), /requires a field name/);
    assert.throws(() => db.query('users').orderBy('age', 'up'), /direction of "asc" or "desc"/);
    assert.throws(() => db.query('users').skip(-1), /non-negative integer/);
    assert.throws(() => db.query('users').take(1.5), /non-negative integer/);
    assert.throws(() => db.query('users').select(), /requires at least one field/);
    assert.throws(() => db.query('users').select(() => {}), /requires a field name/);
    assert.throws(() => db.query({}), /path segments must be strings or numbers/);
  });

  it('runs read hooks with the query operation', async function() {
    const contexts = [];
    const hookedDb = createDb(new MemoryDriver());
    hookedDb.use({
      name: 'spy',
      execute(context, next) {
        contexts.push(context);
        return next();
      },
    });
    await hookedDb.connect();
    await hookedDb.set('users', 'u1', { name: 'Ana', age: 31 });

    contexts.length = 0;
    await hookedDb.query('users').where('age', '>', 18).toArray();

    assert.strictEqual(contexts.length, 1);
    assert.strictEqual(contexts[0].operation, 'query');
    assert.strictEqual(contexts[0].kind, 'read');
    assert.strictEqual(contexts[0].sync, false);
    assert.deepStrictEqual(contexts[0].args[0], ['users']);
    assert.deepStrictEqual(contexts[0].args[1][0], {
      type: 'where',
      field: ['age'],
      operator: '>',
      value: 18,
    });
  });

  it('asks drivers for a single record from first() and any()', async function() {
    const contexts = [];
    const hookedDb = createDb(new MemoryDriver());
    hookedDb.use({
      name: 'spy',
      execute(context, next) {
        contexts.push(context);
        return next();
      },
    });
    await hookedDb.connect();
    await hookedDb.set('users', 'u1', { name: 'Ana', age: 31 });

    contexts.length = 0;
    await hookedDb.query('users').orderBy('age').first();
    await hookedDb.query('users').where('age', '>', 18).any();

    assert.deepStrictEqual(contexts[0].args[1], [
      { type: 'orderBy', field: ['age'], direction: 'asc' },
      { type: 'take', count: 1 },
    ]);
    assert.deepStrictEqual(contexts[1].args[1], [
      { type: 'where', field: ['age'], operator: '>', value: 18 },
      { type: 'take', count: 1 },
    ]);
  });

  it('reads from the first driver under the default policy', async function() {
    const primary = new MemoryDriver({ name: 'primary' });
    const secondary = new MemoryDriver({ name: 'secondary' });
    const primaryDb = createDb([primary, secondary]);
    await primaryDb.connect();
    await primaryDb.set('users', 'a', { name: 'Ana', age: 20 });
    await secondary.set('users', 'b', { name: 'Beto', age: 30 });

    assert.deepStrictEqual(
      (await primaryDb.query('users').toArray()).map(record => record.id),
      ['a'],
    );
  });

  it('falls back to the next driver when a query fails', async function() {
    const failing = new MemoryDriver({ name: 'failing', failQuery: true });
    const secondary = new MemoryDriver({ name: 'secondary' });
    const dbWithFallback = createDb([failing, secondary]);
    await dbWithFallback.connect();
    await secondary.set('users', 'b', { name: 'Beto', age: 30 });

    assert.deepStrictEqual(
      (await dbWithFallback.query('users').toArray()).map(record => record.id),
      ['b'],
    );
    assert.strictEqual(failing.queryCalls, 1);
    assert.deepStrictEqual(await dbWithFallback.query('missing').toArray(), []);

    const bothFail = createDb([
      new MemoryDriver({ name: 'failing', failQuery: true }),
      new MemoryDriver({ name: 'also failing', failQuery: true }),
    ]);
    await assert.rejects(bothFail.query('users').toArray(), /also failing driver query failure/);
  });

  it('applies the read timeout to query()', async function() {
    const slowDriver = new MemoryDriver({ name: 'slow', queryDelayMs: 100 });
    const slowDb = createDb(slowDriver, { readTimeout: 20 });
    await slowDb.connect();
    await slowDb.set('users', 'u1', { name: 'Ana' });

    await assert.rejects(slowDb.query('users').toArray(), /query\(\) timed out after 20ms/);
  });

  it('reports drivers that do not implement query()', async function() {
    const externalDb = createDb(new GetOnlyDriver());

    await assert.rejects(
      externalDb.query('users').toArray(),
      /query\(\) is not supported by GetOnlyDriver/,
    );
  });

  it('rejects query() with the encryption plugin', async function() {
    const encryptedDb = createDb(new MemoryDriver(), { writeTimeout: 1000 });
    encryptedDb.use(encryptedValues({
      activeKeyId: 'k1',
      keys: { k1: new Uint8Array(32).fill(7) },
    }));
    await encryptedDb.connect();
    await encryptedDb.set('users', 'u1', { name: 'Ana', age: 31 });

    await assert.rejects(
      encryptedDb.query('users').toArray(),
      error => error instanceof DeepBaseEncryptionError
        && error.code === 'ENCRYPTION_QUERY_UNSUPPORTED',
    );
    await assert.rejects(
      encryptedDb.query('users').count(),
      error => error instanceof DeepBaseEncryptionError
        && error.code === 'ENCRYPTION_QUERY_UNSUPPORTED',
    );
  });

});
