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

async function main() {


    // Reset the custom database
    customDB.del();

    // Set some data
    const path = await customDB.set("a", "b", { circular: {} });
    customDB.set(...path, "circular", "self", customDB.getRef(...path));

    // Retrieve and log the data
    const retrievedData = customDB.getRef(...path);
    console.log("Retrieved data:", retrievedData);
    console.log("Circular reference preserved:", retrievedData.circular.self === retrievedData);

} main();