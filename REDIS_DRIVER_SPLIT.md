# Redis Driver Split - Summary

## Overview

The Redis driver has been split into two separate packages to support both vanilla Redis and Redis Stack (RedisJSON).

## Changes Made

### 1. Package Renaming
- **`packages/driver-redis`** → **`packages/driver-redis-json`**
  - Renamed to reflect its dependency on RedisJSON module
  - Package name: `deepbase-redis-json`
  - Uses native JSON.SET, JSON.GET, JSON.NUMINCRBY operations
  - Requires Redis Stack or RedisJSON module

### 2. New Package Created
- **`packages/driver-redis`** (NEW)
  - Package name: `deepbase-redis`
  - Vanilla Redis implementation (no modules required)
  - Uses standard Redis string operations with JSON serialization
  - Works with any Redis installation

## Technical Differences

### `deepbase-redis` (Vanilla)
```javascript
import RedisDriver from 'deepbase-redis';

// Uses standard Redis commands
await client.get(key)         // Returns JSON string
await client.set(key, value)  // Stores JSON string
```

**Features:**
- ✅ Works with any Redis installation
- ✅ No modules required
- ✅ Simple deployment
- ❌ No atomic JSON path operations
- ❌ Entire values must be read/written

### `deepbase-redis-json` (RedisJSON)
```javascript
import RedisDriver from 'deepbase-redis-json';

// Uses RedisJSON commands
await client.json.get(key, { path })           // Native JSON operations
await client.json.set(key, path, value)        // Atomic path updates
await client.json.numIncrBy(key, path, inc)    // Atomic increments
```

**Features:**
- ✅ Atomic JSON path operations
- ✅ More efficient for large nested objects
- ✅ Native JSON.NUMINCRBY for atomic increments
- ❌ Requires Redis Stack or RedisJSON module

## Files Modified

### Core Files
- `/package.json` - Added scripts for both Redis drivers
- `/README.md` - Updated to document both drivers
- `/CHANGELOG.md` - Added v3.2.0 section with breaking changes
- `/MIGRATION_GUIDE.md` - Added migration guide for both drivers

### Driver Files
- `/packages/driver-redis/` (NEW)
  - `package.json` - New package configuration
  - `src/RedisDriver.js` - Vanilla implementation
  - `src/index.js` - Module exports
  - `src/index.cjs` - CommonJS exports
  - `README.md` - Documentation for vanilla driver
  - `LICENSE` - MIT License
  - `test/test.js` - Test suite

- `/packages/driver-redis-json/` (RENAMED)
  - `package.json` - Updated package name
  - `README.md` - Updated documentation
  - All other files remain the same

### Benchmark Files
- `/benchmarks/package.json` - Added `bench:redis-json` script
- `/benchmarks/benchmark-redis.js` - Updated for vanilla driver
- `/benchmarks/benchmark-redis-json.js` (NEW) - Benchmark for RedisJSON
- `/benchmarks/README.md` - Updated documentation

### Documentation
- `/examples/README.md` - Added notes about both drivers
- `/scripts/publish.js` - Added `deepbase-redis-json` to packages list

## Migration Guide

### From v3.0-3.1 to v3.2

If you were using `deepbase-redis` with Redis Stack:
```bash
npm uninstall deepbase-redis
npm install deepbase-redis-json
```

```javascript
// Change import
import RedisDriver from 'deepbase-redis-json';  // was: deepbase-redis
```

If you have vanilla Redis (no modules):
```bash
npm install deepbase-redis
```

```javascript
import RedisDriver from 'deepbase-redis';
```

## Breaking Changes

- **Package Rename**: `deepbase-redis` (v3.0-3.1) → `deepbase-redis-json` (v3.2+)
- **New Package**: `deepbase-redis` now refers to the vanilla Redis driver

## Backward Compatibility

The API remains the same for both drivers:
- `get(...path)` - Same interface
- `set(...path, value)` - Same interface
- `inc(...path, amount)` - Same interface
- `del(...path)` - Same interface
- All other methods remain identical

The only difference is in:
1. Package name
2. Required Redis installation (vanilla vs Redis Stack)
3. Internal implementation (string operations vs JSON operations)

## Testing

Both drivers have identical test suites and should pass all tests:
```bash
npm run test:redis           # Test vanilla driver
npm run test:redis-json      # Test RedisJSON driver
```

## Benchmarking

Run benchmarks for both drivers:
```bash
npm run bench:redis          # Benchmark vanilla driver
npm run bench:redis-json     # Benchmark RedisJSON driver
```

## Bug Fixes

### Concurrency Issue in Vanilla Driver
Fixed a race condition in the vanilla Redis driver when handling parallel writes to the same key:

**Problem:** Multiple concurrent `set()` operations on nested paths in the same Redis key could overwrite each other, resulting in data loss.

**Solution:** Implemented an in-memory lock system that serializes operations on the same Redis key while allowing parallel operations on different keys.

**Implementation:**
- Added `_locks` Map to track pending operations per key
- `_acquireLock()` method ensures only one operation modifies a key at a time
- Operations on different keys remain fully parallel
- No performance impact on non-concurrent operations

## Next Steps

1. ✅ All code changes completed
2. ✅ Documentation updated
3. ✅ Benchmarks updated
4. ✅ Test both drivers (all tests passing)
5. ⏳ Publish to npm with version bump

## Version Recommendation

This should be released as **v3.2.0** (minor version bump) because:
- New feature added (vanilla Redis driver)
- Breaking change for existing users (package rename)
- API remains compatible

