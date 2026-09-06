# 🌳 DeepBase v3.0

**The ultimate multi-driver persistence system for Node.js**

DeepBase is a powerful, flexible database abstraction that lets you use multiple storage backends with a single, intuitive API. Write once, persist everywhere.

## ✨ What's New in v3.0

- 🔌 **Driver-based architecture**: Plug and play different storage backends
- 🔄 **Multi-driver support**: Use multiple backends simultaneously with priority fallback
- 📦 **Modular packages**: Install only what you need
- 🚀 **Built-in migration**: Easy data migration between drivers
- 🛡️ **Automatic fallback**: System continues working even if primary driver fails
- 🌍 **Cross-platform**: Works on Node.js, Bun, Deno (with appropriate drivers)
- 🔒 **Concurrency-safe**: Race condition protection for all concurrent operations
- ⏱️ **Timeout support**: Configurable timeouts to prevent hanging operations

## 📦 Packages

DeepBase v3.0 is split into modular packages:

- **`deepbase`** - Core library (includes `deepbase-json` as dependency)
- **`deepbase-json`** - JSON filesystem driver (no external DB dependencies!)
- **`deepbase-sqlite`** - SQLite driver (embedded database, ACID compliant)
- **`deepbase-mongodb`** - MongoDB driver
- **`deepbase-redis`** - Redis driver (vanilla, works with any Redis)
- **`deepbase-redis-json`** - Redis Stack driver (requires RedisJSON module)

## 🚀 Quick Start

### Simple JSON Driver

```bash
npm install deepbase deepbase-json
```

```javascript
import DeepBase from 'deepbase';
import { resolvePath } from 'deepbase/path';

const dataPath = resolvePath(import.meta.url, './data');

// Option 1: Backward-compatible syntax (uses JSON driver by default)
const db = new DeepBase({ path: dataPath, name: 'mydb' });
await db.connect();

// Option 2: Explicit JSON driver
import { JsonDriver } from 'deepbase-json';
const explicitDb = new DeepBase(new JsonDriver({ path: dataPath, name: 'mydb' }));
await explicitDb.connect();

await db.set('users', 'alice', { name: 'Alice', age: 30 });
const alice = await db.get('users', 'alice');
console.log(alice); // { name: 'Alice', age: 30 }
```

`path` is required and must be absolute. `resolvePath()` anchors a relative
path to your application module instead of `process.cwd()` or the installed
package location.

### Multi-Driver Setup (MongoDB + JSON Backup)

```bash
npm install deepbase deepbase-json deepbase-mongodb
```

```javascript
import DeepBase from 'deepbase';
import { JsonDriver } from 'deepbase-json';
import MongoDriver from 'deepbase-mongodb';

const db = new DeepBase([
  new MongoDriver({ url: 'mongodb://localhost:27017' }),
  new JsonDriver({ path: '/var/lib/myapp/backup' })
], {
  writeAll: true,           // Write to all drivers
  readFirst: true,          // Read from first available
  failOnPrimaryError: false // Continue if primary fails
});

await db.connect();

// Writes to both MongoDB and JSON
await db.set('config', 'version', '1.0.0');

// Reads from MongoDB (or JSON if MongoDB is down)
const version = await db.get('config', 'version');
```

## 🔥 Core Features

### Set and Get Nested Data

```javascript
await db.set('config', 'theme', 'dark');
await db.set('config', 'lang', 'en');

const theme = await db.get('config', 'theme'); // 'dark'
const config = await db.get('config'); // { theme: 'dark', lang: 'en' }
```

### Add Items with Auto-Generated IDs

```javascript
const userPath = await db.add('users', { name: 'Bob', email: 'bob@example.com' });
// userPath: ['users', 'aB3xK9mL2n']

const user = await db.get(...userPath);
// { name: 'Bob', email: 'bob@example.com' }
```

### Increment and Decrement

```javascript
await db.set('stats', 'views', 100);
await db.inc('stats', 'views', 50);  // 150
await db.dec('stats', 'views', 30);  // 120
```

### Update with Functions

```javascript
await db.set('user', 'name', 'alice');
await db.upd('user', 'name', name => name.toUpperCase());
const name = await db.get('user', 'name'); // 'ALICE'
```

### Keys, Values, Entries

```javascript
await db.set('products', 'laptop', { price: 999 });
await db.set('products', 'mouse', { price: 29 });

const keys = await db.keys('products');     // ['laptop', 'mouse']
const values = await db.values('products'); // [{ price: 999 }, { price: 29 }]
const entries = await db.entries('products'); // [['laptop', {...}], ['mouse', {...}]]
```

## 🔄 Migration Between Drivers

One of the most powerful features is built-in data migration:

```javascript
import DeepBase from '@deepbase/core';
import JsonDriver from '@deepbase/json';
import MongoDriver from '@deepbase/mongodb';

// Setup with both drivers
const db = new DeepBase([
  new JsonDriver({ path: '/var/lib/myapp/data', name: 'mydb' }), // Source (index 0)
  new MongoDriver({ url: 'mongodb://localhost:27017' }) // Target (index 1)
]);

await db.connect();

// Migrate all data from JSON (0) to MongoDB (1)
const result = await db.migrate(0, 1, {
  clear: true,      // Clear target before migration
  batchSize: 100,   // Progress callback every 100 items
  onProgress: (progress) => {
    console.log(`Migrated ${progress.migrated} items`);
  }
});

console.log(`Migration complete: ${result.migrated} items, ${result.errors} errors`);
```

### Sync All Drivers

```javascript
// Copy data from primary (index 0) to all other drivers
await db.syncAll();
```

## 🏗️ Advanced: Three-Tier Architecture

For maximum reliability, use multiple backends with priority:

```javascript
import DeepBase from '@deepbase/core';
import MongoDriver from '@deepbase/mongodb';
import JsonDriver from '@deepbase/json';
import RedisDriver from '@deepbase/redis';

const db = new DeepBase([
  new MongoDriver({ url: 'mongodb://localhost:27017' }),  // Primary
  new JsonDriver({ path: '/var/lib/myapp/persistence' }),              // Backup
  new RedisDriver({ url: 'redis://localhost:6379' })      // Cache
], {
  writeAll: true,           // Replicate writes to all three
  readFirst: true,          // Read from first available
  failOnPrimaryError: false // Graceful degradation
});

await db.connect();

// Writes to all three backends
await db.set('users', 'john', { name: 'John' });

// If MongoDB fails, reads from JSON
// If both fail, reads from Redis
const user = await db.get('users', 'john');
```

**Benefits:**
- ✅ Automatic failover if any backend goes down
- ✅ Data replication across all backends
- ✅ Zero downtime during migrations
- ✅ Easy recovery from failures

## 📖 API Reference

### DeepBase Constructor

```javascript
new DeepBase(drivers, options)
```

**Parameters:**
- `drivers`: Single driver or array of drivers (in priority order)
- `options`:
  - `writeAll` (default: `true`): Write to all drivers
  - `readFirst` (default: `true`): Read from first available driver
  - `failOnPrimaryError` (default: `true`): Throw if primary driver fails
  - `lazyConnect` (default: `true`): Auto-connect on first operation
  - `timeout` (default: `0`): Global timeout in ms (0 = disabled)
  - `readTimeout` (default: `timeout`): Timeout for read operations in ms
  - `writeTimeout` (default: `timeout`): Timeout for write operations in ms
  - `connectTimeout` (default: `timeout`): Timeout for connection in ms

### Core Methods

- `await db.connect()` - Connect all drivers
- `await db.disconnect()` - Disconnect all drivers
- `await db.get(...path)` - Get value at path
- `await db.set(...path, value)` - Set value at path
- `await db.del(...path)` - Delete value at path
- `await db.inc(...path, amount)` - Increment numeric value
- `await db.dec(...path, amount)` - Decrement numeric value
- `await db.add(...path, value)` - Add item with auto-generated ID
- `await db.upd(...path, fn)` - Update value with function
- `await db.keys(...path)` - Get keys at path
- `await db.first(...path)` - Get first key at path (same order as `keys()`)
- `await db.last(...path)` - Get last key at path (same order as `keys()`)
- `await db.values(...path)` - Get values at path
- `await db.entries(...path)` - Get entries at path

### Migration Methods

- `await db.migrate(fromIndex, toIndex, options)` - Migrate data between drivers
- `await db.syncAll(options)` - Sync primary to all other drivers
- `db.getDriver(index)` - Get driver by index
- `db.getDrivers()` - Get all drivers

## 🔒 Concurrency Safety

DeepBase v3.0+ provides **built-in race condition protection** for all drivers:

### Protected Operations
- ✅ `inc()` / `dec()` - Atomic increment/decrement
- ✅ `upd()` - Atomic read-modify-write
- ✅ `set()` - Safe concurrent writes
- ✅ `add()` - Unique ID generation without collisions

### How it Works

**SQLite Driver**: Uses native SQLite transactions for atomic operations
```javascript
// 100 concurrent increments = exactly 100 (no race conditions)
await Promise.all(
  Array.from({ length: 100 }, () => db.inc('counter', 1))
);
```

**JSON Driver**: Uses operation queue to serialize writes
```javascript
// Concurrent updates are safe - no data loss
await Promise.all([
  db.upd('account', acc => ({ ...acc, balance: acc.balance + 50 })),
  db.upd('account', acc => ({ ...acc, lastAccess: Date.now() }))
]);
```

See [`examples/08-concurrency-safe.js`](./examples/08-concurrency-safe.js) for detailed examples.

## ⏱️ Timeout Configuration

Prevent operations from hanging indefinitely with configurable timeouts:

```javascript
import DeepBase from 'deepbase';
import { JsonDriver } from 'deepbase-json';

// Global timeout for all operations
const db = new DeepBase(new JsonDriver({ path: '/var/lib/myapp/data' }), {
  timeout: 5000  // 5 seconds for all operations
});

// Different timeouts for reads and writes
const db2 = new DeepBase([
  new RedisDriver({ url: 'redis://slow-server:6379' }),
  new JsonDriver({ path: '/var/lib/myapp/backup' }) // Fallback if Redis times out
], {
  readTimeout: 2000,   // 2 seconds for reads (get, keys, values, entries)
  writeTimeout: 5000,  // 5 seconds for writes (set, del, inc, dec, add, upd)
  connectTimeout: 10000 // 10 seconds for connection
});

try {
  const value = await db.get('some', 'key');
} catch (error) {
  // Error: get() timed out after 2000ms
  console.error(error.message);
}
```

**Timeout Options:**
- `timeout` (default: `0`): Global timeout in milliseconds for all operations (0 = disabled)
- `readTimeout` (default: `timeout`): Timeout for read operations
- `writeTimeout` (default: `timeout`): Timeout for write operations  
- `connectTimeout` (default: `timeout`): Timeout for connection operation

**Use Cases:**
- 🛡️ **Network issues**: Prevent hanging on slow/unresponsive database servers
- 🔄 **Fast failover**: Combined with multi-driver setup for automatic fallback
- ⚡ **Performance SLAs**: Enforce response time requirements
- 🐛 **Debugging**: Identify slow operations during development

See [`examples/09-timeout.js`](./examples/09-timeout.js) for examples and [`TIMEOUT_FEATURE.md`](./TIMEOUT_FEATURE.md) for detailed documentation.

## 🎯 Available Drivers

### JSON Driver (`@deepbase/json`)

Filesystem-based JSON storage. Perfect for:
- Development and testing
- Small to medium datasets
- Human-readable data
- No external dependencies

```javascript
new JsonDriver({
  path: '/var/lib/myapp/data', // Required absolute storage directory
  name: 'mydb',            // Filename (mydb.json)
  stringify: JSON.stringify, // Custom serializer
  parse: JSON.parse        // Custom parser
})
```

### SQLite Driver (`@deepbase/sqlite`)

SQLite embedded database. Perfect for:
- Production applications
- Medium to large datasets
- Offline-first apps
- Desktop applications (Electron/Tauri)
- Serverless deployments
- ACID compliance required

```javascript
new SqliteDriver({
  path: '/var/lib/myapp/data', // Required absolute storage directory
  name: 'mydb'            // Database filename (mydb.db)
})
```

No external dependencies required - embedded database!

### MongoDB Driver (`@deepbase/mongodb`)

MongoDB storage. Perfect for:
- Production applications
- Large datasets
- Complex queries
- Scalability

```javascript
new MongoDriver({
  url: 'mongodb://localhost:27017',
  database: 'myapp',       // Database name
  collection: 'documents'  // Collection name
})
```

Requires MongoDB:
```bash
docker run -d -p 27017:27017 mongodb/mongodb-community-server:latest
```

### Redis Driver (`@deepbase/redis`)

Vanilla Redis storage (no modules required). Perfect for:
- Caching
- Session storage
- High-performance reads/writes
- Works with any Redis installation

```javascript
new RedisDriver({
  url: 'redis://localhost:6379',
  prefix: 'myapp'          // Key prefix
})
```

Requires standard Redis:
```bash
docker run -d -p 6379:6379 redis:latest
```

**Note:** Uses JSON serialization. For atomic JSON operations, use `deepbase-redis-json` instead.

### Redis-JSON Driver (`@deepbase/redis-json`)

Redis Stack storage with RedisJSON module. Perfect for:
- Caching with large nested objects
- High-performance reads/writes
- Atomic JSON path operations
- Real-time applications

```javascript
import RedisDriver from 'deepbase-redis-json';

new RedisDriver({
  url: 'redis://localhost:6379',
  prefix: 'myapp'          // Key prefix
})
```

Requires Redis Stack (includes RedisJSON):
```bash
docker run -d -p 6379:6379 redis/redis-stack-server:latest
```

**Benefits over vanilla Redis driver:**
- Atomic JSON path operations
- More efficient for partial updates
- Native JSON.NUMINCRBY for atomic increments

## 🧪 Custom JSON Serialization

DeepBase supports custom JSON serialization in the JSON driver, allowing for circular references and complex data structures.

### Example with `flatted`:

```javascript
import { parse, stringify } from 'flatted';
import DeepBase from 'deepbase';
import { JsonDriver } from 'deepbase-json';

const db = new DeepBase(new JsonDriver({ 
  path: '/var/lib/myapp/data',
  name: 'mydb',
  stringify, 
  parse 
}));

await db.connect();

// Now you can store circular references
const obj = { name: 'circular' };
obj.self = obj; // circular reference
await db.set('circular', obj);
```

### Example with `CircularJSON`:

```javascript
const CircularJSON = require('circular-json');
import DeepBase from 'deepbase';
import { JsonDriver } from 'deepbase-json';

const db = new DeepBase(new JsonDriver({
  path: '/var/lib/myapp/data',
  name: 'mydb',
  stringify: (obj) => CircularJSON.stringify(obj, null, 4),
  parse: CircularJSON.parse
}));

await db.connect();

await db.set("a", "b", { circular: {} });
await db.set("a", "b", "circular", "self", await db.get("a", "b"));
```

## 🔒 Secure Storage with Encryption

Use the built-in plugin to encrypt every value with AES-256-GCM before it
reaches the driver. With `JsonDriver`, values stay encrypted both on disk and
in its internal memory cache; no custom serialization or memory hooks are needed.

```javascript
import DeepBase from 'deepbase';
import { encryptedValues } from 'deepbase/plugins/encryption';
import { JsonDriver } from 'deepbase-json';

const encodedKey = process.env.DEEPBASE_ENCRYPTION_KEY;
if (!encodedKey) {
  throw new Error('DEEPBASE_ENCRYPTION_KEY is required');
}

const encryptionKey = Buffer.from(encodedKey, 'base64');
const encryption = encryptedValues({
  activeKeyId: 'primary',
  keys: { primary: encryptionKey }
});

const driver = new JsonDriver({
  path: '/var/lib/myapp/data',
  name: 'secure_db'
});
const secureDB = new DeepBase(driver).use(encryption);

try {
  await secureDB.set('config', {
    service: 'my-app',
    accessToken: 'example-token',
    retries: 0
  });

  await secureDB.inc('config', 'retries', 1);
  const config = await secureDB.get('config'); // Decrypted for the application
} finally {
  await secureDB.dispose({ clearMemory: true, releaseInstance: true });
  encryptionKey.fill(0);
}
```

Provide a base64-encoded, randomly generated 32-byte key through your
application's secret manager or environment. The application reads it explicitly;
the plugin requires a 32-byte `Buffer` or `Uint8Array` and never supplies a
default key. Keep the key available under the same `keyId` to reopen the database.

Object keys, array lengths, and empty containers remain visible. Plaintext
exists while your application supplies or reads values, including inside
`upd()` callbacks; the plugin does not cache decrypted values. Disposal clears
the JSON driver's cache and the plugin's internal key copies.

Authentication failures, malformed envelopes, and unknown key IDs throw.
Existing plaintext data is encrypted when rewritten through the plugin;
registering it does not migrate existing data automatically.

See the [encryption plugin documentation](../core/docs/plugins/encryption.md)
for additional keys and key rotation.

## 🛠️ Creating Custom Drivers

Extend `DeepBaseDriver` to create your own drivers:

```javascript
import { DeepBaseDriver } from '@deepbase/core';

class MyCustomDriver extends DeepBaseDriver {
  async connect() { /* ... */ }
  async disconnect() { /* ... */ }
  async get(...args) { /* ... */ }
  async set(...args) { /* ... */ }
  async del(...args) { /* ... */ }
  async inc(...args) { /* ... */ }
  async dec(...args) { /* ... */ }
  async add(...args) { /* ... */ }
  async upd(...args) { /* ... */ }
}
```

## 📚 Examples

Check the `/examples` folder for complete examples:

1. **Simple JSON** - Basic single-driver usage
2. **Multi-Driver** - MongoDB with JSON backup
3. **Migration** - Moving data from JSON to MongoDB
4. **Three-Tier** - Full production-ready setup

## 🤔 Why DeepBase?

- ⚡ **Simple API**: Intuitive nested object operations
- 🔌 **Flexible**: Use any storage backend
- 🛡️ **Resilient**: Automatic failover and recovery
- 📦 **Modular**: Install only what you need
- 🚀 **Fast**: Optimized for performance
- 🌍 **Universal**: Works across platforms
- 💪 **Production-ready**: Battle-tested patterns

## 🤝 Contributing

Contributions are welcome! Whether it's:
- 🐛 Bug reports
- 💡 Feature requests
- 📖 Documentation improvements
- 🔌 New drivers

## 📄 License

MIT License - Copyright (c) Martin Clasen

---

🚀 **Try DeepBase today and simplify your data persistence!**

## 📊 Performance

DeepBase v3.8.4 local benchmark medians (three runs on 2026-08-06,
1,000 sequential writes and reads per run):

- 📁 **JSON**: ~597,000 cached reads/sec and ~1,500 persisted writes/sec
- 🗃️ **SQLite** (`balanced`): ~236,000 reads/sec and ~49,100 writes/sec
- 🏗️ **Drizzle + SQLite** (`balanced`): ~23,700 reads/sec and ~10,800 writes/sec

MongoDB and Redis were not available in this measurement environment, so their
older results are not presented as current. See the
[Benchmark Results](https://github.com/clasen/DeepBase/blob/main/BENCHMARK_RESULTS.md)
for the full methodology, detailed operations, environment, and reproduction
commands. Results vary by hardware, dataset, durability settings, and workload.

For more information, visit [GitHub](https://github.com/clasen/DeepBase)
