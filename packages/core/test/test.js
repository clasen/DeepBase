import assert from 'assert';
import { DeepBase, DeepBaseDriver } from '../src/index.js';

// Mock driver for testing
class MockDriver extends DeepBaseDriver {
  constructor({name, ...opts} = {}) {
    super(opts);
    this.data = {};
    this.connected = false;
    this.name = name || 'mock';
  }

  async connect() {
    this.connected = true;
    await super.connect(); // Set _connected flag
  }

  async disconnect() {
    this.connected = false;
    this._connected = false;
  }

  async get(...args) {
    if (!this.connected) throw new Error('Not connected');
    if (args.length === 0) return { ...this.data };
    
    let current = this.data;
    for (const key of args) {
      if (!current || typeof current !== 'object') return null;
      current = current[key];
    }
    return current === undefined ? null : current;
  }

  async set(...args) {
    if (!this.connected) throw new Error('Not connected');
    if (args.length < 2) {
      this.data = args[0] || {};
      return [];
    }
    
    const keys = args.slice(0, -1);
    const value = args[args.length - 1];
    
    let current = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    return keys;
  }

  async del(...keys) {
    if (!this.connected) throw new Error('Not connected');
    if (keys.length === 0) {
      this.data = {};
      return;
    }
    
    const key = keys.pop();
    let current = this.data;
    for (const k of keys) {
      if (!current[k]) return;
      current = current[k];
    }
    delete current[key];
  }

  async inc(...args) {
    const i = args.pop();
    const current = await this.get(...args) || 0;
    return this.set(...args, current + i);
  }

  async dec(...args) {
    const i = args.pop();
    return this.inc(...args, -i);
  }

  async add(...keys) {
    const value = keys.pop();
    const id = Math.random().toString(36).substr(2, 10);
    await this.set(...keys, id, value);
    return [...keys, id];
  }

  async upd(...args) {
    const func = args.pop();
    return this.set(...args, func(await this.get(...args)));
  }
}

describe('DeepBase Core', function() {
  describe('Constructor', function() {
    it('should accept single driver', function() {
      const driver = new MockDriver();
      const db = new DeepBase(driver);
      
      assert.strictEqual(db.drivers.length, 1);
      assert.strictEqual(db.drivers[0], driver);
    });

    it('should accept array of drivers', function() {
      const driver1 = new MockDriver({ name: 'd1' });
      const driver2 = new MockDriver({ name: 'd2' });
      const db = new DeepBase([driver1, driver2]);
      
      assert.strictEqual(db.drivers.length, 2);
      assert.strictEqual(db.drivers[0], driver1);
      assert.strictEqual(db.drivers[1], driver2);
    });

    it('should create JsonDriver for plain object (backward compatibility)', function() {
      // When a plain object is passed, it should create a JsonDriver with those options
      const db = new DeepBase({ name: 'test-db' });
      assert.strictEqual(db.drivers.length, 1);
      assert.ok(db.drivers[0] instanceof DeepBaseDriver);
    });

    it('should set default options', function() {
      const db = new DeepBase(new MockDriver());
      
      assert.strictEqual(db.opts.writeAll, true);
      assert.strictEqual(db.opts.readFirst, true);
      assert.strictEqual(db.opts.failOnPrimaryError, true);
    });

    it('should override default options', function() {
      const db = new DeepBase(new MockDriver(), {
        writeAll: false,
        readFirst: false,
        failOnPrimaryError: false
      });
      
      assert.strictEqual(db.opts.writeAll, false);
      assert.strictEqual(db.opts.readFirst, false);
      assert.strictEqual(db.opts.failOnPrimaryError, false);
    });
  });

  describe('Connect/Disconnect', function() {
    it('should connect all drivers', async function() {
      const driver1 = new MockDriver({ name: 'd1' });
      const driver2 = new MockDriver({ name: 'd2' });
      const db = new DeepBase([driver1, driver2]);
      
      const result = await db.connect();
      
      assert.strictEqual(result.connected, 2);
      assert.strictEqual(result.total, 2);
      assert.ok(driver1.connected);
      assert.ok(driver2.connected);
    });

    it('should disconnect all drivers', async function() {
      const driver1 = new MockDriver({ name: 'd1' });
      const driver2 = new MockDriver({ name: 'd2' });
      const db = new DeepBase([driver1, driver2]);
      
      await db.connect();
      await db.disconnect();
      
      assert.ok(!driver1.connected);
      assert.ok(!driver2.connected);
    });
  });

  describe('Single Driver Operations', function() {
    let db;

    beforeEach(async function() {
      db = new DeepBase(new MockDriver());
      await db.connect();
    });

    it('should set and get values', async function() {
      await db.set('key', 'value');
      const result = await db.get('key');
      assert.strictEqual(result, 'value');
    });

    it('should delete values', async function() {
      await db.set('key', 'value');
      await db.del('key');
      const result = await db.get('key');
      assert.strictEqual(result, null);
    });

    it('should increment values', async function() {
      await db.set('counter', 10);
      await db.inc('counter', 5);
      const result = await db.get('counter');
      assert.strictEqual(result, 15);
    });

    it('should add items', async function() {
      const path = await db.add('items', { value: 'test' });
      assert.strictEqual(path.length, 2);
      assert.strictEqual(path[0], 'items');
    });
  });

  describe('Keys with Dots (Base Driver Methods)', function() {
    it('should properly escape and unescape dots in keys', function() {
      const driver = new MockDriver();
      
      // Test _escapeDots
      assert.strictEqual(driver._escapeDots('test.key'), 'test\\.key');
      assert.strictEqual(driver._escapeDots('user@example.com'), 'user@example\\.com');
      assert.strictEqual(driver._escapeDots('normal'), 'normal');
      
      // Test _unescapeDots
      assert.strictEqual(driver._unescapeDots('test\\.key'), 'test.key');
      assert.strictEqual(driver._unescapeDots('user@example\\.com'), 'user@example.com');
      assert.strictEqual(driver._unescapeDots('normal'), 'normal');
    });

    it('should convert path to key with proper escaping', function() {
      const driver = new MockDriver();
      
      // Test _pathToKey
      assert.strictEqual(driver._pathToKey(['user', 'name']), 'user.name');
      assert.strictEqual(driver._pathToKey(['user.name@domain.com', 'email']), 'user\\.name@domain\\.com.email');
      assert.strictEqual(driver._pathToKey(['config.prod']), 'config\\.prod');
    });

    it('should convert key to path with proper unescaping', function() {
      const driver = new MockDriver();
      
      // Test _keyToPath
      assert.deepStrictEqual(driver._keyToPath('user.name'), ['user', 'name']);
      assert.deepStrictEqual(driver._keyToPath('user\\.name@domain\\.com.email'), ['user.name@domain.com', 'email']);
      assert.deepStrictEqual(driver._keyToPath('config\\.prod'), ['config.prod']);
    });

    it('should handle backslashes in keys', function() {
      const driver = new MockDriver();
      
      // Test escaping backslashes
      assert.strictEqual(driver._escapeDots('path\\to\\file'), 'path\\\\to\\\\file');
      assert.strictEqual(driver._unescapeDots('path\\\\to\\\\file'), 'path\\to\\file');
      
      // Test path conversion with backslashes
      assert.strictEqual(driver._pathToKey(['path\\to\\file']), 'path\\\\to\\\\file');
      assert.deepStrictEqual(driver._keyToPath('path\\\\to\\\\file'), ['path\\to\\file']);
    });
  });

  describe('Multi-Driver Operations', function() {
    let driver1, driver2, db;

    beforeEach(async function() {
      driver1 = new MockDriver({ name: 'd1' });
      driver2 = new MockDriver({ name: 'd2' });
      db = new DeepBase([driver1, driver2]);
      await db.connect();
    });

    it('should write to all drivers when writeAll is true', async function() {
      await db.set('key', 'value');
      
      const result1 = await driver1.get('key');
      const result2 = await driver2.get('key');
      
      assert.strictEqual(result1, 'value');
      assert.strictEqual(result2, 'value');
    });

    it('should write to primary only when writeAll is false', async function() {
      const db2 = new DeepBase([driver1, driver2], { writeAll: false });
      await db2.connect();
      await db2.set('key', 'value');
      
      const result1 = await driver1.get('key');
      const result2 = await driver2.get('key');
      
      assert.strictEqual(result1, 'value');
      assert.strictEqual(result2, null);
    });

    it('should read from first available driver', async function() {
      await driver1.set('key', 'from-driver1');
      
      const result = await db.get('key');
      assert.strictEqual(result, 'from-driver1');
    });

    it('should fallback to second driver if first fails', async function() {
      driver1.connected = false; // Simulate runtime failure (driver reports as disconnected but _connected is still true)
      await driver2.set('key', 'from-driver2');
      
      const result = await db.get('key');
      assert.strictEqual(result, 'from-driver2');
    });
  });

  describe('Migration', function() {
    let driver1, driver2, db;

    beforeEach(async function() {
      driver1 = new MockDriver({ name: 'source' });
      driver2 = new MockDriver({ name: 'target' });
      db = new DeepBase([driver1, driver2]);
      await db.connect();
    });

    it('should migrate data from one driver to another', async function() {
      // Setup source data
      await driver1.set('users', 'alice', { age: 30 });
      await driver1.set('users', 'bob', { age: 25 });
      await driver1.set('config', 'version', '1.0');
      
      // Migrate
      const result = await db.migrate(0, 1);
      
      assert.ok(result.migrated > 0);
      assert.strictEqual(result.errors, 0);
      
      // Verify target has data
      const targetData = await driver2.get();
      assert.ok(targetData.users);
      assert.ok(targetData.config);
    });

    it('should clear target before migration when clear is true', async function() {
      await driver2.set('existing', 'data');
      await driver1.set('new', 'data');
      
      await db.migrate(0, 1, { clear: true });
      
      const existing = await driver2.get('existing');
      assert.strictEqual(existing, null);
    });

    it('should not clear target when clear is false', async function() {
      await driver2.set('existing', 'data');
      await driver1.set('new', 'data');
      
      await db.migrate(0, 1, { clear: false });
      
      const existing = await driver2.get('existing');
      assert.strictEqual(existing, 'data');
    });
  });

  describe('Driver Management', function() {
    it('should get driver by index', function() {
      const driver1 = new MockDriver({ name: 'd1' });
      const driver2 = new MockDriver({ name: 'd2' });
      const db = new DeepBase([driver1, driver2]);
      
      assert.strictEqual(db.getDriver(0), driver1);
      assert.strictEqual(db.getDriver(1), driver2);
    });

    it('should get all drivers', function() {
      const driver1 = new MockDriver({ name: 'd1' });
      const driver2 = new MockDriver({ name: 'd2' });
      const db = new DeepBase([driver1, driver2]);
      
      const drivers = db.getDrivers();
      assert.strictEqual(drivers.length, 2);
      assert.strictEqual(drivers[0], driver1);
      assert.strictEqual(drivers[1], driver2);
    });
  });

  describe('Lazy Connect', function() {
    it('should auto-connect when lazyConnect is true (default)', async function() {
      const driver = new MockDriver({ name: 'lazy' });
      const db = new DeepBase([driver]); // lazyConnect defaults to true
      
      // Driver should not be connected yet
      assert.strictEqual(driver._connected, false);
      
      // First operation should auto-connect
      await db.set('key', 'value');
      
      assert.strictEqual(driver._connected, true);
      assert.strictEqual(await db.get('key'), 'value');
    });

    it('should NOT auto-connect when lazyConnect is false', async function() {
      const driver = new MockDriver({ name: 'manual' });
      const db = new DeepBase([driver], { lazyConnect: false });
      
      // Driver should not be connected
      assert.strictEqual(driver._connected, false);
      
      // Operation should fail without manual connect
      try {
        await db.set('key', 'value');
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.strictEqual(error.message, 'Not connected');
      }
      
      // Manual connect should work
      await db.connect();
      assert.strictEqual(driver._connected, true);
      
      await db.set('key', 'value');
      assert.strictEqual(await db.get('key'), 'value');
    });

    it('should respect lazyConnect setting per instance', async function() {
      const driver1 = new MockDriver({ name: 'auto' });
      const driver2 = new MockDriver({ name: 'manual' });
      
      const dbAuto = new DeepBase([driver1], { lazyConnect: true });
      const dbManual = new DeepBase([driver2], { lazyConnect: false });
      
      // Auto instance should connect automatically
      await dbAuto.set('key', 'auto');
      assert.strictEqual(driver1._connected, true);
      
      // Manual instance should not connect automatically
      assert.strictEqual(driver2._connected, false);
      try {
        await dbManual.set('key', 'manual');
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.strictEqual(error.message, 'Not connected');
      }
    });
  });

  describe('Array Operations', function() {
    it('should pop last element from array', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      await db.set('items', ['a', 'b', 'c', 'd']);
      
      const popped = await db.pop('items');
      assert.strictEqual(popped, 'd');
      
      const remaining = await db.get('items');
      assert.strictEqual(remaining['0'], 'a');
      assert.strictEqual(remaining['1'], 'b');
      assert.strictEqual(remaining['2'], 'c');
      assert.strictEqual(remaining['3'], undefined);
    });

    it('should shift first element from array', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      await db.set('items', ['a', 'b', 'c', 'd']);
      
      const shifted = await db.shift('items');
      assert.strictEqual(shifted, 'a');
      
      const remaining = await db.get('items');
      assert.strictEqual(remaining['0'], undefined);
      assert.strictEqual(remaining['1'], 'b');
      assert.strictEqual(remaining['2'], 'c');
      assert.strictEqual(remaining['3'], 'd');
    });

    it('should return undefined when popping from empty array', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      await db.set('items', []);
      const result = await db.pop('items');
      assert.strictEqual(result, undefined);
    });

    it('should return undefined when shifting from empty array', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      await db.set('items', []);
      const result = await db.shift('items');
      assert.strictEqual(result, undefined);
    });

    it('should pop from nested array', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      await db.set('data', {
        queue: ['task1', 'task2', 'task3']
      });
      
      const popped = await db.pop('data', 'queue');
      assert.strictEqual(popped, 'task3');
      
      const queue = await db.get('data', 'queue');
      assert.strictEqual(queue['0'], 'task1');
      assert.strictEqual(queue['1'], 'task2');
      assert.strictEqual(queue['2'], undefined);
    });

    it('should shift from nested array', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      await db.set('data', {
        queue: ['task1', 'task2', 'task3']
      });
      
      const shifted = await db.shift('data', 'queue');
      assert.strictEqual(shifted, 'task1');
      
      const queue = await db.get('data', 'queue');
      assert.strictEqual(queue['0'], undefined);
      assert.strictEqual(queue['1'], 'task2');
      assert.strictEqual(queue['2'], 'task3');
    });

    it('should handle multiple pops', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      await db.set('stack', ['one', 'two', 'three']);
      
      assert.strictEqual(await db.pop('stack'), 'three');
      assert.strictEqual(await db.pop('stack'), 'two');
      assert.strictEqual(await db.pop('stack'), 'one');
      assert.strictEqual(await db.pop('stack'), undefined);
    });

    it('should handle multiple shifts', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      await db.set('queue', ['first', 'second', 'third']);
      
      assert.strictEqual(await db.shift('queue'), 'first');
      assert.strictEqual(await db.shift('queue'), 'second');
      assert.strictEqual(await db.shift('queue'), 'third');
      assert.strictEqual(await db.shift('queue'), undefined);
    });

    it('should pop after add operations', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      // Add 5 items
      await db.add('items', 1);
      await db.add('items', 2);
      await db.add('items', 3);
      await db.add('items', 4);
      await db.add('items', 5);
      
      // Check initial values
      let values = await db.values('items');
      assert.strictEqual(values.length, 5);
      assert.deepStrictEqual(values, [1, 2, 3, 4, 5]);
      
      // Pop last item
      const popped = await db.pop('items');
      assert.strictEqual(popped, 5);
      
      // Check remaining values
      values = await db.values('items');
      assert.strictEqual(values.length, 4);
      assert.deepStrictEqual(values, [1, 2, 3, 4]);
    });

    it('should shift after add operations', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      // Add 5 items
      await db.add('items', 1);
      await db.add('items', 2);
      await db.add('items', 3);
      await db.add('items', 4);
      await db.add('items', 5);
      
      // Check initial values
      let values = await db.values('items');
      assert.strictEqual(values.length, 5);
      assert.deepStrictEqual(values, [1, 2, 3, 4, 5]);
      
      // Shift first item
      const shifted = await db.shift('items');
      assert.strictEqual(shifted, 1);
      
      // Check remaining values
      values = await db.values('items');
      assert.strictEqual(values.length, 4);
      assert.deepStrictEqual(values, [2, 3, 4, 5]);
    });

    it('should pop and shift together after add operations', async function() {
      const driver = new MockDriver();
      const db = new DeepBase([driver]);
      
      // Add 5 items
      await db.add('items', 1);
      await db.add('items', 2);
      await db.add('items', 3);
      await db.add('items', 4);
      await db.add('items', 5);
      
      // Pop from end
      const popped = await db.pop('items');
      assert.strictEqual(popped, 5);
      
      let values = await db.values('items');
      assert.deepStrictEqual(values, [1, 2, 3, 4]);
      
      // Shift from beginning
      const shifted = await db.shift('items');
      assert.strictEqual(shifted, 1);
      
      values = await db.values('items');
      assert.deepStrictEqual(values, [2, 3, 4]);
    });
  });
});

