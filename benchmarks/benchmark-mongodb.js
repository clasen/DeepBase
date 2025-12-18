import DeepBase from '../packages/core/src/index.js';
import MongoDriver from '../packages/driver-mongodb/src/index.js';

const ITERATIONS = 1000;
const BATCH_SIZE = 100;

function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    rss: (used.rss / 1024 / 1024).toFixed(2),
    heapTotal: (used.heapTotal / 1024 / 1024).toFixed(2),
    heapUsed: (used.heapUsed / 1024 / 1024).toFixed(2),
    external: (used.external / 1024 / 1024).toFixed(2)
  };
}

async function benchmark() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DeepBase MongoDB Driver - Performance Benchmark');
  console.log('═══════════════════════════════════════════════════════════\n');

  const db = new DeepBase(new MongoDriver({ 
    url: 'mongodb://localhost:27017',
    database: 'deepbase_benchmark',
    collection: 'test'
  }));

  try {
    await db.connect();
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ Could not connect to MongoDB:', error.message);
    console.log('💡 Make sure MongoDB is running: docker start mongodb\n');
    process.exit(1);
  }

  // Clear existing data
  await db.del();

  // Initial memory state
  const initialMemory = getMemoryUsage();
  console.log('📊 Initial Memory Usage:');
  console.log(`   RSS: ${initialMemory.rss} MB | Heap Used: ${initialMemory.heapUsed} MB | Heap Total: ${initialMemory.heapTotal} MB\n`);

  // 1. Write Performance
  console.log('📝 Testing WRITE performance...');
  const writeStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await db.set('items', `item_${i}`, { 
      id: i, 
      name: `Item ${i}`,
      timestamp: Date.now()
    });
  }
  const writeTime = performance.now() - writeStart;
  const writeOps = ITERATIONS / (writeTime / 1000);
  const memAfterWrite = getMemoryUsage();
  console.log(`   ✓ ${ITERATIONS} writes in ${writeTime.toFixed(2)}ms`);
  console.log(`   ✓ ${writeOps.toFixed(2)} ops/sec`);
  console.log(`   💾 Memory - RSS: ${memAfterWrite.rss} MB | Heap Used: ${memAfterWrite.heapUsed} MB\n`);

  // 2. Read Performance
  console.log('📖 Testing READ performance...');
  const readStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await db.get('items', `item_${i}`);
  }
  const readTime = performance.now() - readStart;
  const readOps = ITERATIONS / (readTime / 1000);
  const memAfterRead = getMemoryUsage();
  console.log(`   ✓ ${ITERATIONS} reads in ${readTime.toFixed(2)}ms`);
  console.log(`   ✓ ${readOps.toFixed(2)} ops/sec`);
  console.log(`   💾 Memory - RSS: ${memAfterRead.rss} MB | Heap Used: ${memAfterRead.heapUsed} MB\n`);

  // 3. Update Performance
  console.log('🔄 Testing UPDATE performance...');
  const updateStart = performance.now();
  for (let i = 0; i < BATCH_SIZE; i++) {
    await db.upd('items', `item_${i}`, item => ({
      ...item,
      updated: true,
      updatedAt: Date.now()
    }));
  }
  const updateTime = performance.now() - updateStart;
  const updateOps = BATCH_SIZE / (updateTime / 1000);
  console.log(`   ✓ ${BATCH_SIZE} updates in ${updateTime.toFixed(2)}ms`);
  console.log(`   ✓ ${updateOps.toFixed(2)} ops/sec\n`);

  // 4. Increment Performance (uses $inc)
  console.log('➕ Testing INCREMENT performance (atomic $inc)...');
  await db.set('counters', 'counter', 0);
  const incStart = performance.now();
  for (let i = 0; i < BATCH_SIZE; i++) {
    await db.inc('counters', 'counter', 1);
  }
  const incTime = performance.now() - incStart;
  const incOps = BATCH_SIZE / (incTime / 1000);
  console.log(`   ✓ ${BATCH_SIZE} atomic increments in ${incTime.toFixed(2)}ms`);
  console.log(`   ✓ ${incOps.toFixed(2)} ops/sec\n`);

  // 5. Delete Performance
  console.log('🗑️  Testing DELETE performance...');
  const delStart = performance.now();
  for (let i = 0; i < BATCH_SIZE; i++) {
    await db.del('items', `item_${i}`);
  }
  const delTime = performance.now() - delStart;
  const delOps = BATCH_SIZE / (delTime / 1000);
  console.log(`   ✓ ${BATCH_SIZE} deletes in ${delTime.toFixed(2)}ms`);
  console.log(`   ✓ ${delOps.toFixed(2)} ops/sec\n`);

  // 6. Keys/Values/Entries Performance
  console.log('🔑 Testing KEYS/VALUES/ENTRIES performance...');
  const keysStart = performance.now();
  const keys = await db.keys('items');
  const keysTime = performance.now() - keysStart;
  
  const valuesStart = performance.now();
  const values = await db.values('items');
  const valuesTime = performance.now() - valuesStart;
  
  const entriesStart = performance.now();
  const entries = await db.entries('items');
  const entriesTime = performance.now() - entriesStart;
  
  console.log(`   ✓ keys() on ${keys.length} items: ${keysTime.toFixed(2)}ms`);
  console.log(`   ✓ values() on ${values.length} items: ${valuesTime.toFixed(2)}ms`);
  console.log(`   ✓ entries() on ${entries.length} items: ${entriesTime.toFixed(2)}ms\n`);

  // 7. Batch Write Performance
  console.log('📦 Testing BATCH WRITE performance...');
  const batchStart = performance.now();
  const promises = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    promises.push(db.set('batch', `item_${i}`, { value: i }));
  }
  await Promise.all(promises);
  const batchTime = performance.now() - batchStart;
  const batchOps = BATCH_SIZE / (batchTime / 1000);
  console.log(`   ✓ ${BATCH_SIZE} parallel writes in ${batchTime.toFixed(2)}ms`);
  console.log(`   ✓ ${batchOps.toFixed(2)} ops/sec\n`);

  await db.disconnect();

  // Final memory state
  const finalMemory = getMemoryUsage();
  
  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY - MongoDB Driver');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Write:        ${writeOps.toFixed(2)} ops/sec`);
  console.log(`  Read:         ${readOps.toFixed(2)} ops/sec`);
  console.log(`  Update:       ${updateOps.toFixed(2)} ops/sec`);
  console.log(`  Increment:    ${incOps.toFixed(2)} ops/sec (atomic)`);
  console.log(`  Delete:       ${delOps.toFixed(2)} ops/sec`);
  console.log(`  Batch Write:  ${batchOps.toFixed(2)} ops/sec`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('  MEMORY USAGE');
  console.log('───────────────────────────────────────────────────────────');
  console.log(`  Initial RSS:       ${initialMemory.rss} MB`);
  console.log(`  Final RSS:         ${finalMemory.rss} MB`);
  console.log(`  RSS Delta:         ${(parseFloat(finalMemory.rss) - parseFloat(initialMemory.rss)).toFixed(2)} MB`);
  console.log(`  Initial Heap:      ${initialMemory.heapUsed} MB`);
  console.log(`  Final Heap:        ${finalMemory.heapUsed} MB`);
  console.log(`  Heap Delta:        ${(parseFloat(finalMemory.heapUsed) - parseFloat(initialMemory.heapUsed)).toFixed(2)} MB`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

benchmark().catch(console.error);

