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
customDB.del();

// Set some data
customDB.set("a", "b", { circular: {} });
customDB.set("a", "b", "circular", "self", customDB.getRef("a", "b"));

// Retrieve and log the data
const retrievedData = customDB.getRef("a", "b");
console.log("Retrieved data:", retrievedData);
console.log("Circular reference preserved:", retrievedData.circular.self === retrievedData);
