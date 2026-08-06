# DeepBase v3.8.4 Benchmark Results

Measured on 2026-08-05. This report separates results verified in the current checkout from older comparison values that could not be refreshed without external services.

## Executive Summary

- `deepbase-sqlite` avoids full-table descendant scans by using indexed key ranges.
- `deepbase-drizzle` uses the same range strategy for SQLite, LibSQL, and Turso, and creates a non-unique `seq` index during automatic schema setup.
- Drizzle SQLite sequential `set` throughput on a 5,000-write workload improved from approximately 4,867 ops/sec to a five-run median of 14,634 ops/sec (about 3x).
- The current Drizzle query plan uses the primary-key index for descendant operations and a covering `seq` index for `MAX(seq)`.

## Environment

| Component | Version |
|---|---|
| DeepBase | 3.8.4 |
| Node.js | 22.22.2 |
| OS | macOS Darwin 25.5.0 arm64 |
| better-sqlite3 | 11.10.0 |
| Drizzle ORM | 0.36.4 |
| SQLite profile | `balanced` (WAL, `synchronous=NORMAL`) |

Results are local measurements and will vary with hardware, filesystem, database size, warm-up state, and background load.

## Cross-Driver Snapshot

The Drizzle column was refreshed from the median of five local runs using the same operation sequence as `benchmarks/benchmark-compare.js`: 500 iterations for standard operations and 200 push/pop pairs for stack and queue.

The other columns are retained from the previous repository snapshot. `npm run bench:compare` could not produce a fresh complete table because MongoDB was unavailable during this run.

| Operation | JSON | SQLite | Drizzle | MongoDB | Redis | RedisJSON |
|---|---:|---:|---:|---:|---:|---:|
| Write | ~2.7k | ~46.4k | **~13.5k** | ~3.8k | ~2.8k | ~5.1k |
| Read | ~719.1k | ~245.4k | **~27.5k** | ~1.8k | ~4.3k | ~11.1k |
| Increment | ~2.0k | ~73.5k | **~10.7k** | ~4.9k | ~3.0k | ~11.3k |
| Update | ~2.0k | ~69.8k | **~10.2k** | ~1.2k | ~1.5k | ~3.8k |
| Delete | ~2.1k | ~76.4k | **~17.3k** | ~5.3k | ~1.8k | ~10.9k |
| Stack | ~2.1k | ~40.9k | **~9.7k** | ~2.3k | ~3.0k | ~3.9k |
| Queue | ~2.1k | ~44.5k | **~9.8k** | ~2.6k | ~2.5k | ~3.9k |

All values are operations per second. Do not use this mixed-age table to make small relative comparisons between drivers; rerun the full suite with MongoDB and Redis available for that purpose.

## Drizzle SQLite: Five-Run Median

| Operation | Median ops/sec |
|---|---:|
| Write | 13,468 |
| Read | 27,518 |
| Increment | 10,742 |
| Update | 10,196 |
| Delete | 17,346 |
| Stack | 9,657 |
| Queue | 9,839 |

Individual write results ranged from 9,651 to 13,985 ops/sec. The median is reported to reduce the effect of filesystem and JIT warm-up variance.

## Drizzle SQLite: Standard Benchmark

Command:

```bash
npm run bench:drizzle
```

One complete 1,000-iteration run produced:

### Sequential operations

| Operation | Ops/sec |
|---|---:|
| Write | 10,262 |
| Read | 23,458 |
| Update | 8,649 |
| Increment | 9,242 |
| Delete | 16,187 |
| Batch write | 9,269 |

### Concurrent workload

| Operation | Ops/sec |
|---|---:|
| Concurrent write | 13,496 |
| Concurrent read | 26,619 |
| Mixed 75% read / 25% write | 22,550 |
| Concurrent increment | 9,739 |

The concurrent increment correctness check finished at 500, matching the expected value of 500.

### Memory snapshot

| Metric | Value |
|---|---:|
| Initial RSS | 128.48 MB |
| Final RSS | 142.23 MB |
| RSS delta | +13.75 MB |

This is a process-level snapshot without forced garbage collection, so it should not be treated as a standalone memory scalability benchmark.

## SQLite Range Optimization Validation

The performance regression came from descendant queries shaped as:

```sql
WHERE key LIKE 'parent.%'
```

On growing tables, SQLite scanned the table for every write. SQLite-family drivers now use the equivalent half-open range:

```sql
WHERE key >= 'parent.' AND key < 'parent/'
```

Observed query plans:

```text
SEARCH deepbase_main USING INDEX ... (key>? AND key<?)
SEARCH deepbase_main USING COVERING INDEX deepbase_main_seq_idx
```

The range optimization is enabled only for SQLite, LibSQL, and Turso, whose default key ordering satisfies this boundary. PostgreSQL and MySQL retain escaped `LIKE` matching until their configured collation can be verified safely. The `seq` index is created across supported dialects when automatic schema management is enabled.

## Larger SQLite Workloads

Additional `balanced` measurements from the current optimization work:

| Scenario | Dataset / operations | Ops/sec |
|---|---|---:|
| Native SQLite sequential `set` | 5,000 writes | 67,487 median |
| Migration-like flat `set` only | 20,000 seeded rows / 5,000 writes | 55,353 |
| Migration-like flat `set` + `del` | 20,000 seeded rows / 5,000 operations | 29,052 |
| Migration-like deep `set` + `del` | 20,000 seeded rows / 5,000 operations | 14,569 |

These scenarios are not directly comparable to the 500-iteration cross-driver table because their dataset sizes and operation mixes differ.

## Correctness Checks

- Drizzle driver suite: 296 passing tests.
- Native SQLite driver suite: 347 passing tests.
- Query-plan tests reject a regression back to `SCAN deepbase_main` for descendant deletion.
- Special-key tests cover dots, underscores, percent signs, slashes, and backslashes.
- Drizzle keeps escaped `LIKE` behavior for dialects without verified binary collation.
- Sequence allocation remains inside database transactions; existing keys retain their original `seq`.

## Reproducing the Results

```bash
# Drizzle SQLite benchmark
npm run bench:drizzle

# Native SQLite benchmark
npm run bench:sqlite

# SQLite migration-like workloads
npm run bench:sqlite-migration-like

# Full cross-driver comparison; requires MongoDB and Redis
npm run bench:compare
```

For release decisions, run at least three repetitions on the target deployment hardware and report the median together with dataset size, pragma profile, and concurrency.
