import { DeepBaseDriver } from 'deepbase';
import steno from 'steno';
import fs from 'fs';
import * as pathModule from 'path';
import lockfile from 'proper-lockfile';

export class JsonDriver extends DeepBaseDriver {
  static _instances = {};
  
  constructor({
    name,
    path,
    stringify,
    parse,
    multiProcess,
    encodeForMemory,
    decodeFromMemory,
    ...opts
  } = {}) {
    super(opts);

    if (typeof path !== 'string' || path.trim() === '' || !pathModule.isAbsolute(path)) {
      throw new TypeError('JsonDriver requires an absolute "path" option.');
    }
    
    this.name = name || "default";
    this.path = path;
    this.stringify = stringify || ((obj) => JSON.stringify(obj, null, 4));
    this.parse = parse || JSON.parse;
    this.multiProcess = multiProcess || false;
    this.encodeForMemory = encodeForMemory || (value => value);
    this.decodeFromMemory = decodeFromMemory || (value => value);
    
    this.path = pathModule.resolve(this.path);
    this.fileName = pathModule.join(this.path, `${this.name}.json`);
    
    // Singleton pattern per file
    if (JsonDriver._instances[this.fileName]) {
      const existing = JsonDriver._instances[this.fileName];
      // Upgrade to multiProcess if requested
      if (multiProcess) existing.multiProcess = true;
      return existing;
    }
    
    this.obj = {};
    // Queue for serializing concurrent operations
    this._operationQueue = Promise.resolve();
    this._queueLock = false;
    this._disposing = false;
    this._disposed = false;
    this._disposePromise = null;
    
    JsonDriver._instances[this.fileName] = this;
  }
  
  _connectSync() {
    this._assertUsable();
    if (this._connected) return;

    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path, { recursive: true });
    }

    if (fs.existsSync(this.fileName)) {
      const fileContent = fs.readFileSync(this.fileName, "utf8");
      const parsed = fileContent ? this.parse(fileContent) : {};
      this.obj = this._encodeForMemory(parsed, []);
    } else {
      // Create the file so proper-lockfile can lock it in multiProcess mode
      fs.writeFileSync(this.fileName, this._serializeMemory());
    }

    this._connected = true;
  }

  async connect() {
    this._connectSync();
  }
  
  async disconnect() {
    if (this._disposed) {
      return;
    }
    if (this._disposePromise) {
      return this._disposePromise;
    }
    await this._operationQueue;
    await this._saveToFile();
    this._connected = false;
  }
  
  async get(...args) {
    this._assertUsable();
    // In multiProcess mode, re-read from disk for fresh data
    if (this.multiProcess) {
      this._refreshFromDisk();
    }
    const value = this._getRecursive(this.obj, args.slice());
    return this._decodeFromMemory(value, args);
  }

  getSync(...args) {
    if (this.multiProcess) {
      throw new Error('JsonDriver: getSync() is not supported in multiProcess mode.');
    }
    this._connectSync();
    const value = this._getRecursive(this.obj, args.slice());
    return this._decodeFromMemory(value, args);
  }
  
  async set(...args) {
    return this._queueOperation(async () => {
      if (args.length < 2) {
        const value = this._encodeForMemory(args[0], []);
        this.obj = value;
        await this._saveToFile();
        return [];
      }
      
      const keys = args.slice(0, -1);
      const value = this._encodeForMemory(args[args.length - 1], keys);
      
      // Make a copy to avoid modifying the original array
      this._setRecursive(this.obj, keys.slice(), value);
      await this._saveToFile();
      return keys;
    });
  }
  
  async del(...keys) {
    return this._queueOperation(async () => {
      if (keys.length === 0) {
        this.obj = {};
        return this._saveToFile();
      }
      
      const key = keys.pop();
      const parentObj = this._getRecursive(this.obj, keys.slice());
      
      if (parentObj && parentObj.hasOwnProperty(key)) {
        delete parentObj[key];
        return this._saveToFile();
      }
    });
  }
  
  async inc(...args) {
    const i = args.pop();
    return this.upd(...args, n => n + i);
  }
  
  async dec(...args) {
    const i = args.pop();
    return this.upd(...args, n => n - i);
  }
  
  async add(...keys) {
    return this._queueOperation(async () => {
      const value = keys.pop();
      const id = this.nanoid();
      await this._setInternal(...[...keys, id], value);
      return [...keys, id];
    });
  }
  
  async upd(...args) {
    // Queue the entire get+update+set operation to make it atomic
    return this._queueOperation(async () => {
      const func = args.pop();
      const currentValue = this._getRecursive(this.obj, args.slice());
      const decodedValue = this._decodeFromMemory(currentValue, args);
      const newValue = func(decodedValue);
      await this._setInternal(...args, newValue);
      return args;
    });
  }

  async first(...args) {
    if (this.multiProcess) {
      this._refreshFromDisk();
    }

    const value = this._getRecursive(this.obj, args.slice());
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
    if (this.multiProcess) {
      this._refreshFromDisk();
    }

    const value = this._getRecursive(this.obj, args.slice());
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
  
  // Internal set without queuing (for use within queued operations)
  async _setInternal(...args) {
    if (args.length < 2) {
      const value = this._encodeForMemory(args[0], []);
      this.obj = value;
      await this._saveToFile();
      return [];
    }
    
    const keys = args.slice(0, -1);
    const value = this._encodeForMemory(args[args.length - 1], keys);
    
    this._setRecursive(this.obj, keys.slice(), value);
    await this._saveToFile();
    return keys;
  }
  
  // Re-read file from disk into this.obj
  _refreshFromDisk() {
    if (fs.existsSync(this.fileName)) {
      const fileContent = fs.readFileSync(this.fileName, "utf8");
      const parsed = fileContent ? this.parse(fileContent) : {};
      this.obj = this._encodeForMemory(parsed, []);
    }
  }

  // Queue operations to prevent race conditions
  async _queueOperation(operation) {
    this._assertUsable();
    const previousOperation = this._operationQueue;
    
    let resolver;
    this._operationQueue = new Promise(resolve => {
      resolver = resolve;
    });
    
    try {
      // Wait for previous operation to complete
      await previousOperation;

      if (this.multiProcess) {
        // Lock the file, re-read, operate, then unlock
        const release = await lockfile.lock(this.fileName, {
          retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
          stale: 10000
        });
        try {
          this._refreshFromDisk();
          const result = await operation();
          return result;
        } finally {
          await release();
        }
      } else {
        const result = await operation();
        return result;
      }
    } catch (error) {
      throw error;
    } finally {
      resolver();
    }
  }

  async dispose({ clearMemory = true, releaseInstance = true } = {}) {
    if (this._disposePromise) {
      return this._disposePromise;
    }

    this._disposing = true;
    this._disposePromise = (async () => {
      try {
        await this._operationQueue;
        if (this._connected) {
          await this._saveToFile();
        }
        this._connected = false;

        if (clearMemory) {
          this.obj = {};
        }
        if (releaseInstance && JsonDriver._instances[this.fileName] === this) {
          delete JsonDriver._instances[this.fileName];
        }

        this._disposed = true;
      } catch (error) {
        this._disposing = false;
        this._disposePromise = null;
        throw error;
      }
    })();

    return this._disposePromise;
  }

  _assertUsable() {
    if (this._disposing || this._disposed) {
      throw new Error('JsonDriver has been disposed');
    }
  }

  _clone(value) {
    return typeof value === 'object' && value !== null
      ? this.parse(this.stringify(value))
      : value;
  }

  _encodeForMemory(value, path) {
    return this.encodeForMemory(this._clone(value), path.map(String));
  }

  _decodeFromMemory(value, path) {
    return this.decodeFromMemory(this._clone(value), path.map(String));
  }

  _serializeMemory() {
    return this.stringify(this._decodeFromMemory(this.obj, []));
  }
  
  _setRecursive(obj, keys, value) {
    if (keys.length === 0) return;
    
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
  
  _getRecursive(obj, keys) {
    if (keys.length === 0) return obj;
    if (keys.length === 1) {
      return obj === null || obj[keys[0]] === undefined ? null : obj[keys[0]];
    }
    
    const key = keys.shift();
    if (!obj.hasOwnProperty(key)) return null;
    
    return this._getRecursive(obj[key], keys);
  }
  
  async _saveToFile() {
    const serializedData = this._serializeMemory();
    if (this.multiProcess) {
      // Sync write ensures data is on disk before lock release
      fs.writeFileSync(this.fileName, serializedData);
    } else {
      return new Promise((resolve, reject) => {
        steno.writeFile(this.fileName, serializedData, err => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
}

export default JsonDriver;
