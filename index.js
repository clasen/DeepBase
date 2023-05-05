const steno = require("steno")
const fs = require("fs")
const { nanoid } = require("nanoid");

class DeepBase {
    constructor(opts = {}) {
        this.idn = 8;
        this.name = "deepbase"
        this.path = __dirname

        this.filters = {
            set: {},
            get: {},
            inc: { "*": (n) => n[0] + n[1] },
            dec: { "*": (n) => n[0] - n[1] },
        };

        Object.assign(this, opts)

        this.obj = {};
        this.fileName = this.path + "/" + this.name + ".json"
        if (fs.existsSync(this.fileName)) {
            this.obj = JSON.parse(fs.readFileSync(this.fileName, "utf8"))
        }
    }

    incFilter(path, filterFunc) {
        this.filters.inc[path] = filterFunc;
    }

    decFilter(path, filterFunc) {
        this.filters.dec[path] = filterFunc;
    }

    setFilter(path, filterFunc) {
        this.filters.set[path] = filterFunc;
    }

    getFilter(path, filterFunc) {
        this.filters.get[path] = filterFunc;
    }

    _matcher(arr, searchStr) {
        // Replace * characters in each item with a regular expression that matches any character except *
        const regexArr = arr.map(item => new RegExp(`^${item.replace(/\*/g, "[^*]*")}$`));
        // Use the regex array to filter items that match the search string
        return arr.filter((item, index) => regexArr[index].test(searchStr));
    }

    _filter(path, type, args) {
        if (!this.filters[type]) return args[0];

        const filters = Object.keys(this.filters[type]).reverse();
        const key = this._matcher(filters, path.join("."));
        if (key.length > 0) {
            return this.filters[type][key[0]](args);
        }

        return args[0];
    }

    async inc(...args) {
        return this._op("inc", args)
    }

    async dec(...args) {
        return this._op("dec", args)
    }

    async _op(type, args) {
        const keys = args.slice(0, -1);
        let value = args[args.length - 1]
        value = this._filter(keys, "set", [value])
        const r = this._getRecursive(this.obj, keys.slice());
        return this.set(...keys, this._filter(keys, type, [r, value]))
    }

    async set(...args) {
        if (args.length < 2) return
        const keys = args.slice(0, -1)
        const value = this._filter(keys, "set", [args[args.length - 1]])

        this._setRecursive(this.obj, keys, value);
        await this._saveToFile();
        return args.slice(0, -1)
    }

    _setRecursive(obj, keys, value) {
        if (keys.length === 1) {
            obj[keys[0]] = value;
            return;
        }

        const key = keys.shift();
        if (!obj.hasOwnProperty(key) || typeof obj[key] !== "object") {
            obj[key] = {};
        }

        this._setRecursive(obj[key], keys, value);
    }

    get(...args) {
        const keys = args.slice()
        if (keys.length == 0) return this.obj
        const value = this._getRecursive(this.obj, keys);
        return this._filter(args, "get", [value])
    }

    _getRecursive(obj, keys) {

        if (keys.length === 0) {
            return obj;
        }

        if (keys.length === 1) {
            return obj[keys[0]] === undefined ? null : obj[keys[0]];
        }

        const key = keys.shift();
        if (!obj.hasOwnProperty(key)) {
            return null;
        }

        return this._getRecursive(obj[key], keys);
    }

    async del(...keys) {

        if (keys.length === 0) {
            this.obj = {}
            return this._saveToFile()
        }

        const key = keys.pop();
        const parentObj = this.get(...keys);

        if (parentObj) {
            if (parentObj == key) this.del(...keys)
            if (parentObj.hasOwnProperty(key)) delete parentObj[key];
            return this._saveToFile()
        }
    }

    add(...keys) {
        const value = keys.pop();
        const id = nanoid(this.idn)
        this.set(...[...keys, id, value])
        return [...keys, id]
    }

    async _saveToFile() {
        return new Promise((resolve, reject) => {
            steno.writeFile(this.fileName, JSON.stringify(this.obj, null, 4), err => {
                if (err) reject(err)
                resolve()
            })
        });
    }

    keys(...args) {
        const r = this.get(...args)
        return (r !== null && typeof r === "object") ? Object.keys(r) : [];
    }
}


module.exports = DeepBase;