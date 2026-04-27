import DeepBase from '../packages/core/src/index.js';
import JsonDriver from '../packages/driver-json/src/index.js';
import MongoDriver from '../packages/driver-mongodb/src/index.js';
import RedisDriver from '../packages/driver-redis/src/index.js';
import fs from 'fs';

const DATA_SIZES = [100, 500, 1000];

function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    rss: (used.rss / 1024 / 1024).toFixed(2),
    heapTotal: (used.heapTotal / 1024 / 1024).toFixed(2),
    heapUsed: (used.heapUsed / 1024 / 1024).toFixed(2),
    external: (used.external / 1024 / 1024).toFixed(2)
  };
}

async function benchmarkMigration(fromName, toName, fromDriver, toDriver, dataSize) {
  const db = new DeepBase([fromDriver, toDriver]);
  let connectedStats;
  
  try {
    connectedStats = await db.connect();
  } catch (error) {
    await db.disconnect();
    console.log(`   ⚠️  ${fromName} or ${toName}: unavailable (${error.message})`);
    return null;
  }

  // DeepBase can connect partially (e.g. JSON ok, Mongo/Redis down).
  // If either side of migration is unavailable, skip scenario gracefully.
  if (connectedStats.connected < connectedStats.total) {
    const unavailable = [];
    if (!fromDriver._connected) unavailable.push(fromName);
    if (!toDriver._connected) unavailable.push(toName);
    const unavailableLabel = unavailable.length > 0 ? unavailable.join(' and ') : `${fromName} or ${toName}`;
    console.log(`   ⚠️  ${unavailableLabel}: unavailable, benchmark skipped`);
    await db.disconnect();
    return null;
  }

  try {
    // Populate source driver
    const source = db.getDriver(0);
    await source.del();
    
    for (let i = 0; i < dataSize; i++) {
      await source.set('items', `item_${i}`, {
        id: i,
        name: `Item ${i}`,
        description: `Description for item ${i}`,
        timestamp: Date.now(),
        tags: ['tag1', 'tag2', 'tag3'],
        metadata: {
          created: Date.now(),
          updated: Date.now(),
          version: 1
        }
      });
    }

    // Benchmark migration
    const memBefore = getMemoryUsage();
    const start = performance.now();
    const result = await db.migrate(0, 1, { clear: true });
    const time = performance.now() - start;
    const memAfter = getMemoryUsage();

    return {
      items: result.migrated,
      time: time,
      throughput: result.migrated / (time / 1000),
      memory: {
        before: memBefore,
        after: memAfter,
        rssDelta: (parseFloat(memAfter.rss) - parseFloat(memBefore.rss)).toFixed(2),
        heapDelta: (parseFloat(memAfter.heapUsed) - parseFloat(memBefore.heapUsed)).toFixed(2)
      }
    };
  } catch (error) {
    console.log(`   ⚠️  ${fromName} → ${toName}: benchmark skipped (${error.message})`);
    return null;
  } finally {
    await db.disconnect();
  }
}

async function runMigrationBenchmarks() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  DeepBase - Migration Performance Benchmark');
  console.log('═══════════════════════════════════════════════════════════\n');

  const testPath = './benchmarks/data';
  const scenarios = [
    {
      name: 'JSON → MongoDB',
      from: 'JSON',
      to: 'MongoDB',
      fromDriver: () => new JsonDriver({ name: 'source', path: testPath }),
      toDriver: () => new MongoDriver({ 
        url: 'mongodb://localhost:27017',
        database: 'deepbase_migration',
        collection: 'test'
      }),
      cleanup: () => {
        if (fs.existsSync(testPath)) {
          fs.rmSync(testPath, { recursive: true, force: true });
        }
      }
    },
    {
      name: 'JSON → Redis',
      from: 'JSON',
      to: 'Redis',
      fromDriver: () => new JsonDriver({ name: 'source', path: testPath }),
      toDriver: () => new RedisDriver({ 
        url: 'redis://localhost:6379',
        prefix: 'migration'
      }),
      cleanup: () => {
        if (fs.existsSync(testPath)) {
          fs.rmSync(testPath, { recursive: true, force: true });
        }
      }
    },
    {
      name: 'MongoDB → Redis',
      from: 'MongoDB',
      to: 'Redis',
      fromDriver: () => new MongoDriver({ 
        url: 'mongodb://localhost:27017',
        database: 'deepbase_migration_source',
        collection: 'test'
      }),
      toDriver: () => new RedisDriver({ 
        url: 'redis://localhost:6379',
        prefix: 'migration'
      })
    }
  ];

  for (const scenario of scenarios) {
    console.log(`\n${scenario.name}`);
    console.log('─────────────────────────────────────────────────────────');
    
    for (const size of DATA_SIZES) {
      const result = await benchmarkMigration(
        scenario.from,
        scenario.to,
        scenario.fromDriver(),
        scenario.toDriver(),
        size
      );

      if (result) {
        console.log(`  ${size.toString().padStart(4)} items: ${result.time.toFixed(2).padStart(8)}ms (${result.throughput.toFixed(2)} items/sec)`);
        console.log(`       💾 Memory - RSS: ${result.memory.after.rss} MB (${result.memory.rssDelta} MB delta)`);
      } else {
        console.log(`  ${size.toString().padStart(4)} items: N/A`);
        break;
      }
    }

    if (scenario.cleanup) scenario.cleanup();
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Migration Performance Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n  💡 Tips for optimal migration performance:');
  console.log('     • Use batchSize option for large datasets');
  console.log('     • Monitor progress with onProgress callback');
  console.log('     • Consider clear:false to preserve existing data');
  console.log('     • Test migration on subset before full migration');
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

runMigrationBenchmarks().catch(console.error);

