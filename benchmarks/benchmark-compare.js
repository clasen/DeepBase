import DeepBase from '../packages/core/src/index.js';
import JsonDriver from '../packages/driver-json/src/index.js';
import SqliteDriver from '../packages/driver-sqlite/src/index.js';
import MongoDriver from '../packages/driver-mongodb/src/index.js';
import RedisDriver from '../packages/driver-redis/src/index.js';
import RedisJsonDriver from '../packages/driver-redis-json/src/index.js';
import fs from 'fs';

const ITERATIONS = 500;

function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    rss: (used.rss / 1024 / 1024).toFixed(2),
    heapTotal: (used.heapTotal / 1024 / 1024).toFixed(2),
    heapUsed: (used.heapUsed / 1024 / 1024).toFixed(2),
    external: (used.external / 1024 / 1024).toFixed(2)
  };
}

async function benchmarkDriver(name, driver, cleanup) {
  const results = {};
  
  // Memory before connection
  const memoryBefore = getMemoryUsage();
  
  const db = new DeepBase(driver);
  try {
    await db.connect();
  } catch (error) {
    console.log(`   ⚠️  ${name}: Not available (${error.message})`);
    return null;
  }

  // Clear data
  await db.del();

  // Write test
  const writeStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await db.set('items', `item_${i}`, { id: i, value: `value_${i}` });
  }
  results.write = ITERATIONS / ((performance.now() - writeStart) / 1000);

  // Read test
  const readStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await db.get('items', `item_${i}`);
  }
  results.read = ITERATIONS / ((performance.now() - readStart) / 1000);

  // Increment test
  await db.set('counter', 'value', 0);
  const incStart = performance.now();
  for (let i = 0; i < 100; i++) {
    await db.inc('counter', 'value', 1);
  }
  results.increment = 100 / ((performance.now() - incStart) / 1000);

  // Update test
  const updateStart = performance.now();
  for (let i = 0; i < 100; i++) {
    await db.upd('items', `item_${i}`, v => ({ ...v, updated: true }));
  }
  results.update = 100 / ((performance.now() - updateStart) / 1000);

  // Delete test
  const delStart = performance.now();
  for (let i = 0; i < 100; i++) {
    await db.del('items', `item_${i}`);
  }
  results.delete = 100 / ((performance.now() - delStart) / 1000);

  // Memory after all operations
  const memoryAfter = getMemoryUsage();
  results.memory = {
    before: memoryBefore,
    after: memoryAfter,
    rssDelta: (parseFloat(memoryAfter.rss) - parseFloat(memoryBefore.rss)).toFixed(2),
    heapDelta: (parseFloat(memoryAfter.heapUsed) - parseFloat(memoryBefore.heapUsed)).toFixed(2)
  };

  await db.disconnect();
  if (cleanup) cleanup();

  return results;
}

async function runComparison() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DeepBase - Driver Performance Comparison');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Running ${ITERATIONS} iterations per test...\n`);

  const results = {};

  // Test JSON Driver
  console.log('🔧 Testing JSON Driver...');
  const testPath = './benchmarks/data';
  results.json = await benchmarkDriver(
    'JSON',
    new JsonDriver({ name: 'compare', path: testPath }),
    () => {
      if (fs.existsSync(testPath)) {
        fs.rmSync(testPath, { recursive: true, force: true });
      }
    }
  );
  if (results.json) console.log('   ✓ Complete\n');

  // Test SQLite Driver
  console.log('🗄️  Testing SQLite Driver...');
  const sqlitePath = './benchmarks/data-sqlite';
  results.sqlite = await benchmarkDriver(
    'SQLite',
    new SqliteDriver({ name: 'compare', path: sqlitePath }),
    () => {
      if (fs.existsSync(sqlitePath)) {
        fs.rmSync(sqlitePath, { recursive: true, force: true });
      }
    }
  );
  if (results.sqlite) console.log('   ✓ Complete\n');

  // Test MongoDB Driver
  console.log('🍃 Testing MongoDB Driver...');
  results.mongodb = await benchmarkDriver(
    'MongoDB',
    new MongoDriver({ 
      url: 'mongodb://localhost:27017',
      database: 'deepbase_compare',
      collection: 'test'
    })
  );
  if (results.mongodb) console.log('   ✓ Complete\n');

  // Test Redis Driver
  console.log('⚡ Testing Redis Driver...');
  results.redis = await benchmarkDriver(
    'Redis',
    new RedisDriver({ 
      url: 'redis://localhost:6379',
      prefix: 'compare'
    })
  );
  if (results.redis) console.log('   ✓ Complete\n');

  // Test Redis JSON Driver
  console.log('📊 Testing Redis JSON Driver...');
  results.redisjson = await benchmarkDriver(
    'RedisJSON',
    new RedisJsonDriver({ 
      url: 'redis://localhost:6379',
      prefix: 'compare_json'
    })
  );
  if (results.redisjson) console.log('   ✓ Complete\n');

  // Display Results
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  COMPARISON RESULTS (ops/sec)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const operations = ['write', 'read', 'increment', 'update', 'delete'];
  const drivers = ['json', 'sqlite', 'mongodb', 'redis', 'redisjson'];
  
  // Print header
  console.log('Operation      JSON         SQLite       MongoDB      Redis        RedisJSON');
  console.log('──────────────────────────────────────────────────────────────────────────────────');

  for (const op of operations) {
    const opName = op.charAt(0).toUpperCase() + op.slice(1);
    let line = opName.padEnd(15);
    
    for (const driver of drivers) {
      if (results[driver] && results[driver][op]) {
        line += results[driver][op].toFixed(2).padStart(12);
      } else {
        line += 'N/A'.padStart(12);
      }
    }
    console.log(line);
  }

  console.log('─────────────────────────────────────────────────────────');

  // Calculate and display winner for each operation
  console.log('\n🏆 Performance Winners:\n');
  for (const op of operations) {
    let fastest = null;
    let fastestOps = 0;
    
    for (const driver of drivers) {
      if (results[driver] && results[driver][op] > fastestOps) {
        fastest = driver;
        fastestOps = results[driver][op];
      }
    }
    
    if (fastest) {
      const emoji = fastest === 'json' ? '📁' : 
                    fastest === 'sqlite' ? '🗄️' :
                    fastest === 'mongodb' ? '🍃' : 
                    fastest === 'redis' ? '⚡' : '📊';
      console.log(`   ${emoji} ${op.toUpperCase().padEnd(12)} → ${fastest.toUpperCase()} (${fastestOps.toFixed(2)} ops/sec)`);
    }
  }

  // Memory comparison table
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  MEMORY USAGE COMPARISON (MB)');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('Driver         Initial RSS  Final RSS    RSS Delta   Heap Delta');
  console.log('────────────────────────────────────────────────────────────────────');
  
  for (const driver of drivers) {
    if (results[driver] && results[driver].memory) {
      const driverName = driver.charAt(0).toUpperCase() + driver.slice(1);
      const mem = results[driver].memory;
      let line = driverName.padEnd(15);
      line += mem.before.rss.padStart(12);
      line += mem.after.rss.padStart(12);
      line += mem.rssDelta.padStart(12);
      line += mem.heapDelta.padStart(13);
      console.log(line);
    }
  }

  console.log('─────────────────────────────────────────────────────────');
  
  // Find most memory efficient
  let mostEfficient = null;
  let lowestDelta = Infinity;
  for (const driver of drivers) {
    if (results[driver] && results[driver].memory) {
      const delta = parseFloat(results[driver].memory.rssDelta);
      if (delta < lowestDelta) {
        lowestDelta = delta;
        mostEfficient = driver;
      }
    }
  }
  
  if (mostEfficient) {
    const emoji = mostEfficient === 'json' ? '📁' : 
                  mostEfficient === 'sqlite' ? '🗄️' :
                  mostEfficient === 'mongodb' ? '🍃' : 
                  mostEfficient === 'redis' ? '⚡' : '📊';
    console.log(`\n💾 Most Memory Efficient: ${emoji} ${mostEfficient.toUpperCase()} (${lowestDelta.toFixed(2)} MB delta)\n`);
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}

runComparison().catch(console.error);

