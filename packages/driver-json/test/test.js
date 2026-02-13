import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import { DeepBase } from '../../core/src/index.js';
import { JsonDriver } from '../src/JsonDriver.js';
import { SqliteDriver } from '../../driver-sqlite/src/SqliteDriver.js';

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

  describe('Queue / Stack (add + pop + shift)', function() {
    it('should work as FIFO queue with add + shift', async function() {
      // Enqueue items
      await db.add('queue', 'first');
      await db.add('queue', 'second');
      await db.add('queue', 'third');

      // Dequeue in insertion order (FIFO)
      assert.strictEqual(await db.shift('queue'), 'first');
      assert.strictEqual(await db.shift('queue'), 'second');
      assert.strictEqual(await db.shift('queue'), 'third');
      assert.strictEqual(await db.shift('queue'), undefined);
    });

    it('should work as LIFO stack with add + pop', async function() {
      // Push items
      await db.add('stack', 'first');
      await db.add('stack', 'second');
      await db.add('stack', 'third');

      // Pop in reverse order (LIFO)
      assert.strictEqual(await db.pop('stack'), 'third');
      assert.strictEqual(await db.pop('stack'), 'second');
      assert.strictEqual(await db.pop('stack'), 'first');
      assert.strictEqual(await db.pop('stack'), undefined);
    });

    it('should interleave add and shift correctly', async function() {
      await db.add('q', 'a');
      await db.add('q', 'b');
      assert.strictEqual(await db.shift('q'), 'a');

      await db.add('q', 'c');
      assert.strictEqual(await db.shift('q'), 'b');
      assert.strictEqual(await db.shift('q'), 'c');
      assert.strictEqual(await db.shift('q'), undefined);
    });

    it('should interleave add and pop correctly', async function() {
      await db.add('s', 'a');
      await db.add('s', 'b');
      assert.strictEqual(await db.pop('s'), 'b');

      await db.add('s', 'c');
      assert.strictEqual(await db.pop('s'), 'c');
      assert.strictEqual(await db.pop('s'), 'a');
      assert.strictEqual(await db.pop('s'), undefined);
    });

    it('should track length correctly through add/pop/shift', async function() {
      await db.add('items', 1);
      await db.add('items', 2);
      await db.add('items', 3);
      assert.strictEqual(await db.len('items'), 3);

      await db.pop('items');
      assert.strictEqual(await db.len('items'), 2);

      await db.shift('items');
      assert.strictEqual(await db.len('items'), 1);

      await db.add('items', 4);
      assert.strictEqual(await db.len('items'), 2);
    });

    it('should preserve values order with add + values()', async function() {
      await db.add('list', 'x');
      await db.add('list', 'y');
      await db.add('list', 'z');

      const vals = await db.values('list');
      assert.deepStrictEqual(vals, ['x', 'y', 'z']);
    });

    it('should handle objects in queue', async function() {
      await db.add('tasks', { task: 'build', priority: 1 });
      await db.add('tasks', { task: 'test', priority: 2 });
      await db.add('tasks', { task: 'deploy', priority: 3 });

      const first = await db.shift('tasks');
      assert.deepStrictEqual(first, { task: 'build', priority: 1 });

      const last = await db.pop('tasks');
      assert.deepStrictEqual(last, { task: 'deploy', priority: 3 });

      assert.strictEqual(await db.len('tasks'), 1);
    });

    // Limitation: pop/shift are designed for object-based collections (via add()),
    // not native JS arrays. delete arr[i] leaves a hole instead of shrinking the array.
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

  describe('Race Conditions', function() {
    it('should handle 100 concurrent increments correctly', async function() {
      this.timeout(5000);
      
      await db.set('counter', 0);
      
      // Run 100 concurrent increments
      const promises = Array.from({ length: 100 }, () => db.inc('counter', 1));
      await Promise.all(promises);
      
      const result = await db.get('counter');
      assert.strictEqual(result, 100, 'All increments should be applied atomically');
    });

    it('should handle concurrent read-modify-write operations', async function() {
      this.timeout(5000);
      
      await db.set('data', { counter: 0, items: [] });
      
      // Run 50 concurrent updates that read, modify, and write
      const promises = Array.from({ length: 50 }, (_, i) =>
        db.upd('data', (current) => ({
          counter: current.counter + 1,
          items: [...current.items, `item-${current.counter}`]
        }))
      );
      
      await Promise.all(promises);
      
      const finalData = await db.get('data');
      assert.strictEqual(finalData.counter, 50, 'Counter should be exactly 50');
      assert.strictEqual(finalData.items.length, 50, 'Should have exactly 50 items');
      
      // Check that all items have unique values
      const uniqueItems = new Set(finalData.items);
      assert.strictEqual(uniqueItems.size, 50, 'All items should be unique');
    });

    it('should handle concurrent sets on different keys', async function() {
      this.timeout(5000);
      
      // Run 50 concurrent set operations on different keys
      const promises = Array.from({ length: 50 }, (_, i) =>
        db.set('users', `user${i}`, { name: `User ${i}`, value: i })
      );
      
      await Promise.all(promises);
      
      // Verify all keys exist and have correct values
      const users = await db.get('users');
      assert.strictEqual(Object.keys(users).length, 50, 'Should have 50 users');
      
      for (let i = 0; i < 50; i++) {
        assert.deepStrictEqual(
          users[`user${i}`],
          { name: `User ${i}`, value: i },
          `User ${i} should have correct data`
        );
      }
    });

    it('should handle concurrent add operations with unique IDs', async function() {
      this.timeout(5000);
      
      await db.set('items', {});
      
      // Run 50 concurrent add operations
      const promises = Array.from({ length: 50 }, (_, i) =>
        db.add('items', { value: i })
      );
      
      const results = await Promise.all(promises);
      
      // Verify all items were added with unique IDs
      const items = await db.get('items');
      assert.strictEqual(Object.keys(items).length, 50, 'Should have 50 items');
      
      // Check that all IDs are unique
      const ids = results.map(r => r[r.length - 1]);
      const uniqueIds = new Set(ids);
      assert.strictEqual(uniqueIds.size, 50, 'All IDs should be unique');
    });

    it('should handle concurrent decrements correctly', async function() {
      this.timeout(5000);
      
      await db.set('inventory', 1000);
      
      // Run 100 concurrent decrements
      const promises = Array.from({ length: 100 }, () => db.dec('inventory', 5));
      await Promise.all(promises);
      
      const result = await db.get('inventory');
      assert.strictEqual(result, 500, 'All decrements should be applied atomically');
    });
  });

  describe('Multi-Process Safety (multiProcess: true)', function() {
    const workerPath = path.join(__dirname, 'worker.js');
    const multiProcessPath = path.join(testDataPath, 'multi-process');

    function spawnWorker(args) {
      return new Promise((resolve, reject) => {
        const child = fork(workerPath, [JSON.stringify(args)], {
          stdio: 'pipe'
        });
        let stderr = '';
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Worker exited with code ${code}: ${stderr}`));
        });
        child.on('error', reject);
      });
    }

    beforeEach(function() {
      // Clean singleton cache so multiProcess instances are fresh
      JsonDriver._instances = {};
      if (fs.existsSync(multiProcessPath)) {
        fs.rmSync(multiProcessPath, { recursive: true, force: true });
      }
    });

    afterEach(function() {
      JsonDriver._instances = {};
      if (fs.existsSync(multiProcessPath)) {
        fs.rmSync(multiProcessPath, { recursive: true, force: true });
      }
    });

    it('should handle concurrent increments from multiple processes', async function() {
      this.timeout(30000);
      
      const dbName = 'mp-inc-test';
      const numProcesses = 4;
      const iterationsPerProcess = 25;

      // Initialize the file with counter = 0
      const driver = new JsonDriver({ name: dbName, path: multiProcessPath, multiProcess: true });
      await driver.connect();
      await driver.set('counter', 0);
      await driver.disconnect();
      JsonDriver._instances = {};

      // Spawn N processes that each increment counter M times
      const workers = Array.from({ length: numProcesses }, () =>
        spawnWorker({ name: dbName, path: multiProcessPath, task: 'increment', iterations: iterationsPerProcess })
      );
      await Promise.all(workers);

      // Read the final value
      const verifyDriver = new JsonDriver({ name: dbName, path: multiProcessPath, multiProcess: true });
      await verifyDriver.connect();
      const result = await verifyDriver.get('counter');
      await verifyDriver.disconnect();
      JsonDriver._instances = {};

      assert.strictEqual(result, numProcesses * iterationsPerProcess,
        `Expected counter to be ${numProcesses * iterationsPerProcess}, got ${result}`);
    });

    it('should handle concurrent inc() from multiple processes', async function() {
      this.timeout(30000);
      
      const dbName = 'mp-atomic-inc-test';
      const numProcesses = 4;
      const iterationsPerProcess = 25;

      // Initialize
      const driver = new JsonDriver({ name: dbName, path: multiProcessPath, multiProcess: true });
      await driver.connect();
      await driver.set('counter', 0);
      await driver.disconnect();
      JsonDriver._instances = {};

      // Spawn processes using inc()
      const workers = Array.from({ length: numProcesses }, () =>
        spawnWorker({ name: dbName, path: multiProcessPath, task: 'inc', iterations: iterationsPerProcess })
      );
      await Promise.all(workers);

      // Verify
      const verifyDriver = new JsonDriver({ name: dbName, path: multiProcessPath, multiProcess: true });
      await verifyDriver.connect();
      const result = await verifyDriver.get('counter');
      await verifyDriver.disconnect();
      JsonDriver._instances = {};

      assert.strictEqual(result, numProcesses * iterationsPerProcess,
        `Expected counter to be ${numProcesses * iterationsPerProcess}, got ${result}`);
    });

    it('should preserve writes from different processes on different keys', async function() {
      this.timeout(30000);
      
      const dbName = 'mp-keys-test';
      const numProcesses = 3;
      const iterationsPerProcess = 10;

      // Initialize
      const driver = new JsonDriver({ name: dbName, path: multiProcessPath, multiProcess: true });
      await driver.connect();
      await driver.set('entries', {});
      await driver.disconnect();
      JsonDriver._instances = {};

      // Spawn processes that each write unique keys
      const workers = Array.from({ length: numProcesses }, () =>
        spawnWorker({ name: dbName, path: multiProcessPath, task: 'set-unique', iterations: iterationsPerProcess })
      );
      await Promise.all(workers);

      // Verify all keys are present
      const verifyDriver = new JsonDriver({ name: dbName, path: multiProcessPath, multiProcess: true });
      await verifyDriver.connect();
      const entries = await verifyDriver.get('entries');
      await verifyDriver.disconnect();
      JsonDriver._instances = {};

      const totalKeys = Object.keys(entries).length;
      const expected = numProcesses * iterationsPerProcess;
      assert.strictEqual(totalKeys, expected,
        `Expected ${expected} entries, got ${totalKeys}`);
    });

    it('should work correctly in single-process multiProcess mode', async function() {
      this.timeout(5000);

      const mpDb = new DeepBase(new JsonDriver({ 
        name: 'mp-single-test', 
        path: multiProcessPath, 
        multiProcess: true 
      }));
      await mpDb.connect();

      // Basic operations should still work
      await mpDb.set('key', 'value');
      assert.strictEqual(await mpDb.get('key'), 'value');

      await mpDb.set('counter', 0);
      const promises = Array.from({ length: 50 }, () => mpDb.inc('counter', 1));
      await Promise.all(promises);
      assert.strictEqual(await mpDb.get('counter'), 50);

      await mpDb.set('user', 'name', 'Alice');
      await mpDb.del('user', 'name');
      const user = await mpDb.get('user');
      assert.deepStrictEqual(user, {});

      await mpDb.disconnect();
      JsonDriver._instances = {};
    });
  });
});

describe('Multi-Driver: JsonDriver + SqliteDriver (add + pop + shift)', function() {
  const multiDataPath = path.join(__dirname, 'test-data-multi');
  let db, jsonDriver, sqliteDriver;
  let testCounter = 0;

  before(function() {
    if (fs.existsSync(multiDataPath)) {
      fs.rmSync(multiDataPath, { recursive: true, force: true });
    }
  });

  beforeEach(async function() {
    testCounter++;
    JsonDriver._instances = {};
    SqliteDriver._instances = {};

    jsonDriver = new JsonDriver({ name: `multi-${testCounter}`, path: multiDataPath });
    sqliteDriver = new SqliteDriver({ name: `multi-${testCounter}`, path: multiDataPath });

    db = new DeepBase([jsonDriver, sqliteDriver]);
    await db.connect();
  });

  afterEach(async function() {
    await db.disconnect();
    JsonDriver._instances = {};
    SqliteDriver._instances = {};
    if (fs.existsSync(multiDataPath)) {
      fs.rmSync(multiDataPath, { recursive: true, force: true });
    }
  });

  it('should write to both drivers on set', async function() {
    await db.set('key', 'value');

    const fromJson = await jsonDriver.get('key');
    const fromSqlite = await sqliteDriver.get('key');

    assert.strictEqual(fromJson, 'value');
    assert.strictEqual(fromSqlite, 'value');
  });

  it('should keep both drivers in sync after add + pop (FIFO via shift)', async function() {
    // Add items
    await db.add('queue', 'first');
    await db.add('queue', 'second');
    await db.add('queue', 'third');

    // Check both drivers have same number of items
    const jsonBefore = await jsonDriver.get('queue');
    const sqliteBefore = await sqliteDriver.get('queue');
    assert.strictEqual(Object.keys(jsonBefore).length, 3, 'JSON should have 3 items');
    assert.strictEqual(Object.keys(sqliteBefore).length, 3, 'SQLite should have 3 items');

    // Check that both drivers have the same keys (same IDs)
    const jsonKeys = Object.keys(jsonBefore).sort();
    const sqliteKeys = Object.keys(sqliteBefore).sort();
    assert.deepStrictEqual(jsonKeys, sqliteKeys, 'Both drivers should have the same keys');

    // Shift (FIFO dequeue)
    const shifted = await db.shift('queue');
    assert.strictEqual(shifted, 'first');

    // Both drivers should have 2 items remaining
    const jsonAfter = await jsonDriver.get('queue');
    const sqliteAfter = await sqliteDriver.get('queue');
    assert.strictEqual(Object.keys(jsonAfter).length, 2, 'JSON should have 2 items after shift');
    assert.strictEqual(Object.keys(sqliteAfter).length, 2, 'SQLite should have 2 items after shift');

    // Remaining values should match
    assert.deepStrictEqual(Object.values(jsonAfter), ['second', 'third']);
    assert.deepStrictEqual(Object.values(sqliteAfter), ['second', 'third']);
  });

  it('should keep both drivers in sync after add + pop (LIFO)', async function() {
    await db.add('stack', 'a');
    await db.add('stack', 'b');
    await db.add('stack', 'c');

    // Pop (LIFO)
    const popped = await db.pop('stack');
    assert.strictEqual(popped, 'c');

    // Both should have 2 items
    const jsonAfter = await jsonDriver.get('stack');
    const sqliteAfter = await sqliteDriver.get('stack');
    assert.strictEqual(Object.keys(jsonAfter).length, 2, 'JSON should have 2 items after pop');
    assert.strictEqual(Object.keys(sqliteAfter).length, 2, 'SQLite should have 2 items after pop');

    // Same keys and values in both
    assert.deepStrictEqual(Object.keys(jsonAfter).sort(), Object.keys(sqliteAfter).sort());
    assert.deepStrictEqual(Object.values(jsonAfter), ['a', 'b']);
    assert.deepStrictEqual(Object.values(sqliteAfter), ['a', 'b']);
  });

  it('should drain queue completely from both drivers', async function() {
    await db.add('q', 1);
    await db.add('q', 2);
    await db.add('q', 3);

    assert.strictEqual(await db.shift('q'), 1);
    assert.strictEqual(await db.shift('q'), 2);
    assert.strictEqual(await db.shift('q'), 3);
    assert.strictEqual(await db.shift('q'), undefined);

    // Both drivers should be empty (JSON returns {}, SQLite returns null when all keys deleted)
    const jsonData = await jsonDriver.get('q');
    const sqliteData = await sqliteDriver.get('q');
    const jsonLen = jsonData ? Object.keys(jsonData).length : 0;
    const sqliteLen = sqliteData ? Object.keys(sqliteData).length : 0;
    assert.strictEqual(jsonLen, 0, 'JSON queue should be empty');
    assert.strictEqual(sqliteLen, 0, 'SQLite queue should be empty');
  });

  it('should handle interleaved add + pop across both drivers', async function() {
    await db.add('items', 'x');
    await db.add('items', 'y');
    assert.strictEqual(await db.pop('items'), 'y');

    await db.add('items', 'z');
    assert.strictEqual(await db.pop('items'), 'z');
    assert.strictEqual(await db.pop('items'), 'x');
    assert.strictEqual(await db.pop('items'), undefined);

    // Both empty (JSON returns {}, SQLite returns null when all keys deleted)
    const jsonData = await jsonDriver.get('items');
    const sqliteData = await sqliteDriver.get('items');
    const jsonLen = jsonData ? Object.keys(jsonData).length : 0;
    const sqliteLen = sqliteData ? Object.keys(sqliteData).length : 0;
    assert.strictEqual(jsonLen, 0, 'JSON items should be empty');
    assert.strictEqual(sqliteLen, 0, 'SQLite items should be empty');
  });

  it('should maintain consistent len() across both drivers', async function() {
    await db.add('list', 'a');
    await db.add('list', 'b');
    await db.add('list', 'c');

    assert.strictEqual(await db.len('list'), 3);

    // Check each driver directly
    const jsonList = await jsonDriver.get('list');
    const sqliteList = await sqliteDriver.get('list');
    assert.strictEqual(Object.keys(jsonList).length, 3);
    assert.strictEqual(Object.keys(sqliteList).length, 3);

    await db.pop('list');

    const jsonAfter = await jsonDriver.get('list');
    const sqliteAfter = await sqliteDriver.get('list');
    assert.strictEqual(Object.keys(jsonAfter).length, 2);
    assert.strictEqual(Object.keys(sqliteAfter).length, 2);
  });

  it('should handle objects in multi-driver queue', async function() {
    await db.add('tasks', { name: 'build', prio: 1 });
    await db.add('tasks', { name: 'test', prio: 2 });
    await db.add('tasks', { name: 'deploy', prio: 3 });

    const first = await db.shift('tasks');
    assert.deepStrictEqual(first, { name: 'build', prio: 1 });

    const last = await db.pop('tasks');
    assert.deepStrictEqual(last, { name: 'deploy', prio: 3 });

    // Both drivers should have 1 item left
    const jsonTasks = await jsonDriver.get('tasks');
    const sqliteTasks = await sqliteDriver.get('tasks');
    assert.strictEqual(Object.keys(jsonTasks).length, 1);
    assert.strictEqual(Object.keys(sqliteTasks).length, 1);
    assert.deepStrictEqual(Object.values(jsonTasks)[0], { name: 'test', prio: 2 });
    assert.deepStrictEqual(Object.values(sqliteTasks)[0], { name: 'test', prio: 2 });
  });
});

