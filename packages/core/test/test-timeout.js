import { DeepBase } from '../src/index.js';
import { JsonDriver } from '../../driver-json/src/index.js';
import assert from 'assert';

// Slow driver that delays operations
class SlowDriver extends JsonDriver {
  constructor(opts = {}) {
    super(opts);
    this.delay = opts.delay || 1000;
  }

  async get(...args) {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return super.get(...args);
  }

  async set(...args) {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return super.set(...args);
  }

  async del(...args) {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return super.del(...args);
  }

  async inc(...args) {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return super.inc(...args);
  }

  async dec(...args) {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return super.dec(...args);
  }

  async add(...args) {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return super.add(...args);
  }

  async upd(...args) {
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return super.upd(...args);
  }
}

async function testTimeouts() {
  console.log('Testing timeout functionality...\n');
  
  // Test 1: Get timeout
  console.log('Test 1: Get operation timeout');
  const db1 = new DeepBase(
    [new SlowDriver({ name: 'slow-test1', delay: 2000 })],
    { readTimeout: 1000 }
  );
  
  try {
    await db1.connect();
    await db1.get('test');
    assert.fail('Should have timed out');
  } catch (error) {
    assert(error.message.includes('timed out'), 'Should contain timeout message');
    console.log('✅ Get timeout works correctly');
  }
  
  // Test 2: Set timeout
  console.log('Test 2: Set operation timeout');
  const db2 = new DeepBase(
    [new SlowDriver({ name: 'slow-test2', delay: 2000 })],
    { writeTimeout: 1000 }
  );
  
  try {
    await db2.connect();
    await db2.set('test', 'value');
    assert.fail('Should have timed out');
  } catch (error) {
    assert(error.message.includes('timed out'), 'Should contain timeout message');
    console.log('✅ Set timeout works correctly');
  }
  
  // Test 3: Operations succeed within timeout
  console.log('Test 3: Operations succeed within timeout');
  const db3 = new DeepBase(
    [new SlowDriver({ name: 'slow-test3', delay: 500 })],
    { timeout: 2000 }
  );
  
  try {
    await db3.connect();
    await db3.set('test', 'value');
    const value = await db3.get('test');
    assert.strictEqual(value, 'value', 'Value should be retrieved');
    console.log('✅ Operations within timeout work correctly');
  } catch (error) {
    assert.fail(`Should not have timed out: ${error.message}`);
  }
  
  // Test 4: No timeout (disabled)
  console.log('Test 4: Timeout disabled');
  const db4 = new DeepBase(
    [new SlowDriver({ name: 'slow-test4', delay: 500 })],
    { timeout: 0 } // Disabled
  );
  
  try {
    await db4.connect();
    await db4.set('test', 'value');
    const value = await db4.get('test');
    assert.strictEqual(value, 'value', 'Value should be retrieved');
    console.log('✅ Disabled timeout works correctly');
  } catch (error) {
    assert.fail(`Should not have failed: ${error.message}`);
  }
  
  // Test 5: Different read/write timeouts
  console.log('Test 5: Different read/write timeouts');
  const db5 = new DeepBase(
    [new SlowDriver({ name: 'slow-test5', delay: 1500 })],
    { 
      readTimeout: 1000,  // Shorter timeout
      writeTimeout: 2000  // Longer timeout
    }
  );
  
  try {
    await db5.connect();
    
    // Get should timeout
    try {
      await db5.get('test');
      assert.fail('Get should have timed out');
    } catch (error) {
      assert(error.message.includes('timed out'), 'Get should timeout');
    }
    
    // Set should succeed
    await db5.set('test', 'value');
    console.log('✅ Different read/write timeouts work correctly');
  } catch (error) {
    assert.fail(`Unexpected error: ${error.message}`);
  }
  
  // Test 6: All write operations timeout
  console.log('Test 6: All write operations timeout');
  const db6 = new DeepBase(
    [new SlowDriver({ name: 'slow-test6', delay: 2000 })],
    { writeTimeout: 1000 }
  );
  
  await db6.connect();
  
  const writeOps = [
    { name: 'set', fn: () => db6.set('test', 'value') },
    { name: 'del', fn: () => db6.del('test') },
    { name: 'inc', fn: () => db6.inc('counter') },
    { name: 'dec', fn: () => db6.dec('counter') },
    { name: 'add', fn: () => db6.add('items', 'item') },
    { name: 'upd', fn: () => db6.upd('obj', 'key', 'value') }
  ];
  
  for (const op of writeOps) {
    try {
      await op.fn();
      assert.fail(`${op.name} should have timed out`);
    } catch (error) {
      assert(error.message.includes('timed out'), `${op.name} should timeout`);
    }
  }
  console.log('✅ All write operations timeout correctly');
  
  console.log('\n✅ All timeout tests passed!');
}

// Run tests
testTimeouts().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

