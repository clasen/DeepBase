import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import DeepBase from '../packages/core/src/index.js';
import SqliteDriver from '../packages/driver-sqlite/src/SqliteDriver.js';

const DEFAULTS = {
  profiles: 104916,
  writeOps: 17872,
  progressEvery: 1000,
  runs: 2,
  pragmas: ['safe', 'balanced', 'fast'],
  concurrency: [1, 4, 8, 16],
  outputDir: './results',
  dataRoot: './data-migration-like',
  keepData: false,
  fullMatrix: false,
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((x) => x.startsWith('--') && !x.includes('=')));
  const getNumber = (name, fallback) => {
    const found = args.find((x) => x.startsWith(`${name}=`));
    if (!found) return fallback;
    const value = Number.parseInt(found.split('=').slice(1).join('='), 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const getList = (name, fallback) => {
    const found = args.find((x) => x.startsWith(`${name}=`));
    if (!found) return fallback;
    const values = found.split('=').slice(1).join('=').split(',').map((x) => x.trim()).filter(Boolean);
    return values.length > 0 ? values : fallback;
  };

  const profiles = getNumber('--profiles', DEFAULTS.profiles);
  const writeOps = Math.min(getNumber('--write-ops', DEFAULTS.writeOps), profiles);
  const progressEvery = getNumber('--progress-every', DEFAULTS.progressEvery);
  const runs = getNumber('--runs', DEFAULTS.runs);
  const pragmas = getList('--pragmas', DEFAULTS.pragmas);
  const concurrency = getList('--concurrency', DEFAULTS.concurrency.map(String))
    .map((x) => Number.parseInt(x, 10))
    .filter((x) => Number.isFinite(x) && x > 0);
  const outputDir = getList('--output-dir', [DEFAULTS.outputDir])[0];
  const dataRoot = getList('--data-root', [DEFAULTS.dataRoot])[0];

  return {
    profiles,
    writeOps,
    progressEvery,
    runs,
    pragmas,
    concurrency: concurrency.length ? concurrency : DEFAULTS.concurrency,
    outputDir,
    dataRoot,
    keepData: flags.has('--keep-data'),
    fullMatrix: flags.has('--full-matrix'),
    help: flags.has('--help') || flags.has('-h'),
  };
}

function printHelp() {
  console.log('Benchmark migration-like writes on deepbase-sqlite.');
  console.log('');
  console.log('Usage:');
  console.log('  node benchmarks/benchmark-sqlite-migration-like.js');
  console.log('  node benchmarks/benchmark-sqlite-migration-like.js --profiles=104916 --write-ops=17872');
  console.log('  node benchmarks/benchmark-sqlite-migration-like.js --runs=3 --pragmas=safe,balanced,fast');
  console.log('  node benchmarks/benchmark-sqlite-migration-like.js --concurrency=1,4,8,16 --full-matrix');
  console.log('');
  console.log('Options:');
  console.log('  --profiles=<n>          Total profile rows to seed');
  console.log('  --write-ops=<n>         Planned migration ops');
  console.log('  --progress-every=<n>    Log progress each N logical write ops');
  console.log('  --runs=<n>              Repetitions per scenario');
  console.log('  --pragmas=a,b,c         SQLite pragma modes');
  console.log('  --concurrency=a,b,c     Concurrency values to test');
  console.log('  --full-matrix           Cross all patterns/shapes/concurrency');
  console.log('  --output-dir=<path>     Results directory');
  console.log('  --data-root=<path>      Temporary DB root directory');
  console.log('  --keep-data             Keep generated DB files');
  console.log('  --help                  Show this help');
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function median(values) {
  return percentile(values, 50);
}

function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((acc, x) => acc + x, 0) / values.length;
}

function escapeKeyPart(text) {
  return String(text).replace(/\./g, '\\.');
}

function formatBytes(bytes) {
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function nowIsoSafe() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function generateSeedRows(totalProfiles, plannedWriteOps) {
  const rows = [];
  const normalizedWriteOps = Math.min(plannedWriteOps, totalProfiles);
  for (let i = 0; i < normalizedWriteOps; i++) {
    const hid = `H${i}`;
    rows.push([
      `LEGACY_${i}`,
      {
        game: 'game',
        remoteData: { hid },
        name: `User ${i}`,
        denounces: i % 7,
      },
    ]);
  }
  for (let i = normalizedWriteOps; i < totalProfiles; i++) {
    const hid = `H${i}`;
    rows.push([
      `game:${hid}`,
      {
        game: 'game',
        remoteData: { hid },
        name: `Canonical ${i}`,
        denounces: i % 5,
      },
    ]);
  }
  return rows;
}

function buildMigrationPlan(rows, writeOps) {
  const legacyRows = [];
  for (const [key, value] of rows) {
    if (!String(key).includes(':')) {
      legacyRows.push([String(key), value]);
    }
  }
  return legacyRows.slice(0, writeOps).map(([from, value]) => {
    const hid = value?.remoteData?.hid || value?.hid || from;
    const canonicalKey = `game:${hid}`;
    return {
      from,
      to: canonicalKey,
      value: {
        ...value,
        game: 'game',
        remoteData: {
          ...(value?.remoteData || {}),
          hid,
        },
      },
    };
  });
}

function getDbSize(basePath, dbName) {
  const file = path.join(basePath, `${dbName}.db`);
  const result = { db: 0, wal: 0, shm: 0, total: 0 };
  const paths = {
    db: file,
    wal: `${file}-wal`,
    shm: `${file}-shm`,
  };
  for (const [key, p] of Object.entries(paths)) {
    if (fs.existsSync(p)) {
      const size = fs.statSync(p).size;
      result[key] = size;
      result.total += size;
    }
  }
  return result;
}

function checkpoint(driver) {
  if (!driver?.db) return;
  try {
    driver.db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // no-op (pragma mode may not be WAL)
  }
}

function makeScenarios(config) {
  const scenarios = [];
  for (const pragma of config.pragmas) {
    if (config.fullMatrix) {
      const patterns = ['set-del', 'set-only'];
      const shapes = ['flat', 'deep'];
      for (const pattern of patterns) {
        for (const shape of shapes) {
          for (const concurrency of config.concurrency) {
            scenarios.push({
              id: `${pragma}-${shape}-${pattern}-c${concurrency}`,
              pragma,
              shape,
              pattern,
              concurrency,
            });
          }
        }
      }
      continue;
    }

    scenarios.push({
      id: `${pragma}-flat-set-del-c1`,
      pragma,
      shape: 'flat',
      pattern: 'set-del',
      concurrency: 1,
      baseline: true,
    });

    for (const c of config.concurrency.filter((x) => x !== 1)) {
      scenarios.push({
        id: `${pragma}-flat-set-del-c${c}`,
        pragma,
        shape: 'flat',
        pattern: 'set-del',
        concurrency: c,
      });
    }

    scenarios.push({
      id: `${pragma}-flat-set-only-c1`,
      pragma,
      shape: 'flat',
      pattern: 'set-only',
      concurrency: 1,
    });

    scenarios.push({
      id: `${pragma}-deep-set-del-c1`,
      pragma,
      shape: 'deep',
      pattern: 'set-del',
      concurrency: 1,
    });
  }
  return scenarios;
}

async function seedProfilesFast(driver, rows) {
  const insertStmt = driver.db.prepare('INSERT INTO deepbase (key, value, seq) VALUES (?, ?, ?)');
  const tx = driver.db.transaction((batchRows) => {
    driver.db.exec('DELETE FROM deepbase');
    let seq = 1;
    for (const [key, value] of batchRows) {
      const dbKey = `profile.${escapeKeyPart(key)}`;
      insertStmt.run(dbKey, JSON.stringify(value), seq);
      seq += 1;
    }
  });
  tx(rows);
}

async function runWithConcurrency(items, concurrency, worker) {
  let index = 0;
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  });
  await Promise.all(workers);
}

async function executeLogicalWrite(db, op, scenario) {
  if (scenario.shape === 'flat') {
    await db.set('profile', op.to, op.value);
    if (scenario.pattern === 'set-del') {
      await db.del('profile', op.from);
    }
    return;
  }

  // Deep variant intentionally adds nested writes over a parent object.
  await db.set('profile', op.to, {
    ...op.value,
    payload: {
      language: 'es',
      locale: 'AR',
      flags: { reviewed: false },
    },
  });
  await db.set('profile', op.to, 'payload', 'language', 'en');
  if (scenario.pattern === 'set-del') {
    await db.del('profile', op.from);
  }
}

async function runOneScenario(config, scenario, seedRows, runIndex) {
  const dataDir = path.resolve(config.dataRoot, `${scenario.id}-run${runIndex + 1}`);
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(dataDir, { recursive: true });

  const driver = new SqliteDriver({
    path: dataDir,
    name: 'bench',
    pragma: scenario.pragma,
  });
  const db = new DeepBase([driver], { writeAll: false });

  await db.connect();
  await seedProfilesFast(driver, seedRows);

  const loadStart = performance.now();
  const rows = await db.entries('profile');
  const loadMs = performance.now() - loadStart;

  const planStart = performance.now();
  const planned = buildMigrationPlan(rows, config.writeOps);
  const planMs = performance.now() - planStart;

  console.log(`Loaded ${rows.length} profile rows.`);
  console.log(`Planned write operations: ${planned.length}`);

  const opDurations = [];
  const blockDurations = [];
  let completed = 0;
  const writeStart = performance.now();
  const currentBlock = [];

  await runWithConcurrency(planned, scenario.concurrency, async (op) => {
    const start = performance.now();
    await executeLogicalWrite(db, op, scenario);
    const duration = performance.now() - start;
    opDurations.push(duration);
    currentBlock.push(duration);
    completed += 1;

    if (completed % config.progressEvery === 0 || completed === planned.length) {
      const p50 = percentile(currentBlock, 50);
      const p95 = percentile(currentBlock, 95);
      const blockAvg = avg(currentBlock);
      blockDurations.push({
        at: completed,
        count: currentBlock.length,
        p50,
        p95,
        avg: blockAvg,
      });
      console.log(
        `Write progress: ${completed}/${planned.length} | block p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms avg=${blockAvg.toFixed(2)}ms`,
      );
      currentBlock.length = 0;
    }
  });

  const writeMs = performance.now() - writeStart;
  const writeOpsSec = planned.length / (writeMs / 1000);
  const rawDisk = getDbSize(dataDir, 'bench');
  checkpoint(driver);
  const compactDisk = getDbSize(dataDir, 'bench');

  await db.disconnect();
  if (!config.keepData) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  return {
    run: runIndex + 1,
    rowsLoaded: rows.length,
    writesPlanned: planned.length,
    loadMs,
    planMs,
    writeMs,
    writeOpsSec,
    opMs: {
      p50: percentile(opDurations, 50),
      p95: percentile(opDurations, 95),
      p99: percentile(opDurations, 99),
      avg: avg(opDurations),
      max: opDurations.length ? Math.max(...opDurations) : 0,
    },
    blocks: blockDurations,
    disk: {
      raw: rawDisk,
      compacted: compactDisk,
    },
  };
}

function aggregateScenarioRuns(runs) {
  return {
    rowsLoaded: median(runs.map((r) => r.rowsLoaded)),
    writesPlanned: median(runs.map((r) => r.writesPlanned)),
    loadMs: median(runs.map((r) => r.loadMs)),
    planMs: median(runs.map((r) => r.planMs)),
    writeMs: median(runs.map((r) => r.writeMs)),
    writeOpsSec: median(runs.map((r) => r.writeOpsSec)),
    opMs: {
      p50: median(runs.map((r) => r.opMs.p50)),
      p95: median(runs.map((r) => r.opMs.p95)),
      p99: median(runs.map((r) => r.opMs.p99)),
      avg: median(runs.map((r) => r.opMs.avg)),
      max: median(runs.map((r) => r.opMs.max)),
    },
    disk: {
      rawTotal: median(runs.map((r) => r.disk.raw.total)),
      compactedTotal: median(runs.map((r) => r.disk.compacted.total)),
      walRaw: median(runs.map((r) => r.disk.raw.wal)),
      walCompacted: median(runs.map((r) => r.disk.compacted.wal)),
    },
    lastBlockP95: median(runs.map((r) => {
      const blocks = r.blocks;
      return blocks.length ? blocks[blocks.length - 1].p95 : 0;
    })),
  };
}

function printScenarioSummaryTable(summaryRows) {
  console.log('\n================================================================');
  console.log('SQLITE MIGRATION-LIKE WRITE SUMMARY (MEDIAN BY SCENARIO)');
  console.log('================================================================\n');
  const header = [
    'Scenario'.padEnd(38),
    'Ops/sec'.padStart(10),
    'Write(s)'.padStart(10),
    'Op p95'.padStart(10),
    'Block p95'.padStart(12),
    'Disk(comp)'.padStart(14),
  ].join('');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of summaryRows) {
    const line = [
      row.id.padEnd(38),
      row.aggregate.writeOpsSec.toFixed(0).padStart(10),
      (row.aggregate.writeMs / 1000).toFixed(1).padStart(10),
      `${row.aggregate.opMs.p95.toFixed(1)}ms`.padStart(10),
      `${row.aggregate.lastBlockP95.toFixed(1)}ms`.padStart(12),
      formatBytes(row.aggregate.disk.compactedTotal).padStart(14),
    ].join('');
    console.log(line);
  }
}

function printReadout(summaryRows) {
  const byId = new Map(summaryRows.map((x) => [x.id, x]));
  console.log('\nInterpretation guide:');
  console.log('- If "flat-set-only-c1" is much faster than "flat-set-del-c1", delete is a major cost.');
  console.log('- If "deep-set-del-c1" is much slower than "flat-set-del-c1", parent-object expansion is a major cost.');
  console.log('- If higher concurrency lowers ops/sec or increases p95, you hit SQLite single-writer contention.');
  console.log('- Compare pragma groups (safe/balanced/fast) using the same shape/pattern/concurrency to quantify durability tradeoffs.');

  const best = [...summaryRows].sort((a, b) => b.aggregate.writeOpsSec - a.aggregate.writeOpsSec)[0];
  if (best) {
    console.log('');
    console.log(`Best observed scenario: ${best.id} (${best.aggregate.writeOpsSec.toFixed(0)} ops/sec).`);
  }

  for (const pragma of ['safe', 'balanced', 'fast']) {
    const base = byId.get(`${pragma}-flat-set-del-c1`);
    const setOnly = byId.get(`${pragma}-flat-set-only-c1`);
    const deep = byId.get(`${pragma}-deep-set-del-c1`);
    if (base && setOnly) {
      const ratio = setOnly.aggregate.writeOpsSec / Math.max(base.aggregate.writeOpsSec, 0.0001);
      console.log(`- ${pragma}: set-only vs set+del = ${ratio.toFixed(2)}x`);
    }
    if (base && deep) {
      const ratio = deep.aggregate.writeOpsSec / Math.max(base.aggregate.writeOpsSec, 0.0001);
      console.log(`- ${pragma}: deep vs flat set+del = ${ratio.toFixed(2)}x`);
    }
  }
}

async function main() {
  const config = parseArgs(process.argv);
  if (config.help) {
    printHelp();
    return;
  }

  const scenarios = makeScenarios(config);
  const seedRows = generateSeedRows(config.profiles, config.writeOps);

  console.log('\n================================================================');
  console.log('DeepBase SQLite migration-like benchmark');
  console.log('================================================================');
  console.log(`Profiles: ${config.profiles}`);
  console.log(`Target write operations: ${config.writeOps}`);
  console.log(`Runs per scenario: ${config.runs}`);
  console.log(`Progress block: ${config.progressEvery}`);
  console.log(`Scenarios: ${scenarios.length}`);
  console.log(`Pragmas: ${config.pragmas.join(', ')}`);
  console.log(`Concurrency set: ${config.concurrency.join(', ')}`);
  console.log('');

  const allResults = [];
  for (const scenario of scenarios) {
    console.log('----------------------------------------------------------------');
    console.log(`Scenario: ${scenario.id}`);
    console.log(`  pragma=${scenario.pragma} shape=${scenario.shape} pattern=${scenario.pattern} concurrency=${scenario.concurrency}`);
    const runs = [];
    for (let run = 0; run < config.runs; run++) {
      console.log(`Run ${run + 1}/${config.runs}`);
      const runResult = await runOneScenario(config, scenario, seedRows, run);
      runs.push(runResult);
      console.log(
        `Run done: load=${runResult.loadMs.toFixed(0)}ms plan=${runResult.planMs.toFixed(0)}ms write=${runResult.writeMs.toFixed(0)}ms (${runResult.writeOpsSec.toFixed(0)} ops/sec)`,
      );
    }
    allResults.push({
      ...scenario,
      runs,
      aggregate: aggregateScenarioRuns(runs),
    });
  }

  fs.mkdirSync(path.resolve(config.outputDir), { recursive: true });
  const outputFile = path.resolve(config.outputDir, `sqlite-migration-like-${nowIsoSafe()}.json`);
  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      config,
    },
    results: allResults,
  };
  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), 'utf8');

  printScenarioSummaryTable(allResults);
  console.log(`\nJSON results saved to: ${outputFile}`);
  printReadout(allResults);
}

main().catch((error) => {
  console.error('Benchmark failed:', error?.message || error);
  process.exit(1);
});
