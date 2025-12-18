# DeepBase Examples

This folder contains examples demonstrating the DeepBase multi-driver system.

## Prerequisites

### For MongoDB examples:
```bash
docker run -d -p 27017:27017 --name mongodb mongodb/mongodb-community-server:latest
```

### For Redis examples:
```bash
# For vanilla Redis (used in examples)
docker run -d -p 6379:6379 --name redis redis:latest

# Or for Redis Stack with RedisJSON (for deepbase-redis-json)
docker run -d -p 6379:6379 --name redis-stack redis/redis-stack-server:latest
```

## Running Examples

### Example 1: Simple JSON Driver
```bash
npm run example1
```
Demonstrates basic usage with a single JSON driver.

### Example 2: Multi-Driver (MongoDB + JSON)
```bash
npm run example2
```
Shows how to use multiple drivers with automatic fallback.

### Example 3: Migration from JSON to MongoDB
```bash
npm run example3
```
Demonstrates migrating existing data from JSON to MongoDB.

### Example 4: Three-Tier Architecture
```bash
npm run example4
```
Advanced setup with MongoDB (primary), JSON (backup), and Redis (cache).

## What You'll Learn

- **Single driver usage**: Basic operations with JSON filesystem driver
- **Multi-driver setup**: Combining drivers with priorities
- **Data migration**: Moving data between different backends
- **Automatic fallback**: How the system handles driver failures
- **Three-tier architecture**: Building resilient systems with multiple backends

## Notes

- All examples create data in the `./data` directory
- MongoDB and Redis examples require the respective services running
- The system gracefully handles missing drivers and provides fallback

