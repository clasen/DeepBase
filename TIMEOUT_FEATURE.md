# Timeout Configuration Feature

## Overview

DeepBase now supports configurable timeouts for all database operations. This prevents operations from hanging indefinitely when a driver or backend service becomes unresponsive.

## Configuration Options

### Global Timeout

Set a single timeout for all operations:

```javascript
const db = new DeepBase(drivers, {
  timeout: 5000  // 5 seconds for all operations
});
```

### Separate Read/Write Timeouts

Configure different timeouts for read and write operations:

```javascript
const db = new DeepBase(drivers, {
  readTimeout: 3000,   // 3 seconds for read operations (get, keys, values, entries)
  writeTimeout: 10000  // 10 seconds for write operations (set, del, inc, dec, add, upd)
});
```

### Connection Timeout

Set a specific timeout for connection operations:

```javascript
const db = new DeepBase(drivers, {
  connectTimeout: 5000,  // 5 seconds for connection
  readTimeout: 3000,
  writeTimeout: 10000
});
```

### Disable Timeout

Set timeout to `0` to disable (default behavior):

```javascript
const db = new DeepBase(drivers, {
  timeout: 0  // No timeout (operations wait indefinitely)
});
```

## Timeout Priority

Timeouts are applied in the following priority order:

1. **Read operations** (`get`, `keys`, `values`, `entries`):
   - `readTimeout` if specified
   - Otherwise `timeout` if specified
   - Otherwise `0` (no timeout)

2. **Write operations** (`set`, `del`, `inc`, `dec`, `add`, `upd`):
   - `writeTimeout` if specified
   - Otherwise `timeout` if specified
   - Otherwise `0` (no timeout)

3. **Connection operation** (`connect`):
   - `connectTimeout` if specified
   - Otherwise `timeout` if specified
   - Otherwise `0` (no timeout)

## Error Handling

When a timeout occurs, the operation throws an error with a descriptive message:

```javascript
try {
  await db.get('some.key');
} catch (error) {
  // Error: get() timed out after 5000ms
  console.error(error.message);
}
```

## Examples

### Example 1: Basic Timeout

```javascript
import { DeepBase } from 'deepbase';
import { RedisDriver } from 'deepbase-redis';

const db = new DeepBase([new RedisDriver()], {
  timeout: 5000  // 5 second timeout for all operations
});

await db.connect();

try {
  const value = await db.get('user', '123');
  console.log(value);
} catch (error) {
  if (error.message.includes('timed out')) {
    console.error('Operation timed out');
  }
}
```

### Example 2: Different Timeouts for Read/Write

```javascript
const db = new DeepBase([new MongoDriver()], {
  readTimeout: 2000,   // Fast reads
  writeTimeout: 10000  // Allow longer for writes
});

await db.connect();

// This will timeout after 2 seconds
await db.get('data', 'key');

// This will timeout after 10 seconds
await db.set('data', 'key', 'value');
```

### Example 3: Multi-Driver with Timeout

```javascript
const db = new DeepBase(
  [
    new RedisDriver({ host: 'slow-redis-server' }),
    new JsonDriver({ name: 'backup' })
  ],
  {
    readTimeout: 3000,
    writeTimeout: 5000,
    readFirst: true  // Try drivers in order with timeout
  }
);

await db.connect();

// Will try Redis first with 3s timeout, fallback to JSON if timeout
const value = await db.get('user', '123');
```

### Example 4: Production Configuration

```javascript
const db = new DeepBase(
  [
    new RedisDriver({ host: process.env.REDIS_HOST }),
    new MongoDriver({ uri: process.env.MONGO_URI }),
    new JsonDriver({ name: 'local-cache' })
  ],
  {
    readTimeout: 2000,      // Fast response for reads
    writeTimeout: 5000,     // Moderate timeout for writes
    connectTimeout: 10000,  // Allow time for initial connection
    readFirst: true,        // Try in order
    writeAll: true,         // Write to all drivers
    failOnPrimaryError: false  // Continue if primary times out
  }
);

try {
  await db.connect();
} catch (error) {
  console.error('Connection timeout:', error.message);
}
```

## Implementation Details

- Timeouts are implemented using `Promise.race()` with a timeout promise
- The timeout promise rejects after the specified milliseconds
- Original operation continues in the background but result is ignored
- No timeout (`0` or undefined) allows operations to run indefinitely
- Timeout values are in milliseconds

## Best Practices

1. **Set reasonable timeouts**: Too short may cause false failures, too long defeats the purpose
2. **Different timeouts for different operations**: Reads are typically faster than writes
3. **Connection timeout**: Set higher than operation timeouts as initial connection may be slower
4. **Multi-driver scenarios**: Use timeouts with `readFirst: true` to enable fast failover
5. **Production monitoring**: Log timeout errors to identify slow operations or infrastructure issues

## Testing

Run the timeout test suite:

```bash
npm run test:core
node packages/core/test/test-timeout.js
```

Run the timeout example:

```bash
node examples/09-timeout.js
```

## Backward Compatibility

This feature is fully backward compatible. By default, timeouts are disabled (`0`), maintaining the original behavior where operations wait indefinitely.

## Related Configuration

- `readFirst`: Works well with timeouts for driver failover
- `writeAll`: Timeout applies to the entire write operation across all drivers
- `failOnPrimaryError`: Controls whether timeout on primary driver throws an error
- `lazyConnect`: Connection timeout applies during lazy connection

## Troubleshooting

### Operations timing out frequently

1. Check network connectivity to database servers
2. Verify database server performance
3. Consider increasing timeout values
4. Check for resource constraints (CPU, memory, network)

### Timeouts not working

1. Verify timeout value is greater than 0
2. Check that you're using the correct timeout option (`readTimeout`, `writeTimeout`, etc.)
3. Ensure you're awaiting the operation properly

### Performance impact

- Timeout implementation has minimal overhead (single setTimeout per operation)
- Operations that succeed quickly have negligible performance impact
- No impact when timeouts are disabled (default)

