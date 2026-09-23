import assert from 'node:assert/strict';

/**
 * Canonical query() fixture shared by the driver test suites.
 * Writing the same documents through every driver lets each package assert the
 * same result sequence.
 */
export const QUERY_RECORDS = {
  u1: { name: 'Ana', age: 31, address: { city: 'Rosario' } },
  u2: { name: 'Beto', age: 18 },
  u3: { name: 'Caro', age: 45, address: { city: 'Córdoba' } },
  u4: { name: 'Dani', age: 18, address: { city: 'Rosario' } },
  u5: { name: 'Eva' },
  u6: { name: 'Fabi', age: null },
};

/** Keys of QUERY_RECORDS in ascending key order. */
export const QUERY_IDS = Object.keys(QUERY_RECORDS);

/** Write the fixture under `users`, plus a boolean, an array and a scalar at the root. */
export async function seedQueryFixture(db) {
  for (const id of QUERY_IDS) {
    await db.set('users', id, QUERY_RECORDS[id]);
  }
  await db.set('flag', true);
  await db.set('list', [1, 2, 3]);
  await db.set('settings', 'theme', 'dark');
}

const ids = records => records.map(record => record.id);
const values = records => records.map(record => record.value);
const valuesFor = recordIds => recordIds.map(id => QUERY_RECORDS[id]);

export const queryScenarios = [
  {
    title: 'reads every record ordered by key',
    async run(db) {
      const records = await db.query('users').toArray();
      assert.deepStrictEqual(ids(records), QUERY_IDS);
      assert.deepStrictEqual(values(records), valuesFor(QUERY_IDS));
    },
  },
  {
    title: 'filters with equality, inequality, ranges and in',
    async run(db) {
      assert.deepStrictEqual(ids(await db.query('users').where('age', '=', 18).toArray()), ['u2', 'u4']);
      assert.deepStrictEqual(ids(await db.query('users').where('age', '!=', 18).toArray()), ['u1', 'u3', 'u6']);
      assert.deepStrictEqual(ids(await db.query('users').where('age', '>', 18).toArray()), ['u1', 'u3']);
      assert.deepStrictEqual(ids(await db.query('users').where('age', '>=', 31).toArray()), ['u1', 'u3']);
      assert.deepStrictEqual(ids(await db.query('users').where('age', '<', 31).toArray()), ['u2', 'u4']);
      assert.deepStrictEqual(ids(await db.query('users').where('age', '<=', 18).toArray()), ['u2', 'u4']);
      assert.deepStrictEqual(ids(await db.query('users').where('name', 'in', ['Ana', 'Caro']).toArray()), ['u1', 'u3']);
      assert.deepStrictEqual(await db.query('users').where('name', 'in', []).toArray(), []);
    },
  },
  {
    title: 'combines several where() steps with AND',
    async run(db) {
      const records = await db
        .query('users')
        .where('age', '>=', 18)
        .where('address.city', '=', 'Rosario')
        .toArray();
      assert.deepStrictEqual(ids(records), ['u1', 'u4']);
    },
  },
  {
    title: 'matches nested fields by path segments',
    async run(db) {
      assert.deepStrictEqual(
        ids(await db.query('users').where('address.city', '=', 'Rosario').toArray()),
        ['u1', 'u4'],
      );
      assert.deepStrictEqual(
        ids(await db.query('users').where(['address', 'city'], '=', 'Córdoba').toArray()),
        ['u3'],
      );
      assert.deepStrictEqual(ids(await db.query('users').where('address.city', '=', 'Salta').toArray()), []);
    },
  },
  {
    title: 'never matches a missing field, not even with null',
    async run(db) {
      // u5 has no `age` field, u6 stores an explicit null.
      assert.deepStrictEqual(ids(await db.query('users').where('age', '=', null).toArray()), ['u6']);
      assert.deepStrictEqual(ids(await db.query('users').where('missing', '=', null).toArray()), []);
      assert.deepStrictEqual(ids(await db.query('users').where('address.city', '=', null).toArray()), []);
    },
  },
  {
    title: 'compares without type coercion',
    async run(db) {
      assert.deepStrictEqual(await db.query('users').where('age', '=', '18').toArray(), []);
      assert.deepStrictEqual(await db.query('users').where('age', '>', '20').toArray(), []);
      assert.deepStrictEqual(await db.query('users').where('name', 'in', [1, 2]).toArray(), []);
    },
  },
  {
    title: 'orders with orderBy and keeps key order for ties',
    async run(db) {
      assert.deepStrictEqual(ids(await db.query('users').orderBy('age').toArray()), ['u2', 'u4', 'u1', 'u3', 'u5', 'u6']);
      assert.deepStrictEqual(
        ids(await db.query('users').orderBy('age', 'desc').toArray()),
        ['u5', 'u6', 'u3', 'u1', 'u2', 'u4'],
      );
      assert.deepStrictEqual(
        ids(await db.query('users').orderBy('address.city').toArray()),
        ['u3', 'u1', 'u4', 'u2', 'u5', 'u6'],
      );
      assert.deepStrictEqual(
        ids(await db.query('users').orderBy(['address', 'city'], 'desc').toArray()),
        ['u2', 'u5', 'u6', 'u1', 'u4', 'u3'],
      );
    },
  },
  {
    title: 'paginates with skip and take in chain order',
    async run(db) {
      assert.deepStrictEqual(ids(await db.query('users').orderBy('age').skip(1).take(2).toArray()), ['u4', 'u1']);
      assert.deepStrictEqual(ids(await db.query('users').skip(4).toArray()), ['u5', 'u6']);
      assert.deepStrictEqual(ids(await db.query('users').take(0).toArray()), []);
      assert.deepStrictEqual(ids(await db.query('users').skip(10).toArray()), []);
      // take() runs before where(), so the filter only sees the first two records.
      assert.deepStrictEqual(ids(await db.query('users').take(2).where('age', '>', 18).toArray()), ['u1']);
    },
  },
  {
    title: 'projects selected fields with select',
    async run(db) {
      assert.deepStrictEqual(
        values(await db.query('users').select('name').toArray()),
        valuesFor(QUERY_IDS).map(record => ({ name: record.name })),
      );
      assert.deepStrictEqual(
        values(await db.query('users').select('name', 'address.city').toArray()),
        [
          { name: 'Ana', address: { city: 'Rosario' } },
          { name: 'Beto' },
          { name: 'Caro', address: { city: 'Córdoba' } },
          { name: 'Dani', address: { city: 'Rosario' } },
          { name: 'Eva' },
          { name: 'Fabi' },
        ],
      );
      assert.deepStrictEqual(
        values(await db.query('users').select(['age']).where('age', '>', 30).toArray()),
        [{ age: 31 }, { age: 45 }],
      );
      assert.deepStrictEqual(
        values(await db.query('users').select('missing').toArray()),
        [{}, {}, {}, {}, {}, {}],
      );
    },
  },
  {
    title: 'returns first, count and any terminals',
    async run(db) {
      assert.deepStrictEqual(await db.query('users').first(), { id: 'u1', value: QUERY_RECORDS.u1 });
      assert.deepStrictEqual(
        await db.query('users').orderBy('age', 'desc').first(),
        { id: 'u5', value: QUERY_RECORDS.u5 },
      );
      assert.strictEqual(await db.query('users').where('age', '<', 10).first(), null);
      assert.strictEqual(await db.query('users').count(), 6);
      assert.strictEqual(await db.query('users').where('age', '=', 18).count(), 2);
      assert.strictEqual(await db.query('users').any(), true);
      assert.strictEqual(await db.query('users').where('age', '=', 18).any(), true);
      assert.strictEqual(await db.query('users').where('age', '>', 100).any(), false);
    },
  },
  {
    title: 'returns an empty collection for a missing path',
    async run(db) {
      assert.deepStrictEqual(await db.query('missing').toArray(), []);
      assert.deepStrictEqual(await db.query('users', 'nobody').toArray(), []);
      assert.strictEqual(await db.query('missing').first(), null);
      assert.strictEqual(await db.query('missing').count(), 0);
      assert.strictEqual(await db.query('missing').any(), false);
    },
  },
  {
    title: 'rejects when the path does not hold an object',
    async run(db) {
      await assert.rejects(db.query('flag').toArray(), /requires an object at "flag", received boolean/);
      await assert.rejects(db.query('list').toArray(), /requires an object at "list", received array/);
      await assert.rejects(db.query('settings', 'theme').toArray(), /requires an object at "settings.theme", received string/);
    },
  },
  {
    title: 'queries the root object when no path is given',
    async run(db) {
      const records = await db.query().toArray();
      assert.deepStrictEqual(ids(records), ['flag', 'list', 'settings', 'users']);
      assert.deepStrictEqual(values(records), [true, [1, 2, 3], { theme: 'dark' }, QUERY_RECORDS]);
      assert.strictEqual(await db.query().count(), 4);
      assert.deepStrictEqual(ids(await db.query().where('name', '=', 'Ana').toArray()), []);
    },
  },
];
