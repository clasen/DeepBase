import { DeepBase } from '../packages/core/src/index.js';
import { resolvePath } from '../packages/core/src/path.js';
import { JsonDriver } from '../packages/driver-json/src/index.js';

const dataPath = resolvePath(import.meta.url, './data');

// Custom slow driver for testing timeouts
class SlowDriver extends JsonDriver {
  constructor(opts = {}) {
    super(opts);
    this.delay = opts.delay || 5000; // Default 5 second delay
  }

  async get(...args) {
    // Simulate slow operation
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return super.get(...args);
  }

  async set(...args) {
    // Simulate slow operation
    await new Promise(resolve => setTimeout(resolve, this.delay));
    return super.set(...args);
  }
}

async function demoTimeout() {
  console.log('🚀 DeepBase Timeout Configuration Demo\n');
  
  // Example 1: Global timeout
  console.log('📌 Example 1: Global timeout (3 seconds)');
  const db1 = new DeepBase(
    [new SlowDriver({ name: 'slow-db', path: dataPath, delay: 5000 })],
    { timeout: 3000 } // 3 second timeout for all operations
  );
  
  try {
    await db1.connect();
    await db1.set('test', 'value');
    console.log('✅ Set succeeded');
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  // Example 2: Separate read/write timeouts
  console.log('\n📌 Example 2: Separate read/write timeouts');
  const db2 = new DeepBase(
    [new SlowDriver({ name: 'slow-db2', path: dataPath, delay: 2000 })],
    { 
      readTimeout: 1000,  // 1 second for reads
      writeTimeout: 5000  // 5 seconds for writes
    }
  );
  
  try {
    await db2.connect();
    
    // This should timeout (delay 2s > timeout 1s)
    try {
      await db2.get('test');
      console.log('✅ Get succeeded');
    } catch (error) {
      console.log(`❌ Get failed: ${error.message}`);
    }
    
    // This should succeed (delay 2s < timeout 5s)
    try {
      await db2.set('test', 'value');
      console.log('✅ Set succeeded');
    } catch (error) {
      console.log(`❌ Set failed: ${error.message}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  // Example 3: No timeout (default behavior)
  console.log('\n📌 Example 3: No timeout (will wait forever)');
  const db3 = new DeepBase(
    [new JsonDriver({ name: 'normal-db', path: dataPath })],
    { timeout: 0 } // 0 = disabled (default)
  );
  
  try {
    await db3.connect();
    await db3.set('test', 'value');
    const value = await db3.get('test');
    console.log(`✅ Operations succeeded: ${value}`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  // Example 4: Connection timeout
  console.log('\n📌 Example 4: Connection timeout');
  const db4 = new DeepBase(
    [new SlowDriver({ name: 'slow-connect', path: dataPath, delay: 0 })],
    { 
      connectTimeout: 2000, // 2 second connection timeout
      lazyConnect: false
    }
  );
  
  try {
    await db4.connect();
    console.log('✅ Connection succeeded');
  } catch (error) {
    console.log(`❌ Connection failed: ${error.message}`);
  }
  
  console.log('\n✨ Demo complete!');
}

// Run the demo
demoTimeout().catch(console.error);
