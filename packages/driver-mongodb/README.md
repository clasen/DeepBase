# deepbase-mongodb

MongoDB driver for DeepBase.

## Installation

```bash
npm install deepbase deepbase-mongodb
```

## Prerequisites

Requires MongoDB server:

```bash
docker run -d -p 27017:27017 --name mongodb mongodb/mongodb-community-server:latest
```

## Description

Stores data in MongoDB collections. Perfect for:

- ✅ Production applications
- ✅ Large datasets
- ✅ Complex queries
- ✅ Scalability and replication
- ✅ Cloud deployment

## Usage

```javascript
import DeepBase from 'deepbase';
import MongoDriver from 'deepbase-mongodb';

const db = new DeepBase(new MongoDriver({
  url: 'mongodb://localhost:27017',
  database: 'myapp',
  collection: 'documents'
}));

await db.connect();

await db.set('users', 'alice', { name: 'Alice', age: 30 });
const alice = await db.get('users', 'alice');
```

## Options

```javascript
new MongoDriver({
  url: 'mongodb://localhost:27017',  // MongoDB connection URL
  database: 'deepbase',              // Database name (or use 'base')
  collection: 'documents',           // Collection name (or use 'name')
  nidAlphabet: 'ABC...',            // Alphabet for ID generation
  nidLength: 10                      // Length of generated IDs
})
```

## Data Structure

Data is stored as MongoDB documents:

```javascript
// Document structure
{
  _id: "users",
  alice: {
    name: "Alice",
    age: 30
  },
  bob: {
    name: "Bob",
    age: 25
  }
}
```

## Features

### Nested Operations

MongoDB's dot notation is used for nested operations:

```javascript
await db.set('users', 'alice', 'address', 'city', 'New York');
// Stored as: { users.alice.address.city: "New York" }
```

### Atomic Increment/Decrement

Uses MongoDB's `$inc` operator for atomic operations:

```javascript
await db.inc('users', 'alice', 'balance', 100);
await db.dec('users', 'alice', 'balance', 50);
```

### Upsert by Default

All set operations use upsert, creating documents if they don't exist.

## Multi-Driver with MongoDB Primary

Common pattern: MongoDB for production, JSON for backup:

```javascript
import DeepBase from 'deepbase';
import MongoDriver from 'deepbase-mongodb';
import { JsonDriver } from 'deepbase';

const db = new DeepBase([
  new MongoDriver({ 
    url: process.env.MONGO_URL,
    database: 'production'
  }),
  new JsonDriver({ path: './backup' })
], {
  writeAll: true,           // Replicate to JSON
  failOnPrimaryError: false // Fallback to JSON if MongoDB fails
});

await db.connect();
```

## Migration from JSON

Migrate existing JSON data to MongoDB:

```javascript
import DeepBase from '@deepbase/core';
import { JsonDriver } from 'deepbase';
import MongoDriver from '@deepbase/mongodb';

const db = new DeepBase([
  new JsonDriver({ path: './data' }),
  new MongoDriver({ url: 'mongodb://localhost:27017' })
]);

await db.connect();
await db.migrate(0, 1); // JSON -> MongoDB

console.log('Migration complete!');
```

## Connection String Formats

```javascript
// Local
url: 'mongodb://localhost:27017'

// With auth
url: 'mongodb://username:password@localhost:27017'

// MongoDB Atlas
url: 'mongodb+srv://username:password@cluster.mongodb.net'

// Replica set
url: 'mongodb://host1:27017,host2:27017,host3:27017/?replicaSet=myReplSet'
```

## Best Practices

1. **Use environment variables** for connection strings
2. **Enable retryWrites** for production: `?retryWrites=true`
3. **Use connection pooling** (handled automatically by driver)
4. **Index frequently accessed fields** in MongoDB
5. **Use with JSON backup** for redundancy

## Error Handling

```javascript
try {
  await db.connect();
} catch (error) {
  console.error('MongoDB connection failed:', error);
  // Fallback to JSON driver or handle gracefully
}
```

## License

MIT - Copyright (c) Martin Clasen

