# 🌐 DeepBase IndexedDB Driver

**Browser-based persistence using IndexedDB**

The IndexedDB driver allows you to use DeepBase in browser environments with full offline capabilities. Perfect for Progressive Web Apps (PWAs), single-page applications, and any web app that needs reliable client-side storage.

## ✨ Features

- 🌐 **Browser-native**: Uses IndexedDB API built into modern browsers
- 📴 **Offline-first**: Works without network connectivity
- 💾 **Large storage**: Can store much more data than localStorage (typically hundreds of MBs)
- 🔒 **Concurrency-safe**: Built-in operation queuing prevents race conditions
- 🚀 **Fast**: Asynchronous operations with IndexedDB transactions
- 🔄 **PWA-ready**: Perfect for Progressive Web Apps
- 🛡️ **Type-safe**: Full support for nested objects and arrays
- 🎯 **Same API**: Use the exact same DeepBase API in browser and Node.js

## 📦 Installation

```bash
npm install deepbase deepbase-indexeddb
```

Or via CDN:

```html
<script type="module">
  import DeepBase from 'https://cdn.skypack.dev/deepbase';
  import IndexedDBDriver from 'https://cdn.skypack.dev/deepbase-indexeddb';
  
  // Your code here
</script>
```

## 🚀 Quick Start

### Basic Usage (Production)

When using the published NPM packages:

```javascript
import DeepBase from 'deepbase';
import IndexedDBDriver from 'deepbase-indexeddb';

// Create database instance
const db = new DeepBase(new IndexedDBDriver({
  name: 'myapp',        // Database name
  version: 1,           // Database version
  storeName: 'store'    // Object store name (optional)
}));

// Connect to database
await db.connect();

// Store data
await db.set('users', 'alice', { 
  name: 'Alice', 
  email: 'alice@example.com',
  settings: {
    theme: 'dark',
    notifications: true
  }
});

// Retrieve data
const alice = await db.get('users', 'alice');
console.log(alice.settings.theme); // 'dark'

// Update nested values
await db.set('users', 'alice', 'settings', 'theme', 'light');

// Delete data
await db.del('users', 'alice');

// Disconnect when done
await db.disconnect();
```

### Using with a Bundler (Webpack, Vite, etc.)

For browser applications using a bundler, you can import normally:

```javascript
import DeepBase from 'deepbase';
import IndexedDBDriver from 'deepbase-indexeddb';

const db = new DeepBase(new IndexedDBDriver({
  name: 'myapp',
  version: 1
}));

await db.connect();
// ... your code
```

### Using without a Bundler (Plain HTML)

**Good news!** DeepBase now works directly in the browser thanks to dynamic imports:

```html
<script type="module">
  // Import directly from local files
  import DeepBase from './path/to/packages/core/src/index.js';
  import { IndexedDBDriver } from './path/to/packages/driver-indexeddb/src/IndexedDBDriver.js';
  
  // Use the full DeepBase class with all features!
  const db = new DeepBase(new IndexedDBDriver({
    name: 'myapp',
    version: 1
  }));
  
  await db.connect();
  await db.set('users', 'alice', { name: 'Alice' });
  const alice = await db.get('users', 'alice');
  console.log(alice);
</script>
```

Or via CDN (once published):

```html
<script type="module">
  import DeepBase from 'https://cdn.skypack.dev/deepbase';
  import IndexedDBDriver from 'https://cdn.skypack.dev/deepbase-indexeddb';
  
  const db = new DeepBase(new IndexedDBDriver({
    name: 'myapp',
    version: 1
  }));
  
  await db.connect();
  // Your code here
</script>
```

**Note:** The full DeepBase class now works in browsers! You get all features including multi-driver support, timeouts, and advanced operations.

### Progressive Web App Example

```javascript
import DeepBase from 'deepbase';
import IndexedDBDriver from 'deepbase-indexeddb';

class TodoApp {
  constructor() {
    this.db = new DeepBase(new IndexedDBDriver({
      name: 'todoapp',
      version: 1
    }));
  }
  
  async init() {
    await this.db.connect();
    
    // Initialize default data if needed
    const todos = await this.db.get('todos');
    if (!todos) {
      await this.db.set('todos', {});
    }
  }
  
  async addTodo(text) {
    const todoPath = await this.db.add('todos', {
      text,
      completed: false,
      createdAt: Date.now()
    });
    return todoPath[1]; // Return the auto-generated ID
  }
  
  async toggleTodo(id) {
    await this.db.upd('todos', id, 'completed', val => !val);
  }
  
  async getTodos() {
    return await this.db.get('todos');
  }
  
  async deleteTodo(id) {
    await this.db.del('todos', id);
  }
}

// Usage
const app = new TodoApp();
await app.init();

const id = await app.addTodo('Learn DeepBase');
console.log('Created todo:', id);

await app.toggleTodo(id);
const todos = await app.getTodos();
console.log('All todos:', todos);
```

## 🎯 Configuration Options

```javascript
new IndexedDBDriver({
  name: 'mydb',         // Database name (default: 'deepbase')
  version: 1,           // Database version (default: 1)
  storeName: 'store',   // Object store name (default: 'store')
  
  // Inherited from DeepBaseDriver:
  nidAlphabet: 'ABC...', // Custom alphabet for auto-generated IDs
  nidLength: 10          // Length of auto-generated IDs
})
```

## 📚 API Reference

The IndexedDB driver supports all standard DeepBase operations:

### Basic Operations

```javascript
// Get value at path
const value = await db.get('path', 'to', 'value');

// Set value at path
await db.set('path', 'to', 'value', 'hello');

// Delete value at path
await db.del('path', 'to', 'value');
```

### Array Operations

```javascript
// Add item with auto-generated ID
const path = await db.add('items', { name: 'Item 1' });
// Returns: ['items', 'aB3xK9mL2n']

// Pop last item from array
const item = await db.pop('myArray');

// Shift first item from array
const first = await db.shift('myArray');
```

### Numeric Operations

```javascript
// Increment number
await db.inc('counter', 1);

// Decrement number
await db.dec('counter', 1);
```

### Update with Functions

```javascript
// Update value using a function
await db.upd('user', 'name', name => name.toUpperCase());
```

### Object Operations

```javascript
// Get keys
const keys = await db.keys('users');

// Get values
const values = await db.values('users');

// Get entries
const entries = await db.entries('users');
```

## 🔒 Concurrency Safety

The IndexedDB driver includes built-in operation queuing to prevent race conditions:

```javascript
// These operations are safely serialized
await Promise.all([
  db.inc('counter', 1),
  db.inc('counter', 1),
  db.inc('counter', 1)
]);

const counter = await db.get('counter');
console.log(counter); // Always 3, never less
```

## 🌐 Browser Compatibility

The IndexedDB driver works in all modern browsers that support IndexedDB:

- ✅ Chrome 24+
- ✅ Firefox 16+
- ✅ Safari 10+
- ✅ Edge (all versions)
- ✅ Opera 15+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile, etc.)

## 💡 Use Cases

### Progressive Web Apps (PWAs)

```javascript
// Store user preferences
await db.set('preferences', {
  theme: 'dark',
  language: 'en',
  notifications: true
});

// Cache API responses
await db.set('cache', 'users', apiResponse);
```

### Offline-First Applications

```javascript
// Queue operations while offline
if (!navigator.onLine) {
  await db.add('syncQueue', {
    action: 'updateUser',
    data: userData,
    timestamp: Date.now()
  });
}

// Sync when back online
window.addEventListener('online', async () => {
  const queue = await db.get('syncQueue');
  // Process queue...
  await db.del('syncQueue');
});
```

### Client-Side State Management

```javascript
// Store application state
await db.set('app', 'state', {
  currentUser: userId,
  openModals: ['settings'],
  cart: [item1, item2]
});

// Restore state on page load
const state = await db.get('app', 'state');
```

### Form Data Persistence

```javascript
// Auto-save form data
document.querySelector('#myForm').addEventListener('input', async (e) => {
  await db.set('forms', 'contact', e.target.form.id, e.target.value);
});

// Restore form data
const savedData = await db.get('forms', 'contact');
```

## 🔄 Multi-Driver Setup

Combine IndexedDB with other drivers for advanced scenarios:

```javascript
import DeepBase from 'deepbase';
import IndexedDBDriver from 'deepbase-indexeddb';
import JsonDriver from 'deepbase-json';

// Browser: Use IndexedDB
// Node.js: Use JSON files
const db = new DeepBase(
  typeof window !== 'undefined'
    ? new IndexedDBDriver({ name: 'myapp' })
    : new JsonDriver({ path: './data', name: 'myapp' })
);

await db.connect();
// Same code works in both environments!
```

## 🛠️ Advanced Features

### Database Versioning

```javascript
// Upgrade database version when schema changes
const db = new DeepBase(new IndexedDBDriver({
  name: 'myapp',
  version: 2  // Increment version number
}));

// IndexedDB will automatically handle the upgrade
await db.connect();
```

### Multiple Object Stores

```javascript
// Create separate stores for different data types
const usersDB = new DeepBase(new IndexedDBDriver({
  name: 'myapp',
  storeName: 'users'
}));

const postsDB = new DeepBase(new IndexedDBDriver({
  name: 'myapp',
  storeName: 'posts'
}));

await usersDB.connect();
await postsDB.connect();
```

### Custom ID Generation

```javascript
const db = new DeepBase(new IndexedDBDriver({
  name: 'myapp',
  nidAlphabet: '0123456789',  // Numbers only
  nidLength: 6                // 6 digits
}));

const path = await db.add('items', { name: 'Item' });
// ID will be something like: ['items', '123456']
```

## ⚠️ Limitations

- **Browser-only**: This driver only works in browser environments with IndexedDB support
- **Storage limits**: Browser-dependent (typically 50-100MB, but can be more)
- **Same-origin policy**: Data is isolated per domain
- **Not suitable for**: Node.js, server-side rendering (SSR) initial render

For Node.js environments, use:
- `deepbase-json` for development
- `deepbase-sqlite` for production
- `deepbase-mongodb` for scalability
- `deepbase-redis` for caching

## 🔍 Debugging

### Check Database in Browser DevTools

1. Open Chrome DevTools
2. Go to "Application" tab
3. Expand "IndexedDB" in the sidebar
4. Find your database name
5. Inspect stored data

### Common Issues

**Error: "IndexedDB is not available"**
- This driver requires a browser environment
- Check that you're not running in Node.js
- Ensure browser supports IndexedDB

**Data not persisting**
- Make sure to call `await db.connect()` before operations
- Check browser storage settings/permissions
- Verify you're not in private/incognito mode (some browsers restrict storage)

## 📝 TypeScript Support

```typescript
import DeepBase from 'deepbase';
import IndexedDBDriver from 'deepbase-indexeddb';

interface User {
  name: string;
  email: string;
  settings: {
    theme: 'light' | 'dark';
    notifications: boolean;
  };
}

const db = new DeepBase(new IndexedDBDriver({
  name: 'myapp'
}));

await db.connect();

// TypeScript will infer types
await db.set('users', 'alice', {
  name: 'Alice',
  email: 'alice@example.com',
  settings: {
    theme: 'dark',
    notifications: true
  }
} as User);

const alice = await db.get('users', 'alice') as User;
```

## 🤝 Contributing

Found a bug or want to contribute? Check out the [main repository](https://github.com/clasen/DeepBase).

## 📄 License

MIT License - Copyright (c) Martin Clasen

## 🔗 Links

- [Main Documentation](https://github.com/clasen/DeepBase)
- [GitHub Repository](https://github.com/clasen/DeepBase)
- [Report Issues](https://github.com/clasen/DeepBase/issues)
- [Other Drivers](https://github.com/clasen/DeepBase/tree/main/packages)

---

🚀 **Build amazing offline-first web apps with DeepBase + IndexedDB!**

