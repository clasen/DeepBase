# deepbase-json

JSON filesystem driver for DeepBase.

## Installation

```bash
npm install deepbase
# deepbase-json is included automatically as a dependency
```

## Description

Stores data in JSON files on the filesystem. Perfect for:

- ✅ Development and testing
- ✅ Small to medium datasets
- ✅ Human-readable data
- ✅ No external dependencies needed
- ✅ Version control friendly

## Usage

```javascript
import DeepBase, { JsonDriver } from 'deepbase';

const db = new DeepBase(new JsonDriver({
  path: './data',
  name: 'mydb'
}));

await db.connect();

await db.set('users', 'alice', { name: 'Alice', age: 30 });
const alice = await db.get('users', 'alice');
```

## Options

```javascript
new JsonDriver({
  path: './data',              // Directory to store JSON files
  name: 'default',            // Filename (without .json)
  nidAlphabet: 'ABC...',      // Alphabet for ID generation
  nidLength: 10,              // Length of generated IDs
  stringify: JSON.stringify,  // Custom JSON serializer
  parse: JSON.parse          // Custom JSON parser
})
```

## Features

### Singleton Pattern

Multiple instances pointing to the same file will share the same data:

```javascript
const db1 = new DeepBase(new JsonDriver({ name: 'mydb' }));
const db2 = new DeepBase(new JsonDriver({ name: 'mydb' }));
// Both use the same underlying data
```

### Custom Serialization

Support for circular references and custom serialization:

```javascript
import CircularJSON from 'circular-json';

const db = new DeepBase(new JsonDriver({
  stringify: (obj) => CircularJSON.stringify(obj, null, 4),
  parse: CircularJSON.parse
}));
```

### Atomic Writes

Uses `steno` for atomic file writes, preventing data corruption.

## File Structure

Data is stored as JSON files:

```
data/
  mydb.json
  users.json
  config.json
```

## Example Data

```json
{
  "users": {
    "alice": {
      "name": "Alice",
      "age": 30
    },
    "bob": {
      "name": "Bob",
      "age": 25
    }
  },
  "config": {
    "theme": "dark",
    "lang": "en"
  }
}
```

## Use Cases

- **Development**: Quick prototyping without database setup
- **Testing**: Easy to inspect and modify test data
- **Small Apps**: Perfect for configuration and small datasets
- **Backup**: Use as secondary driver for data backup
- **Version Control**: Human-readable, git-friendly format

## Migration

Easy to migrate from JSON to other drivers:

```javascript
import DeepBase, { JsonDriver } from 'deepbase';
import MongoDriver from 'deepbase-mongodb';

const db = new DeepBase([
  new JsonDriver({ path: './data' }),
  new MongoDriver({ url: 'mongodb://localhost:27017' })
]);

await db.connect();
await db.migrate(0, 1); // Migrate JSON to MongoDB
```

## License

MIT - Copyright (c) Martin Clasen

