const DeepBase = require('../index');

const mem = new DeepBase({ name: "demo", path: __dirname }); // db.json

// SET
mem.set("config", "lang", "en");

const configLang = mem.get("config", "lang");
console.log(configLang); // "en"

// ADD
const path = mem.add("user", { name: "martin" });
console.log(path) // [ 'user', 'iKid4OCK' ] / iKid4OCK is a random string

const userName = mem.get(...path, "name");
console.log(userName); // "martin"

// INC
mem.inc(...path, "count", 1);
mem.inc(...path, "count", 1);

const userBalance = mem.get(...path, "count");
console.log(userBalance); // 2

mem.add("user", { name: "anya" });

const userIds = mem.keys("user")
console.log(userIds) // [ 'iKid4OCK', 'F3wORv_J' ]

// UPDATE
mem.upd("config", "lang", v => v.toUpperCase());
const lang = mem.get("config", "lang"); // EN

console.log(mem.get()) // db.json
// {
//     "config": {
//         "lang": "EN"
//     },
//     "user": {
//         "iKid4OCK": {
//             "name": "martin",
//             "count": 2
//         },
//         "F3wORv_J": {
//             "name": "anya"
//         }
//     }
// }

