# deepbase-sqlite

SQLite driver for DeepBase.

## Installation

```bash
npm install deepbase deepbase-sqlite --ignore-scripts=false
```

> `deepbase-sqlite` depends on `better-sqlite3`, a native module. Its install
> script downloads a prebuilt binary (or compiles from source as a fallback).
> If your environment disables npm lifecycle scripts, see
> [Troubleshooting](#troubleshooting) below.

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
  nidAlphabet: 'ABC...',      // Alphabet for ID generation
  nidLength: 10               // Length of generated IDs
})
```

## Features

### High Performance

Uses `better-sqlite3` for synchronous operations wrapped in async API:

- Prepared statements for optimal performance
- Transaction support for batch operations
- Fast lookups with indexed keys

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

The driver owns the `better-sqlite3` connection and exposes maintenance through
its own API, so a backup or vacuum job needs no `better-sqlite3` entry in your
own `package.json`. That keeps a single native binding in the tree and removes
any chance of a version mismatch between your copy and the driver's.

```javascript
const driver = db.getDriver(0);

const status = await driver.checkIntegrity();     // 'ok', or what SQLite found
await driver.backup('./backups/mydb-2026-07-28.db');
await driver.vacuum();
await driver.checkpoint('TRUNCATE');
```

| Method | Behaviour |
|--------|-----------|
| `checkIntegrity()` | Read-only `PRAGMA integrity_check`; returns its status verbatim. |
| `backup(destination)` | Read-only source, online copy, verified before it resolves. Returns `destination`. |
| `vacuum()` | Rebuilds the file to reclaim free pages. |
| `checkpoint(mode)` | `PASSIVE` (default), `FULL`, `RESTART` or `TRUNCATE`. Returns `{ busy, log, checkpointed }`. |

`checkIntegrity()` and `backup()` open a temporary read-only connection with
`fileMustExist: true`, then close it. They never create, migrate, or change
PRAGMAs on the source database; a missing or mistyped source path fails instead
of producing an empty database. `backup()` creates destination parent
directories only after opening the source, then reopens the result read-only and
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

SQLite offers excellent performance:

- Fast reads and writes with prepared statements
- Efficient indexing for quick lookups
- Transaction batching for bulk operations
- Low memory footprint

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

## Benchmark — pragma modes

Median of 3 runs, 1 000 iterations per operation. `balanced` vs `none`:

```
Operation                  none    safe    balanced    fast   Bal vs None
─────────────────────────────────────────────────────────────────────────
Sequential Write          4,525  17,296     84,701  98,238      +1772%
Sequential Read          20,705  22,871     23,405  23,040        +13%
Update                    2,689  10,666     17,764  18,857       +561%
Increment                 4,291  14,129     25,734  26,364       +500%
Delete                    3,806  12,010     20,884  21,074       +449%
Batch Write               3,813  17,763     87,209  83,045      +2187%
Concurrent Write          4,449  22,196     72,613 102,458      +1532%
Deep Write (5-lvl)        4,311  26,740     53,957  91,312      +1152%
Obj Expansion             1,997     365     34,633  47,318      +1634%
Session Lifecycle           572   2,465      3,700   3,792       +546%
```

Disk usage is **29 % smaller** after compaction compared to `none`. All correctness checks pass on every mode.

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

### `SQLITE_BUSY` / `database is locked`

The driver waits and retries complete transactions when another connection owns the write lock. If the retry budget is exhausted:

1. Confirm every process points to the same local filesystem, not NFS.
2. Look for long-running migrations, raw `better-sqlite3` connections, SQLite tools, or overlapping deployments.
3. Increase `busyTimeoutMs` or `busyRetry.maxAttempts` only for known transient contention.
4. Move to a client-server database if write contention is sustained.

`better-sqlite3` is synchronous. Each native lock wait blocks that Node.js thread for up to `busyTimeoutMs`; the JavaScript backoff between attempts is asynchronous.

### `Could not locate the bindings file` / `better_sqlite3.node` missing

This error means `better-sqlite3`'s native binding was never fetched or built.
It almost always comes from npm install scripts being disabled, which prevents
`better-sqlite3`'s `install` script from downloading the prebuilt binary.

Check whether scripts are disabled:

```bash
npm config get ignore-scripts   # should be "false"
cat ~/.npmrc 2>/dev/null        # look for `ignore-scripts=true`
cat .npmrc 2>/dev/null
```

Fix — rebuild the native binding in the project that uses `deepbase-sqlite`:

```bash
npm rebuild better-sqlite3 --ignore-scripts=false
```

If `npm rebuild` still doesn't fetch a prebuild (common when `ignore-scripts`
is persisted in `.npmrc`), do a clean reinstall of just that package:

```bash
rm -rf node_modules/better-sqlite3
npm i --ignore-scripts=false
```

Verify the binding landed:

```bash
ls node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

Notes:

- `npm i <pkg> --ignore-scripts=false` only runs scripts if the install
  actually changes `node_modules`. When npm reports `up to date`, no install
  scripts run — use `npm rebuild` or remove the package folder first.
- In monorepos or CI, prefer setting `ignore-scripts=false` for the install
  step rather than passing it as a one-off flag.
- When this happens at runtime, `deepbase-sqlite` will throw an error with
  code `DEEPBASE_SQLITE_BINDING_MISSING` and a pointer back to this section.

## License

MIT - Copyright (c) Martin Clasen
