import { DeepBaseDriver } from 'deepbase';
import steno from 'steno';
import fs from 'fs';
import * as pathModule from 'path';

export class JsonDriver extends DeepBaseDriver {
  static _instances = {};
  
  constructor({name, path, stringify, parse, ...opts} = {}) {
    super(opts);
    
    this.name = name || "default";
    this.path = path || new URL('../../../db', import.meta.url).pathname;
    this.stringify = stringify || ((obj) => JSON.stringify(obj, null, 4));
    this.parse = parse || JSON.parse;
    
    this.path = pathModule.resolve(this.path);
    this.fileName = pathModule.join(this.path, `${this.name}.json`);
    
    // Singleton pattern per file
    if (JsonDriver._instances[this.fileName]) {
      return JsonDriver._instances[this.fileName];
    }
    
    this.obj = {};
    // Queue for serializing concurrent operations
    this._operationQueue = Promise.resolve();
    this._queueLock = false;
    
    JsonDriver._instances[this.fileName] = this;
  }
  
  async connect() {
    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path, { recursive: true });
    }
    
    if (fs.existsSync(this.fileName)) {
      const fileContent = fs.readFileSync(this.fileName, "utf8");
      this.obj = fileContent ? this.parse(fileContent) : {};
    }
    
    this._connected = true;
  }
  
  async disconnect() {
    await this._saveToFile();
  }
  
  async get(...args) {
    // Reads don't modify state, so they can run without queuing
    const value = this._getRecursive(this.obj, args.slice());
    return typeof value === 'object' && value !== null 
      ? this.parse(this.stringify(value)) 
      : value;
  }
  
  async set(...args) {
    return this._queueOperation(async () => {
      if (args.length < 2) {
        this.obj = args[0];
        await this._saveToFile();
        return [];
      }
      
      const keys = args.slice(0, -1);
      const value = args[args.length - 1];
      
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
      const newValue = func(currentValue);
      await this._setInternal(...args, newValue);
      return args;
    });
  }
  
  // Internal set without queuing (for use within queued operations)
  async _setInternal(...args) {
    if (args.length < 2) {
      this.obj = args[0];
      await this._saveToFile();
      return [];
    }
    
    const keys = args.slice(0, -1);
    const value = args[args.length - 1];
    
    this._setRecursive(this.obj, keys.slice(), value);
    await this._saveToFile();
    return keys;
  }
  
  // Queue operations to prevent race conditions
  async _queueOperation(operation) {
    const previousOperation = this._operationQueue;
    
    let resolver;
    this._operationQueue = new Promise(resolve => {
      resolver = resolve;
    });
    
    try {
      // Wait for previous operation to complete
      await previousOperation;
      // Execute current operation
      const result = await operation();
      resolver();
      return result;
    } catch (error) {
      resolver();
      throw error;
    }
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
    return new Promise((resolve, reject) => {
      const serializedData = this.stringify(this.obj);
      steno.writeFile(this.fileName, serializedData, err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export default JsonDriver;

