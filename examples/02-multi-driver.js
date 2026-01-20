// Example 2: Multi-driver with MongoDB primary and JSON backup
import DeepBase from '../packages/core/src/index.js';
import JsonDriver from '../packages/driver-json/src/index.js';
import MongoDriver from '../packages/driver-mongodb/src/index.js'; // deepbase-mongodb

async function main() {
  console.log('🌳 DeepBase Example 2: Multi-Driver (MongoDB + JSON)\n');
  
  // Create DeepBase with MongoDB primary and JSON backup
  const db = new DeepBase([
    new MongoDriver({ 
      url: 'mongodb://localhost:27017',
      database: 'deepbase_example',
      collection: 'data'
    }),
    new JsonDriver({ 
      name: 'backup', 
      path: './data' 
    })
  ], {
    writeAll: true,           // Write to all drivers
    readFirst: true,          // Read from first available
    failOnPrimaryError: false // Continue if MongoDB fails
  });
  
  const result = await db.connect();
  console.log(`✅ Connected: ${result.connected}/${result.total} drivers\n`);
  
  // Write data (goes to both MongoDB and JSON)
  await db.set('app', 'version', '1.0.0');
  await db.set('app', 'name', 'MyApp');
  console.log('📝 Wrote to all drivers');
  
  const userPath = await db.add('users', { 
    name: 'Charlie', 
    email: 'charlie@example.com',
    role: 'admin'
  });
  console.log('👤 Added user:', userPath);
  
  // Read data (from first available - MongoDB)
  const app = await db.get('app');
  const user = await db.get(...userPath);
  
  console.log('\n📊 Data:');
  console.log('App:', app);
  console.log('User:', user);
  
  // If MongoDB fails, it will read from JSON automatically
  console.log('\n💡 Note: If MongoDB is down, data will be read from JSON backup');
  
  await db.disconnect();
  console.log('\n✅ Disconnected from all drivers');
}

main().catch(console.error);

