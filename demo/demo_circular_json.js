const DeepBase = require('../index');
const CircularJSON = require('circular-json');

// Create a new DeepBase instance with custom serializer and deserializer
const customDB = new DeepBase({
    name: "demo_circular_json",
    path: __dirname,
    stringify: (obj) => CircularJSON.stringify(obj, null, 4),
    parse: CircularJSON.parse
});

// Reset the custom database
customDB.del();

// Set some data
customDB.set("a", "b", { circular: {} });
customDB.set("a", "b", "circular", "self", customDB.get("a", "b"));

// Retrieve and log the data
const retrievedData = customDB.get("a", "b");
console.log("Retrieved data:", retrievedData);
console.log("Circular reference preserved:", retrievedData.circular.self === retrievedData);

// Log the raw file content
// const fs = require('fs');
// const rawContent = fs.readFileSync(customDB.fileName, 'utf8');
// console.log("Raw file content:");
// console.log(rawContent);