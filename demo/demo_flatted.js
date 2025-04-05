import DeepBase from '../index.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { parse, stringify } from 'flatted';

// Create a new DeepBase instance with custom serializer and deserializer
const customDB = new DeepBase({
    name: "demo_flatted",
    path: __dirname,
    stringify,
    parse
});

// Reset the custom database
await customDB.del();

// Set some data
await customDB.set("a", "b", { circular: {} });
await customDB.set("a", "b", "circular", "self", await customDB.getRef("a", "b"));

// Retrieve and log the data
const retrievedData = await customDB.getRef("a", "b");
console.log("Retrieved data:", retrievedData);
console.log("Circular reference preserved:", retrievedData.circular.self === retrievedData);
