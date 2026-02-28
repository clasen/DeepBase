import DeepBase from '../packages/core/src/index.js';
import SqliteDriver from '../packages/driver-sqlite/src/SqliteDriver.js';
import fs from 'fs';
import path from 'path';

const ITERATIONS = 1000;
const BATCH_SIZE = 100;
const CONCURRENT_OPS = 1000;
const RUNS = 3;

function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    rss: (used.rss / 1024 / 1024),
    heapUsed: (used.heapUsed / 1024 / 1024),
  };
}

function getDiskSize(dbPath, dbName) {
  const base = path.join(dbPath, `${dbName}.db`);
  let total = 0;
  const breakdown = {};
  for (const ext of ['', '-wal', '-shm']) {
    const f = base + ext;
    if (fs.existsSync(f)) {
      const sz = fs.statSync(f).size;
      total += sz;
      if (sz > 0) breakdown[ext || '.db'] = sz;
    }
  }
  return { total, breakdown };
}

function checkpointAndMeasure(driver, dbPath, dbName) {
  if (driver.db) {
    try { driver.db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) { /* no-op for non-WAL */ }
  }
  return getDiskSize(dbPath, dbName);
}

function fmtKB(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

async function benchmarkDriver(label, createDriver, dbPath, dbName) {
  const allResults = [];

  for (let run = 0; run < RUNS; run++) {
    if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { recursive: true, force: true });

    const drv = createDriver();
    const db = new DeepBase(drv);
    await db.connect();

    const results = {};
    const memBefore = getMemoryUsage();

    // --- Sequential Write ---
    const writeStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      await db.set('items', `item_${i}`, { id: i, name: `Item ${i}`, timestamp: Date.now() });
    }
    results.write = ITERATIONS / ((performance.now() - writeStart) / 1000);

    const diskAfterWriteRaw = getDiskSize(dbPath, dbName);
    const diskAfterWrite = checkpointAndMeasure(drv, dbPath, dbName);

    // --- Sequential Read ---
    const readStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      await db.get('items', `item_${i}`);
    }
    results.read = ITERATIONS / ((performance.now() - readStart) / 1000);

    // --- Update ---
    const updateStart = performance.now();
    for (let i = 0; i < BATCH_SIZE; i++) {
      await db.upd('items', `item_${i}`, item => ({ ...item, updated: true, updatedAt: Date.now() }));
    }
    results.update = BATCH_SIZE / ((performance.now() - updateStart) / 1000);

    // --- Increment ---
    await db.set('counters', 'counter', 0);
    const incStart = performance.now();
    for (let i = 0; i < BATCH_SIZE; i++) {
      await db.inc('counters', 'counter', 1);
    }
    results.increment = BATCH_SIZE / ((performance.now() - incStart) / 1000);

    // --- Delete ---
    const delStart = performance.now();
    for (let i = 0; i < BATCH_SIZE; i++) {
      await db.del('items', `item_${i}`);
    }
    results.delete = BATCH_SIZE / ((performance.now() - delStart) / 1000);

    // --- Keys/Values/Entries ---
    const keysStart = performance.now();
    await db.keys('items');
    results.keys = 1 / ((performance.now() - keysStart) / 1000);

    const valuesStart = performance.now();
    await db.values('items');
    results.values = 1 / ((performance.now() - valuesStart) / 1000);

    const entriesStart = performance.now();
    await db.entries('items');
    results.entries = 1 / ((performance.now() - entriesStart) / 1000);

    // --- Batch Write ---
    const batchStart = performance.now();
    await Promise.all(Array.from({ length: BATCH_SIZE }, (_, i) =>
      db.set('batch', `item_${i}`, { value: i }),
    ));
    results.batchWrite = BATCH_SIZE / ((performance.now() - batchStart) / 1000);

    // --- Concurrent Write ---
    await db.del('concurrent_items');
    const concWriteStart = performance.now();
    await Promise.all(Array.from({ length: CONCURRENT_OPS }, (_, i) =>
      db.set('concurrent_items', `item_${i}`, { id: i, name: `Item ${i}`, timestamp: Date.now() }),
    ));
    results.concurrentWrite = CONCURRENT_OPS / ((performance.now() - concWriteStart) / 1000);

    // --- Concurrent Read ---
    const concReadStart = performance.now();
    await Promise.all(Array.from({ length: CONCURRENT_OPS }, (_, i) =>
      db.get('concurrent_items', `item_${i}`),
    ));
    results.concurrentRead = CONCURRENT_OPS / ((performance.now() - concReadStart) / 1000);

    // --- Mixed 75/25 ---
    const mixedStart = performance.now();
    await Promise.all(Array.from({ length: 1000 }, (_, i) =>
      i % 4 === 0
        ? db.set('concurrent_items', `item_${Math.floor(Math.random() * CONCURRENT_OPS)}`, { updated: true, timestamp: Date.now() })
        : db.get('concurrent_items', `item_${Math.floor(Math.random() * CONCURRENT_OPS)}`),
    ));
    results.mixed = 1000 / ((performance.now() - mixedStart) / 1000);

    // --- Concurrent Increments ---
    await db.set('stress', 'counter', 0);
    const stressStart = performance.now();
    await Promise.all(Array.from({ length: 500 }, () => db.inc('stress', 'counter', 1)));
    const finalCount = await db.get('stress', 'counter');
    results.concurrentInc = 500 / ((performance.now() - stressStart) / 1000);
    results.incCorrect = finalCount === 500;

    // =============================================
    //  DEEP OBJECT SCENARIOS
    // =============================================

    // --- Deep Write (5-level paths) ---
    const DEEP_N = 200;
    const deepWriteStart = performance.now();
    for (let i = 0; i < DEEP_N; i++) {
      await db.set('app', 'users', `user_${i}`, 'profile', 'settings', {
        theme: 'dark', lang: 'en', notifications: true, fontSize: 14,
      });
    }
    results.deepWrite = DEEP_N / ((performance.now() - deepWriteStart) / 1000);

    // --- Deep Read Leaf (fetch the deepest stored value) ---
    const deepReadLeafStart = performance.now();
    for (let i = 0; i < DEEP_N; i++) {
      await db.get('app', 'users', `user_${i}`, 'profile', 'settings');
    }
    results.deepReadLeaf = DEEP_N / ((performance.now() - deepReadLeafStart) / 1000);

    // --- Deep Read Subtree (fetch entire user subtree, multiple children) ---
    // First add more nested data so each user has several children
    for (let i = 0; i < DEEP_N; i++) {
      await db.set('app', 'users', `user_${i}`, 'profile', 'name', `User ${i}`);
      await db.set('app', 'users', `user_${i}`, 'profile', 'email', `user${i}@test.com`);
      await db.set('app', 'users', `user_${i}`, 'stats', 'logins', i * 10);
      await db.set('app', 'users', `user_${i}`, 'stats', 'lastSeen', Date.now());
    }
    const deepReadSubtreeStart = performance.now();
    for (let i = 0; i < DEEP_N; i++) {
      await db.get('app', 'users', `user_${i}`);
    }
    results.deepReadSubtree = DEEP_N / ((performance.now() - deepReadSubtreeStart) / 1000);

    // --- Object Expansion (store object then set nested property into it) ---
    const EXPAND_N = 200;
    const expandStart = performance.now();
    for (let i = 0; i < EXPAND_N; i++) {
      await db.set('sessions', `s_${i}`, 'config', {
        country: '', gender: 'M', lang: 'es', vip: false,
      });
      await db.set('sessions', `s_${i}`, 'config', 'lang', 'en');
    }
    results.objExpansion = EXPAND_N / ((performance.now() - expandStart) / 1000);

    // --- Complex Session Lifecycle (storybot-like: mixed object + nested writes + reads) ---
    const SESSION_N = 50;
    const sessionStart = performance.now();
    for (let i = 0; i < SESSION_N; i++) {
      const sk = `stm.${Date.now()}.sess${i}`;
      await db.set(sk, 'replace', { '{lang}': 'es', '{name}': `User${i}`, '@main': 'bot' });
      await db.set(sk, 'tokens', { input: 1000, output: 50, cost: 0.005 });
      await db.set(sk, 'active', 'BotA', true);
      await db.set(sk, 'active', 'BotB', true);
      await db.set(sk, 'replace', '{lang}', 'en');
      await db.set(sk, 'node', 'current', 'chapter', 1);
      const session = await db.get(sk);
      if (!session || session.replace['{lang}'] !== 'en') throw new Error('session integrity check failed');
    }
    results.sessionLifecycle = SESSION_N / ((performance.now() - sessionStart) / 1000);

    // --- Read Entire Deep Tree (get root with thousands of nested keys) ---
    const deepTreeStart = performance.now();
    await db.get('app');
    results.deepTreeRead = 1 / ((performance.now() - deepTreeStart) / 1000);

    const memAfter = getMemoryUsage();
    const diskFinalRaw = getDiskSize(dbPath, dbName);
    const diskFinal = checkpointAndMeasure(drv, dbPath, dbName);

    results.memory = {
      rssDelta: memAfter.rss - memBefore.rss,
      heapDelta: memAfter.heapUsed - memBefore.heapUsed,
    };
    results.disk = {
      afterWriteRaw: diskAfterWriteRaw.total,
      afterWrite: diskAfterWrite.total,
      finalRaw: diskFinalRaw.total,
      final: diskFinal.total,
    };

    await db.disconnect();
    allResults.push(results);
  }

  return median(allResults);
}

function median(runs) {
  const result = {};
  const keys = Object.keys(runs[0]);
  for (const k of keys) {
    if (typeof runs[0][k] === 'number') {
      const sorted = runs.map(r => r[k]).sort((a, b) => a - b);
      result[k] = sorted[Math.floor(sorted.length / 2)];
    } else if (typeof runs[0][k] === 'boolean') {
      result[k] = runs.every(r => r[k]);
    } else if (typeof runs[0][k] === 'object') {
      result[k] = {};
      for (const sk of Object.keys(runs[0][k])) {
        const sorted = runs.map(r => r[k][sk]).sort((a, b) => a - b);
        result[k][sk] = sorted[Math.floor(sorted.length / 2)];
      }
    }
  }
  return result;
}

function pct(fast, orig) {
  const diff = ((fast - orig) / orig * 100);
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(0)}%`;
}

const PRAGMA_MODES = ['none', 'safe', 'balanced', 'fast'];

async function run() {
  console.log('\n================================================================');
  console.log('  SqliteDriver — Pragma Mode Benchmark');
  console.log(`  ${RUNS} runs per mode, median reported`);
  console.log('================================================================\n');

  const paths = {};
  const results = {};
  for (const pragma of PRAGMA_MODES) {
    paths[pragma] = `./benchmarks/data-${pragma}`;
    console.log(`Running SqliteDriver [pragma=${pragma}]...`);
    results[pragma] = await benchmarkDriver(
      pragma,
      () => new SqliteDriver({ name: 'bench', path: paths[pragma], pragma }),
      paths[pragma],
      'bench',
    );
  }

  // ---- RESULTS TABLE ----
  const ops = [
    ['write', 'Sequential Write'],
    ['read', 'Sequential Read'],
    ['update', 'Update'],
    ['increment', 'Increment'],
    ['delete', 'Delete'],
    ['batchWrite', 'Batch Write'],
    ['concurrentWrite', 'Concurrent Write'],
    ['concurrentRead', 'Concurrent Read'],
    ['mixed', 'Mixed (75R/25W)'],
    ['concurrentInc', 'Concurrent Inc'],
    [null, null],
    ['deepWrite', 'Deep Write (5-lvl)'],
    ['deepReadLeaf', 'Deep Read Leaf'],
    ['deepReadSubtree', 'Deep Read Subtree'],
    ['objExpansion', 'Obj Expansion'],
    ['sessionLifecycle', 'Session Lifecycle'],
    ['deepTreeRead', 'Deep Tree Read'],
  ];

  console.log('\n================================================================');
  console.log('  THROUGHPUT (ops/sec) — higher is better');
  console.log('================================================================\n');

  const hdr = 'Operation'.padEnd(22) +
    PRAGMA_MODES.map(m => m.charAt(0).toUpperCase() + m.slice(1)).map(m => m.padStart(12)).join('') +
    '  Bal vs None';
  console.log(hdr);
  console.log('─'.repeat(hdr.length));

  for (const [key, label] of ops) {
    if (key === null) {
      console.log('  — DEEP OBJECT SCENARIOS —');
      continue;
    }
    let line = label.padEnd(22);
    for (const m of PRAGMA_MODES) line += results[m][key].toFixed(0).padStart(12);
    line += pct(results.balanced[key], results.none[key]).padStart(12);
    console.log(line);
  }

  console.log('\n================================================================');
  console.log('  DISK SIZE — lower is better');
  console.log('  (compacted = after WAL checkpoint; raw = during operation)');
  console.log('================================================================\n');

  const diskHdr = 'Metric'.padEnd(26) +
    PRAGMA_MODES.map(m => m.charAt(0).toUpperCase() + m.slice(1)).map(m => m.padStart(14)).join('');
  console.log(diskHdr);
  console.log('─'.repeat(diskHdr.length));

  for (const [metric, label] of [['afterWriteRaw', 'After 1k writes (raw)'], ['afterWrite', 'After 1k writes (compact)'], ['finalRaw', 'Final (raw)'], ['final', 'Final (compacted)']]) {
    let line = label.padEnd(26);
    for (const m of PRAGMA_MODES) line += fmtKB(results[m].disk[metric]).padStart(14);
    console.log(line);
  }
  let line = 'Bal vs None (compacted)'.padEnd(26);
  line += ''.padStart(14);
  line += ''.padStart(14);
  line += pct(results.balanced.disk.final, results.none.disk.final).padStart(14);
  console.log(line);

  console.log('\n================================================================');
  console.log('  MEMORY (MB delta) — lower is better');
  console.log('================================================================\n');

  const memHdr = 'Metric'.padEnd(22) +
    PRAGMA_MODES.map(m => m.charAt(0).toUpperCase() + m.slice(1)).map(m => m.padStart(14)).join('');
  console.log(memHdr);
  console.log('─'.repeat(memHdr.length));

  line = 'RSS Delta'.padEnd(22);
  for (const m of PRAGMA_MODES) line += results[m].memory.rssDelta.toFixed(2).padStart(14);
  console.log(line);

  line = 'Heap Delta'.padEnd(22);
  for (const m of PRAGMA_MODES) line += results[m].memory.heapDelta.toFixed(2).padStart(14);
  console.log(line);

  console.log('\n================================================================');
  console.log('  CORRECTNESS');
  console.log('================================================================\n');

  for (const m of PRAGMA_MODES) {
    console.log(`  pragma=${m.padEnd(10)}: 500 concurrent increments → ${results[m].incCorrect ? 'PASS' : 'FAIL'}`);
  }

  console.log('\n================================================================\n');

  for (const p of Object.values(paths)) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
}

run().catch(console.error);
