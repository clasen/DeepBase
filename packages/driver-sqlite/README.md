# deepbase-sqlite

SQLite driver for DeepBase.

## Installation

```bash
npm install deepbase deepbase-sqlite
```

## Description

Stores data in SQLite database files. Perfect for:

- ✅ Production applications
- ✅ Medium to large datasets
- ✅ Fast queries and transactions
- ✅ ACID compliance
- ✅ Embedded database solution
- ✅ Zero configuration needed

## Usage

```javascript
import DeepBase from 'deepbase';
import SqliteDriver from 'deepbase-sqlite';

const db = new DeepBase(new SqliteDriver({
  path: './data',
  name: 'mydb'
}));

await db.connect();

await db.set('users', 'alice', { name: 'Alice', age: 30 });
const alice = await db.get('users', 'alice');
```

## Options

```javascript
new SqliteDriver({
  path: './data',              // Directory to store database files
  name: 'default',            // Database filename (without .db)
  nidAlphabet: 'ABC...',      // Alphabet for ID generation
  nidLength: 10               // Length of generated IDs
})
```

## Features

### High Performance

Uses `better-sqlite3` for synchronous operations wrapped in async API:

- Prepared statements for optimal performance
- Transaction support for batch operations
- Fast lookups with indexed keys

### Singleton Pattern

Multiple instances pointing to the same database file will share the same connection:

```javascript
const db1 = new DeepBase(new SqliteDriver({ name: 'mydb' }));
const db2 = new DeepBase(new SqliteDriver({ name: 'mydb' }));
// Both use the same underlying database connection
```

### Nested Data Structure

Efficiently stores nested objects using a key-value schema:

- Keys are stored as dot-notation paths (e.g., `user.profile.name`)
- Values are stored as JSON
- Fast lookups for both exact keys and partial paths

### ACID Compliance

SQLite provides:

- **Atomicity**: All operations complete or none do
- **Consistency**: Data remains valid across transactions
- **Isolation**: Concurrent operations don't interfere
- **Durability**: Committed data persists even after crashes

## Database Structure

Data is stored in a simple key-value table:

```sql
CREATE TABLE deepbase (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
```

Example data:

```
key                    | value
-----------------------|------------------
users.alice.name       | "Alice"
users.alice.age        | 30
users.bob.name         | "Bob"
users.bob.age          | 25
config.theme           | "dark"
config.lang            | "en"
```

## Use Cases

- **Production Apps**: Reliable embedded database for web/desktop apps
- **Medium Datasets**: Handles millions of records efficiently
- **Offline First**: Works without network or external database server
- **Desktop Apps**: Perfect for Electron or Tauri applications
- **Mobile Apps**: Lightweight database for React Native/Capacitor
- **IoT Devices**: Embedded storage for edge computing
- **Serverless**: Deploy with your functions, no external DB needed

## Performance

SQLite offers excellent performance:

- Fast reads and writes with prepared statements
- Efficient indexing for quick lookups
- Transaction batching for bulk operations
- Low memory footprint

## Migration

Easy to migrate between SQLite and other drivers:

```javascript
import DeepBase from 'deepbase';
import SqliteDriver from 'deepbase-sqlite';
import MongoDriver from 'deepbase-mongodb';

const db = new DeepBase([
  new SqliteDriver({ path: './data' }),
  new MongoDriver({ url: 'mongodb://localhost:27017' })
]);

await db.connect();
await db.migrate(0, 1); // Migrate SQLite to MongoDB
```

## File Structure

Data is stored as SQLite database files:

```
data/
  mydb.db
  users.db
  config.db
```

## Comparison with JSON Driver

| Feature | SQLite | JSON |
|---------|--------|------|
| Performance | ⚡ Very Fast | 🐌 Slower for large data |
| File Size | 📦 Compact | 📄 Human readable |
| Transactions | ✅ ACID | ❌ No transactions |
| Query Speed | 🚀 Indexed | 🔍 Full scan |
| Reliability | 💪 Very High | ⚠️ File corruption risk |
| Debugging | 🔧 SQL tools | 👁️ Easy to inspect |

## Best Practices

### Use Transactions for Bulk Operations

```javascript
// Better: Use root object set for bulk inserts
const data = {
  user1: { name: 'Alice' },
  user2: { name: 'Bob' },
  user3: { name: 'Charlie' }
};
await db.set('users', data);
```

### Disconnect Properly

```javascript
// Always disconnect to close database connection
await db.disconnect();
```

### Use Appropriate Paths

```javascript
// Good: Organize data hierarchically
await db.set('users', userId, 'profile', data);

// Avoid: Flat structure loses benefits of nesting
await db.set(`user_${userId}_profile`, data);
```

## License

MIT - Copyright (c) Martin Clasen


