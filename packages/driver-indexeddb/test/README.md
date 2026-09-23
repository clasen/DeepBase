# Testing IndexedDB Driver

Since IndexedDB is a browser API, tests must be run in a browser environment.

## Running Tests

Serve the repository over HTTP and open `test.html` in a browser:

```bash
# from the repository root
python3 -m http.server 8791
# then open http://127.0.0.1:8791/packages/driver-indexeddb/test/test.html
```

Opening the file directly (`file://`) does not work: the page loads ES modules, which the browser blocks outside `http(s)`, and the library uses bare specifiers that the import map inside `test.html` resolves. Once served, tests run automatically on load, the "Run All Tests" button re-runs them, and "Clear Database" resets the test database.

### Headless

`run-headless.js` serves the repository itself and drives a local Chrome/Chromium build through the DevTools protocol, so no npm dependency is required:

```bash
node packages/driver-indexeddb/test/run-headless.js
# or point at a specific binary:
CHROME_PATH="/path/to/chrome" node packages/driver-indexeddb/test/run-headless.js
```

It prints one line per test, exits non-zero when any test fails, and accepts `--port <port>` and `--timeout <ms>`.

## Test Files

- `test.html` - Interactive browser-based test suite with visual feedback

## Manual Testing

You can also test manually using the browser console:

```javascript
import DeepBase from 'deepbase';
import IndexedDBDriver from 'deepbase-indexeddb';

const db = new DeepBase(new IndexedDBDriver({
  name: 'manual-test',
  version: 1
}));

await db.connect();

// Test basic operations
await db.set('test', 'value', 'hello');
console.log(await db.get('test', 'value')); // 'hello'

// Test nested operations
await db.set('users', 'alice', { name: 'Alice', age: 30 });
console.log(await db.get('users', 'alice'));

await db.disconnect();
```

## Debugging

Open Chrome DevTools:
1. Go to "Application" tab
2. Expand "IndexedDB" in the sidebar
3. Find your database
4. Inspect stored data

## Browser Compatibility

Tests should work in:
- Chrome 24+
- Firefox 16+
- Safari 10+
- Edge (all versions)
- Opera 15+
