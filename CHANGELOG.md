# Changelog

All notable changes to DeepBase will be documented in this file.

## [3.2.0] - TBD

### ✨ New Features

#### New Redis Drivers
- **`deepbase-redis`**: Vanilla Redis driver (no modules required)
  - Works with any standard Redis installation
  - Uses JSON serialization for data storage
  - Perfect for caching and session storage
  - No external module dependencies
- **`deepbase-redis-json`**: Redis Stack driver (requires RedisJSON module)
  - Previously named `deepbase-redis`
  - Uses native RedisJSON for atomic JSON operations
  - More efficient for large nested objects
  - Requires Redis Stack or RedisJSON module

### 🔧 Breaking Changes

- **Redis driver renamed**: The previous `deepbase-redis` package has been renamed to `deepbase-redis-json`
- **New vanilla Redis driver**: A new `deepbase-redis` package now provides vanilla Redis support without RedisJSON
- **Migration path**: If you were using `deepbase-redis` with Redis Stack, update your imports to use `deepbase-redis-json`

## [3.0.0] - 2025-12-11

### 🎉 Major Release - Architecture Redesign

Complete rewrite with driver-based architecture and multi-backend support.

### ✨ New Features

#### Driver Architecture
- **Modular packages**: Core + drivers as separate npm packages
- **Multi-driver support**: Use multiple storage backends simultaneously
- **Driver interface**: Standard `DeepBaseDriver` class for creating custom drivers
- **Automatic fallback**: Read from first available driver if primary fails
- **Write replication**: Optionally write to all drivers simultaneously

#### Built-in Migration
- **`migrate(fromIndex, toIndex)`**: Migrate data between any two drivers
- **`syncAll()`**: Sync primary driver to all others
- **Progress callbacks**: Track migration progress in real-time
- **Batch processing**: Configurable batch sizes for large datasets

#### New Packages
- **`deepbase`**: Core orchestration library (includes `deepbase-json` as dependency)
- **`deepbase-json`**: JSON filesystem driver (replaces `deepbase` v2)
- **`deepbase-mongodb`**: MongoDB driver (replaces `deepbase-mongo`)
- **`deepbase-redis`**: Redis Stack driver
- **`deepbase-sqlite`**: SQLite driver (embedded database)

### 🔧 Changes

#### API Changes
- **Required `connect()`**: Must call `await db.connect()` before operations
- **Driver instantiation**: Drivers must be wrapped in `new DeepBase(driver)`
- **MongoDB options**: `base` → `database`, `name` → `collection`
- **Redis options**: `name` → `prefix`

#### Configuration Options
- **`writeAll`** (default: `true`): Write to all drivers or primary only
- **`readFirst`** (default: `true`): Read from first available or race all
- **`failOnPrimaryError`** (default: `true`): Throw on primary failure or continue

### 📦 Package Structure

```
deepbase                # Core library (depends on deepbase-json)
deepbase-json           # JSON filesystem driver  
deepbase-mongodb        # MongoDB driver
deepbase-redis          # Redis Stack driver
deepbase-sqlite         # SQLite driver
```

### 🔄 Migration from v2.x

See [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for detailed migration instructions.

**Quick migration:**
```javascript
// v2.x
import DeepBase from 'deepbase';
const db = new DeepBase({ name: 'mydb' });

// v3.0
import DeepBase from 'deepbase';
// JSON driver is included! Use backward-compatible syntax:
const db = new DeepBase({ name: 'mydb' });
// Or explicit: import { JsonDriver } from 'deepbase';
await db.connect();
```

### 🎯 Use Cases Enabled

1. **Development to Production**: Start with JSON, migrate to MongoDB
2. **Redundancy**: Write to MongoDB + JSON backup simultaneously  
3. **High Availability**: Automatic fallback between multiple backends
4. **Performance**: Use Redis as cache with MongoDB persistence
5. **Migration**: Move data between any storage backends

### 📚 Documentation

- New comprehensive README with multi-driver examples
- Individual package documentation
- Migration guide from v2.x
- 4 complete examples demonstrating features

### ✅ Backwards Compatibility

- All v2.x methods work identically in v3.0
- Data format unchanged - can read existing v2.x data files
- Easy migration path with minimal code changes

---

## [2.0.4] - 2024 (Previous Version)

### Changed
- Updated dependencies
- Bug fixes and improvements

## [2.0.0] - 2023

### Added
- Custom JSON serialization support
- Singleton pattern for instances
- Improved error handling

---

## [1.x.x] - 2022-2023

Initial releases with basic functionality.

### Features
- Nested object operations
- JSON file persistence  
- Auto-generated IDs
- Atomic operations

---

[3.0.0]: https://github.com/clasen/DeepBase/releases/tag/v3.0.0
[2.0.4]: https://github.com/clasen/DeepBase/releases/tag/v2.0.4
[2.0.0]: https://github.com/clasen/DeepBase/releases/tag/v2.0.0

