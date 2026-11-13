# deepbase-sqlite

SQLite driver for DeepBase.

## Installation

```bash
npm install deepbase deepbase-sqlite
```

The driver uses the SQLite that ships with the runtime (`node:sqlite`), so there
is no native addon to download or compile. It needs Node.js 22.16 or later, or
Bun. The same code and test suite run on both.

Node.js 22 prints `ExperimentalWarning: SQLite is an experimental feature` the
first time the module loads. The warning comes from Node.js itself.

## Upgrading from 3.12 and earlier

Versions up to 3.12 were built on `better-sqlite3`. Existing database files
open as they are; the table layout did not change.

- Node.js 22.16 or later is required, or Bun.
- A write that exhausts its busy retries rejects with `code: 'ERR_SQLITE_ERROR'`
  and `errcode: 5` (`SQLITE_BUSY`). It used to reject with `code: 'SQLITE_BUSY'`.
- The `DEEPBASE_SQLITE_BINDING_MISSING` error is gone, and so is the
  `--ignore-scripts=false` install requirement.
- Writes issued concurrently share transactions. See
  [Write batching](#write-batching).

## Description

Stores data in SQLite database files. Perfect for:

- ✅ Production applications
- ✅ Medium to large datasets
- ✅ Fast queries and transactions
- ✅ ACID compliance
- ✅ Embedded database solution
- ✅ Zero configuration needed

## Usage

```javascript
import DeepBase from 'deepbase';
import { resolvePath } from 'deepbase/path';
import SqliteDriver from 'deepbase-sqlite';

const dataPath = resolvePath(import.meta.url, './data');

const db = new DeepBase(new SqliteDriver({
  path: dataPath,
  name: 'mydb',
  pragma: 'balanced' // default — omit for same result
}));

await db.connect();

await db.set('users', 'alice', { name: 'Alice', age: 30 });
const alice = await db.get('users', 'alice');
```

`path` is required and must be absolute. `resolvePath()` anchors a relative
path to your application module instead of `process.cwd()` or the installed
package location.

## Options

```javascript
new SqliteDriver({
  path: '/var/lib/myapp/data', // Required absolute directory for database files
  name: 'default',            // Database filename (without .db)
  pragma: 'balanced',         // Performance profile: 'none' | 'safe' | 'balanced' | 'fast'
  busyTimeoutMs: 5000,        // Native wait per lock attempt
  busyRetry: {
    maxAttempts: 2,           // Total transaction attempts
    baseDelayMs: 25,          // Exponential backoff base
    maxDelayMs: 250           // Backoff cap
  },
  queryWindowMaxRecords: 1000, // query() records a native window may reach
  queryWindowMaxProbes: 12000, // query() lookups the order guard may spend
  nidAlphabet: 'ABC...',      // Alphabet for ID generation
  nidLength: 10               // Length of generated IDs
})
```

## Features

### High Performance

Uses the built-in `node:sqlite` for synchronous operations wrapped in async API:

- Prepared statements for optimal performance
- Transaction support for batch operations
- Fast lookups with indexed keys

### Write batching

Writes issued while a commit is in flight share the next transaction, so
concurrent callers pay for one commit instead of one each:

```javascript
await Promise.all(users.map(user => db.set('users', user.id, user)));
```

Each write still runs in its own `SAVEPOINT`: a write that throws rejects alone
and the rest of the batch commits. Every promise resolves only after its batch
commits. A batch holds at most 1000 writes; `vacuum()` and `checkpoint()` run
alone, in queue order. Writes awaited one after another gain nothing.

### Multi-process concurrency

Multiple instances and same-host processes may safely point to the same database file. Each driver owns its connection and lifecycle; SQLite coordinates writers using WAL, `BEGIN IMMEDIATE`, a busy timeout, and bounded transaction retries:

```javascript
const db1 = new DeepBase(new SqliteDriver({ path: '/var/lib/myapp/data', name: 'mydb' }));
const db2 = new DeepBase(new SqliteDriver({ path: '/var/lib/myapp/data', name: 'mydb' }));
// Independent connections; disconnecting db1 does not close db2.
```

SQLite still permits only one writer at a time. Keep write transactions short and use a client-server database when sustained write contention or multiple hosts are required. WAL requires a local filesystem shared by processes on the same host; do not place the database on NFS.

When upgrading from a version that used the in-memory sequence counter, stop all old writer processes before starting the new version. Old and new sequence allocators must not write concurrently during a rolling deployment.

### Maintenance

The driver owns the SQLite connection and exposes maintenance through its own
API, so a backup or vacuum job does not need to open a connection of its own.

```javascript
const driver = db.getDriver(0);

const status = await driver.checkIntegrity();     // 'ok', or what SQLite found
await driver.backup('./backups/mydb-2026-07-28.db');
await driver.vacuum();
await driver.checkpoint('TRUNCATE');
```

| Method | Behaviour |
|--------|-----------|
| `checkIntegrity()` | `PRAGMA integrity_check` on a temporary connection; returns its status verbatim. |
| `backup(destination)` | Online copy from a temporary connection, verified before it resolves. Returns `destination`. |
| `vacuum()` | Rebuilds the file to reclaim free pages. |
| `checkpoint(mode)` | `PASSIVE` (default), `FULL`, `RESTART` or `TRUNCATE`. Returns `{ busy, log, checkpointed }`. |

`checkIntegrity()` and `backup()` open a temporary connection in `mode=rw`,
which refuses to create a missing file, then close it. They never create, migrate, or change
PRAGMAs on the source database; a missing or mistyped source path fails instead
of producing an empty database. `backup()` creates destination parent
directories only after opening the source, then reopens the result and
verifies it with `integrity_check` — a backup nobody validated is not a backup.
It rejects with code `DEEPBASE_SQLITE_BACKUP_CORRUPT` when the copy fails to
verify, leaving the bad file on disk for inspection, so a restore routine must
never pick a backup by timestamp alone. The copy is consistent with writes that
land while it runs, and it does not block the driver's write queue.

`vacuum()` and `checkpoint()` do take the write lock, so they queue behind the
driver's own writes and honour `busyRetry`. Run them when the application is
idle. `checkpoint()` rejects with code `DEEPBASE_SQLITE_NOT_WAL` on databases
opened with `pragma: 'none'`, which use a rollback journal and have no WAL.

Retention, rotation and scheduling stay in your application — the driver takes a
verified snapshot, nothing more.

### Nested Data Structure

Efficiently stores nested objects using a key-value schema:

- Keys are stored as dot-notation paths (e.g., `user.profile.name`)
- Values are stored as JSON
- Fast lookups for both exact keys and partial paths

Each row also stores a database-assigned `seq` so reads that rebuild objects use `ORDER BY seq, key`. That matches JavaScript insertion order for sibling keys and keeps `shift()` / `pop()` aligned with `JsonDriver`. For legacy databases, the driver only adds the missing column and index; it does not renumber existing rows. Historical ties remain deterministic through the `key` fallback order.

### Querying

`db.query(...path)` evaluates `where` / `orderBy` / `skip` / `take` / `select` in memory and never pushes filters into SQLite. Terminals (`toArray`, `first`, `count`, `any`) return records shaped `{ id, value }`, where `id` is the property name and `value` the stored value:

```javascript
const adults = await db.query('users').where('age', '>=', 18).orderBy('age').toArray();
// [{ id: 'alice', value: { name: 'Alice', age: 30 } }, ...]
```

#### Native pagination window

When the chain *starts* with `skip()`/`take()`, the driver answers that window from the key index and rebuilds only the records the window keeps, instead of materialising the whole collection. `first()` and `any()` use the same path because they are a single-record window.

```javascript
// Reads the key index plus 10 records, not the 20,000 records in the collection.
const page = await db.query('users').skip(100).take(10).toArray();

// Filters and ordering still run in memory, so a leading where()/orderBy()
// falls back to reading the collection.
const adults = await db.query('users').where('age', '>=', 18).take(10).toArray();
```

Two guards keep the native window cheaper than reading the collection, both configurable on the driver:

- `queryWindowMaxRecords` (default `1000`): how far `offset + limit` may reach before the driver reads the collection instead.
- `queryWindowMaxProbes` (default `12000`): how many key-index lookups the order guard may spend. The guard exists because stored keys escape `.` and `\` and expand records into `<key>.<field>` rows, so a plain key scan can disagree with the record order for ids such as `u1` and `u1!`; when it cannot prove the order, the driver falls back to the generic path.

Set either budget to `0` to always use the generic path. Measurements on 20,000 records (80,000 rows, 4 fields each): `first()` 71 ms → 0.04 ms, `take(10)` 71 ms → 0.14 ms, `skip(100).take(10)` 69 ms → 0.8 ms, `take(1000)` 70 ms → 13 ms.

### ACID Compliance

SQLite provides:

- **Atomicity**: All operations complete or none do
- **Consistency**: Data remains valid across transactions
- **Isolation**: Concurrent writes are serialized by SQLite
- **Durability**: Committed data persists even after crashes

## Pragma Modes

`SqliteDriver` ships with four configurable performance profiles via the `pragma` option:

| Mode | `synchronous` | `cache_size` | `mmap_size` | `WITHOUT ROWID` | Use case |
|------|--------------|-------------|-------------|-----------------|----------|
| **none** | — | — | — | No | Backward-compatible with databases created by older versions |
| **safe** | FULL | 2 MB | off | Yes | Durability first, WAL + full fsync |
| **balanced** *(default)* | NORMAL | 8 MB | 256 MB | Yes | Best mix of speed and safety for most apps |
| **fast** | OFF | 16 MB | 256 MB | Yes | Maximum throughput — data may be lost on OS crash |

All WAL modes use `journal_mode=WAL` and `temp_store=MEMORY`. Lock waiting is configured independently through `busyTimeoutMs` and therefore also applies to `pragma: 'none'`.

```javascript
// Backward-compatible (no PRAGMAs, no WITHOUT ROWID)
new SqliteDriver({ path: '/var/lib/myapp/data', name: 'mydb', pragma: 'none' })

// Maximum durability
new SqliteDriver({ path: '/var/lib/myapp/data', name: 'mydb', pragma: 'safe' })

// Recommended (default)
new SqliteDriver({ path: '/var/lib/myapp/data', name: 'mydb', pragma: 'balanced' })

// Maximum throughput
new SqliteDriver({ path: '/var/lib/myapp/data', name: 'mydb', pragma: 'fast' })
```

`SqliteFastDriver` is kept as a named alias for backward compatibility:

```javascript
import { SqliteFastDriver } from 'deepbase-sqlite';
// SqliteFastDriver === SqliteDriver (same class, same options)
```

## Database Structure

Data is stored in a simple key-value table:

```sql
CREATE TABLE deepbase (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  seq INTEGER NOT NULL
);

CREATE INDEX deepbase_seq_idx ON deepbase(seq);
```

Optimized PRAGMA profiles create `deepbase` `WITHOUT ROWID`.

Example data:

```
key                   | value    | seq
----------------------|----------|----
users.alice.name      | "Alice"  | 1
users.alice.age       | 30       | 2
users.bob.name        | "Bob"    | 3
users.bob.age         | 25       | 4
config.theme          | "dark"   | 5
config.lang           | "en"     | 6
```

## Use Cases

- **Production Apps**: Reliable embedded database for web/desktop apps
- **Medium Datasets**: Handles millions of records efficiently
- **Offline First**: Works without network or external database server
- **Desktop Apps**: Perfect for Electron or Tauri applications
- **Mobile Apps**: Lightweight database for React Native/Capacitor
- **IoT Devices**: Embedded storage for edge computing
- **Serverless**: Deploy with your functions, no external DB needed

## Performance

The numbers come from `benchmarks/benchmark-sqlite-compare.js`
(`npm run bench:sqlite-compare`): 1,000 sequential writes and reads, 100
updates and increments, 100 and 1,000 writes issued at once through
`Promise.all`, and 500 concurrent increments. Each cell is the median of 15
runs in separate processes, measured on 2026-11-13 on an Apple M4 Max with
Node.js 22.23 and Bun 1.4.4. The Linux columns ran in Docker (`node:22`, arm64)
on the same machine.

### 3.12 against the current driver, `balanced` profile (ops/sec)

The 3.12 columns are the previous `better-sqlite3` driver on Node.js. Bun
cannot load that version.

| Operation | macOS 3.12 | macOS Node.js | macOS Bun | Linux 3.12 | Linux Node.js | Linux Bun |
|---|---:|---:|---:|---:|---:|---:|
| Sequential write | 61.2k | 55.4k | 40.6k | 73.6k | 62.9k | 59.1k |
| Sequential read | 308k | 279k | 280k | 323k | 304k | 337k |
| Update | 66.5k | 59.5k | 44.1k | 68.7k | 65.4k | 79.0k |
| Increment | 81.5k | 74.9k | 88.1k | 110k | 105k | 140k |
| Batch write (100 at once) | 54.6k | 203k | 224k | 96.4k | 227k | 268k |
| Concurrent write (1,000 at once) | 58.7k | 219k | 274k | 63.5k | 214k | 314k |
| Concurrent increment (500 at once) | 88.7k | 199k | 257k | 66.2k | 194k | 310k |
| Mixed, 75% reads | 227k | 255k | 227k | 236k | 303k | 398k |
| Subtree read | 101k | 90.0k | 82.0k | 101k | 93.8k | 117k |
| Module load | 5.4 ms | 1.7 ms | 1.0 ms | 5.6 ms | 1.4 ms | 1.0 ms |

On Node.js, operations awaited one at a time run 5 to 15% slower than on 3.12.
Writes issued together share a transaction (see [Write batching](#write-batching))
and run 2 to 4 times faster.

Bun on Linux bundles its own SQLite and was the fastest setup here for every
operation except sequential writes. Bun on macOS links Apple's system SQLite,
which turns on `checkpoint_fullfsync`: each WAL checkpoint waits for a full
flush to disk, so sequential writes and updates run about 25% slower than on
Node.js. Concurrent writes hide most of that cost, since a batch pays for one
commit.

Two scenarios of the benchmark are left out of these tables: deep-path writes
and the session lifecycle. Both are short, and batching writes fewer WAL pages
earlier in the run, so the automatic checkpoint now lands inside them. With a
checkpoint forced before each one, they measure the same as on 3.12. On Linux,
the `none` and `safe` profiles are bound by `fsync` inside the Docker VM, so
they are not shown.

### Profiles (Node.js on macOS, ops/sec)

| Operation | none | safe | balanced | fast |
|---|---:|---:|---:|---:|
| Sequential write | 4.5k | 22.9k | 55.4k | 68.0k |
| Sequential read | 110k | 277k | 279k | 256k |
| Update | 4.7k | 21.0k | 59.5k | 62.1k |
| Increment | 5.0k | 21.3k | 74.9k | 73.2k |
| Batch write (100 at once) | 127k | 189k | 203k | 197k |
| Concurrent write (1,000 at once) | 212k | 223k | 219k | 216k |
| Concurrent increment (500 at once) | 171k | 211k | 199k | 200k |
| Mixed, 75% reads | 122k | 270k | 255k | 268k |

With batching, concurrent throughput barely depends on the profile, because one
commit (and one `fsync` in `safe`) covers the whole batch. In `safe`, concurrent
writes went from 25.5k ops/sec on 3.12 to 223k. All profiles kept 500
concurrent increments exact.

## Migration

Easy to migrate between SQLite and other drivers:

```javascript
import DeepBase from 'deepbase';
import SqliteDriver from 'deepbase-sqlite';
import MongoDriver from 'deepbase-mongodb';

const db = new DeepBase([
  new SqliteDriver({ path: '/var/lib/myapp/data' }),
  new MongoDriver({ url: 'mongodb://localhost:27017' })
]);

await db.connect();
await db.migrate(0, 1); // Migrate SQLite to MongoDB
```

## File Structure

Data is stored as SQLite database files:

```
data/
  mydb.db
  users.db
  config.db
```

## Comparison with JSON Driver

| Feature | SQLite | JSON |
|---------|--------|------|
| Performance | ⚡ Very Fast | 🐌 Slower for large data |
| File Size | 📦 Compact | 📄 Human readable |
| Transactions | ✅ ACID | ❌ No transactions |
| Query Speed | 🚀 Indexed | 🔍 Full scan |
| Reliability | 💪 Very High | ⚠️ File corruption risk |
| Debugging | 🔧 SQL tools | 👁️ Easy to inspect |

## Best Practices

### Use Transactions for Bulk Operations

```javascript
// Better: Use root object set for bulk inserts
const data = {
  user1: { name: 'Alice' },
  user2: { name: 'Bob' },
  user3: { name: 'Charlie' }
};
await db.set('users', data);
```

### Disconnect Properly

```javascript
// Always disconnect to close database connection
await db.disconnect();
```

### Use Appropriate Paths

```javascript
// Good: Organize data hierarchically
await db.set('users', userId, 'profile', data);

// Avoid: Flat structure loses benefits of nesting
await db.set(`user_${userId}_profile`, data);
```

## Troubleshooting

### `database is locked` (`errcode` 5, `SQLITE_BUSY`)

The driver waits and retries complete transactions when another connection owns the write lock. If the retry budget is exhausted:

1. Confirm every process points to the same local filesystem, not NFS.
2. Look for long-running migrations, raw SQLite connections, SQLite tools, or overlapping deployments.
3. Increase `busyTimeoutMs` or `busyRetry.maxAttempts` only for known transient contention.
4. Move to a client-server database if write contention is sustained.

`node:sqlite` is synchronous. Each native lock wait blocks that JavaScript thread for up to `busyTimeoutMs`; the backoff between attempts is asynchronous.

## License

MIT - Copyright (c) Martin Clasen
