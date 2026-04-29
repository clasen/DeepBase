import { DeepBaseDriver } from 'deepbase';
import { MongoClient } from 'mongodb';

const ROOT_VALUE_FIELD = '__deepbase_value';

export class MongoDriver extends DeepBaseDriver {
  constructor({base, database, name, collection, url, ...opts} = {}) {
    super(opts);
    
    this.base = base || database || "deepbase";
    this.name = name || collection || "documents";
    this.url = url || "mongodb://localhost:27017";
    
    this.client = new MongoClient(this.url);
    this.db = this.client.db(this.base);
    this.collection = this.db.collection(this.name);
  }
  
  // Override escape methods for MongoDB specific requirements ($ and . are restricted)
  _escapeDots(str) {
    // Escape backslashes first, then dots, then $ signs
    return str.replace(/\\/g, '\\\\').replace(/\./g, '\\d').replace(/\$/g, '\\s');
  }
  
  _unescapeDots(str) {
    // Unescape in reverse order
    return str.replace(/\\s/g, '$').replace(/\\d/g, '.').replace(/\\\\/g, '\\');
  }
  
  async connect() {
    await this.client.connect();
    this._connected = true;
  }
  
  async disconnect() {
    await this.client.close();
  }
  
  async get(...arr) {
    if (arr.length === 0) {
      const list = await this.collection.find({}).toArray();
      const obj = {};
      for (let item of list) {
        obj[item._id] = this._unescapeObject(item);
        delete obj[item._id]._id;
      }
      return obj;
    }
    
    const _id = arr.shift();
    const obj = await this.collection.findOne({ _id });
    if (obj === null) return null;
    
    delete obj._id;
    
    // Unescape the object keys before navigating
    const unescapedObj = this._unescapeObject(obj);
    if (
      arr.length === 0 &&
      Object.keys(unescapedObj).length === 1 &&
      Object.prototype.hasOwnProperty.call(unescapedObj, ROOT_VALUE_FIELD)
    ) {
      return unescapedObj[ROOT_VALUE_FIELD];
    }

    return this._getFromUnescaped(unescapedObj, arr);
  }
  
  async set(...arr) {
    if (arr.length < 2) return;

    const _id = arr.shift();
    const val = arr.pop();

    if (arr.length === 0) {
      const replacement =
        val !== null && typeof val === 'object' && !Array.isArray(val)
          ? { _id, ...this._escapeObject(val) }
          : { _id, [ROOT_VALUE_FIELD]: val };

      return this.collection.replaceOne({ _id }, replacement, { upsert: true });
    }

    const path = this._pathToKey(arr);
    return this.collection.updateOne(
      { _id },
      {
        $unset: { [ROOT_VALUE_FIELD]: "" },
        $set: { [path]: this._escapeValue(val) },
      },
      { upsert: true },
    );
  }
  
  async inc(...arr) {
    return this._updateOne(arr, "$inc");
  }
  
  async dec(...arr) {
    arr[arr.length - 1] = -arr[arr.length - 1];
    return this._updateOne(arr, "$inc");
  }
  
  async del(...arr) {
    if (arr.length === 0) {
      return this.collection.deleteMany({});
    }

    const _id = arr.shift();
    if (arr.length === 0) {
      return this.collection.deleteOne({ _id });
    }

    return this.collection.updateOne(
      { _id },
      { $unset: { [this._pathToKey(arr)]: "" } },
    );
  }
  
  async add(...keys) {
    const value = keys.pop();
    const id = this.nanoid();
    await this.set(...[...keys, id], value);
    return [...keys, id];
  }
  
  async upd(...args) {
    const func = args.pop();
    return this.set(...args, func(await this.get(...args)));
  }

  async first(...args) {
    const value = await this.get(...args);
    if (value === null || typeof value !== 'object') {
      return undefined;
    }

    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        return key;
      }
    }

    return undefined;
  }

  async last(...args) {
    const value = await this.get(...args);
    if (value === null || typeof value !== 'object') {
      return undefined;
    }

    let last;
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        last = key;
      }
    }

    return last;
  }
  
  async _updateOne(arr, type = "$set") {
    const _id = arr.shift();
    const val = arr.pop();
    
    // Use _pathToKey to properly escape dots and special characters
    const set = arr.length == 0 ? { [ROOT_VALUE_FIELD]: val } : { [this._pathToKey(arr)]: val };
    const update = arr.length == 0
      ? { [type]: set }
      : { $unset: { [ROOT_VALUE_FIELD]: "" }, [type]: set };
    const opts = { upsert: true };
    
    return this.collection.updateOne({ _id }, update, opts);
  }
  
  _getFromUnescaped(obj, keys) {
    if (keys.length === 0) return obj;
    if (keys.length === 1) {
      return obj[keys[0]] === undefined ? null : obj[keys[0]];
    }
    
    const key = keys.shift();
    if (!obj.hasOwnProperty(key)) return null;
    
    return this._getFromUnescaped(obj[key], keys);
  }
  
  /**
   * Recursively unescape all keys in an object
   */
  _unescapeObject(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }
    
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const unescapedKey = this._unescapeDots(key);
        const value = obj[key];
        
        // Recursively unescape nested objects
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          result[unescapedKey] = this._unescapeObject(value);
        } else {
          result[unescapedKey] = value;
        }
      }
    }
    return result;
  }

  _escapeValue(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    return this._escapeObject(value);
  }

  _escapeObject(obj) {
    const result = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[this._escapeDots(key)] = this._escapeValue(obj[key]);
      }
    }
    return result;
  }
}

export default MongoDriver;

