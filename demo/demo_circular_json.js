const DeepBase = require('../index');
const CircularJSON = require('circular-json');

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
    customDB.set(...path, "circular", "self", customDB.get(...path));

    // Retrieve and log the data
    const retrievedData = customDB.get(...path);
    console.log("Retrieved data:", retrievedData);
    console.log("Circular reference preserved:", retrievedData.circular.self === retrievedData);

} main();