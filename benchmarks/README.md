# DeepBase Performance Benchmarks

Comprehensive performance benchmarks for all DeepBase drivers.

## Quick Start

```bash
# Run all benchmarks
npm run bench:all

# Or run individual benchmarks
npm run bench:json        # JSON driver only
npm run bench:mongodb     # MongoDB driver only
npm run bench:redis       # Redis driver (vanilla) only
npm run bench:redis-json  # Redis-JSON driver only
npm run bench:compare     # Compare all drivers
npm run bench:migration   # Migration performance
```

## Prerequisites

For MongoDB and Redis benchmarks:

```bash
# Start MongoDB
docker start mongodb

# Start Redis (vanilla) - for deepbase-redis
docker start redis

# Start Redis Stack (with RedisJSON) - for deepbase-redis-json
docker start redis-stack-server-6379
```

## What's Measured

All benchmarks now include:
- ⚡ **Performance**: Operations per second (ops/sec)
- 💾 **Memory Usage**: RSS (Resident Set Size) and Heap usage in MB
- 📊 **Memory Delta**: Memory increase/decrease during operations

### Memory Metrics Explained

- **RSS (Resident Set Size)**: Total memory allocated to the process
- **Heap Used**: JavaScript heap memory in use
- **Delta**: Change in memory from start to end of operation

## Benchmark Results

### Driver Comparison (500 iterations)

| Operation | JSON | MongoDB | Redis | Winner |
|-----------|------|---------|-------|--------|
| **Write** | ~2,000 ops/sec | ~2,300 ops/sec | **~6,000 ops/sec** | ⚡ Redis |
| **Read** | **~594,000 ops/sec** | ~1,600 ops/sec | ~6,800 ops/sec | 📁 JSON |
| **Increment** | ~2,300 ops/sec | ~2,700 ops/sec | **~6,900 ops/sec** | ⚡ Redis |
| **Update** | ~2,500 ops/sec | ~900 ops/sec | **~3,500 ops/sec** | ⚡ Redis |
| **Delete** | ~2,700 ops/sec | ~2,900 ops/sec | **~7,700 ops/sec** | ⚡ Redis |

### Key Findings

#### 🏆 Redis Stack
- **Fastest** for write-heavy operations
- **Best** for atomic operations (increment/decrement)
- **Excellent** for high-throughput scenarios
- ~3-4x faster than MongoDB for most operations
- Sub-millisecond latency for individual operations

#### 📁 JSON Driver
- **Extremely fast reads** from in-memory cache
- 100x faster reads than other drivers (cached)
- Perfect for development and testing
- Good for small to medium datasets
- Simple deployment (no external dependencies)

#### 🍃 MongoDB
- **Balanced** performance across operations
- Best for complex queries and aggregations
- Excellent for production workloads
- Built-in replication and sharding
- Atomic operations with `$inc` operator

### Migration Performance

| Source → Target | 100 items | 500 items | 1000 items |
|----------------|-----------|-----------|------------|
| JSON → MongoDB | ~2,500 items/sec | ~2,550 items/sec | ~2,300 items/sec |
| JSON → Redis | ~6,600 items/sec | ~6,800 items/sec | ~6,600 items/sec |
| MongoDB → Redis | ~5,600 items/sec | ~6,000 items/sec | ~6,400 items/sec |

**Note**: Migration includes nested object serialization and complex data structures.

## Detailed Benchmarks

### JSON Driver (1000 iterations)

```
Write:        1,945 ops/sec
Read:         629,475 ops/sec (in-memory cache)
Update:       1,315 ops/sec
Increment:    1,186 ops/sec
Delete:       1,236 ops/sec
Batch Write:  2,244 ops/sec

Memory Usage: Shows RSS and Heap usage after each operation
- Initial memory baseline displayed
- Memory delta calculated at end
- Tracks memory growth during operations
```

**Characteristics:**
- Reads are extremely fast (in-memory)
- Writes include disk I/O with atomic writes (steno)
- Single file per database instance
- Perfect for < 10,000 records
- Low memory footprint

### MongoDB Driver (1000 iterations)

```
Write:        2,285 ops/sec
Read:         1,647 ops/sec
Update:       934 ops/sec
Increment:    2,677 ops/sec (atomic $inc)
Delete:       2,926 ops/sec
Batch Write:  Parallel operations supported

Memory Usage: Includes MongoDB client memory overhead
- Tracks connection pooling memory
- Shows driver-specific memory usage
- Memory delta for operation sequences
```

**Characteristics:**
- Atomic operations with MongoDB operators
- Network latency included in measurements
- Document-based storage
- Scales to millions of records
- Moderate memory footprint with connection pooling

### Redis Driver (Vanilla) - 1000 iterations

```
Write:        ~5,000+ ops/sec
Read:         ~5,000+ ops/sec
Update:       ~3,000+ ops/sec
Increment:    ~5,000+ ops/sec (read-modify-write)
Delete:       ~6,000+ ops/sec
Batch Write:  High throughput

Memory Usage: Node.js client memory only
- Server-side memory separate (Redis manages)
- Client memory typically very low
- Efficient for high-throughput scenarios
```

**Characteristics:**
- In-memory storage (fast)
- Standard Redis string operations
- Works with any Redis installation
- JSON serialization/deserialization
- Network latency included
- Optional persistence (RDB/AOF)
- Minimal client memory footprint

### Redis-JSON Driver (1000 iterations)

```
Write:        6,014 ops/sec
Read:         6,880 ops/sec
Update:       3,491 ops/sec
Increment:    6,912 ops/sec (JSON.NUMINCRBY - atomic)
Delete:       7,786 ops/sec
Batch Write:  High throughput

Memory Usage: Node.js client memory only
- Server-side memory separate (Redis manages)
- Client memory typically very low
- More efficient for nested operations
```

**Characteristics:**
- In-memory storage (fastest)
- RedisJSON module for native JSON operations
- Atomic JSON path operations
- More efficient for large nested objects
- Network latency included
- Optional persistence (RDB/AOF)
- Minimal client memory footprint

## Performance Tips

### For JSON Driver
- Use for development and testing
- Keep datasets under 10,000 records
- Reads are nearly free (in-memory cache)
- Consider for read-heavy workloads

### For MongoDB Driver
- Ideal for production workloads
- Use indexes for frequently queried fields
- Leverage aggregation pipeline for complex queries
- Enable retryWrites for reliability
- Use transactions for atomic multi-document operations

### For Redis Drivers

**Redis (Vanilla) Driver:**
- Works with any Redis installation
- Best for small to medium objects
- Simple deployment (standard Redis)
- Good for caching and session storage
- Use when RedisJSON is not available

**Redis-JSON Driver:**
- Requires Redis Stack or RedisJSON module
- Best for large nested objects
- Atomic JSON path operations
- More efficient for partial updates
- Ideal for high-throughput scenarios
- Configure persistence (AOF) for durability
- Monitor memory usage
- Consider as cache layer with MongoDB backend

## Multi-Driver Architecture

Combine drivers for maximum performance and reliability:

```javascript
// High-performance with redundancy
const db = new DeepBase([
  new RedisDriver({ url: 'redis://...' }),    // Fast cache
  new MongoDriver({ url: 'mongodb://...' }),  // Persistent storage
  new JsonDriver({ path: './backup' })        // Local backup
]);
```

**Benefits:**
- Redis handles 90%+ of reads (sub-ms latency)
- MongoDB provides persistence
- JSON provides local backup
- Automatic failover between layers

## Benchmark Environment

- **Node.js**: v18+
- **MongoDB**: Community Server 8.0
- **Redis**: Redis Stack 7.4
- **Machine**: MacOS (Darwin 24.4.0)
- **Iterations**: 500-1000 per test
- **Data**: Complex nested objects with metadata

## Running Custom Benchmarks

Create your own benchmark with memory tracking:

```javascript
import DeepBase from 'deepbase';
import RedisDriver from 'deepbase-redis';

function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    rss: (used.rss / 1024 / 1024).toFixed(2),
    heapUsed: (used.heapUsed / 1024 / 1024).toFixed(2)
  };
}

const db = new DeepBase(new RedisDriver({ url: 'redis://localhost:6379' }));
await db.connect();

const memBefore = getMemoryUsage();
const iterations = 1000;
const start = performance.now();

for (let i = 0; i < iterations; i++) {
  await db.set('test', `key_${i}`, { value: i });
}

const time = performance.now() - start;
const memAfter = getMemoryUsage();
const opsPerSec = iterations / (time / 1000);

console.log(`Performance: ${opsPerSec.toFixed(2)} ops/sec`);
console.log(`Memory: ${memBefore.rss} MB → ${memAfter.rss} MB (${(memAfter.rss - memBefore.rss).toFixed(2)} MB delta)`);
```

## Interpreting Results

### Operations Per Second (ops/sec)
- **< 1,000**: Acceptable for low-frequency operations
- **1,000-5,000**: Good for most applications
- **5,000-10,000**: Excellent performance
- **> 10,000**: Outstanding, suitable for high-load systems

### Latency Targets
- **< 1ms**: Excellent (in-memory)
- **1-10ms**: Good (local databases)
- **10-50ms**: Acceptable (network databases)
- **> 50ms**: Consider optimization

### Memory Usage Guidelines

#### RSS (Resident Set Size)
- **< 50 MB**: Excellent - Minimal memory footprint
- **50-100 MB**: Good - Typical for small datasets
- **100-200 MB**: Acceptable - Medium datasets with caching
- **> 200 MB**: Monitor - Large datasets or potential leak

#### Memory Delta (Per 1000 Operations)
- **< 5 MB**: Excellent - Minimal memory growth
- **5-10 MB**: Good - Normal for data operations
- **10-20 MB**: Acceptable - Complex data structures
- **> 20 MB**: Warning - Check for memory leaks

#### Heap Usage
- **< 30 MB**: Minimal - Very efficient
- **30-60 MB**: Low - Good memory management
- **60-100 MB**: Moderate - Normal for active operations
- **> 100 MB**: High - Consider memory optimization

**Note**: Memory usage varies by:
- Data structure complexity
- Number of cached items
- Driver-specific overhead (connections, buffers)
- Node.js version and V8 optimizations

## Contributing

To add new benchmarks:

1. Create `benchmark-yourtest.js` in `/benchmarks`
2. Follow the existing format
3. Add script to `package.json`
4. Update this README

## See Also

- [Testing Guide](../TESTING.md) - Unit tests
- [Main README](../README.md) - Documentation
- [Examples](../examples/) - Usage examples

