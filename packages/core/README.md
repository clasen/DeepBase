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
import { resolvePath } from 'deepbase/path';

const dataPath = resolvePath(import.meta.url, './data');

// Backward-compatible syntax - uses JSON driver by default
const db = new DeepBase({ path: dataPath, name: 'mydb' });
await db.connect();

await db.set('users', 'alice', { name: 'Alice' });
const alice = await db.get('users', 'alice');
```

Filesystem drivers require an absolute `path`. `resolvePath()` anchors a
relative path to your application module instead of `process.cwd()` or the
installed package location.

### Explicit Driver Usage

```javascript
import DeepBase from 'deepbase';
import { JsonDriver } from 'deepbase-json';

const db = new DeepBase(new JsonDriver({ path: '/var/lib/myapp/data' }));
await db.connect();

await db.set('users', 'alice', { name: 'Alice' });
const alice = await db.get('users', 'alice');
```

## Additional Drivers

The JSON driver (`deepbase-json`) is included automatically. Install additional drivers as needed:

- [`deepbase-sqlite`](https://www.npmjs.com/package/deepbase-sqlite) - SQLite embedded database
- [`deepbase-indexeddb`](https://www.npmjs.com/package/deepbase-indexeddb) - IndexedDB for browser environments
- [`deepbase-drizzle`](https://www.npmjs.com/package/deepbase-drizzle) - [Drizzle ORM](https://orm.drizzle.team/) — SQLite, PostgreSQL, MySQL, and other dialects via your Drizzle `db` (default table schema is inferred)
- [`deepbase-mongodb`](https://www.npmjs.com/package/deepbase-mongodb) - MongoDB storage
- [`deepbase-redis`](https://www.npmjs.com/package/deepbase-redis) - Redis Stack storage

### Drizzle Example (PostgreSQL / MySQL / Supabase)

```javascript
import DeepBase from 'deepbase';
import DrizzleDriver from 'deepbase-drizzle';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool });

const store = new DeepBase(new DrizzleDriver({ db, client: pool }));
await store.connect(); // creates table automatically if it does not exist
await store.set('users', 'alice', { name: 'Alice' });
```

Same pattern works with other Drizzle dialects (`mysql2`, SQLite, etc.).  
For Supabase Postgres, use the Supabase connection string in `DATABASE_URL`.  
Optional: set `tableName` if you want a different table than `deepbase_main`.

### Multi-Driver Example

```javascript
import DeepBase from 'deepbase';
import { JsonDriver } from 'deepbase-json';
import MongoDriver from 'deepbase-mongodb';

const db = new DeepBase([
  new MongoDriver({ url: 'mongodb://localhost:27017' }),
  new JsonDriver({ path: '/var/lib/myapp/backup' })
], {
  writeAll: true,           // Write to both drivers
  readFirst: true,          // Read from first available
  failOnPrimaryError: false // Continue if MongoDB fails
});

await db.connect();
```

## Instance Plugins

Register per-instance plugins before `connect()` or the first operation:

```javascript
const plugin = {
  name: 'uppercase-reads',
  async execute(context, next) {
    const value = await next();
    return context.operation === 'get' && typeof value === 'string'
      ? value.toUpperCase()
      : value;
  },
  executeSync(context, next) {
    const value = next();
    return context.operation === 'get' && typeof value === 'string'
      ? value.toUpperCase()
      : value;
  }
};

const db = new DeepBase(driver).use(plugin);
```

`execute(context, next)` middleware runs in registration order. It may call
`next()` once, pass `{ operation, args }` overrides, or return without calling
`next()` to short-circuit the operation. Optional `setup(db)` is synchronous;
optional `dispose(db)` runs in reverse registration order after drivers are
disposed. Async middleware must implement `executeSync` for `getSync()`.

Schema reads and writes use the plugin pipeline. `migrate()`, `syncAll()`, and
direct `getDriver()` access remain raw so stored representations can be copied
without transformation.

Built-in plugins, included in the `deepbase` package:

- [`deepbase/plugins/encryption`](docs/plugins/encryption.md) encrypts all values automatically (Node.js).
- [`deepbase/plugins/links`](docs/plugins/links.md) resolves explicit path links (portable).

Import each plugin from its own entry point and register it with `.use()`.
Both entry points support ESM, CommonJS, and TypeScript. Importing the core or
links does not load the encryption plugin.

## Timeout Configuration

Prevent operations from hanging indefinitely with configurable timeouts:

```javascript
import DeepBase from 'deepbase';
import { JsonDriver } from 'deepbase-json';

// Global timeout for all operations
const db = new DeepBase(new JsonDriver({ path: '/var/lib/myapp/data' }), {
  timeout: 5000  // 5 seconds
});

// Different timeouts for reads and writes
const db2 = new DeepBase(new JsonDriver({ path: '/var/lib/myapp/data' }), {
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

## Optional Data Schema

DeepBase remains schemaless by default. Pass `schema` as a constructor option to validate future mutations and declare relationships over normal DeepBase paths:

```javascript
import DeepBase, { DeepBaseSchemaError } from 'deepbase';
import { JsonDriver } from 'deepbase-json';

const schema = {
  entities: {
    users: {
      path: ['users', ':id'],
      additionalFields: false,
      fields: {
        name: { type: 'string', required: true },
        profile: {
          type: 'object',
          properties: { active: { type: 'boolean', required: true } }
        }
      }
    },
    posts: {
      path: ['posts', ':id'],
      additionalFields: true,
      fields: {
        title: { type: 'string', required: true },
        authorId: { type: ['string', 'null'], ref: 'users' }
      }
    }
  }
};

const db = new DeepBase(new JsonDriver({ path: '/var/lib/myapp/data', name: 'app' }), { schema });
await db.set('users', 'alice', { name: 'Alice', profile: { active: true } });
await db.set('posts', 'hello', { title: 'Hello', authorId: 'alice' });

await db.validateSchema(); // explicit read-only audit: { valid, errors }
await db.describeSchema(); // deterministic structured model
await db.schemaDiagram();  // Mermaid ER text
```

Supported types are `string`, `number`, `boolean`, `null`, `object`, and `array`. Objects use `properties`; arrays use `items`; omitted `required` means optional. `additionalFields` is required per entity and applies to nested declared objects too. References use the destination entity's final path parameter. Missing destinations and deletion of referenced records throw `DeepBaseSchemaError` before writing any driver.

When no schema is declared, `describeSchema()` infers an editable candidate. Relationships suggested from `*Id` / `*_id` fields are marked `candidate: true` and never enforced. `validateSchema()` requires a declared schema. Enforcement is serialized within one `DeepBase` instance; concurrent writers in other processes require external coordination.

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
  - `schema`: Optional application-owned entity schema

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


#### Query Operations
- `await db.keys(...path)` - Get keys at path
- `await db.first(...path)` - Get the first key at path (same driver read order as `get()`)
- `await db.last(...path)` - Get the last key at path (same driver read order as `get()`)
- `await db.values(...path)` - Get values at path
- `await db.entries(...path)` - Get entries at path
- `await db.len(...path)` - Count the number of keys at path

#### Schema Operations
- `await db.describeSchema()` - Describe the declared or inferred model as JSON
- `await db.validateSchema()` - Audit all stored data against the declared schema
- `await db.schemaDiagram()` - Generate a Mermaid ER diagram

#### Migration
- `await db.migrate(fromIndex, toIndex, options)` - Migrate data between drivers
- `await db.syncAll(options)` - Sync primary to all others

**Migration Options:**
- `clear` (default: `true`): Clear target driver before migration
- `batchSize` (default: `100`): Progress callback frequency (items between calls)
- `onProgress`: Callback `({ migrated, errors, current }) => {}` for monitoring

**Returns:** `{ migrated, errors }` with counts of successful and failed items.

```javascript
import DeepBase from 'deepbase';
import { JsonDriver } from 'deepbase-json';
import SqliteDriver from 'deepbase-sqlite';

const db = new DeepBase([
  new SqliteDriver({ path: '/var/lib/myapp/data', name: 'mydb' }),  // index 0
  new JsonDriver({ path: '/var/lib/myapp/backup', name: 'mydb' })   // index 1
]);
await db.connect();

// Migrate SQLite → JSON (clears target first)
const result = await db.migrate(0, 1);
console.log(result); // { migrated: 5, errors: 0 }

// Migrate JSON → SQLite (merge, keep existing data)
await db.migrate(1, 0, { clear: false });

// Migrate with progress reporting
await db.migrate(0, 1, {
  batchSize: 10,
  onProgress: ({ migrated, errors, current }) => {
    console.log(`${migrated} migrated | ${errors} errors | current: ${current}`);
  }
});

// Sync primary (index 0) to all other drivers
await db.syncAll();
```

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
  async first(...args) { /* optional optimization; fallback exists in base class */ }
  async last(...args) { /* optional optimization; fallback exists in base class */ }
}
```

`DeepBase.first()` / `DeepBase.last()` delegate to each driver's `first()` / `last()` and follow the same read policy as `get()` (`readFirst` order or `Promise.any` mode). `shift()` / `pop()` use these methods, and drivers without overrides still work through the base fallback to `keys()`.

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

See the [encryption plugin documentation](docs/plugins/encryption.md)
for additional keys and key rotation.

## License

MIT - Copyright (c) Martin Clasen
