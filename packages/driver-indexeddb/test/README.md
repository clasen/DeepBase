# Testing IndexedDB Driver

Since IndexedDB is a browser API, tests must be run in a browser environment.

## Running Tests

1. Open `test.html` in a web browser
2. Tests will automatically run when the page loads
3. You can also click "Run All Tests" button to re-run tests
4. Use "Clear Database" to reset the test database

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

