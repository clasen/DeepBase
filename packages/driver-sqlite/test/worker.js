import Database from 'better-sqlite3';
import { SqliteDriver } from '../src/SqliteDriver.js';

const options = JSON.parse(process.argv[2]);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function holdLock() {
  const databaseOptions = options.busyTimeoutMs === undefined
    ? undefined
    : { timeout: options.busyTimeoutMs };
  const db = new Database(options.fileName, databaseOptions);
  db.exec('BEGIN IMMEDIATE');
  process.send?.({ type: 'locked' });
  await wait(options.holdMs);
  db.exec('COMMIT');
  db.close();
}

async function runDriverTask() {
  const driver = new SqliteDriver({
    name: options.name,
    path: options.path,
    pragma: options.pragma ?? 'balanced',
    busyTimeoutMs: options.busyTimeoutMs,
    busyRetry: options.busyRetry,
  });

  await driver.connect();

  if (options.task === 'inc') {
    for (let i = 0; i < options.iterations; i += 1) {
      await driver.inc('counter', 1);
    }
  } else if (options.task === 'set-unique') {
    for (let i = 0; i < options.iterations; i += 1) {
      await driver.set('entries', `${options.workerId}-${i}`, i);
    }
  } else if (options.task === 'mixed') {
    for (let i = 0; i < options.iterations; i += 1) {
      await driver.set('entries', `${options.workerId}-${i}`, i);
      await driver.add('items', { workerId: options.workerId, index: i });
      await driver.set('temporary', `${options.workerId}-${i}`, true);
      await driver.del('temporary', `${options.workerId}-${i}`);
    }
  } else if (options.task !== 'connect-only') {
    throw new Error(`Unknown worker task: ${options.task}`);
  }

  await driver.disconnect();
}

if (options.task === 'hold-lock') {
  await holdLock();
} else {
  await runDriverTask();
}

process.disconnect?.();
