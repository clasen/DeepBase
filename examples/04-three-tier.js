// Example 4: Three-tier setup (MongoDB primary, JSON secondary, Redis cache)
import DeepBase from '../packages/core/src/index.js';
import { resolvePath } from '../packages/core/src/path.js';
import { JsonDriver } from '../packages/driver-json/src/index.js';
import MongoDriver from '../packages/driver-mongodb/src/index.js'; // deepbase-mongodb
import RedisDriver from '../packages/driver-redis/src/index.js'; // deepbase-redis

const dataPath = resolvePath(import.meta.url, './data');

async function main() {
  console.log('🌳 DeepBase Example 4: Three-Tier Architecture\n');
  console.log('Architecture: MongoDB (primary) → JSON (backup) → Redis (cache)\n');
  
  // Create three-tier setup
  const db = new DeepBase([
    new MongoDriver({ 
      url: 'mongodb://localhost:27017',
      database: 'deepbase_threetier',
      collection: 'data'
    }),
    new JsonDriver({ 
      name: 'threetier_backup', 
      path: dataPath
    }),
    new RedisDriver({ 
      url: 'redis://localhost:6379',
      prefix: 'threetier'
    })
  ], {
    writeAll: true,           // Write to all three
    readFirst: true,          // Read from first available
    failOnPrimaryError: false // Fallback if primary fails
  });
  
  const result = await db.connect();
  console.log(`✅ Connected: ${result.connected}/${result.total} drivers`);
  
  if (result.connected < result.total) {
    console.log('⚠️  Note: Not all drivers connected. System will work with available drivers.\n');
  }
  
  // Write data to all three tiers
  console.log('\n📝 Writing data to all tiers...');
  await db.set('system', 'status', 'operational');
  await db.set('system', 'uptime', 3600);
  
  const order1 = await db.add('orders', { 
    customer: 'Alice',
    total: 299.99,
    status: 'pending'
  });
  console.log('📦 Created order:', order1);
  
  // Increment uptime
  await db.inc('system', 'uptime', 100);
  console.log('⏱️  Incremented uptime');
  
  // Read data (will come from first available driver)
  console.log('\n📊 Reading data...');
  const system = await db.get('system');
  const orders = await db.get('orders');
  
  console.log('System:', system);
  console.log('Orders:', orders);
  
  // Demonstrate sync capability
  console.log('\n🔄 You can sync all drivers with:');
  console.log('   await db.syncAll()');
  console.log('   This copies data from primary to all others');
  
  // Check individual drivers
  console.log('\n🔍 Checking individual drivers:');
  for (let i = 0; i < db.getDrivers().length; i++) {
    try {
      const driver = db.getDriver(i);
      const data = await driver.get('system', 'status');
      const driverName = ['MongoDB', 'JSON', 'Redis'][i];
      console.log(`   ${driverName}: ${data ? '✅ Data present' : '❌ No data'}`);
    } catch (error) {
      const driverName = ['MongoDB', 'JSON', 'Redis'][i];
      console.log(`   ${driverName}: ❌ ${error.message}`);
    }
  }
  
  await db.disconnect();
  console.log('\n✅ Disconnected from all drivers');
  
  console.log('\n💡 Benefits of three-tier:');
  console.log('   - If MongoDB fails, system uses JSON');
  console.log('   - If MongoDB and JSON fail, system uses Redis');
  console.log('   - All writes replicate to all tiers');
  console.log('   - Automatic failover and recovery');
}

main().catch(console.error);
