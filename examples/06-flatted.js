/**
 * Example: Using flatted for circular reference support
 * 
 * Flatted allows you to serialize/deserialize objects with circular references
 * This is useful when you need to store complex object graphs
 */

import DeepBase from 'deepbase';
import { resolvePath } from 'deepbase/path';
import { parse, stringify } from 'flatted';

const dataPath = resolvePath(import.meta.url, './examples/data');

// Create DeepBase with flatted serialization
const db = new DeepBase({ 
  path: dataPath,
  name: 'flatted-example',
  stringify,  // Use flatted's stringify instead of JSON.stringify
  parse       // Use flatted's parse instead of JSON.parse
});

await db.connect();

console.log('🔄 DeepBase with Flatted Support\n');

// Example 1: Store object with circular reference
console.log('📝 Example 1: Circular References');
const user = {
  name: 'Alice',
  age: 30
};

const post = {
  title: 'My First Post',
  content: 'Hello World!',
  author: user
};

// Create circular reference
user.latestPost = post;

console.log('Creating user with circular reference to post...');
await db.set('circular', 'user', user);

// Retrieve the data
const retrievedUser = await db.get('circular', 'user');
console.log('✅ Retrieved user:', {
  name: retrievedUser.name,
  age: retrievedUser.age,
  latestPost: {
    title: retrievedUser.latestPost.title,
    authorName: retrievedUser.latestPost.author.name
  }
});
console.log('✅ Circular reference preserved:', retrievedUser.latestPost.author === retrievedUser);
console.log();

// Example 2: Complex object graph
console.log('📝 Example 2: Complex Object Graph');

const node1 = { id: 1, name: 'Node 1', connections: [] };
const node2 = { id: 2, name: 'Node 2', connections: [] };
const node3 = { id: 3, name: 'Node 3', connections: [] };

// Create circular graph
node1.connections.push(node2, node3);
node2.connections.push(node3, node1);
node3.connections.push(node1, node2);

const graph = {
  nodes: [node1, node2, node3],
  root: node1
};

await db.set('graph', 'network', graph);
console.log('✅ Stored complex circular graph');

const retrievedGraph = await db.get('graph', 'network');
console.log('✅ Retrieved graph with', retrievedGraph.nodes.length, 'nodes');
console.log('✅ Root node:', retrievedGraph.root.name);
console.log('✅ Root connections:', retrievedGraph.root.connections.map(n => n.name).join(', '));
console.log('✅ Circular references preserved:', 
  retrievedGraph.nodes[0].connections[0].connections[1] === retrievedGraph.nodes[0]
);
console.log();

// Example 3: Self-referencing object
console.log('📝 Example 3: Self-Referencing Object');

const recursive = {
  name: 'Recursive Object',
  value: 42
};
recursive.self = recursive;
recursive.parent = recursive;

await db.set('self', 'reference', recursive);
const retrievedSelf = await db.get('self', 'reference');
console.log('✅ Retrieved self-referencing object');
console.log('✅ Self reference check:', retrievedSelf.self === retrievedSelf);
console.log('✅ Parent reference check:', retrievedSelf.parent === retrievedSelf);
console.log();

// Example 4: Array with circular references
console.log('📝 Example 4: Array with Circular References');

const arr = [1, 2, 3];
arr.push(arr); // Array contains itself
const data = {
  name: 'Circular Array',
  items: arr
};

await db.set('arrays', 'circular', data);
const retrievedArr = await db.get('arrays', 'circular');
console.log('✅ Retrieved circular array');
console.log('✅ Array length:', retrievedArr.items.length);
console.log('✅ First 3 items:', retrievedArr.items.slice(0, 3));
console.log('✅ 4th item is array itself:', Array.isArray(retrievedArr.items[3]));
console.log();

// Example 5: Compare with standard JSON (would fail)
console.log('📝 Example 5: Why Flatted is Needed');
console.log('❌ Standard JSON.stringify would fail with circular references:');

try {
  const circular = { name: 'Test' };
  circular.self = circular;
  JSON.stringify(circular);
} catch (error) {
  console.log('   Error:', error.message);
}

console.log('✅ Flatted handles it gracefully!');
console.log();

await db.disconnect();
console.log('✨ Example complete!');
