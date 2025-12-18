import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeepBase } from '../../core/src/index.js';
import { JsonDriver } from '../src/JsonDriver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataPath = path.join(__dirname, 'test-data');

describe('JsonDriver', function() {
  let db;
  let testCounter = 0;

  before(function() {
    // Clean up test data before all tests
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  beforeEach(async function() {
    // Use unique name for each test to avoid singleton conflicts
    testCounter++;
    db = new DeepBase(new JsonDriver({ 
      name: `test-${testCounter}`, 
      path: testDataPath 
    }));
    await db.connect();
  });

  afterEach(async function() {
    await db.disconnect();
    if (fs.existsSync(testDataPath)) {
      fs.rmSync(testDataPath, { recursive: true, force: true });
    }
  });

  describe('Basic Operations', function() {
    it('should set and get a simple value', async function() {
      await db.set('key', 'value');
      const result = await db.get('key');
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
      assert.deepStrictEqual(user, { name: 'Bob', age: 25 });
    });

    it('should return null for non-existent keys', async function() {
      const result = await db.get('nonexistent');
      assert.strictEqual(result, null);
    });
  });

  describe('Keys with Dots', function() {
    it('should handle keys containing dots', async function() {
      const setResult = await db.set('value', 'martin.clasen@gmail.com', 1);
      
      assert.strictEqual(setResult.length, 2);
      assert.strictEqual(setResult[0], 'value');
      assert.strictEqual(setResult[1], 'martin.clasen@gmail.com');
      
      const getValue = await db.get('value');
      assert.deepStrictEqual(getValue, { 'martin.clasen@gmail.com': 1 });
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
      assert.deepStrictEqual(user, { name: 'John Doe', age: 30 });
    });

    it('should handle dots in first level keys', async function() {
      await db.set('config.prod', 'value', 100);
      const configProd = await db.get('config.prod');
      assert.deepStrictEqual(configProd, { value: 100 });
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
  });

  describe('Delete Operations', function() {
    it('should delete a key', async function() {
      await db.set('temp', 'value');
      await db.del('temp');
      
      const result = await db.get('temp');
      assert.strictEqual(result, null);
    });

    it('should delete nested key', async function() {
      await db.set('user', 'name', 'Alice');
      await db.set('user', 'age', 30);
      await db.del('user', 'age');
      
      const user = await db.get('user');
      assert.deepStrictEqual(user, { name: 'Alice' });
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
      const path = await db.add('users', { name: 'Charlie' });
      
      assert.strictEqual(path.length, 2);
      assert.strictEqual(path[0], 'users');
      assert.strictEqual(typeof path[1], 'string');
      assert.strictEqual(path[1].length, 10);
      
      const user = await db.get(...path);
      assert.deepStrictEqual(user, { name: 'Charlie' });
    });

    it('should add multiple items with unique IDs', async function() {
      const path1 = await db.add('items', { value: 1 });
      const path2 = await db.add('items', { value: 2 });
      
      assert.notStrictEqual(path1[1], path2[1]);
    });
  });

  describe('Increment/Decrement', function() {
    it('should increment a value', async function() {
      await db.set('counter', 10);
      await db.inc('counter', 5);
      
      const result = await db.get('counter');
      assert.strictEqual(result, 15);
    });

    it('should decrement a value', async function() {
      await db.set('counter', 20);
      await db.dec('counter', 8);
      
      const result = await db.get('counter');
      assert.strictEqual(result, 12);
    });

    it('should increment nested value', async function() {
      await db.set('user', 'balance', 100);
      await db.inc('user', 'balance', 50);
      
      const balance = await db.get('user', 'balance');
      assert.strictEqual(balance, 150);
    });
  });

  describe('Update Operation', function() {
    it('should update value with function', async function() {
      await db.set('name', 'alice');
      await db.upd('name', name => name.toUpperCase());
      
      const result = await db.get('name');
      assert.strictEqual(result, 'ALICE');
    });

    it('should update nested value with function', async function() {
      await db.set('user', 'age', 25);
      await db.upd('user', 'age', age => age + 1);
      
      const age = await db.get('user', 'age');
      assert.strictEqual(age, 26);
    });
  });

  describe('Keys, Values, Entries', function() {
    beforeEach(async function() {
      await db.set('users', 'alice', { age: 30 });
      await db.set('users', 'bob', { age: 25 });
    });

    it('should get keys', async function() {
      const keys = await db.keys('users');
      assert.deepStrictEqual(keys.sort(), ['alice', 'bob']);
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

  describe('Persistence', function() {
    it('should persist data to file', async function() {
      // Use a separate db for this test
      const persistDb = new DeepBase(new JsonDriver({ 
        name: 'persist-test', 
        path: testDataPath 
      }));
      await persistDb.connect();
      await persistDb.set('persistent', 'data');
      await persistDb.disconnect();
      
      const filePath = path.join(testDataPath, 'persist-test.json');
      assert.ok(fs.existsSync(filePath));
      
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.deepStrictEqual(content, { persistent: 'data' });
    });

    it('should load existing data on connect', async function() {
      // Use a separate db for this test
      const db1 = new DeepBase(new JsonDriver({ 
        name: 'reload-test', 
        path: testDataPath 
      }));
      await db1.connect();
      await db1.set('existing', 'value');
      await db1.disconnect();
      
      // Create new instance pointing to same file
      const db2 = new DeepBase(new JsonDriver({ 
        name: 'reload-test', 
        path: testDataPath 
      }));
      await db2.connect();
      
      const result = await db2.get('existing');
      assert.strictEqual(result, 'value');
      
      await db2.disconnect();
    });
  });

  describe('Singleton Pattern', function() {
    it('should return same instance for same file', function() {
      const driver1 = new JsonDriver({ name: 'singleton', path: testDataPath });
      const driver2 = new JsonDriver({ name: 'singleton', path: testDataPath });
      
      assert.strictEqual(driver1, driver2);
    });

    it('should return different instances for different files', function() {
      const driver1 = new JsonDriver({ name: 'file1', path: testDataPath });
      const driver2 = new JsonDriver({ name: 'file2', path: testDataPath });
      
      assert.notStrictEqual(driver1, driver2);
    });
  });
});

