# Memory Tracking in DeepBase Benchmarks

## Overview

All DeepBase benchmarks now include comprehensive memory usage tracking using Node.js `process.memoryUsage()` API. This helps identify memory efficiency and potential memory leaks across different drivers.

## What's Tracked

### Memory Metrics

1. **RSS (Resident Set Size)**: Total memory allocated to the process
   - Includes heap, code, and stack
   - Best indicator of actual memory consumption

2. **Heap Total**: Total size of the allocated heap
   - V8's memory allocation pool
   - Can grow as needed

3. **Heap Used**: Amount of heap currently in use
   - Active JavaScript objects
   - Best indicator of JS memory usage

4. **External**: Memory used by C++ objects bound to JavaScript
   - Native modules and buffers
   - Important for drivers with native dependencies

## Implementation

### Memory Measurement Function

```javascript
function getMemoryUsage() {
  const used = process.memoryUsage();
  return {
    rss: (used.rss / 1024 / 1024).toFixed(2),
    heapTotal: (used.heapTotal / 1024 / 1024).toFixed(2),
    heapUsed: (used.heapUsed / 1024 / 1024).toFixed(2),
    external: (used.external / 1024 / 1024).toFixed(2)
  };
}
```

### Measurement Points

1. **Initial State**: Before any database operations
2. **After Write Operations**: Shows memory impact of data insertion
3. **After Read Operations**: Shows caching effects
4. **Final State**: After all operations complete
5. **Delta Calculation**: Difference between initial and final states

## Benchmarks Updated

✅ **benchmark-json.js** - JSON driver memory profiling
✅ **benchmark-sqlite.js** - SQLite driver memory profiling
✅ **benchmark-mongodb.js** - MongoDB driver memory profiling
✅ **benchmark-redis.js** - Redis driver memory profiling
✅ **benchmark-compare.js** - Multi-driver memory comparison
✅ **benchmark-migration.js** - Migration memory tracking

## Example Output

### Individual Driver Benchmark

```
📊 Initial Memory Usage:
   RSS: 47.55 MB | Heap Used: 5.13 MB | Heap Total: 6.83 MB

📝 Testing WRITE performance...
   ✓ 1000 writes in 319.70ms
   ✓ 3127.93 ops/sec
   💾 Memory - RSS: 63.55 MB | Heap Used: 8.26 MB

📖 Testing READ performance...
   ✓ 1000 reads in 1.22ms
   ✓ 819924.16 ops/sec
   💾 Memory - RSS: 63.61 MB | Heap Used: 9.16 MB

═══════════════════════════════════════════════════════════
  MEMORY USAGE
───────────────────────────────────────────────────────────
  Initial RSS:       47.55 MB
  Final RSS:         68.31 MB
  RSS Delta:         20.76 MB
  Initial Heap:      5.13 MB
  Final Heap:        7.99 MB
  Heap Delta:        2.86 MB
═══════════════════════════════════════════════════════════
```

### Driver Comparison

```
═══════════════════════════════════════════════════════════
  MEMORY USAGE COMPARISON (MB)
═══════════════════════════════════════════════════════════

Driver         Initial RSS  Final RSS    RSS Delta   Heap Delta
────────────────────────────────────────────────────────────────────
Json                 110.77      123.97       13.20        10.59
Sqlite               124.00      125.48        1.48         3.06
Mongodb              125.89      139.58       13.69        -3.33
Redis                139.67      140.28        0.61        -2.88
─────────────────────────────────────────────────────────

💾 Most Memory Efficient: ⚡ REDIS (0.61 MB delta)
```

## Key Findings

### Memory Efficiency Ranking (500 iterations)

1. **Redis** - 0.61 MB delta
   - Most memory efficient
   - Minimal client-side overhead
   - Server handles data storage

2. **SQLite** - 1.48 MB delta
   - Very efficient
   - Native module with good memory management
   - Minimal in-process caching

3. **JSON** - 13.20 MB delta
   - Moderate memory usage
   - In-memory cache for reads
   - Trade-off: speed vs memory

4. **MongoDB** - 13.69 MB delta
   - Similar to JSON
   - Connection pooling overhead
   - Client-side buffering

### Negative Heap Deltas

Some benchmarks show negative heap deltas (e.g., MongoDB: -3.33 MB, Redis: -2.88 MB). This is **normal** and indicates:

- **Garbage Collection**: V8 cleaned up memory during operations
- **Efficient Memory Management**: Drivers are not leaking memory
- **Connection Pooling**: Initial connection overhead followed by stable usage

## Interpreting Memory Results

### Good Memory Profile
- **Stable Delta**: Memory grows predictably with data
- **Low Per-Operation Cost**: < 10KB per operation
- **GC Activity**: Occasional heap decreases (garbage collection)

### Warning Signs
- **Continuous Growth**: Memory keeps increasing without GC
- **High Delta**: > 50 MB for 1000 simple operations
- **No GC**: Heap only grows, never decreases

## Use Cases

### Development
- Monitor memory impact of new features
- Identify memory leaks early
- Compare different implementation approaches

### Production Planning
- Estimate memory requirements
- Plan server resources
- Set memory limits and alerts

### Driver Selection
- Choose driver based on memory constraints
- Balance performance vs memory usage
- Consider multi-driver architecture

## Best Practices

1. **Run Multiple Times**: Memory usage can vary between runs
2. **Look at Trends**: Focus on patterns, not absolute values
3. **Consider Context**: Memory usage depends on data complexity
4. **Monitor Production**: Benchmark results are guidelines, not guarantees
5. **Profile Regularly**: Check memory after major changes

## Memory Optimization Tips

### For JSON Driver
```javascript
// Clear cache periodically for long-running processes
await db.disconnect();  // Clears in-memory cache
await db.connect();     // Fresh start
```

### For SQLite Driver
```javascript
// Use WAL mode for better memory efficiency
new SqliteDriver({ 
  name: 'mydb',
  options: { pragma: { journal_mode: 'WAL' } }
});
```

### For MongoDB Driver
```javascript
// Limit connection pool size
new MongoDriver({ 
  url: 'mongodb://localhost:27017',
  options: { maxPoolSize: 10 }  // Default is 100
});
```

### For Redis Driver
```javascript
// Already optimized, but consider:
// - Disable Redis-side persistence if used as cache only
// - Use Redis MEMORY DOCTOR for server-side optimization
```

## Technical Details

### Why RSS and Not Just Heap?

- **RSS** includes everything: heap, stack, native modules, buffers
- **Heap** only shows V8 JavaScript memory
- **Both** are needed for complete picture

### When Memory Decreases

Memory can decrease due to:
1. **V8 Garbage Collection** - Automatic cleanup
2. **Buffer Releases** - Network buffers freed
3. **Connection Pool Cleanup** - Idle connections closed
4. **OS Memory Management** - Pages returned to system

### Measurement Accuracy

- Measurements are taken at specific points
- GC can run between measurements
- Results are snapshots, not continuous monitoring
- Use multiple runs for accuracy

## Future Enhancements

Potential additions to memory tracking:

- [ ] Continuous memory monitoring during operations
- [ ] Memory leak detection over time
- [ ] Peak memory usage tracking
- [ ] Memory pressure simulation
- [ ] Per-operation memory breakdown
- [ ] Memory usage over different data sizes
- [ ] Comparison with V8 heap snapshots

## Contributing

To add memory tracking to new benchmarks:

1. Copy the `getMemoryUsage()` function
2. Measure at start, after major operations, and at end
3. Calculate deltas
4. Display in summary section
5. Update this documentation

## See Also

- [Benchmarks README](./README.md) - Main benchmark documentation
- [Node.js process.memoryUsage()](https://nodejs.org/api/process.html#processmemoryusage)
- [V8 Garbage Collection](https://v8.dev/blog/trash-talk)
- [Memory Profiling in Node.js](https://nodejs.org/en/docs/guides/simple-profiling/)

