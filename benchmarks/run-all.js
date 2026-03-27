#!/usr/bin/env node
/**
 * Runs all benchmark scripts in the same order as `npm run bench:all` from the monorepo root.
 * Usage (from repo root): `node benchmarks/run-all.js`
 * Usage (from benchmarks/): `node run-all.js`
 */
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRIPTS = [
  'benchmark-json.js',
  'benchmark-mongodb.js',
  'benchmark-redis.js',
  'benchmark-redis-json.js',
  'benchmark-sqlite.js',
  'benchmark-drizzle.js',
  'benchmark-compare.js',
  'benchmark-migration.js',
];

for (const script of SCRIPTS) {
  console.log(`\n${'='.repeat(60)}\n  Running ${script}\n${'='.repeat(60)}\n`);
  execSync(`node ${script}`, { cwd: __dirname, stdio: 'inherit' });
}

console.log('\n✅ All benchmark scripts finished.\n');
