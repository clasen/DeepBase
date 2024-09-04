const steno = require("steno")
const fs = require("fs")
const { customAlphabet } = require('nanoid');
const path = require('path');

class DeepBase {
    constructor(opts = {}) {
        this.nidAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        this.nidLength = 10;
        this.name = "default"
        this.path = path.join(__dirname, "..", "..", "db");
        this.nanoid = customAlphabet(this.nidAlphabet, this.nidLength);
        this.stringify = (obj) => JSON.stringify(obj, null, 4);
        this.parse = JSON.parse;

        Object.assign(this, opts);

        this.path = path.resolve(this.path);

        if (!fs.existsSync(this.path)) {
            fs.mkdirSync(this.path, { recursive: true });
        }

        this.obj = {};
        this.fileName = path.join(this.path, `${this.name}.json`);

        if (fs.existsSync(this.fileName)) {
            const fileContent = fs.readFileSync(this.fileName, "utf8");
            this.obj = this.parse(fileContent);
        }
    }

    async upd(...args) {
        const func = args.pop()
        return this.set(...args, func(this.get(...args)))
    }

    async inc(...args) {
        const i = args.pop()
        return this.upd(...args, n => n + i)
    }

    async dec(...args) {
        const i = args.pop()
        return this.upd(...args, n => n - i)
    }

    async set(...args) {
        if (args.length < 2) return
        const keys = args.slice(0, -1)
        const value = args[args.length - 1]

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
        return this._getRecursive(this.obj, keys);
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
        const id = this.nanoid();
        this.set(...[...keys, id, value]);
        return [...keys, id];
    }

    async _saveToFile() {
        return new Promise((resolve, reject) => {
            const serializedData = this.stringify(this.obj);
            steno.writeFile(this.fileName, serializedData, err => {
                if (err) reject(err);
                resolve();
            });
        });
    }

    keys(...args) {
        const r = this.get(...args)
        return (r !== null && typeof r === "object") ? Object.keys(r) : [];
    }

    values(...args) {
        const r = this.get(...args)
        return (r !== null && typeof r === "object") ? Object.values(r) : [];
    }
}


module.exports = DeepBase;