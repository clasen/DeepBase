# deepbase

DeepBase - Multi-driver persistence system with JSON driver included.

## Installation

```bash
npm install deepbase
# Automatically includes deepbase-json as dependency
```

> **AI Skill**: You can also add DeepBase as a skill for AI agentic development:
> ```bash
> npx skills add https://github.com/clasen/DeepBase --skill deepbase
> ```

## What is DeepBase?

DeepBase is a powerful database abstraction that orchestrates multiple storage drivers. It includes:

- **JSON driver included**: `deepbase-json` comes as a dependency for filesystem storage
- **Multi-driver management**: Use multiple storage backends simultaneously
- **Automatic fallback**: Read from first available driver
- **Replication**: Write to all drivers or just primary
- **Migration**: Built-in data migration between drivers
- **Driver interface**: Base class for creating custom drivers

## Quick Start

### Simple Usage (JSON Driver - Built-in!)

```javascript
import DeepBase from 'deepbase';

// Backward-compatible syntax - uses JSON driver by default
const db = new DeepBase({ path: './data', name: 'mydb' });
await db.connect();

await db.set('users', 'alice', { name: 'Alice' });
const alice = await db.get('users', 'alice');
```

### Explicit Driver Usage

```javascript
import DeepBase, { JsonDriver } from 'deepbase';

const db = new DeepBase(new JsonDriver({ path: './data' }));
await db.connect();

await db.set('users', 'alice', { name: 'Alice' });
const alice = await db.get('users', 'alice');
```

## Additional Drivers

The JSON driver (`deepbase-json`) is included automatically. Install additional drivers as needed:

- [`deepbase-sqlite`](https://www.npmjs.com/package/deepbase-sqlite) - SQLite embedded database
- [`deepbase-mongodb`](https://www.npmjs.com/package/deepbase-mongodb) - MongoDB storage
- [`deepbase-redis`](https://www.npmjs.com/package/deepbase-redis) - Redis Stack storage
- [`deepbase-indexeddb`](https://www.npmjs.com/package/deepbase-indexeddb) - IndexedDB for browser environments

### Multi-Driver Example

```javascript
import DeepBase, { JsonDriver } from 'deepbase';
import MongoDriver from 'deepbase-mongodb';

const db = new DeepBase([
  new MongoDriver({ url: 'mongodb://localhost:27017' }),
  new JsonDriver({ path: './backup' })
], {
  writeAll: true,           // Write to both drivers
  readFirst: true,          // Read from first available
  failOnPrimaryError: false // Continue if MongoDB fails
});

await db.connect();
```

## Timeout Configuration

Prevent operations from hanging indefinitely with configurable timeouts:

```javascript
import DeepBase, { JsonDriver } from 'deepbase';

// Global timeout for all operations
const db = new DeepBase(new JsonDriver(), {
  timeout: 5000  // 5 seconds
});

// Different timeouts for reads and writes
const db2 = new DeepBase(new JsonDriver(), {
  readTimeout: 3000,   // 3 seconds for reads
  writeTimeout: 10000  // 10 seconds for writes
});

// All operations will timeout if they exceed the limit
try {
  await db.get('some', 'key');
} catch (error) {
  // Error: get() timed out after 5000ms
  console.error(error.message);
}
```

**Timeout Options:**
- `timeout`: Global timeout for all operations (default: `0` = disabled)
- `readTimeout`: Timeout for `get`, `keys`, `values`, `entries` (default: `timeout`)
- `writeTimeout`: Timeout for `set`, `del`, `inc`, `dec`, `add`, `upd` (default: `timeout`)
- `connectTimeout`: Timeout for connection operation (default: `timeout`)

See [TIMEOUT_FEATURE.md](https://github.com/clasen/DeepBase/blob/main/TIMEOUT_FEATURE.md) for detailed documentation.

## API

### Constructor

```javascript
new DeepBase(drivers, options)
```

**Parameters:**
- `drivers`: Single driver or array of drivers
- `options`:
  - `writeAll` (default: `true`): Write to all drivers
  - `readFirst` (default: `true`): Read from first available
  - `failOnPrimaryError` (default: `true`): Throw on primary failure
  - `lazyConnect` (default: `true`): Auto-connect on first operation
  - `timeout` (default: `0`): Global timeout in ms (0 = disabled)
  - `readTimeout` (default: `timeout`): Timeout for read operations in ms
  - `writeTimeout` (default: `timeout`): Timeout for write operations in ms
  - `connectTimeout` (default: `timeout`): Timeout for connection in ms

### Methods

#### Connection
- `await db.connect()` - Connect all drivers
- `await db.disconnect()` - Disconnect all drivers

#### Data Operations
- `await db.get(...path)` - Get value at path
- `await db.set(...path, value)` - Set value at path
- `await db.del(...path)` - Delete value at path
- `await db.inc(...path, amount)` - Increment value
- `await db.dec(...path, amount)` - Decrement value
- `await db.add(...path, value)` - Add with auto-generated ID (consistent across all drivers)
- `await db.upd(...path, fn)` - Update with function

#### Queue / Stack Operations
- `await db.pop(...path)` - Remove and return the last item
- `await db.shift(...path)` - Remove and return the first item
- `await db.len(...path)` - Count the number of keys at path

#### Query Operations
- `await db.keys(...path)` - Get keys at path
- `await db.values(...path)` - Get values at path
- `await db.entries(...path)` - Get entries at path

#### Migration
- `await db.migrate(fromIndex, toIndex, options)` - Migrate data
- `await db.syncAll(options)` - Sync primary to all others

#### Driver Management
- `db.getDriver(index)` - Get specific driver
- `db.getDrivers()` - Get all drivers

## Queue & Stack

Use `add` + `shift` as a **FIFO queue**, or `add` + `pop` as a **LIFO stack**:

```javascript
// FIFO Queue
await db.add('jobs', { task: 'send-email', to: 'alice@example.com' });
await db.add('jobs', { task: 'resize-image', file: 'photo.jpg' });
await db.add('jobs', { task: 'notify', channel: '#general' });

const next = await db.shift('jobs'); // { task: 'send-email', ... }
await db.len('jobs'); // 2

// LIFO Stack
await db.add('undo', { action: 'delete', id: 42 });
await db.add('undo', { action: 'edit', id: 7 });

const last = await db.pop('undo'); // { action: 'edit', id: 7 }
```

In multi-driver mode, `add` generates a single ID shared across all drivers, so `pop` and `shift` stay consistent regardless of the number of backends.

## Creating Custom Drivers

Extend the `DeepBaseDriver` class:

```javascript
import { DeepBaseDriver } from '@deepbase/core';

class MyDriver extends DeepBaseDriver {
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

## 🔐 Extending DeepBase with Encryption

DeepBase supports custom `stringify`/`parse` functions in its `JsonDriver`, making it easy to add transparent AES encryption:

```javascript
import CryptoJS from 'crypto-js';
import DeepBase from 'deepbase';
import { JsonDriver } from 'deepbase-json';

class DeepbaseSecure extends DeepBase {
    constructor(opts) {
        const encryptionKey = opts.encryptionKey;
        delete opts.encryptionKey;

        const driver = new JsonDriver({
            ...opts,
            stringify: (obj) => {
                const iv = CryptoJS.lib.WordArray.random(128 / 8);
                const encrypted = CryptoJS.AES.encrypt(JSON.stringify(obj), encryptionKey, { iv });
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

const db = new DeepbaseSecure({ name: 'secrets', encryptionKey: 'my-key-123' });
await db.set('token', 'sk-super-secret');
console.log(await db.get('token')); // 'sk-super-secret' (file on disk is encrypted)
```

## License

MIT - Copyright (c) Martin Clasen

