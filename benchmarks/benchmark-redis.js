import DeepBase from '../packages/core/src/index.js';
import RedisDriver from '../packages/driver-redis/src/index.js';

const ITERATIONS = 1000;
const BATCH_SIZE = 100;
const CONCURRENT_OPS = 1000; // For concurrent tests
const CONCURRENCY_LEVEL = 50; // Simulated concurrent clients

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
  console.log('  DeepBase Redis Driver (Vanilla) - Performance Benchmark');
  console.log('═══════════════════════════════════════════════════════════\n');

  const db = new DeepBase(new RedisDriver({ 
    url: 'redis://localhost:6379',
    prefix: 'benchmark'
  }));

  try {
    await db.connect();
    console.log('✅ Connected to Redis (vanilla)\n');
  } catch (error) {
    console.error('❌ Could not connect to Redis:', error.message);
    console.log('💡 Make sure Redis is running: docker start redis\n');
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

  // 4. Increment Performance (read-modify-write)
  console.log('➕ Testing INCREMENT performance (read-modify-write)...');
  await db.set('counters', 'counter', 0);
  const incStart = performance.now();
  for (let i = 0; i < BATCH_SIZE; i++) {
    await db.inc('counters', 'counter', 1);
  }
  const incTime = performance.now() - incStart;
  const incOps = BATCH_SIZE / (incTime / 1000);
  console.log(`   ✓ ${BATCH_SIZE} increments in ${incTime.toFixed(2)}ms`);
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

  // ========================================
  // CONCURRENT OPERATIONS TESTS
  // ========================================
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  CONCURRENT OPERATIONS (Real-World Performance)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 8. Concurrent Write Performance
  console.log(`🔥 Testing CONCURRENT WRITE (${CONCURRENCY_LEVEL} parallel clients)...`);
  await db.del('concurrent_items'); // Clear
  const concWriteStart = performance.now();
  const concWritePromises = [];
  for (let i = 0; i < CONCURRENT_OPS; i++) {
    concWritePromises.push(
      db.set('concurrent_items', `item_${i}`, {
        id: i,
        name: `Item ${i}`,
        timestamp: Date.now()
      })
    );
  }
  await Promise.all(concWritePromises);
  const concWriteTime = performance.now() - concWriteStart;
  const concWriteOps = CONCURRENT_OPS / (concWriteTime / 1000);
  console.log(`   ✓ ${CONCURRENT_OPS} concurrent writes in ${concWriteTime.toFixed(2)}ms`);
  console.log(`   ✓ ${concWriteOps.toFixed(2)} ops/sec\n`);

  // 9. Concurrent Read Performance
  console.log(`📚 Testing CONCURRENT READ (${CONCURRENCY_LEVEL} parallel clients)...`);
  const concReadStart = performance.now();
  const concReadPromises = [];
  for (let i = 0; i < CONCURRENT_OPS; i++) {
    concReadPromises.push(db.get('concurrent_items', `item_${i}`));
  }
  await Promise.all(concReadPromises);
  const concReadTime = performance.now() - concReadStart;
  const concReadOps = CONCURRENT_OPS / (concReadTime / 1000);
  console.log(`   ✓ ${CONCURRENT_OPS} concurrent reads in ${concReadTime.toFixed(2)}ms`);
  console.log(`   ✓ ${concReadOps.toFixed(2)} ops/sec\n`);

  // 10. Mixed Concurrent Operations (75% read, 25% write - realistic workload)
  console.log('🔀 Testing MIXED CONCURRENT operations (75% read, 25% write)...');
  const mixedOps = 1000;
  const mixedStart = performance.now();
  const mixedPromises = [];
  for (let i = 0; i < mixedOps; i++) {
    if (Math.random() < 0.75) {
      // 75% reads
      mixedPromises.push(db.get('concurrent_items', `item_${Math.floor(Math.random() * CONCURRENT_OPS)}`));
    } else {
      // 25% writes
      mixedPromises.push(
        db.set('concurrent_items', `item_${Math.floor(Math.random() * CONCURRENT_OPS)}`, {
          updated: true,
          timestamp: Date.now()
        })
      );
    }
  }
  await Promise.all(mixedPromises);
  const mixedTime = performance.now() - mixedStart;
  const mixedOpsPerSec = mixedOps / (mixedTime / 1000);
  console.log(`   ✓ ${mixedOps} mixed operations in ${mixedTime.toFixed(2)}ms`);
  console.log(`   ✓ ${mixedOpsPerSec.toFixed(2)} ops/sec\n`);

  // 11. Concurrent Increments (stress test)
  console.log('➕ Testing CONCURRENT INCREMENTS (atomic operations)...');
  await db.set('stress', 'counter', 0);
  const stressOps = 500;
  const stressStart = performance.now();
  const stressPromises = [];
  for (let i = 0; i < stressOps; i++) {
    stressPromises.push(db.inc('stress', 'counter', 1));
  }
  await Promise.all(stressPromises);
  const finalCount = await db.get('stress', 'counter');
  const stressTime = performance.now() - stressStart;
  const stressOpsPerSec = stressOps / (stressTime / 1000);
  console.log(`   ✓ ${stressOps} concurrent increments in ${stressTime.toFixed(2)}ms`);
  console.log(`   ✓ ${stressOpsPerSec.toFixed(2)} ops/sec`);
  console.log(`   ✓ Final counter value: ${finalCount} (should be ${stressOps})\n`);

  await db.disconnect();

  // Final memory state
  const finalMemory = getMemoryUsage();
  
  // Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY - Redis Driver (Vanilla)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SEQUENTIAL OPERATIONS');
  console.log('───────────────────────────────────────────────────────────');
  console.log(`  Write:        ${writeOps.toFixed(2)} ops/sec`);
  console.log(`  Read:         ${readOps.toFixed(2)} ops/sec`);
  console.log(`  Update:       ${updateOps.toFixed(2)} ops/sec`);
  console.log(`  Increment:    ${incOps.toFixed(2)} ops/sec`);
  console.log(`  Delete:       ${delOps.toFixed(2)} ops/sec`);
  console.log(`  Batch Write:  ${batchOps.toFixed(2)} ops/sec`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('  CONCURRENT OPERATIONS');
  console.log('───────────────────────────────────────────────────────────');
  console.log(`  Concurrent Write:     ${concWriteOps.toFixed(2)} ops/sec`);
  console.log(`  Concurrent Read:      ${concReadOps.toFixed(2)} ops/sec`);
  console.log(`  Mixed Operations:     ${mixedOpsPerSec.toFixed(2)} ops/sec`);
  console.log(`  Concurrent Increment: ${stressOpsPerSec.toFixed(2)} ops/sec`);
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

