# deepbase-redis

Vanilla Redis driver for DeepBase (no modules required).

## Installation

```bash
npm install deepbase deepbase-redis
```

## Prerequisites

Requires standard Redis (no modules needed):

```bash
docker run -d -p 6379:6379 --name redis redis:latest
```

**Note:** This driver works with vanilla Redis. For RedisJSON support, use `deepbase-redis-json` instead.

## Description

Stores data in Redis using standard string operations with JSON serialization. Perfect for:

- ✅ High-performance caching
- ✅ Real-time applications
- ✅ Session storage
- ✅ Works with any Redis installation
- ✅ No modules required

## Usage

```javascript
import DeepBase from 'deepbase';
import RedisDriver from 'deepbase-redis';

const db = new DeepBase(new RedisDriver({
  url: 'redis://localhost:6379',
  prefix: 'myapp'
}));

await db.connect();

await db.set('users', 'alice', { name: 'Alice', age: 30 });
const alice = await db.get('users', 'alice');
```

## Options

```javascript
new RedisDriver({
  url: 'redis://localhost:6379',    // Redis connection URL
  prefix: 'db',                     // Key prefix (or use 'name')
  nidAlphabet: 'ABC...',           // Alphabet for ID generation
  nidLength: 10                     // Length of generated IDs
})
```

## Data Structure

Data is stored as JSON strings in Redis:

```javascript
// Keys created
myapp:users     -> '{"alice": {...}, "bob": {...}}'
myapp:config    -> '{"theme": "dark", "lang": "en"}'
```

## Differences from deepbase-redis-json

This vanilla driver:
- ✅ Works with any Redis installation
- ✅ No modules required
- ✅ Simpler deployment
- ❌ No atomic JSON path operations
- ❌ Entire values must be read/written

The RedisJSON driver (`deepbase-redis-json`):
- ✅ Atomic JSON path operations
- ✅ More efficient for large nested objects
- ❌ Requires Redis Stack or RedisJSON module

## Features

### JSON Serialization

Uses standard JSON serialization:

```javascript
await db.set('users', 'alice', { name: 'Alice', age: 30 });
// Stored as: '{"alice": {"name": "Alice", "age": 30}}'
```

### Nested Operations

Supports nested path operations:

```javascript
await db.set('users', 'alice', 'address', { city: 'NYC' });
// Reads full object, modifies, and writes back
```

### Increment/Decrement

Basic increment operations:

```javascript
await db.inc('stats', 'views', 1);
await db.dec('stats', 'views', 1);
```

### Key Scanning

Efficiently scans keys with patterns:

```javascript
const allUsers = await db.get('users');
// Scans all keys matching prefix
```

## Connection String Formats

```javascript
// Local
url: 'redis://localhost:6379'

// With password
url: 'redis://:password@localhost:6379'

// With database number
url: 'redis://localhost:6379/0'

// Redis Cloud
url: 'redis://username:password@host:port'

// TLS/SSL
url: 'rediss://host:port'
```

## Performance

Redis is extremely fast:

- **Reads**: Sub-millisecond response times
- **Writes**: Thousands of operations per second
- **In-memory**: Data stored in RAM with optional persistence
- **Simple**: No complex JSON path operations

## Use Cases

### Session Storage
```javascript
const sessions = new DeepBase(new RedisDriver({ prefix: 'session' }));
await sessions.set(sessionId, 'user', userData);
```

### Real-time Stats
```javascript
const stats = new DeepBase(new RedisDriver({ prefix: 'stats' }));
await stats.inc('page', 'views', 1);
```

### Cache Layer
```javascript
const cache = new DeepBase([
  new RedisDriver({ prefix: 'cache' }),
  new MongoDriver({ url: '...' })
]);
```

## Best Practices

1. **Use as cache layer** - Not as primary storage
2. **Small to medium objects** - Full objects are read/written
3. **Monitor memory usage** - Redis is in-memory
4. **Enable persistence** - RDB or AOF for durability
5. **Use with persistent drivers** - MongoDB or JSON backup

## Persistence Options

Redis supports:
- **RDB**: Periodic snapshots
- **AOF**: Append-only file for durability

Configure in Redis:
```bash
docker run -d -p 6379:6379 \
  -v redis-data:/data \
  redis:latest \
  --appendonly yes
```

## Error Handling

```javascript
try {
  await db.connect();
} catch (error) {
  console.error('Redis connection failed:', error);
  // Fallback to other drivers
}
```

## When to Use

**Use `deepbase-redis` (this driver) when:**
- You have standard Redis
- You want simple deployment
- Your objects are small to medium sized
- You don't need atomic JSON operations

**Use `deepbase-redis-json` when:**
- You have Redis Stack
- You need atomic JSON path operations
- You work with large nested objects
- You want optimal performance for partial updates

## License

MIT - Copyright (c) Martin Clasen

