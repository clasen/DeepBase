#!/usr/bin/env node
/**
 * Run all DeepBase benchmarks and generate comparison report
 */

import { spawn } from 'child_process';
import fs from 'fs';

const benchmarks = [
  { name: 'JSON', script: 'benchmark-json.js', required: false },
  { name: 'SQLite', script: 'benchmark-sqlite.js', required: false },
  { name: 'Redis', script: 'benchmark-redis.js', required: true },
  { name: 'Redis-JSON', script: 'benchmark-redis-json.js', required: false },
  { name: 'MongoDB', script: 'benchmark-mongodb.js', required: false }
];

const results = {};

console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║    DeepBase Benchmark Suite - Running All Tests      ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

async function runBenchmark(benchmark) {
  return new Promise((resolve) => {
    console.log(`\n▶️  Running ${benchmark.name} benchmark...`);
    console.log('─'.repeat(60));
    
    const proc = spawn('node', [benchmark.script], {
      cwd: process.cwd(),
      stdio: 'inherit'
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${benchmark.name} benchmark completed\n`);
        results[benchmark.name] = { success: true, code };
      } else {
        console.log(`⚠️  ${benchmark.name} benchmark failed (exit code: ${code})\n`);
        results[benchmark.name] = { success: false, code };
      }
      resolve();
    });

    proc.on('error', (err) => {
      console.log(`❌ ${benchmark.name} benchmark error: ${err.message}\n`);
      results[benchmark.name] = { success: false, error: err.message };
      resolve();
    });
  });
}

async function main() {
  const startTime = Date.now();

  // Run all benchmarks sequentially
  for (const benchmark of benchmarks) {
    await runBenchmark(benchmark);
    // Small delay between benchmarks
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║              Benchmark Suite Summary                  ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  let successCount = 0;
  let failCount = 0;

  for (const [name, result] of Object.entries(results)) {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    const details = result.error ? ` (${result.error})` : '';
    console.log(`  ${status}  ${name}${details}`);
    
    if (result.success) successCount++;
    else failCount++;
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`  Total: ${successCount} passed, ${failCount} failed`);
  console.log(`  Time: ${totalTime}s`);
  console.log('─'.repeat(60) + '\n');

  console.log('📊 For detailed comparison, see: BENCHMARK_COMPARISON.md\n');

  // Exit with error if any required benchmark failed
  const requiredFailed = benchmarks.some(b => 
    b.required && results[b.name] && !results[b.name].success
  );

  process.exit(requiredFailed ? 1 : 0);
}

main().catch(console.error);

