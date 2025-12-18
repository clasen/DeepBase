import assert from 'assert';
import { DeepBase } from '../../core/src/index.js';
import { RedisDriver } from '../src/RedisDriver.js';

describe('RedisDriver', function() {
  let db;
  let testCounter = 0;

  // Increase timeout for Redis operations
  this.timeout(10000);

  beforeEach(async function() {
    testCounter++;
    db = new DeepBase(new RedisDriver({ 
      url: 'redis://localhost:6379',
      prefix: `test_${testCounter}`
    }));
    
    try {
      await db.connect();
    } catch (error) {
      this.skip(); // Skip tests if Redis is not available
    }
  });

  afterEach(async function() {
    if (db) {
      try {
        await db.del(); // Clear all data
        await db.disconnect();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Connection', function() {
    it('should connect to Redis', async function() {
      const driver = db.getDriver(0);
      assert.ok(driver.client);
      assert.ok(driver.client.isOpen);
    });
  });

  describe('Basic Operations', function() {
    it('should set and get a simple value', async function() {
      await db.set('key1', 'value');
      const result = await db.get('key1');
      assert.strictEqual(result, 'value');
    });

    it('should set and get nested values', async function() {
      await db.set('user', 'name', 'Alice');
      await db.set('user', 'age', 30);
      
      const name = await db.get('user', 'name');
      const age = await db.get('user', 'age');
      
      assert.strictEqual(name, 'Alice');
      assert.strictEqual(age, 30);
    });

    it('should get entire nested object', async function() {
      await db.set('user', 'name', 'Bob');
      await db.set('user', 'age', 25);
      
      const user = await db.get('user');
      assert.strictEqual(user.name, 'Bob');
      assert.strictEqual(user.age, 25);
    });

    it('should return null for non-existent keys', async function() {
      const result = await db.get('nonexistent');
      assert.strictEqual(result, null);
    });

    it('should get all keys', async function() {
      await db.set('key1', 'value1');
      await db.set('key2', 'value2');
      
      const all = await db.get();
      assert.ok(all.key1);
      assert.ok(all.key2);
      assert.strictEqual(all.key1, 'value1');
      assert.strictEqual(all.key2, 'value2');
    });
  });

  describe('Keys with Dots', function() {
    it('should handle keys containing dots', async function() {
      const setResult = await db.set('value', 'martin.clasen@gmail.com', 1);
      
      assert.strictEqual(setResult.length, 2);
      assert.strictEqual(setResult[0], 'value');
      assert.strictEqual(setResult[1], 'martin.clasen@gmail.com');
      
      const getValue = await db.get('value');
      assert.strictEqual(getValue['martin.clasen@gmail.com'], 1);
    });

    it('should handle keys with multiple dots', async function() {
      await db.set('config', 'api.prod.endpoint', 'https://api.example.com');
      const endpoint = await db.get('config', 'api.prod.endpoint');
      assert.strictEqual(endpoint, 'https://api.example.com');
    });

    it('should handle nested paths with dots in keys', async function() {
      await db.set('users', 'john.doe@example.com', 'name', 'John Doe');
      await db.set('users', 'john.doe@example.com', 'age', 30);
      
      const user = await db.get('users', 'john.doe@example.com');
      assert.strictEqual(user.name, 'John Doe');
      assert.strictEqual(user.age, 30);
    });

    it('should handle dots in first level keys', async function() {
      await db.set('config.prod', 'value', 100);
      const configProd = await db.get('config.prod');
      assert.strictEqual(configProd.value, 100);
    });

    it('should distinguish between dots in keys and path separators', async function() {
      // Set a regular nested path
      await db.set('users', 'alice', 'email', 'alice@example.com');
      
      // Set a key with dots at the same level
      await db.set('users', 'john.doe@company.com', 'email', 'john@work.com');
      
      const users = await db.get('users');
      assert.strictEqual(users.alice.email, 'alice@example.com');
      assert.strictEqual(users['john.doe@company.com'].email, 'john@work.com');
      assert.strictEqual(Object.keys(users).length, 2);
    });

    it('should delete keys containing dots', async function() {
      await db.set('emails', 'user.name@domain.com', 'verified', true);
      await db.set('emails', 'other@email.com', 'verified', false);
      
      await db.del('emails', 'user.name@domain.com');
      
      const email1 = await db.get('emails', 'user.name@domain.com');
      const email2 = await db.get('emails', 'other@email.com');
      
      assert.strictEqual(email1, undefined);
      assert.strictEqual(email2.verified, false);
    });
  });

  describe('Delete Operations', function() {
    it('should delete a key', async function() {
      await db.set('temp', 'value');
      await db.set('keep', 'value');
      await db.del('temp');
      
      const temp = await db.get('temp');
      const keep = await db.get('keep');
      
      assert.strictEqual(temp, null);
      assert.strictEqual(keep, 'value');
    });

    it('should delete nested field', async function() {
      await db.set('user', 'name', 'Alice');
      await db.set('user', 'age', 30);
      await db.del('user', 'age');
      
      const user = await db.get('user');
      assert.strictEqual(user.name, 'Alice');
      assert.strictEqual(user.age, undefined);
    });

    it('should clear all data', async function() {
      await db.set('key1', 'value1');
      await db.set('key2', 'value2');
      await db.del();
      
      const all = await db.get();
      assert.deepStrictEqual(all, {});
    });
  });

  describe('Add Operation', function() {
    it('should add item with auto-generated ID', async function() {
      const path = await db.add('items', 'Charlie');
      
      assert.strictEqual(path.length, 2);
      assert.strictEqual(path[0], 'items');
      assert.strictEqual(typeof path[1], 'string');
      assert.strictEqual(path[1].length, 10);
      
      const item = await db.get(...path);
      assert.strictEqual(item, 'Charlie');
    });

    it('should add multiple items with unique IDs', async function() {
      const path1 = await db.add('items', 'item1');
      const path2 = await db.add('items', 'item2');
      
      assert.notStrictEqual(path1[1], path2[1]);
    });

    it('should add complex objects', async function() {
      const path = await db.add('users', { name: 'Alice', age: 30 });
      const user = await db.get(...path);
      
      assert.deepStrictEqual(user, { name: 'Alice', age: 30 });
    });
  });

  describe('Increment/Decrement', function() {
    it('should increment a value', async function() {
      await db.set('key', 'counter', 10);
      await db.inc('key', 'counter', 5);
      
      const result = await db.get('key', 'counter');
      assert.strictEqual(result, 15);
    });

    it('should decrement a value', async function() {
      await db.set('key', 'counter', 20);
      await db.dec('key', 'counter', 8);
      
      const result = await db.get('key', 'counter');
      assert.strictEqual(result, 12);
    });

    it('should increment nested value', async function() {
      await db.set('user', 'balance', 100);
      await db.inc('user', 'balance', 50);
      
      const balance = await db.get('user', 'balance');
      assert.strictEqual(balance, 150);
    });

    it('should handle multiple increments', async function() {
      await db.set('key', 'views', 0);
      await db.inc('key', 'views', 1);
      await db.inc('key', 'views', 1);
      await db.inc('key', 'views', 1);
      
      const views = await db.get('key', 'views');
      assert.strictEqual(views, 3);
    });

    it('should increment non-existent value from zero', async function() {
      await db.inc('key', 'new_counter', 10);
      
      const result = await db.get('key', 'new_counter');
      assert.strictEqual(result, 10);
    });
  });

  describe('Update Operation', function() {
    it('should update value with function', async function() {
      await db.set('key', 'name', 'alice');
      await db.upd('key', 'name', name => name.toUpperCase());
      
      const result = await db.get('key', 'name');
      assert.strictEqual(result, 'ALICE');
    });

    it('should update nested value with function', async function() {
      await db.set('user', 'age', 25);
      await db.upd('user', 'age', age => age + 1);
      
      const age = await db.get('user', 'age');
      assert.strictEqual(age, 26);
    });

    it('should update complex objects', async function() {
      await db.set('config', 'settings', { theme: 'dark', lang: 'en' });
      await db.upd('config', 'settings', settings => ({
        ...settings,
        lang: 'es'
      }));
      
      const settings = await db.get('config', 'settings');
      assert.strictEqual(settings.theme, 'dark');
      assert.strictEqual(settings.lang, 'es');
    });
  });

  describe('Keys, Values, Entries', function() {
    beforeEach(async function() {
      await db.set('users', 'alice', { age: 30 });
      await db.set('users', 'bob', { age: 25 });
    });

    it('should get keys', async function() {
      const keys = await db.keys('users');
      assert.strictEqual(keys.length, 2);
      assert.ok(keys.includes('alice'));
      assert.ok(keys.includes('bob'));
    });

    it('should get values', async function() {
      const values = await db.values('users');
      assert.strictEqual(values.length, 2);
      assert.ok(values.some(v => v.age === 30));
      assert.ok(values.some(v => v.age === 25));
    });

    it('should get entries', async function() {
      const entries = await db.entries('users');
      assert.strictEqual(entries.length, 2);
      assert.ok(entries.some(([k, v]) => k === 'alice' && v.age === 30));
      assert.ok(entries.some(([k, v]) => k === 'bob' && v.age === 25));
    });
  });

  describe('Complex Nested Operations', function() {
    it('should handle deeply nested objects', async function() {
      await db.set('app', 'config', 'database', 'host', 'localhost');
      await db.set('app', 'config', 'database', 'port', 6379);
      
      const host = await db.get('app', 'config', 'database', 'host');
      const port = await db.get('app', 'config', 'database', 'port');
      
      assert.strictEqual(host, 'localhost');
      assert.strictEqual(port, 6379);
    });

    it('should handle arrays', async function() {
      await db.set('key', 'tags', ['redis', 'cache', 'database']);
      
      const tags = await db.get('key', 'tags');
      assert.deepStrictEqual(tags, ['redis', 'cache', 'database']);
    });

    it('should handle mixed types', async function() {
      await db.set('key', 'string', 'text');
      await db.set('key', 'number', 42);
      await db.set('key', 'boolean', true);
      await db.set('key', 'null', null);
      await db.set('key', 'array', [1, 2, 3]);
      
      const doc = await db.get('key');
      assert.strictEqual(doc.string, 'text');
      assert.strictEqual(doc.number, 42);
      assert.strictEqual(doc.boolean, true);
      assert.strictEqual(doc.null, null);
      assert.deepStrictEqual(doc.array, [1, 2, 3]);
    });
  });

  describe('JSON Path Operations', function() {
    it('should create intermediate objects automatically', async function() {
      await db.set('key', 'level1', 'level2', 'value', 'deep');
      
      const result = await db.get('key', 'level1', 'level2', 'value');
      assert.strictEqual(result, 'deep');
    });

    it('should handle object replacement', async function() {
      await db.set('key', 'obj', { old: 'value' });
      await db.set('key', 'obj', { new: 'value' });
      
      const obj = await db.get('key', 'obj');
      assert.deepStrictEqual(obj, { new: 'value' });
    });
  });

  describe('Performance', function() {
    it('should handle rapid sequential operations', async function() {
      const operations = 50;
      
      for (let i = 0; i < operations; i++) {
        await db.set('perf', `key${i}`, i);
      }
      
      for (let i = 0; i < operations; i++) {
        const value = await db.get('perf', `key${i}`);
        assert.strictEqual(value, i);
      }
    });

    it('should handle parallel operations', async function() {
      const operations = 20;
      const promises = [];
      
      for (let i = 0; i < operations; i++) {
        promises.push(db.set('parallel', `key${i}`, i));
      }
      
      await Promise.all(promises);
      
      const keys = await db.keys('parallel');
      assert.strictEqual(keys.length, operations);
    });
  });
});

