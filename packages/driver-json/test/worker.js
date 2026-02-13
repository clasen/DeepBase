/**
 * Worker script for multi-process tests.
 * Receives commands via IPC and executes them against a JsonDriver instance.
 */
import { JsonDriver } from '../src/JsonDriver.js';

const { name, path, task, iterations } = JSON.parse(process.argv[2]);

const driver = new JsonDriver({ name, path, multiProcess: true });
await driver.connect();

if (task === 'increment') {
  // Perform N sequential increments using upd (atomic read-modify-write)
  for (let i = 0; i < iterations; i++) {
    await driver.upd('counter', (current) => (current || 0) + 1);
  }
} else if (task === 'set-unique') {
  // Set unique keys per process
  const pid = process.pid;
  for (let i = 0; i < iterations; i++) {
    await driver.set('entries', `p${pid}_${i}`, { pid, index: i });
  }
} else if (task === 'inc') {
  // Use the driver's inc method
  for (let i = 0; i < iterations; i++) {
    await driver.inc('counter', 1);
  }
}

await driver.disconnect();

// Signal success
process.exit(0);
