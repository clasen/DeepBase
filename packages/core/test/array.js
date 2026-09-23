import assert from 'node:assert/strict';
import { DeepBase, removeKey } from '../src/index.js';
import { deleteAtPath } from '../src/schema.js';
import { MemoryDriver } from './memory-driver.js';
import { arrayScenarios } from './array-scenario.js';

describe('removeKey', function() {
  it('deletes a plain object key', function() {
    const target = { a: 1, b: 2 };
    assert.strictEqual(removeKey(target, 'a'), true);
    assert.deepStrictEqual(target, { b: 2 });
  });

  it('splices the array index it removes', function() {
    const target = ['a', 'b', 'c'];
    assert.strictEqual(removeKey(target, '1'), true);
    assert.deepStrictEqual(target, ['a', 'c']);

    assert.strictEqual(removeKey(target, 0), true);
    assert.deepStrictEqual(target, ['c']);
  });

  it('leaves holes out and ignores indexes the array does not have', function() {
    const target = [1, 2, 3];
    assert.strictEqual(removeKey(target, '9'), false);
    assert.strictEqual(removeKey(target, '-1'), false);
    assert.strictEqual(removeKey(target, '01'), false);
    assert.strictEqual(removeKey(target, 'not-an-index'), false);
    assert.deepStrictEqual(target, [1, 2, 3]);

    assert.strictEqual(removeKey(target, '2'), true);
    assert.deepStrictEqual(target, [1, 2]);
    assert.strictEqual(target.length, 2);
  });

  it('returns false when there is nothing to remove', function() {
    assert.strictEqual(removeKey({ a: 1 }, 'b'), false);
    assert.strictEqual(removeKey(null, 'a'), false);
    assert.strictEqual(removeKey('text', '0'), false);
  });

  it('leaves keys that cannot be deleted alone', function() {
    const target = [1, 2, 3];
    assert.strictEqual(removeKey(target, 'length'), false);
    assert.deepStrictEqual(target, [1, 2, 3]);

    const frozen = Object.freeze({ a: 1 });
    assert.strictEqual(removeKey(frozen, 'a'), false);
    assert.deepStrictEqual(frozen, { a: 1 });
  });
});

describe('deleteAtPath', function() {
  it('splices arrays so the validated copy matches the stored value', function() {
    const before = { list: ['a', 'b', 'c'], config: { tags: [1, 2] } };
    assert.deepStrictEqual(deleteAtPath(before, ['list', '1']), {
      list: ['a', 'c'],
      config: { tags: [1, 2] },
    });
    assert.deepStrictEqual(deleteAtPath(before, ['config', 'tags', '0']), {
      list: ['a', 'b', 'c'],
      config: { tags: [2] },
    });
    assert.deepStrictEqual(before, { list: ['a', 'b', 'c'], config: { tags: [1, 2] } });
  });
});

describe('array operations', function() {
  let db;

  beforeEach(async function() {
    db = new DeepBase(new MemoryDriver());
    await db.connect();
  });

  for (const scenario of arrayScenarios) {
    it(scenario.title, async function() {
      await scenario.run(db);
    });
  }
});
