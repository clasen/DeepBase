# deepbase-redis-json

Redis Stack (RedisJSON) driver for DeepBase.

## Installation

```bash
npm install deepbase deepbase-redis-json
```

## Prerequisites

Requires Redis Stack (includes RedisJSON module):

```bash
docker run -d -p 6379:6379 --name redis redis/redis-stack-server:latest
```

**Note:** Standard Redis won't work - you need Redis Stack for JSON support.

## Description

Stores data in Redis using the RedisJSON module. Perfect for:

- ✅ High-performance caching
- ✅ Real-time applications
- ✅ Session storage
- ✅ Fast reads and writes
- ✅ In-memory speed with persistence

## Special Characters Support

This driver **automatically escapes** special characters in keys (dots, @, $, spaces, brackets) so you can use them safely:

```javascript
// ✅ Keys with dots work perfectly
await db.set('users', 'john.doe@example.com', { name: 'John' });
await db.set('config', 'api.prod.endpoint', 'https://api.com');

// Internally escaped but transparent to you
const user = await db.get('users', 'john.doe@example.com');
console.log(user); // { name: 'John' }
```

## Usage

```javascript
import DeepBase from 'deepbase';
import RedisDriver from 'deepbase-redis-json';

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

Data is stored as Redis JSON keys:

```javascript
// Keys created
myapp:users     -> { alice: {...}, bob: {...} }
myapp:config    -> { theme: "dark", lang: "en" }
```

## Features

### RedisJSON Support

Uses Redis JSON module for native JSON operations:

```javascript
await db.set('users', 'alice', 'address', { city: 'NYC' });
// Stored at JSON path: $.alice.address
```

### Atomic Increment

Uses Redis `JSON.NUMINCRBY` for atomic operations:

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

## Three-Tier Architecture

Use Redis as a cache layer:

```javascript
import DeepBase from '@deepbase/core';
import MongoDriver from 'deepbase-mongodb';
import { JsonDriver } from 'deepbase';
import RedisDriver from '@deepbase/redis';

const db = new DeepBase([
  new MongoDriver({ url: 'mongodb://localhost:27017' }),  // Primary
  new JsonDriver({ path: './backup' }),                   // Backup
  new RedisDriver({ url: 'redis://localhost:6379' })      // Cache
], {
  writeAll: true,           // Write to all three
  readFirst: true,          // Read from MongoDB first
  failOnPrimaryError: false // Fallback through layers
});
```

**Read priority**: MongoDB → JSON → Redis
**Write replication**: All three updated simultaneously

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
- **Atomic operations**: Lock-free increments and updates

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
await stats.inc('page', 'unique_visitors', 1);
```

### Cache Layer
```javascript
const cache = new DeepBase([
  new RedisDriver({ prefix: 'cache' }),
  new MongoDriver({ url: '...' })
]);

// Fast reads from Redis, persistent in MongoDB
```

## Best Practices

1. **Use as cache layer** - Not as primary storage
2. **Set appropriate TTLs** - Expire old data
3. **Monitor memory usage** - Redis is in-memory
4. **Enable persistence** - RDB or AOF for durability
5. **Use with persistent drivers** - MongoDB or JSON backup

## Persistence Options

Redis Stack supports:
- **RDB**: Periodic snapshots
- **AOF**: Append-only file for durability

Configure in Redis:
```bash
docker run -d -p 6379:6379 \
  -v redis-data:/data \
  redis/redis-stack-server:latest \
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

## License

MIT - Copyright (c) Martin Clasen

