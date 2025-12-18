import assert from 'assert';
import { DeepBase } from '../../core/src/index.js';
import { MongoDriver } from '../src/MongoDriver.js';

describe('MongoDriver', function() {
  let db;
  let testCounter = 0;

  // Increase timeout for MongoDB operations
  this.timeout(10000);

  beforeEach(async function() {
    testCounter++;
    db = new DeepBase(new MongoDriver({ 
      url: 'mongodb://localhost:27017',
      database: 'deepbase_test',
      collection: `test_${testCounter}`
    }));
    
    try {
      await db.connect();
    } catch (error) {
      this.skip(); // Skip tests if MongoDB is not available
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
    it('should connect to MongoDB', async function() {
      const driver = db.getDriver(0);
      assert.ok(driver.client);
      assert.ok(driver.collection);
    });
  });

  describe('Basic Operations', function() {
    it('should set and get a simple value', async function() {
      await db.set('doc1', 'key', 'value');
      const result = await db.get('doc1', 'key');
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

    it('should get all documents', async function() {
      await db.set('doc1', 'value', 'test1');
      await db.set('doc2', 'value', 'test2');
      
      const all = await db.get();
      assert.ok(all.doc1);
      assert.ok(all.doc2);
      assert.strictEqual(all.doc1.value, 'test1');
      assert.strictEqual(all.doc2.value, 'test2');
    });
  });

  describe('Delete Operations', function() {
    it('should delete a field', async function() {
      await db.set('doc', 'temp', 'value');
      await db.set('doc', 'keep', 'value');
      await db.del('doc', 'temp');
      
      const result = await db.get('doc');
      assert.strictEqual(result.temp, undefined);
      assert.strictEqual(result.keep, 'value');
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
      await db.set('doc1', 'value', 'test1');
      await db.set('doc2', 'value', 'test2');
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
      await db.set('doc', 'counter', 10);
      await db.inc('doc', 'counter', 5);
      
      const result = await db.get('doc', 'counter');
      assert.strictEqual(result, 15);
    });

    it('should decrement a value', async function() {
      await db.set('doc', 'counter', 20);
      await db.dec('doc', 'counter', 8);
      
      const result = await db.get('doc', 'counter');
      assert.strictEqual(result, 12);
    });

    it('should increment nested value', async function() {
      await db.set('user', 'balance', 100);
      await db.inc('user', 'balance', 50);
      
      const balance = await db.get('user', 'balance');
      assert.strictEqual(balance, 150);
    });

    it('should handle multiple increments', async function() {
      await db.set('doc', 'views', 0);
      await db.inc('doc', 'views', 1);
      await db.inc('doc', 'views', 1);
      await db.inc('doc', 'views', 1);
      
      const views = await db.get('doc', 'views');
      assert.strictEqual(views, 3);
    });
  });

  describe('Update Operation', function() {
    it('should update value with function', async function() {
      await db.set('doc', 'name', 'alice');
      await db.upd('doc', 'name', name => name.toUpperCase());
      
      const result = await db.get('doc', 'name');
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
      await db.set('app', 'config', 'database', 'port', 27017);
      
      const host = await db.get('app', 'config', 'database', 'host');
      const port = await db.get('app', 'config', 'database', 'port');
      
      assert.strictEqual(host, 'localhost');
      assert.strictEqual(port, 27017);
    });

    it('should handle arrays', async function() {
      await db.set('doc', 'tags', ['javascript', 'nodejs', 'mongodb']);
      
      const tags = await db.get('doc', 'tags');
      assert.deepStrictEqual(tags, ['javascript', 'nodejs', 'mongodb']);
    });

    it('should handle mixed types', async function() {
      await db.set('doc', 'string', 'text');
      await db.set('doc', 'number', 42);
      await db.set('doc', 'boolean', true);
      await db.set('doc', 'null', null);
      await db.set('doc', 'array', [1, 2, 3]);
      
      const doc = await db.get('doc');
      assert.strictEqual(doc.string, 'text');
      assert.strictEqual(doc.number, 42);
      assert.strictEqual(doc.boolean, true);
      assert.strictEqual(doc.null, null);
      assert.deepStrictEqual(doc.array, [1, 2, 3]);
    });
  });

  describe('Keys with Special Characters', function() {
    it('should handle keys with dots', async function() {
      await db.set('doc1', 'user.name@domain.com', 'value');
      const result = await db.get('doc1', 'user.name@domain.com');
      assert.strictEqual(result, 'value');
    });

    it('should handle keys with dollar signs', async function() {
      await db.set('doc1', '$price', 100);
      const result = await db.get('doc1', '$price');
      assert.strictEqual(result, 100);
    });

    it('should handle keys with backslashes', async function() {
      await db.set('doc1', 'path\\to\\file', 'value');
      const result = await db.get('doc1', 'path\\to\\file');
      assert.strictEqual(result, 'value');
    });

    it('should handle complex keys with multiple special characters', async function() {
      await db.set('users', 'john.doe@company.com', 'name', 'John Doe');
      await db.set('users', 'john.doe@company.com', 'role', 'admin');
      
      const user = await db.get('users', 'john.doe@company.com');
      assert.deepStrictEqual(user, { name: 'John Doe', role: 'admin' });
    });

    it('should distinguish between dots in keys and path separators', async function() {
      await db.set('config', 'api.endpoint', 'https://api.example.com');
      await db.set('config', 'timeout', 5000);
      
      const config = await db.get('config');
      assert.strictEqual(config['api.endpoint'], 'https://api.example.com');
      assert.strictEqual(config.timeout, 5000);
    });
  });
});

