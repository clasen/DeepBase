const DeepBase = require('../index');
const { parse, stringify } = require('flatted');

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
customDB.set("a", "b", "circular", "self", customDB.get("a", "b"));

// Retrieve and log the data
const retrievedData = customDB.get("a", "b");
console.log("Retrieved data:", retrievedData);
console.log("Circular reference preserved:", retrievedData.circular.self === retrievedData);
