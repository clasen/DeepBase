import assert from 'node:assert/strict';

/**
 * Canonical array contract shared by the driver test suites.
 *
 * Deleting an index of a stored array removes the element and shifts the rest,
 * matching Array.prototype.splice, so pop()/shift() shrink arrays on every
 * driver instead of leaving holes (rendered as null) or silently doing nothing.
 */
export const arrayScenarios = [
  {
    title: 'pop() removes the last array element',
    async run(db) {
      await db.set('myArray', [1, 2, 3, 4, 5]);
      assert.strictEqual(await db.pop('myArray'), 5);
      assert.deepStrictEqual(await db.get('myArray'), [1, 2, 3, 4]);
      assert.strictEqual(await db.pop('myArray'), 4);
      assert.deepStrictEqual(await db.get('myArray'), [1, 2, 3]);
    },
  },
  {
    title: 'shift() removes the first array element',
    async run(db) {
      await db.set('myArray', [1, 2, 3, 4, 5]);
      assert.strictEqual(await db.shift('myArray'), 1);
      assert.deepStrictEqual(await db.get('myArray'), [2, 3, 4, 5]);
      assert.strictEqual(await db.shift('myArray'), 2);
      assert.deepStrictEqual(await db.get('myArray'), [3, 4, 5]);
    },
  },
  {
    title: 'del() splices the array index it deletes',
    async run(db) {
      await db.set('myArray', ['a', 'b', 'c', 'd']);
      await db.del('myArray', '1');
      assert.deepStrictEqual(await db.get('myArray'), ['a', 'c', 'd']);
      await db.del('myArray', '0');
      assert.deepStrictEqual(await db.get('myArray'), ['c', 'd']);
    },
  },
  {
    title: 'del() leaves no hole behind',
    async run(db) {
      await db.set('myArray', [1, 2, 3]);
      await db.del('myArray', '2');
      const array = await db.get('myArray');
      assert.strictEqual(array.length, 2);
      assert.deepStrictEqual(array, [1, 2]);
      assert.ok(!JSON.stringify(array).includes('null'), 'the stored array kept a null');
    },
  },
  {
    title: 'del() ignores indexes the array does not have',
    async run(db) {
      await db.set('myArray', [1, 2, 3]);
      await db.del('myArray', '9');
      await db.del('myArray', 'not-an-index');
      assert.deepStrictEqual(await db.get('myArray'), [1, 2, 3]);
    },
  },
  {
    title: 'pop() and shift() work on nested arrays',
    async run(db) {
      await db.set('config', 'tags', ['a', 'b', 'c']);
      assert.strictEqual(await db.pop('config', 'tags'), 'c');
      assert.deepStrictEqual(await db.get('config', 'tags'), ['a', 'b']);
      assert.strictEqual(await db.shift('config', 'tags'), 'a');
      assert.deepStrictEqual(await db.get('config', 'tags'), ['b']);
      await db.del('config', 'tags', '0');
      assert.deepStrictEqual(await db.get('config', 'tags'), []);
    },
  },
  {
    title: 'arrays stay arrays after being emptied',
    async run(db) {
      await db.set('list', [1]);
      assert.strictEqual(await db.pop('list'), 1);
      assert.deepStrictEqual(await db.get('list'), []);
      assert.strictEqual(await db.pop('list'), undefined);
    },
  },
  {
    title: 'pop() and shift() keep working on keyed collections',
    async run(db) {
      await db.set('queue', 'a', { n: 1 });
      await db.set('queue', 'b', { n: 2 });
      await db.set('stack', 'a', { n: 1 });
      await db.set('stack', 'b', { n: 2 });

      assert.deepStrictEqual(await db.shift('queue'), { n: 1 });
      assert.deepStrictEqual(await db.pop('stack'), { n: 2 });
      assert.deepStrictEqual(await db.get('queue'), { b: { n: 2 } });
      assert.deepStrictEqual(await db.get('stack'), { a: { n: 1 } });
    },
  },
];
