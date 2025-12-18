import { DeepBaseDriver } from 'deepbase';
import { MongoClient } from 'mongodb';

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
    return this._getFromUnescaped(unescapedObj, arr);
  }
  
  async set(...arr) {
    return this._updateOne(arr, "$set");
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
    return this._updateOne(arr, "$unset");
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
  
  async _updateOne(arr, type = "$set") {
    const _id = arr.shift();
    const val = arr.pop();
    
    // Use _pathToKey to properly escape dots and special characters
    const set = arr.length == 0 ? { [val]: null } : { [this._pathToKey(arr)]: val };
    const opts = { upsert: true };
    
    return this.collection.updateOne({ _id }, { [type]: set }, opts);
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
}

export default MongoDriver;

