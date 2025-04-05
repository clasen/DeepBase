import DeepBase from '../index.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mem = new DeepBase({ name: "demo", path: __dirname }); // db.json

// Reset
await mem.del();

// SET
await mem.set("config", "lang", "en");

const configLang = await mem.get("config", "lang");
console.log(configLang); // "en"

// ADD
const path = await mem.add("user", { name: "martin" });
console.log(path) // [ 'user', 'iKid4OCKds' ] / iKid4OCKds is a random string

const userName = await mem.get(...path, "name");
console.log(userName); // "martin"

// INC
await mem.inc(...path, "count", 1);
await mem.inc(...path, "count", 1);

const userBalance = await mem.get(...path, "count");
console.log(userBalance); // 2

await mem.add("user", { name: "anya" });

const userIds = await mem.keys("user")
console.log(userIds) // [ 'iKid4OCKds', 'FEwORvIJsa' ]

const userValues = await mem.values("user")
console.log(userValues)
// [ { name: 'martin', count: 2 }, { name: 'anya' }]

// UPDATE
await mem.upd("config", "lang", v => v.toUpperCase());
const lang = await mem.get("config", "lang"); // EN

console.log(await mem.get()) // db.json
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

