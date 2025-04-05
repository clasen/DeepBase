import DeepBase from '../index.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import CircularJSON from 'circular-json';

// Create a new DeepBase instance with custom serializer and deserializer
const customDB = new DeepBase({
    name: "demo_circular_json",
    path: __dirname,
    stringify: (obj) => CircularJSON.stringify(obj, null, 4),
    parse: CircularJSON.parse
});



// Reset the custom database
await customDB.del();

// Set some data
const path = await customDB.set("a", "b", { circular: {} });
await customDB.set(...path, "circular", "self", await customDB.getRef(...path));

// Retrieve and log the data
const retrievedData = await customDB.getRef(...path);
console.log("Retrieved data:", retrievedData);
console.log("Circular reference preserved:", retrievedData.circular.self === retrievedData);
