const steno = require('steno')
const fs = require('fs')
const { nanoid } = require("nanoid");

class DeepBase {
    constructor(opts = {}) {
        this.idn = 8;
        this.name = "deepbase"
        this.path = __dirname
        Object.assign(this, opts)

        this.obj = {};
        this.fileName = this.path + "/" + this.name + ".json"
        if (fs.existsSync(this.fileName)) {
            this.obj = JSON.parse(fs.readFileSync(this.fileName, 'utf8'))
        }
    }

    async inc(...args) {
        const [keys, value] = [args.slice(0, -1), args[args.length - 1]];
        const val = this.get(...keys)
        return this.set(...keys, val + value)
    }

    async dec(...args) {
        const [keys, value] = [args.slice(0, -1), args[args.length - 1]];
        const val = this.get(...keys)
        return this.set(...keys, val - value)
    }

    async set(...args) {
        if (args.length < 2) return
        const [keys, value] = [args.slice(0, -1), args[args.length - 1]];
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
        if (!obj.hasOwnProperty(key) || typeof obj[key] !== 'object') {
            obj[key] = {};
        }

        this._setRecursive(obj[key], keys, value);
    }

    get(...keys) {
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
        return (r !== null && typeof r === 'object') ? Object.keys(r) : [];
    }
}


module.exports = DeepBase;