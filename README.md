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
npm install deepbase
# deepbase automatically includes deepbase-json
```

```javascript
import DeepBase from 'deepbase';

// Option 1: Backward-compatible syntax (uses JSON driver by default)
const db = new DeepBase({ path: './data', name: 'mydb' });
await db.connect();

// Option 2: Explicit JSON driver
import { JsonDriver } from 'deepbase';
const db = new DeepBase(new JsonDriver({ path: './data', name: 'mydb' }));
await db.connect();

await db.set('users', 'alice', { name: 'Alice', age: 30 });
const alice = await db.get('users', 'alice');
console.log(alice); // { name: 'Alice', age: 30 }
```

### Multi-Driver Setup (MongoDB + JSON Backup)

```bash
npm install deepbase deepbase-mongodb
```

```javascript
import DeepBase, { JsonDriver } from 'deepbase';
import MongoDriver from 'deepbase-mongodb';

const db = new DeepBase([
  new MongoDriver({ url: 'mongodb://localhost:27017' }),
  new JsonDriver({ path: './backup' })
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
  new JsonDriver({ path: './data', name: 'mydb' }), // Source (index 0)
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
  new JsonDriver({ path: './persistence' }),              // Backup
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

See [`examples/08-concurrency-safe.js`](./examples/08-concurrency-safe.js) for detailed examples and [`RACE_CONDITION_FIX.md`](./RACE_CONDITION_FIX.md) for technical details.

## 🎯 Available Drivers

### JSON Driver (`@deepbase/json`)

Filesystem-based JSON storage. Perfect for:
- Development and testing
- Small to medium datasets
- Human-readable data
- No external dependencies

```javascript
new JsonDriver({
  path: './data',           // Storage directory
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
  path: './data',          // Storage directory
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
import DeepBase, { JsonDriver } from 'deepbase';

const db = new DeepBase(new JsonDriver({ 
  path: './data',
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
import DeepBase, { JsonDriver } from 'deepbase';

const db = new DeepBase(new JsonDriver({
  path: './data',
  name: 'mydb',
  stringify: (obj) => CircularJSON.stringify(obj, null, 4),
  parse: CircularJSON.parse
}));

await db.connect();

await db.set("a", "b", { circular: {} });
await db.set("a", "b", "circular", "self", await db.get("a", "b"));
```

## 🔒 Secure Storage with Encryption

You can create encrypted storage by extending DeepBase with custom serialization:

```javascript
import CryptoJS from 'crypto-js';
import DeepBase, { JsonDriver } from 'deepbase';

class DeepbaseSecure extends DeepBase {
  constructor(opts) {
    const encryptionKey = opts.encryptionKey;
    delete opts.encryptionKey;

    // Create JSON driver with encryption
    const driver = new JsonDriver({
      ...opts,
      stringify: (obj) => {
        const iv = CryptoJS.lib.WordArray.random(128 / 8);
        const encrypted = CryptoJS.AES.encrypt(
          JSON.stringify(obj), 
          encryptionKey, 
          { iv }
        );
        return iv.toString(CryptoJS.enc.Hex) + ':' + encrypted.toString();
      },
      parse: (encryptedData) => {
        const [ivHex, encrypted] = encryptedData.split(':');
        const iv = CryptoJS.enc.Hex.parse(ivHex);
        const bytes = CryptoJS.AES.decrypt(encrypted, encryptionKey, { iv });
        return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
      }
    });

    super(driver);
  }
}

// Create an encrypted database
const secureDB = new DeepbaseSecure({
  path: './data',
  name: 'secure_db',
  encryptionKey: 'your-secret-key-here'
});

await secureDB.connect();

// Use it like a regular DeepBase instance
await secureDB.set("users", "admin", { password: "secret123" });
const admin = await secureDB.get("users", "admin");
console.log(admin); // { password: 'secret123' }

// But the file on disk is encrypted!
```

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

DeepBase v3.0 delivers exceptional performance:

- ⚡ **Redis**: 6,000-7,700 ops/sec for most operations
- 📁 **JSON**: 600,000+ ops/sec for cached reads
- 🍃 **MongoDB**: 1,600-2,900 ops/sec balanced performance

See [Benchmark Results](./BENCHMARK_RESULTS.md) for detailed performance analysis.

For more information, visit [GitHub](https://github.com/clasen/DeepBase)

