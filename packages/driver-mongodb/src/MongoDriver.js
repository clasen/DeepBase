import { DeepBaseDriver, evaluateQuery, removeKey } from 'deepbase';
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
        obj[item._id] = this._unwrapRootValue(obj[item._id]);
      }
      return obj;
    }
    
    const _id = arr.shift();
    const obj = await this.collection.findOne({ _id });
    if (obj === null) return null;
    
    delete obj._id;
    
    // Unescape the object keys before navigating
    const unescapedObj = this._unescapeObject(obj);
    // Root values live under ROOT_VALUE_FIELD, so nested paths navigate the
    // wrapped value instead of the wrapper document.
    const root = this._unwrapRootValue(unescapedObj);
    if (arr.length === 0) return root;

    return this._getFromUnescaped(root, arr);
  }

  /**
   * Non-object root values are stored under ROOT_VALUE_FIELD; unwrap them so
   * root reads match every other driver.
   */
  _unwrapRootValue(value) {
    if (
      Object.keys(value).length === 1 &&
      Object.prototype.hasOwnProperty.call(value, ROOT_VALUE_FIELD)
    ) {
      return value[ROOT_VALUE_FIELD];
    }
    return value;
  }

  /**
   * Run a query descriptor over the object stored at ...path.
   * The document is read from MongoDB and evaluated in memory; filters are not
   * pushed to the server and no indexes are used.
   * @param {Array<string|number>} path - Path to the queried object
   * @param {object[]} steps - Query descriptor steps
   * @returns {Promise<Array<{id: string, value: any}>>} Matching records
   */
  async query(path, steps) {
    return evaluateQuery(await this.get(...path), steps, { path });
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

    // Deleting an array index shifts the remaining elements, the way pop() and
    // shift() expect. Read the parent, splice it and store the shorter array.
    const lastKey = String(arr[arr.length - 1]);
    if (/^\d+$/.test(lastKey)) {
      const parentPath = arr.slice(0, -1);
      const parent = await this.get(_id, ...parentPath);

      if (Array.isArray(parent)) {
        const spliced = parent.slice();
        if (removeKey(spliced, lastKey)) {
          const set = parentPath.length === 0
            ? { [ROOT_VALUE_FIELD]: this._escapeValue(spliced) }
            : { [this._pathToKey(parentPath)]: this._escapeValue(spliced) };

          return this.collection.updateOne({ _id }, { $set: set });
        }
      }
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
    const key = await this._boundaryKey(args, false);
    return key === undefined ? this._boundaryKeyFromValue(args, false) : key;
  }

  async last(...args) {
    const key = await this._boundaryKey(args, true);
    return key === undefined ? this._boundaryKeyFromValue(args, true) : key;
  }

  /**
   * Ask the server for the boundary field name only, instead of transferring
   * the whole document. Returns undefined whenever the path is not a document,
   * so the caller keeps the get()-based behavior.
   * @param {Array<string|number>} path - Path to the queried object
   * @param {boolean} fromEnd - Take the last key instead of the first
   * @returns {Promise<string|undefined>} Boundary key
   */
  async _boundaryKey(path, fromEnd) {
    if (path.length === 0) return undefined;

    const target = path.slice(1);
    const fieldPath = this._pathToKey(target);
    const [row] = await this.collection.aggregate([
      { $match: { _id: path[0] } },
      {
        $project: {
          _id: 0,
          fields: target.length === 0
            ? {
              $filter: {
                input: { $objectToArray: '$$ROOT' },
                as: 'field',
                cond: { $not: [{ $in: ['$$field.k', ['_id', ROOT_VALUE_FIELD]] }] },
              },
            }
            : {
              $cond: [
                { $eq: [{ $type: `$${fieldPath}` }, 'object'] },
                { $objectToArray: `$${fieldPath}` },
                [],
              ],
            },
        },
      },
      { $project: { key: { $arrayElemAt: ['$fields.k', fromEnd ? -1 : 0] } } },
    ]).toArray();

    if (!row || typeof row.key !== 'string') return undefined;
    return this._unescapeDots(row.key);
  }

  async _boundaryKeyFromValue(path, fromEnd) {
    const value = await this.get(...path);
    if (value === null || typeof value !== 'object') {
      return undefined;
    }

    let last;
    for (const key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        if (!fromEnd) return key;
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
    if (obj === null || typeof obj !== 'object') return null;
    if (keys.length === 1) {
      return obj[keys[0]] === undefined ? null : obj[keys[0]];
    }
    
    const key = keys.shift();
    if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
    
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
