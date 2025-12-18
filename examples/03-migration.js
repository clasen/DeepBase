// Example 3: Migrating from JSON to MongoDB
import DeepBase, { JsonDriver } from '../packages/core/src/index.js';
import MongoDriver from '../packages/driver-mongodb/src/index.js'; // deepbase-mongodb

async function main() {
  console.log('🌳 DeepBase Example 3: Migration from JSON to MongoDB\n');
  
  // Step 1: Create initial data with JSON driver
  console.log('📝 Step 1: Creating initial data in JSON...');
  const jsonDb = new DeepBase(new JsonDriver({ 
    name: 'migration_source', 
    path: './data' 
  }));
  
  await jsonDb.connect();
  
  // Populate with sample data
  await jsonDb.set('config', 'version', '2.0.0');
  await jsonDb.set('config', 'env', 'production');
  
  await jsonDb.add('products', { name: 'Laptop', price: 999, stock: 50 });
  await jsonDb.add('products', { name: 'Mouse', price: 29, stock: 200 });
  await jsonDb.add('products', { name: 'Keyboard', price: 79, stock: 150 });
  
  await jsonDb.add('customers', { name: 'Alice', email: 'alice@example.com' });
  await jsonDb.add('customers', { name: 'Bob', email: 'bob@example.com' });
  
  console.log('✅ Created sample data in JSON');
  
  const jsonData = await jsonDb.get();
  console.log('\n📊 JSON Data:', JSON.stringify(jsonData, null, 2));
  
  await jsonDb.disconnect();
  
  // Step 2: Setup multi-driver with JSON and MongoDB
  console.log('\n🔄 Step 2: Setting up multi-driver (JSON + MongoDB)...');
  const db = new DeepBase([
    new JsonDriver({ name: 'migration_source', path: './data' }),
    new MongoDriver({ 
      url: 'mongodb://localhost:27017',
      database: 'deepbase_migrated',
      collection: 'data'
    })
  ]);
  
  const connectResult = await db.connect();
  console.log(`✅ Connected: ${connectResult.connected}/${connectResult.total} drivers`);
  
  // Step 3: Migrate from JSON (index 0) to MongoDB (index 1)
  console.log('\n🚀 Step 3: Starting migration from JSON to MongoDB...');
  const migrationResult = await db.migrate(0, 1, {
    clear: true,
    batchSize: 10,
    onProgress: (progress) => {
      console.log(`   ⏳ Progress: ${progress.migrated} items migrated, ${progress.errors} errors`);
    }
  });
  
  console.log('\n✅ Migration completed!');
  console.log(`   - Items migrated: ${migrationResult.migrated}`);
  console.log(`   - Errors: ${migrationResult.errors}`);
  
  // Step 4: Verify data in MongoDB
  console.log('\n🔍 Step 4: Verifying data in MongoDB...');
  const mongoDriver = db.getDriver(1);
  const mongoData = await mongoDriver.get();
  console.log('📊 MongoDB Data:', JSON.stringify(mongoData, null, 2));
  
  await db.disconnect();
  console.log('\n✅ All done!');
}

main().catch(console.error);

