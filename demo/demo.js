const DeepBase = require('../index');

const mem = new DeepBase({ name: "demo", path: __dirname }); // db.json

// Reset
mem.del();

// SET
mem.set("config", "lang", "en");

const configLang = mem.get("config", "lang");
console.log(configLang); // "en"

// ADD
const path = mem.add("user", { name: "martin" });
console.log(path) // [ 'user', 'iKid4OCKds' ] / iKid4OCKds is a random string

const userName = mem.get(...path, "name");
console.log(userName); // "martin"

// INC
mem.inc(...path, "count", 1);
mem.inc(...path, "count", 1);

const userBalance = mem.get(...path, "count");
console.log(userBalance); // 2

mem.add("user", { name: "anya" });

const userIds = mem.keys("user")
console.log(userIds) // [ 'iKid4OCKds', 'FEwORvIJsa' ]

const userValues = mem.values("user")
console.log(userValues)
// [ { name: 'martin', count: 2 }, { name: 'anya' }]

// UPDATE
mem.upd("config", "lang", v => v.toUpperCase());
const lang = mem.get("config", "lang"); // EN

console.log(mem.get()) // db.json
// {
//     "config": {
//         "lang": "EN"
//     },
//     "user": {
//         "iKid4OCKds": {
//             "name": "martin",
//             "count": 2
//         },
//         "FEwORvIJsa": {
//             "name": "anya"
//         }
//     }
// }

