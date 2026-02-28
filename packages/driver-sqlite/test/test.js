import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeepBase } from '../../core/src/index.js';
import { SqliteDriver } from '../src/SqliteDriver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDataPath = path.join(__dirname, 'test-data');

const PRAGMA_MODES = ['none', 'safe', 'balanced', 'fast'];

for (const pragma of PRAGMA_MODES) {
  describe(`SqliteDriver [pragma=${pragma}]`, function () {
    let db;
    let testCounter = 0;

    before(function () {
      if (fs.existsSync(testDataPath)) {
        fs.rmSync(testDataPath, { recursive: true, force: true });
      }
    });

    beforeEach(async function () {
      testCounter++;
      db = new DeepBase(new SqliteDriver({
        name: `test-${pragma}-${testCounter}`,
        path: testDataPath,
        pragma,
      }));
      await db.connect();
    });

    afterEach(async function () {
      await db.disconnect();
      if (fs.existsSync(testDataPath)) {
        fs.rmSync(testDataPath, { recursive: true, force: true });
      }
    });

    describe('Basic Operations', function () {
      it('should set and get a simple value', async function () {
        await db.set('key', 'value');
        assert.strictEqual(await db.get('key'), 'value');
      });

      it('should set and get nested values', async function () {
        await db.set('user', 'name', 'Alice');
        await db.set('user', 'age', 30);
        assert.strictEqual(await db.get('user', 'name'), 'Alice');
        assert.strictEqual(await db.get('user', 'age'), 30);
      });

      it('should get entire nested object', async function () {
        await db.set('user', 'name', 'Bob');
        await db.set('user', 'age', 25);
        assert.deepStrictEqual(await db.get('user'), { name: 'Bob', age: 25 });
      });

      it('should return null for non-existent keys', async function () {
        assert.strictEqual(await db.get('nonexistent'), null);
      });

      it('should handle numbers', async function () {
        await db.set('number', 42);
        assert.strictEqual(await db.get('number'), 42);
      });

      it('should handle booleans', async function () {
        await db.set('flag', true);
        assert.strictEqual(await db.get('flag'), true);
      });

      it('should handle arrays', async function () {
        await db.set('list', [1, 2, 3]);
        assert.deepStrictEqual(await db.get('list'), [1, 2, 3]);
      });

      it('should handle complex objects', async function () {
        const complexObj = {
          name: 'Test',
          items: [1, 2, 3],
          meta: { created: '2024-01-01', active: true },
        };
        await db.set('complex', complexObj);
        assert.deepStrictEqual(await db.get('complex'), complexObj);
      });
    });

    describe('Keys with Dots', function () {
      it('should handle keys containing dots', async function () {
        const setResult = await db.set('value', 'martin.clasen@gmail.com', 1);
        assert.strictEqual(setResult.length, 2);
        assert.strictEqual(setResult[0], 'value');
        assert.strictEqual(setResult[1], 'martin.clasen@gmail.com');
        assert.deepStrictEqual(await db.get('value'), { 'martin.clasen@gmail.com': 1 });
      });

      it('should handle keys with multiple dots', async function () {
        await db.set('config', 'api.prod.endpoint', 'https://api.example.com');
        assert.strictEqual(await db.get('config', 'api.prod.endpoint'), 'https://api.example.com');
      });

      it('should handle nested paths with dots in keys', async function () {
        await db.set('users', 'john.doe@example.com', 'name', 'John Doe');
        await db.set('users', 'john.doe@example.com', 'age', 30);
        assert.deepStrictEqual(await db.get('users', 'john.doe@example.com'), { name: 'John Doe', age: 30 });
      });

      it('should handle dots in first level keys', async function () {
        await db.set('config.prod', 'value', 100);
        assert.deepStrictEqual(await db.get('config.prod'), { value: 100 });
      });

      it('should distinguish between dots in keys and path separators', async function () {
        await db.set('users', 'alice', 'email', 'alice@example.com');
        await db.set('users', 'john.doe@company.com', 'email', 'john@work.com');
        const users = await db.get('users');
        assert.strictEqual(users.alice.email, 'alice@example.com');
        assert.strictEqual(users['john.doe@company.com'].email, 'john@work.com');
        assert.strictEqual(Object.keys(users).length, 2);
      });

      it('should delete keys containing dots', async function () {
        await db.set('emails', 'user.name@domain.com', 'verified', true);
        await db.set('emails', 'other@email.com', 'verified', false);
        await db.del('emails', 'user.name@domain.com');
        assert.strictEqual(await db.get('emails', 'user.name@domain.com'), null);
        assert.deepStrictEqual(await db.get('emails', 'other@email.com'), { verified: false });
      });
    });

    describe('Delete Operations', function () {
      it('should delete a key', async function () {
        await db.set('temp', 'value');
        await db.del('temp');
        assert.strictEqual(await db.get('temp'), null);
      });

      it('should delete nested key', async function () {
        await db.set('user', 'name', 'Alice');
        await db.set('user', 'age', 30);
        await db.del('user', 'age');
        assert.deepStrictEqual(await db.get('user'), { name: 'Alice' });
      });

      it('should delete parent and all children', async function () {
        await db.set('parent', 'child1', 'value1');
        await db.set('parent', 'child2', 'value2');
        await db.set('parent', 'nested', 'deep', 'value3');
        await db.del('parent');
        assert.strictEqual(await db.get('parent'), null);
        assert.strictEqual(await db.get('parent', 'child1'), null);
        assert.strictEqual(await db.get('parent', 'nested', 'deep'), null);
      });

      it('should clear all data', async function () {
        await db.set('key1', 'value1');
        await db.set('key2', 'value2');
        await db.del();
        assert.deepStrictEqual(await db.get(), {});
      });
    });

    describe('Add Operation', function () {
      it('should add item with auto-generated ID', async function () {
        const p = await db.add('users', { name: 'Charlie' });
        assert.strictEqual(p.length, 2);
        assert.strictEqual(p[0], 'users');
        assert.strictEqual(typeof p[1], 'string');
        assert.strictEqual(p[1].length, 10);
        assert.deepStrictEqual(await db.get(...p), { name: 'Charlie' });
      });

      it('should add multiple items with unique IDs', async function () {
        const p1 = await db.add('items', { value: 1 });
        const p2 = await db.add('items', { value: 2 });
        assert.notStrictEqual(p1[1], p2[1]);
        assert.deepStrictEqual(await db.get(...p1), { value: 1 });
        assert.deepStrictEqual(await db.get(...p2), { value: 2 });
      });

      it('should add items at nested paths', async function () {
        const p = await db.add('categories', 'electronics', 'items', { name: 'Laptop' });
        assert.strictEqual(p.length, 4);
        assert.deepStrictEqual(await db.get(...p), { name: 'Laptop' });
      });
    });

    describe('Increment/Decrement', function () {
      it('should increment a value', async function () {
        await db.set('counter', 10);
        await db.inc('counter', 5);
        assert.strictEqual(await db.get('counter'), 15);
      });

      it('should decrement a value', async function () {
        await db.set('counter', 20);
        await db.dec('counter', 8);
        assert.strictEqual(await db.get('counter'), 12);
      });

      it('should increment nested value', async function () {
        await db.set('user', 'balance', 100);
        await db.inc('user', 'balance', 50);
        assert.strictEqual(await db.get('user', 'balance'), 150);
      });

      it('should handle negative increments', async function () {
        await db.set('counter', 10);
        await db.inc('counter', -3);
        assert.strictEqual(await db.get('counter'), 7);
      });
    });

    describe('Update Operation', function () {
      it('should update value with function', async function () {
        await db.set('name', 'alice');
        await db.upd('name', name => name.toUpperCase());
        assert.strictEqual(await db.get('name'), 'ALICE');
      });

      it('should update nested value with function', async function () {
        await db.set('user', 'age', 25);
        await db.upd('user', 'age', age => age + 1);
        assert.strictEqual(await db.get('user', 'age'), 26);
      });

      it('should update object with function', async function () {
        await db.set('user', { name: 'Alice', age: 30 });
        await db.upd('user', user => ({ ...user, age: user.age + 1 }));
        assert.deepStrictEqual(await db.get('user'), { name: 'Alice', age: 31 });
      });
    });

    describe('Keys, Values, Entries', function () {
      beforeEach(async function () {
        await db.set('users', 'alice', { age: 30 });
        await db.set('users', 'bob', { age: 25 });
      });

      it('should get keys', async function () {
        assert.deepStrictEqual((await db.keys('users')).sort(), ['alice', 'bob']);
      });

      it('should get values', async function () {
        const values = await db.values('users');
        assert.strictEqual(values.length, 2);
        assert.ok(values.some(v => v.age === 30));
        assert.ok(values.some(v => v.age === 25));
      });

      it('should get entries', async function () {
        const entries = await db.entries('users');
        assert.strictEqual(entries.length, 2);
        assert.ok(entries.some(([k, v]) => k === 'alice' && v.age === 30));
        assert.ok(entries.some(([k, v]) => k === 'bob' && v.age === 25));
      });

      it('should return empty arrays for non-object values', async function () {
        await db.set('simple', 'string');
        assert.deepStrictEqual(await db.keys('simple'), []);
        assert.deepStrictEqual(await db.values('simple'), []);
        assert.deepStrictEqual(await db.entries('simple'), []);
      });
    });

    describe('Persistence', function () {
      it('should persist data to database file', async function () {
        const persistDb = new DeepBase(new SqliteDriver({
          name: `persist-${pragma}`,
          path: testDataPath,
          pragma,
        }));
        await persistDb.connect();
        await persistDb.set('persistent', 'data');
        await persistDb.disconnect();
        assert.ok(fs.existsSync(path.join(testDataPath, `persist-${pragma}.db`)));
      });

      it('should load existing data on connect', async function () {
        const db1 = new DeepBase(new SqliteDriver({
          name: `reload-${pragma}`,
          path: testDataPath,
          pragma,
        }));
        await db1.connect();
        await db1.set('existing', 'value');
        await db1.set('nested', 'key', 'data');
        await db1.disconnect();

        const db2 = new DeepBase(new SqliteDriver({
          name: `reload-${pragma}`,
          path: testDataPath,
          pragma,
        }));
        await db2.connect();
        assert.strictEqual(await db2.get('existing'), 'value');
        assert.strictEqual(await db2.get('nested', 'key'), 'data');
        await db2.disconnect();
      });

      it('should handle reconnection', async function () {
        await db.set('before', 'disconnect');
        await db.disconnect();
        await db.connect();
        assert.strictEqual(await db.get('before'), 'disconnect');
      });

      it('should be a no-op when already connected', async function () {
        await db.set('key', 'value');
        await db.connect();
        assert.strictEqual(await db.get('key'), 'value');
        await db.set('key2', 'value2');
        assert.strictEqual(await db.get('key2'), 'value2');
      });
    });

    describe('Singleton Pattern', function () {
      it('should return same instance for same file', function () {
        const d1 = new SqliteDriver({ name: `singleton-${pragma}`, path: testDataPath, pragma });
        const d2 = new SqliteDriver({ name: `singleton-${pragma}`, path: testDataPath, pragma });
        assert.strictEqual(d1, d2);
      });

      it('should return different instances for different files', function () {
        const d1 = new SqliteDriver({ name: `file1-${pragma}`, path: testDataPath, pragma });
        const d2 = new SqliteDriver({ name: `file2-${pragma}`, path: testDataPath, pragma });
        assert.notStrictEqual(d1, d2);
      });
    });

    describe('Root Object Operations', function () {
      it('should set entire root object', async function () {
        const data = {
          users: { alice: { age: 30 }, bob: { age: 25 } },
          config: { theme: 'dark', lang: 'en' },
        };
        await db.set(data);
        assert.deepStrictEqual(await db.get(), data);
      });

      it('should get entire root object', async function () {
        await db.set('key1', 'value1');
        await db.set('key2', 'value2');
        await db.set('nested', 'key', 'value');
        assert.deepStrictEqual(await db.get(), {
          key1: 'value1',
          key2: 'value2',
          nested: { key: 'value' },
        });
      });

      it('should replace root object on set', async function () {
        await db.set('old', 'data');
        await db.set({ new: 'data' });
        assert.deepStrictEqual(await db.get(), { new: 'data' });
        assert.strictEqual(await db.get('old'), null);
      });
    });

    describe('Deep Nesting', function () {
      it('should handle deeply nested paths', async function () {
        await db.set('a', 'b', 'c', 'd', 'e', 'deep value');
        assert.strictEqual(await db.get('a', 'b', 'c', 'd', 'e'), 'deep value');
      });

      it('should get partial deep objects', async function () {
        await db.set('a', 'b', 'c', 'value1');
        await db.set('a', 'b', 'd', 'value2');
        await db.set('a', 'e', 'value3');
        assert.deepStrictEqual(await db.get('a', 'b'), { c: 'value1', d: 'value2' });
        assert.deepStrictEqual(await db.get('a'), {
          b: { c: 'value1', d: 'value2' },
          e: 'value3',
        });
      });
    });

    describe('Overwriting Object with Nested Properties', function () {
      it('should handle setting object first then nested properties', async function () {
        await db.set('config', { lang: 'en', theme: 'dark' });
        await db.set('config', 'lang', 'en');
        await db.set('config', 'theme', 'light');
        assert.deepStrictEqual(await db.get('config'), { lang: 'en', theme: 'light' });
      });

      it('should prioritize nested properties over initial object', async function () {
        await db.set('settings', { a: 1, b: 2, c: 3 });
        await db.set('settings', 'b', 99);
        await db.set('settings', 'd', 4);
        assert.deepStrictEqual(await db.get('settings'), { a: 1, b: 99, c: 3, d: 4 });
      });

      it('should handle nested object then deeper nesting', async function () {
        await db.set('user', { name: 'Alice', meta: { role: 'admin' } });
        await db.set('user', 'meta', 'role', 'user');
        await db.set('user', 'meta', 'active', true);
        assert.deepStrictEqual(await db.get('user'), {
          name: 'Alice',
          meta: { role: 'user', active: true },
        });
      });
    });

    describe('Object Expansion with Special Keys', function () {
      it('should handle object with dotted keys when expanding', async function () {
        await db.set('config', { 'server.port': 8080, 'server.host': 'localhost' });
        await db.set('config', 'debug', true);
        const config = await db.get('config');
        assert.strictEqual(config['server.port'], 8080);
        assert.strictEqual(config['server.host'], 'localhost');
        assert.strictEqual(config.debug, true);
      });

      it('should not crash on objects with empty string keys', async function () {
        await db.set('data', { '': 'empty_key_value', normal: 'ok' });
        await db.set('data', 'extra', 123);
        const data = await db.get('data');
        assert.strictEqual(data[''], 'empty_key_value');
        assert.strictEqual(data.normal, 'ok');
        assert.strictEqual(data.extra, 123);
      });

      it('should handle nested objects with dotted keys during expansion', async function () {
        await db.set('replace', {
          '{lang}': 'es',
          '{first_name}': 'Martin',
          '@main': 'martin',
        });
        await db.set('replace', '{lang}', 'en');
        const result = await db.get('replace');
        assert.strictEqual(result['{lang}'], 'en');
        assert.strictEqual(result['{first_name}'], 'Martin');
        assert.strictEqual(result['@main'], 'martin');
      });

      it('should preserve dots in keys through set/get root object cycle', async function () {
        const data = {
          'api.v1.endpoint': 'https://api.example.com',
          'api.v2.endpoint': 'https://v2.api.example.com',
        };
        await db.set(data);
        assert.deepStrictEqual(await db.get(), data);
      });
    });

    describe('Keys with Underscores (SQL LIKE safety)', function () {
      it('should not cross-match keys with underscores', async function () {
        await db.set('chat_1', 'msg', 'hello');
        await db.set('chatX1', 'msg', 'world');
        assert.deepStrictEqual(await db.get('chat_1'), { msg: 'hello' });
        assert.deepStrictEqual(await db.get('chatX1'), { msg: 'world' });
      });

      it('should isolate data between similar keys with underscores', async function () {
        await db.set('user_42', 'name', 'Alice');
        await db.set('userX42', 'name', 'Bob');
        await db.set('user.42', 'name', 'Charlie');
        assert.deepStrictEqual(await db.get('user_42'), { name: 'Alice' });
        assert.deepStrictEqual(await db.get('userX42'), { name: 'Bob' });
        assert.deepStrictEqual(await db.get('user.42'), { name: 'Charlie' });
      });

      it('should delete only matching keys with underscores', async function () {
        await db.set('item_a', 'x', 1);
        await db.set('itemXa', 'x', 2);
        await db.del('item_a');
        assert.strictEqual(await db.get('item_a'), null);
        assert.deepStrictEqual(await db.get('itemXa'), { x: 2 });
      });

      it('should handle keys with percent signs', async function () {
        await db.set('progress', '100%', 'done', true);
        await db.set('progress', 'abc', 'done', false);
        assert.deepStrictEqual(await db.get('progress', '100%'), { done: true });
        assert.deepStrictEqual(await db.get('progress', 'abc'), { done: false });
      });
    });

    describe('Storybot-like Structure', function () {
      it('should handle dotted top-level keys with deep nesting', async function () {
        const sk = 'stm.1769201539421.dawduxooy';
        await db.set(sk, 'started', 'LuaGardenbot', true);
        await db.set(sk, 'active', 'LuaGardenbot', true);
        await db.set(sk, 'active', 'AmyWaybot', true);
        assert.deepStrictEqual(await db.get(sk), {
          started: { LuaGardenbot: true },
          active: { LuaGardenbot: true, AmyWaybot: true },
        });
      });

      it('should handle replace map with special chars in keys', async function () {
        const sk = 'stm.12345.abc';
        await db.set(sk, 'replace', {
          '{lang}': 'es',
          '{vip_token}': '',
          '{first_name}': 'STM User',
          '{last_name}': '',
          '{crypto_name}': 'kkerfhkkzgf',
          '@main': 'martin',
        });
        const replace = await db.get(sk, 'replace');
        assert.strictEqual(replace['{lang}'], 'es');
        assert.strictEqual(replace['@main'], 'martin');
        assert.strictEqual(replace['{first_name}'], 'STM User');
      });

      it('should handle node history with numeric-like keys', async function () {
        const sk = 'stm.999.xyz';
        await db.set(sk, 'node', 'history', 'c0', {
          from: 'LuaGardenbot', message: 'new contact', timestamp: 1771012955839,
        });
        await db.set(sk, 'node', 'history', '0-2760293686', {
          from: 'LuaGardenbot', message: 'Hey, I\'m Lua', timestamp: 1771012956863,
        });
        await db.set(sk, 'node', 'history', '0-4151942372-o', {
          from: 'main', to: 'LuaGardenbot', message: 'hola', timestamp: 1771012960058,
        });
        const history = await db.get(sk, 'node', 'history');
        assert.strictEqual(Object.keys(history).length, 3);
        assert.strictEqual(history['c0'].from, 'LuaGardenbot');
        assert.strictEqual(history['0-2760293686'].message, 'Hey, I\'m Lua');
        assert.strictEqual(history['0-4151942372-o'].to, 'LuaGardenbot');
      });

      it('should handle object expansion with replace map then set nested', async function () {
        const sk = 'stm.12345.abc';
        await db.set(sk, 'replace', { '{lang}': 'es', '{first_name}': 'User' });
        await db.set(sk, 'replace', '{lang}', 'en');
        const replace = await db.get(sk, 'replace');
        assert.strictEqual(replace['{lang}'], 'en');
        assert.strictEqual(replace['{first_name}'], 'User');
      });

      it('should handle full session lifecycle without crash', async function () {
        const sk = 'stm.1769201539421.dawduxooy';
        await db.set(sk, 'replace', { '{lang}': 'es', '{vip_token}': '', '{first_name}': 'STM User' });
        await db.set(sk, 'config', { country: '', gender: 'M' });
        await db.set(sk, 'tokens', { input: 4554, output: 229, cost: 0.0079825 });
        await db.set(sk, 'started', 'LuaGardenbot', true);
        await db.set(sk, 'active', 'LuaGardenbot', true);
        await db.set(sk, 'active', 'AmyWaybot', true);
        await db.set(sk, 'node', 'current', 'chapter', 2);
        await db.set(sk, 'node', 'current', 'id', '50-326833713');
        await db.set(sk, 'replace', '{lang}', 'en');
        await db.set(sk, 'config', 'country', 'AR');
        const session = await db.get(sk);
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

      it('should not mix sessions with similar dotted keys', async function () {
        await db.set('stm.111.aaa', 'data', 'session1');
        await db.set('stm.111.bbb', 'data', 'session2');
        await db.set('stm.222.aaa', 'data', 'session3');
        assert.deepStrictEqual(await db.get('stm.111.aaa'), { data: 'session1' });
        assert.deepStrictEqual(await db.get('stm.111.bbb'), { data: 'session2' });
        assert.deepStrictEqual(await db.get('stm.222.aaa'), { data: 'session3' });
      });
    });

    describe('Race Conditions', function () {
      it('should handle 100 concurrent increments correctly', async function () {
        this.timeout(5000);
        await db.set('counter', 0);
        await Promise.all(Array.from({ length: 100 }, () => db.inc('counter', 1)));
        assert.strictEqual(await db.get('counter'), 100);
      });

      it('should handle concurrent read-modify-write operations', async function () {
        this.timeout(5000);
        await db.set('data', { counter: 0, items: [] });
        await Promise.all(Array.from({ length: 50 }, () =>
          db.upd('data', cur => ({
            counter: cur.counter + 1,
            items: [...cur.items, `item-${cur.counter}`],
          })),
        ));
        const final = await db.get('data');
        assert.strictEqual(final.counter, 50);
        assert.strictEqual(final.items.length, 50);
        assert.strictEqual(new Set(final.items).size, 50);
      });

      it('should handle concurrent sets on different keys', async function () {
        this.timeout(5000);
        await Promise.all(Array.from({ length: 50 }, (_, i) =>
          db.set('users', `user${i}`, { name: `User ${i}`, value: i }),
        ));
        const users = await db.get('users');
        assert.strictEqual(Object.keys(users).length, 50);
        for (let i = 0; i < 50; i++) {
          assert.deepStrictEqual(users[`user${i}`], { name: `User ${i}`, value: i });
        }
      });

      it('should handle concurrent add operations with unique IDs', async function () {
        this.timeout(5000);
        await db.set('items', {});
        const results = await Promise.all(Array.from({ length: 50 }, (_, i) =>
          db.add('items', { value: i }),
        ));
        const items = await db.get('items');
        assert.strictEqual(Object.keys(items).length, 50);
        assert.strictEqual(new Set(results.map(r => r[r.length - 1])).size, 50);
      });

      it('should handle concurrent decrements correctly', async function () {
        this.timeout(5000);
        await db.set('inventory', 1000);
        await Promise.all(Array.from({ length: 100 }, () => db.dec('inventory', 5)));
        assert.strictEqual(await db.get('inventory'), 500);
      });
    });
  });
}
