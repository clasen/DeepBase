# deepbase

DeepBase - Multi-driver persistence system with JSON driver included.

## Installation

```bash
npm install deepbase
# Automatically includes deepbase-json as dependency
```

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

- `deepbase-sqlite` - SQLite embedded database
- `deepbase-mongodb` - MongoDB storage
- `deepbase-redis` - Redis Stack storage

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
- `await db.add(...path, value)` - Add with auto-generated ID
- `await db.upd(...path, fn)` - Update with function

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

## License

MIT - Copyright (c) Martin Clasen

