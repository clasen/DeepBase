# 🌳 DeepBase

DeepBase is the fastest and simplest way to add persistence to your projects while allowing you to view information in a user-friendly format.

A powerful JSON-based storage library that allows you to store, retrieve, and modify nested objects with ease.

## 📦 Installation
```shell
npm install deepbase
```

## 🔧 Usage
```js
const DeepBase = require("deepbase");
const mem = new DeepBase({ name: "db" }); // db.json
```

### ✍️ Setting Values
```js
mem.set("config", "lang", "en");

const configLang = mem.get("config", "lang");
console.log(configLang); // "en"
```

### ✅ Adding Rows
```js
const path = mem.add("user", { name: "martin" });

// add() will create a secure key (ie. "iKidAOCKds")
console.log(path) // [ 'user', 'iKidAOCKds' ]

const userName = mem.get(...path, "name");
console.log(userName); // "martin"
```

### 🔢 Increment fields
```js
mem.inc(...path, "balance", 160);
mem.inc(...path, "balance", 420);

const userBalance = mem.get(...path, "balance");
console.log(userBalance); // 580
```

### ⚗️ Update
```js
mem.upd("config", "lang", v => v.toUpperCase());
const lang = mem.get("config", "lang"); // EN
```

### 🔥 Finally
```js
mem.add("user", { name: "anya" });

const userIds = mem.keys("user")
console.log(userIds) // [ 'iKidAOCKds', 'FEwORvJjs' ]

console.log(mem.get()) // db.json
// {
//     config: { lang: 'EN' },
//     user: {
//         iKidAOCKds: { name: 'martin', balance: 580 },
//         FEwORvJjs: { name: 'anya' }
//     }
// }
```

## 🧪 Custom JSON Serialization

DeepBase supports custom JSON serialization, allowing for circular references in complex data structures.

### Example with `CircularJSON`:
```javascript
const CircularJSON = require('circular-json');
const db = new DeepBase({
    stringify: (obj) => CircularJSON.stringify(obj, null, 4),
    parse: CircularJSON.parse
});

db.set("a", "b", { circular: {} });
db.set("a", "b", "circular", "self", customDB.get("a", "b"));
```

### Example with `flatted`:
```javascript
const { parse, stringify } = require('flatted');
const db = new DeepBase({ stringify, parse });
```

## 🤯 Features
- 🔍 Easily access and modify nested objects in JSON storage.
- 📁 Automatically save changes to a file.
- 🌱 Simple and intuitive API for managing complex JSON structures.

## 🤔 Why DeepBase 
- ⚡ Fastest and simplest way to add persistence to your projects.
- 📖 View information in a user-friendly format.
- 🧠 Easy to use and understand.

## 🤝 Contributing
Contributions to DeepBase are welcome! If you have an idea or a bug to report, please open an issue. If you would like to contribute to the code, please open a pull request.

## 🎬 Conclusion
DeepBase is a powerful and flexible solution for managing complex JSON structures.

🚀 Try it out and simplify your code today!

## 📄 License
The MIT License (MIT)

Copyright (c) Martin Clasen

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.