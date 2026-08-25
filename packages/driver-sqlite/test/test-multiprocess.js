import assert from 'assert';
import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SqliteDriver } from '../src/SqliteDriver.js';
import { createLegacyDatabase, createSequencedDatabase, inspectDatabase } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, 'worker.js');
const testDataPath = path.join(__dirname, 'test-data-multiprocess');
const retryOptions = {
  busyTimeoutMs: 50,
  busyRetry: {
    maxAttempts: 20,
    baseDelayMs: 2,
    maxDelayMs: 20,
  },
};

function createWorker(args) {
  const child = fork(workerPath, [JSON.stringify(args)], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', data => {
    stderr += data.toString();
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`Worker exited with code ${code}: ${stderr}`));
    });
  });
  return { child, done };
}

function spawnWorker(args) {
  return createWorker(args).done;
}

function spawnLockWorker(args) {
  const worker = createWorker({ ...args, task: 'hold-lock' });
  const locked = new Promise((resolve, reject) => {
    worker.child.on('message', message => {
      if (message?.type === 'locked') resolve({ done: worker.done });
    });
    worker.child.on('error', reject);
    worker.child.on('exit', code => {
      if (code !== 0) reject(new Error(`Lock worker exited before acquiring lock (${code})`));
    });
  });
  return locked;
}

describe('SqliteDriver multi-process safety', function () {
  this.timeout(30000);

  beforeEach(function () {
    fs.rmSync(testDataPath, { recursive: true, force: true });
    fs.mkdirSync(testDataPath, { recursive: true });
  });

  afterEach(function () {
    fs.rmSync(testDataPath, { recursive: true, force: true });
  });

  it('validates concurrency options eagerly', function () {
    assert.throws(
      () => new SqliteDriver({ path: testDataPath, pragma: 'invalid' }),
      /pragma must be one of/,
    );
    assert.throws(
      () => new SqliteDriver({ path: testDataPath, busyTimeoutMs: -1 }),
      /busyTimeoutMs must be a non-negative integer/,
    );
    assert.throws(
      () => new SqliteDriver({ path: testDataPath, busyRetry: { maxAttempts: 0 } }),
      /maxAttempts must be at least 1/,
    );
  });

  it('applies busyTimeoutMs to the SQLite connection', async function () {
    const driver = new SqliteDriver({
      name: 'configured-timeout',
      path: testDataPath,
      busyTimeoutMs: 123,
    });
    await driver.connect();
    assert.strictEqual(driver.db.pragma('busy_timeout', { simple: true }), 123);
    await driver.disconnect();
  });

  it('uses the primary-key index to find descendant rows', async function () {
    const driver = new SqliteDriver({
      name: 'descendant-query-plan',
      path: testDataPath,
    });
    await driver.connect();

    const plan = driver.db
      .prepare(`EXPLAIN QUERY PLAN ${driver.delChildrenStmt.source}`)
      .all('parent.', 'parent/');
    const details = plan.map(step => step.detail).join('\n');

    assert.match(details, /SEARCH deepbase USING PRIMARY KEY/);
    assert.doesNotMatch(details, /SCAN deepbase/);
    await driver.disconnect();
  });

  it('adds a missing seq column without rewriting legacy rows', async function () {
    const name = 'legacy-no-seq';
    const fileName = path.join(testDataPath, `${name}.db`);
    createLegacyDatabase(fileName, [['b', 2], ['a', 1]]);

    const driver = new SqliteDriver({ name, path: testDataPath });
    await driver.connect();
    await driver.disconnect();

    const state = inspectDatabase(fileName);
    assert.deepStrictEqual(state.rows, [
      { key: 'a', seq: 0 },
      { key: 'b', seq: 0 },
    ]);
    assert.ok(state.indexes.some(index => index.name === 'deepbase_seq_idx' && index.unique === 0));
  });

  it('preserves duplicate historical seq values and their stable key order', async function () {
    const name = 'duplicate-seq';
    const fileName = path.join(testDataPath, `${name}.db`);
    createSequencedDatabase(fileName, [
      ['c', 3, 2],
      ['a', 1, 0],
      ['d', 4, 2],
      ['b', 2, 0],
    ]);

    const driver = new SqliteDriver({ name, path: testDataPath });
    await driver.connect();
    await driver.disconnect();

    assert.deepStrictEqual(inspectDatabase(fileName).rows, [
      { key: 'a', seq: 0 },
      { key: 'b', seq: 0 },
      { key: 'c', seq: 2 },
      { key: 'd', seq: 2 },
    ]);
  });

  it('serializes concurrent schema setup across processes', async function () {
    const name = 'concurrent-migration';
    const fileName = path.join(testDataPath, `${name}.db`);
    createLegacyDatabase(fileName, [['value', 1]]);

    await Promise.all(Array.from({ length: 6 }, (_, workerId) =>
      spawnWorker({
        task: 'connect-only',
        workerId,
        name,
        path: testDataPath,
        ...retryOptions,
      }),
    ));

    const state = inspectDatabase(fileName);
    assert.deepStrictEqual(state.rows, [{ key: 'value', seq: 0 }]);
    assert.ok(state.indexes.some(index => index.name === 'deepbase_seq_idx'));
  });

  it('keeps increments atomic across processes', async function () {
    const name = 'concurrent-inc';
    const driver = new SqliteDriver({ name, path: testDataPath, ...retryOptions });
    await driver.set('counter', 0);
    await driver.disconnect();

    await Promise.all(Array.from({ length: 4 }, (_, workerId) =>
      spawnWorker({
        task: 'inc',
        workerId,
        iterations: 25,
        name,
        path: testDataPath,
        ...retryOptions,
      }),
    ));

    const verify = new SqliteDriver({ name, path: testDataPath });
    assert.strictEqual(await verify.get('counter'), 100);
    await verify.disconnect();
  });

  it('preserves mixed writes from multiple processes with unique seq values', async function () {
    const name = 'mixed-writes';
    await Promise.all(Array.from({ length: 3 }, (_, workerId) =>
      spawnWorker({
        task: 'mixed',
        workerId,
        iterations: 10,
        name,
        path: testDataPath,
        ...retryOptions,
      }),
    ));

    const verify = new SqliteDriver({ name, path: testDataPath });
    assert.strictEqual(Object.keys(await verify.get('entries')).length, 30);
    assert.strictEqual(Object.keys(await verify.get('items')).length, 30);
    assert.strictEqual(await verify.get('temporary'), null);
    await verify.disconnect();

    const rows = inspectDatabase(path.join(testDataPath, `${name}.db`)).rows;
    assert.strictEqual(new Set(rows.map(row => row.seq)).size, rows.length);
  });

  it('retries a write until a short external lock is released', async function () {
    const name = 'short-lock';
    const fileName = path.join(testDataPath, `${name}.db`);
    const driver = new SqliteDriver({ name, path: testDataPath, ...retryOptions });
    await driver.connect();

    const lockWorker = await spawnLockWorker({
      fileName,
      holdMs: 150,
      busyTimeoutMs: retryOptions.busyTimeoutMs,
    });
    await driver.set('after-lock', true);
    await lockWorker.done;

    assert.strictEqual(await driver.get('after-lock'), true);
    await driver.disconnect();
  });

  it('surfaces SQLITE_BUSY after the configured retry budget', async function () {
    const name = 'long-lock';
    const fileName = path.join(testDataPath, `${name}.db`);
    const driver = new SqliteDriver({
      name,
      path: testDataPath,
      busyTimeoutMs: 10,
      busyRetry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
    });
    await driver.connect();

    const lockWorker = await spawnLockWorker({ fileName, holdMs: 300, busyTimeoutMs: 10 });
    await assert.rejects(
      driver.set('blocked', true),
      error => error.code === 'SQLITE_BUSY',
    );
    await lockWorker.done;
    await driver.disconnect();
  });
});
