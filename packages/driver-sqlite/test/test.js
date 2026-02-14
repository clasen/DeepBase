import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeepBase } from '../../core/src/index.js';
import { SqliteDriver } from '../src/SqliteDriver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataPath = path.join(__dirname, 'test-data');

describe('SqliteDriver', function() {
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
    db = new DeepBase(new SqliteDriver({ 
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

    it('should handle numbers', async function() {
      await db.set('number', 42);
      const result = await db.get('number');
      assert.strictEqual(result, 42);
    });

    it('should handle booleans', async function() {
      await db.set('flag', true);
      const result = await db.get('flag');
      assert.strictEqual(result, true);
    });

    it('should handle arrays', async function() {
      await db.set('list', [1, 2, 3]);
      const result = await db.get('list');
      assert.deepStrictEqual(result, [1, 2, 3]);
    });

    it('should handle complex objects', async function() {
      const complexObj = {
        name: 'Test',
        items: [1, 2, 3],
        meta: { created: '2024-01-01', active: true }
      };
      await db.set('complex', complexObj);
      const result = await db.get('complex');
      assert.deepStrictEqual(result, complexObj);
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

    it('should delete keys containing dots', async function() {
      await db.set('emails', 'user.name@domain.com', 'verified', true);
      await db.set('emails', 'other@email.com', 'verified', false);
      
      await db.del('emails', 'user.name@domain.com');
      
      const email1 = await db.get('emails', 'user.name@domain.com');
      const email2 = await db.get('emails', 'other@email.com');
      
      assert.strictEqual(email1, null);
      assert.deepStrictEqual(email2, { verified: false });
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

    it('should delete parent and all children', async function() {
      await db.set('parent', 'child1', 'value1');
      await db.set('parent', 'child2', 'value2');
      await db.set('parent', 'nested', 'deep', 'value3');
      
      await db.del('parent');
      
      const result = await db.get('parent');
      assert.strictEqual(result, null);
      
      const child1 = await db.get('parent', 'child1');
      assert.strictEqual(child1, null);
      
      const nested = await db.get('parent', 'nested', 'deep');
      assert.strictEqual(nested, null);
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
      
      const item1 = await db.get(...path1);
      const item2 = await db.get(...path2);
      
      assert.deepStrictEqual(item1, { value: 1 });
      assert.deepStrictEqual(item2, { value: 2 });
    });

    it('should add items at nested paths', async function() {
      const path = await db.add('categories', 'electronics', 'items', { name: 'Laptop' });
      
      assert.strictEqual(path.length, 4);
      assert.strictEqual(path[0], 'categories');
      assert.strictEqual(path[1], 'electronics');
      assert.strictEqual(path[2], 'items');
      
      const item = await db.get(...path);
      assert.deepStrictEqual(item, { name: 'Laptop' });
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

    it('should handle negative increments', async function() {
      await db.set('counter', 10);
      await db.inc('counter', -3);
      
      const result = await db.get('counter');
      assert.strictEqual(result, 7);
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

    it('should update object with function', async function() {
      await db.set('user', { name: 'Alice', age: 30 });
      await db.upd('user', user => ({ ...user, age: user.age + 1 }));
      
      const user = await db.get('user');
      assert.deepStrictEqual(user, { name: 'Alice', age: 31 });
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

    it('should return empty arrays for non-object values', async function() {
      await db.set('simple', 'string');
      
      const keys = await db.keys('simple');
      const values = await db.values('simple');
      const entries = await db.entries('simple');
      
      assert.deepStrictEqual(keys, []);
      assert.deepStrictEqual(values, []);
      assert.deepStrictEqual(entries, []);
    });
  });

  describe('Persistence', function() {
    it('should persist data to database file', async function() {
      // Use a separate db for this test
      const persistDb = new DeepBase(new SqliteDriver({ 
        name: 'persist-test', 
        path: testDataPath 
      }));
      await persistDb.connect();
      await persistDb.set('persistent', 'data');
      await persistDb.disconnect();
      
      const filePath = path.join(testDataPath, 'persist-test.db');
      assert.ok(fs.existsSync(filePath));
    });

    it('should load existing data on connect', async function() {
      // Use a separate db for this test
      const db1 = new DeepBase(new SqliteDriver({ 
        name: 'reload-test', 
        path: testDataPath 
      }));
      await db1.connect();
      await db1.set('existing', 'value');
      await db1.set('nested', 'key', 'data');
      await db1.disconnect();
      
      // Create new instance pointing to same file
      const db2 = new DeepBase(new SqliteDriver({ 
        name: 'reload-test', 
        path: testDataPath 
      }));
      await db2.connect();
      
      const result = await db2.get('existing');
      assert.strictEqual(result, 'value');
      
      const nested = await db2.get('nested', 'key');
      assert.strictEqual(nested, 'data');
      
      await db2.disconnect();
    });

    it('should handle reconnection', async function() {
      await db.set('before', 'disconnect');
      await db.disconnect();
      
      await db.connect();
      const result = await db.get('before');
      assert.strictEqual(result, 'disconnect');
    });
  });

  describe('Singleton Pattern', function() {
    it('should return same instance for same file', function() {
      const driver1 = new SqliteDriver({ name: 'singleton', path: testDataPath });
      const driver2 = new SqliteDriver({ name: 'singleton', path: testDataPath });
      
      assert.strictEqual(driver1, driver2);
    });

    it('should return different instances for different files', function() {
      const driver1 = new SqliteDriver({ name: 'file1', path: testDataPath });
      const driver2 = new SqliteDriver({ name: 'file2', path: testDataPath });
      
      assert.notStrictEqual(driver1, driver2);
    });
  });

  describe('Root Object Operations', function() {
    it('should set entire root object', async function() {
      const data = {
        users: { alice: { age: 30 }, bob: { age: 25 } },
        config: { theme: 'dark', lang: 'en' }
      };
      
      await db.set(data);
      const result = await db.get();
      assert.deepStrictEqual(result, data);
    });

    it('should get entire root object', async function() {
      await db.set('key1', 'value1');
      await db.set('key2', 'value2');
      await db.set('nested', 'key', 'value');
      
      const result = await db.get();
      assert.deepStrictEqual(result, {
        key1: 'value1',
        key2: 'value2',
        nested: { key: 'value' }
      });
    });

    it('should replace root object on set', async function() {
      await db.set('old', 'data');
      
      const newData = { new: 'data' };
      await db.set(newData);
      
      const result = await db.get();
      assert.deepStrictEqual(result, newData);
      
      const old = await db.get('old');
      assert.strictEqual(old, null);
    });
  });

  describe('Deep Nesting', function() {
    it('should handle deeply nested paths', async function() {
      await db.set('a', 'b', 'c', 'd', 'e', 'deep value');
      const result = await db.get('a', 'b', 'c', 'd', 'e');
      assert.strictEqual(result, 'deep value');
    });

    it('should get partial deep objects', async function() {
      await db.set('a', 'b', 'c', 'value1');
      await db.set('a', 'b', 'd', 'value2');
      await db.set('a', 'e', 'value3');
      
      const resultB = await db.get('a', 'b');
      assert.deepStrictEqual(resultB, { c: 'value1', d: 'value2' });
      
      const resultA = await db.get('a');
      assert.deepStrictEqual(resultA, {
        b: { c: 'value1', d: 'value2' },
        e: 'value3'
      });
    });
  });

  describe('Overwriting Object with Nested Properties', function() {
    it('should handle setting object first then nested properties', async function() {
      // This is the scenario from example 05-sqlite.js
      await db.set('config', { lang: 'en', theme: 'dark' });
      await db.set('config', 'lang', 'en');
      await db.set('config', 'theme', 'light');
      
      const config = await db.get('config');
      assert.deepStrictEqual(config, { lang: 'en', theme: 'light' });
    });

    it('should prioritize nested properties over initial object', async function() {
      await db.set('settings', { a: 1, b: 2, c: 3 });
      await db.set('settings', 'b', 99);
      await db.set('settings', 'd', 4);
      
      const settings = await db.get('settings');
      assert.deepStrictEqual(settings, { a: 1, b: 99, c: 3, d: 4 });
    });

    it('should handle nested object then deeper nesting', async function() {
      await db.set('user', { name: 'Alice', meta: { role: 'admin' } });
      await db.set('user', 'meta', 'role', 'user');
      await db.set('user', 'meta', 'active', true);
      
      const user = await db.get('user');
      assert.deepStrictEqual(user, { 
        name: 'Alice', 
        meta: { role: 'user', active: true } 
      });
    });
  });

  describe('Object Expansion with Special Keys', function() {
    it('should handle object with dotted keys when expanding', async function() {
      // Store an object with dots in its property names
      await db.set('config', { 'server.port': 8080, 'server.host': 'localhost' });
      
      // Trigger expansion by setting a nested property
      await db.set('config', 'debug', true);
      
      const config = await db.get('config');
      assert.strictEqual(config['server.port'], 8080);
      assert.strictEqual(config['server.host'], 'localhost');
      assert.strictEqual(config.debug, true);
    });

    it('should not crash on objects with empty string keys', async function() {
      // This was the root cause of the production crash:
      // empty string key produces trailing dot in DB, leading to empty path
      await db.set('data', { '': 'empty_key_value', 'normal': 'ok' });
      
      // Trigger expansion
      await db.set('data', 'extra', 123);
      
      const data = await db.get('data');
      assert.strictEqual(data[''], 'empty_key_value');
      assert.strictEqual(data.normal, 'ok');
      assert.strictEqual(data.extra, 123);
    });

    it('should handle nested objects with dotted keys during expansion', async function() {
      await db.set('replace', {
        '{lang}': 'es',
        '{first_name}': 'Martin',
        '@main': 'martin'
      });
      
      // Trigger expansion
      await db.set('replace', '{lang}', 'en');
      
      const result = await db.get('replace');
      assert.strictEqual(result['{lang}'], 'en');
      assert.strictEqual(result['{first_name}'], 'Martin');
      assert.strictEqual(result['@main'], 'martin');
    });

    it('should preserve dots in keys through set/get root object cycle', async function() {
      const data = {
        'api.v1.endpoint': 'https://api.example.com',
        'api.v2.endpoint': 'https://v2.api.example.com'
      };
      
      await db.set(data);
      const result = await db.get();
      assert.deepStrictEqual(result, data);
    });
  });

  describe('Keys with Underscores (SQL LIKE safety)', function() {
    it('should not cross-match keys with underscores', async function() {
      // _ is a SQL LIKE wildcard that matches any single character
      await db.set('chat_1', 'msg', 'hello');
      await db.set('chatX1', 'msg', 'world');
      
      const chat1 = await db.get('chat_1');
      assert.deepStrictEqual(chat1, { msg: 'hello' });
      
      const chatX1 = await db.get('chatX1');
      assert.deepStrictEqual(chatX1, { msg: 'world' });
    });

    it('should isolate data between similar keys with underscores', async function() {
      await db.set('user_42', 'name', 'Alice');
      await db.set('userX42', 'name', 'Bob');
      await db.set('user.42', 'name', 'Charlie');
      
      const u1 = await db.get('user_42');
      const u2 = await db.get('userX42');
      const u3 = await db.get('user.42');
      
      assert.deepStrictEqual(u1, { name: 'Alice' });
      assert.deepStrictEqual(u2, { name: 'Bob' });
      assert.deepStrictEqual(u3, { name: 'Charlie' });
    });

    it('should delete only matching keys with underscores', async function() {
      await db.set('item_a', 'x', 1);
      await db.set('itemXa', 'x', 2);
      
      await db.del('item_a');
      
      assert.strictEqual(await db.get('item_a'), null);
      assert.deepStrictEqual(await db.get('itemXa'), { x: 2 });
    });

    it('should handle keys with percent signs', async function() {
      await db.set('progress', '100%', 'done', true);
      await db.set('progress', 'abc', 'done', false);
      
      const p100 = await db.get('progress', '100%');
      assert.deepStrictEqual(p100, { done: true });
      
      const pabc = await db.get('progress', 'abc');
      assert.deepStrictEqual(pabc, { done: false });
    });
  });

  describe('Storybot-like Structure', function() {
    it('should handle dotted top-level keys with deep nesting', async function() {
      const sessionKey = 'stm.1769201539421.dawduxooy';
      
      await db.set(sessionKey, 'started', 'LuaGardenbot', true);
      await db.set(sessionKey, 'active', 'LuaGardenbot', true);
      await db.set(sessionKey, 'active', 'AmyWaybot', true);
      
      const session = await db.get(sessionKey);
      assert.deepStrictEqual(session, {
        started: { LuaGardenbot: true },
        active: { LuaGardenbot: true, AmyWaybot: true }
      });
    });

    it('should handle replace map with special chars in keys', async function() {
      const sessionKey = 'stm.12345.abc';
      
      await db.set(sessionKey, 'replace', {
        '{lang}': 'es',
        '{vip_token}': '',
        '{first_name}': 'STM User',
        '{last_name}': '',
        '{crypto_name}': 'kkerfhkkzgf',
        '@main': 'martin'
      });
      
      const replace = await db.get(sessionKey, 'replace');
      assert.strictEqual(replace['{lang}'], 'es');
      assert.strictEqual(replace['@main'], 'martin');
      assert.strictEqual(replace['{first_name}'], 'STM User');
    });

    it('should handle node history with numeric-like keys', async function() {
      const sessionKey = 'stm.999.xyz';
      
      await db.set(sessionKey, 'node', 'history', 'c0', {
        from: 'LuaGardenbot',
        message: 'new contact',
        timestamp: 1771012955839
      });
      await db.set(sessionKey, 'node', 'history', '0-2760293686', {
        from: 'LuaGardenbot',
        message: 'Hey, I\'m Lua',
        timestamp: 1771012956863
      });
      await db.set(sessionKey, 'node', 'history', '0-4151942372-o', {
        from: 'main',
        to: 'LuaGardenbot',
        message: 'hola',
        timestamp: 1771012960058
      });
      
      const history = await db.get(sessionKey, 'node', 'history');
      assert.strictEqual(Object.keys(history).length, 3);
      assert.strictEqual(history['c0'].from, 'LuaGardenbot');
      assert.strictEqual(history['0-2760293686'].message, 'Hey, I\'m Lua');
      assert.strictEqual(history['0-4151942372-o'].to, 'LuaGardenbot');
    });

    it('should handle object expansion with replace map then set nested', async function() {
      const sessionKey = 'stm.12345.abc';
      
      // Store replace map as object
      await db.set(sessionKey, 'replace', {
        '{lang}': 'es',
        '{first_name}': 'User'
      });
      
      // Now update a single key — triggers _expandParentObjects
      await db.set(sessionKey, 'replace', '{lang}', 'en');
      
      const replace = await db.get(sessionKey, 'replace');
      assert.strictEqual(replace['{lang}'], 'en');
      assert.strictEqual(replace['{first_name}'], 'User');
    });

    it('should handle full session lifecycle without crash', async function() {
      const sessionKey = 'stm.1769201539421.dawduxooy';
      
      // Initial object-style set
      await db.set(sessionKey, 'replace', {
        '{lang}': 'es',
        '{vip_token}': '',
        '{first_name}': 'STM User'
      });
      
      await db.set(sessionKey, 'config', { country: '', gender: 'M' });
      await db.set(sessionKey, 'tokens', { input: 4554, output: 229, cost: 0.0079825 });
      
      // Nested individual sets
      await db.set(sessionKey, 'started', 'LuaGardenbot', true);
      await db.set(sessionKey, 'active', 'LuaGardenbot', true);
      await db.set(sessionKey, 'active', 'AmyWaybot', true);
      await db.set(sessionKey, 'node', 'current', 'chapter', 2);
      await db.set(sessionKey, 'node', 'current', 'id', '50-326833713');
      
      // Update inside previously stored object — triggers expansion
      await db.set(sessionKey, 'replace', '{lang}', 'en');
      await db.set(sessionKey, 'config', 'country', 'AR');
      
      // Verify everything
      const session = await db.get(sessionKey);
      
      assert.strictEqual(session.replace['{lang}'], 'en');
      assert.strictEqual(session.replace['{first_name}'], 'STM User');
      assert.strictEqual(session.config.country, 'AR');
      assert.strictEqual(session.config.gender, 'M');
      assert.strictEqual(session.tokens.cost, 0.0079825);
      assert.strictEqual(session.started.LuaGardenbot, true);
      assert.strictEqual(session.active.AmyWaybot, true);
      assert.strictEqual(session.node.current.chapter, 2);
      assert.strictEqual(session.node.current.id, '50-326833713');
    });

    it('should not mix sessions with similar dotted keys', async function() {
      await db.set('stm.111.aaa', 'data', 'session1');
      await db.set('stm.111.bbb', 'data', 'session2');
      await db.set('stm.222.aaa', 'data', 'session3');
      
      assert.deepStrictEqual(await db.get('stm.111.aaa'), { data: 'session1' });
      assert.deepStrictEqual(await db.get('stm.111.bbb'), { data: 'session2' });
      assert.deepStrictEqual(await db.get('stm.222.aaa'), { data: 'session3' });
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
});


