import { DeepBaseDriver } from 'deepbase';

export class IndexedDBDriver extends DeepBaseDriver {
  static _instances = {};
  
  constructor({name, version, storeName, ...opts} = {}) {
    super(opts);
    
    this.name = name || "deepbase";
    this.version = version || 1;
    this.storeName = storeName || "store";
    
    this.db = null;
    this._rootKey = '__root__';
    
    // Queue for serializing concurrent operations
    this._operationQueue = Promise.resolve();
    
    // Singleton pattern per database name
    const instanceKey = `${this.name}:${this.storeName}`;
    if (IndexedDBDriver._instances[instanceKey]) {
      return IndexedDBDriver._instances[instanceKey];
    }
    
    IndexedDBDriver._instances[instanceKey] = this;
  }
  
  async connect() {
    if (this._connected) return;
    
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || !window.indexedDB) {
      throw new Error('IndexedDB is not available. This driver only works in browser environments.');
    }
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, this.version);
      
      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error}`));
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        this._connected = true;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }
  
  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this._connected = false;
    }
  }
  
  async get(...args) {
    if (!this._connected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    
    // Get root object
    const rootObj = await this._getRoot();
    
    // Navigate to the requested path
    const value = this._getRecursive(rootObj, args.slice());
    
    // Return deep copy to prevent mutations
    return typeof value === 'object' && value !== null 
      ? JSON.parse(JSON.stringify(value))
      : value;
  }
  
  async set(...args) {
    return this._queueOperation(async () => {
      if (!this._connected) {
        throw new Error('Database not connected. Call connect() first.');
      }
      
      // Get root object
      const rootObj = await this._getRoot();
      
      if (args.length < 2) {
        // Setting the entire root
        await this._setRoot(args[0]);
        return [];
      }
      
      const keys = args.slice(0, -1);
      const value = args[args.length - 1];
      
      // Set value at path
      this._setRecursive(rootObj, keys.slice(), value);
      
      // Save back to IndexedDB
      await this._setRoot(rootObj);
      
      return keys;
    });
  }
  
  async del(...keys) {
    return this._queueOperation(async () => {
      if (!this._connected) {
        throw new Error('Database not connected. Call connect() first.');
      }
      
      if (keys.length === 0) {
        // Delete entire root
        await this._deleteRoot();
        return;
      }
      
      const rootObj = await this._getRoot();
      const key = keys.pop();
      const parentObj = this._getRecursive(rootObj, keys.slice());
      
      if (parentObj && parentObj.hasOwnProperty(key)) {
        delete parentObj[key];
        await this._setRoot(rootObj);
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
    return this._queueOperation(async () => {
      if (!this._connected) {
        throw new Error('Database not connected. Call connect() first.');
      }
      
      const func = args.pop();
      const rootObj = await this._getRoot();
      const currentValue = this._getRecursive(rootObj, args.slice());
      const newValue = func(currentValue);
      await this._setInternal(...args, newValue);
      return args;
    });
  }
  
  async pop(...args) {
    return this._queueOperation(async () => {
      if (!this._connected) {
        throw new Error('Database not connected. Call connect() first.');
      }
      
      const rootObj = await this._getRoot();
      const arr = this._getRecursive(rootObj, args.slice());
      
      if (!Array.isArray(arr)) {
        throw new Error('pop() can only be used on arrays');
      }
      
      const poppedValue = arr.pop();
      await this._setRoot(rootObj);
      
      return poppedValue;
    });
  }
  
  async shift(...args) {
    return this._queueOperation(async () => {
      if (!this._connected) {
        throw new Error('Database not connected. Call connect() first.');
      }
      
      const rootObj = await this._getRoot();
      const arr = this._getRecursive(rootObj, args.slice());
      
      if (!Array.isArray(arr)) {
        throw new Error('shift() can only be used on arrays');
      }
      
      const shiftedValue = arr.shift();
      await this._setRoot(rootObj);
      
      return shiftedValue;
    });
  }
  
  // Internal method to set without queuing
  async _setInternal(...args) {
    if (!this._connected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    
    const rootObj = await this._getRoot();
    
    if (args.length < 2) {
      await this._setRoot(args[0]);
      return [];
    }
    
    const keys = args.slice(0, -1);
    const value = args[args.length - 1];
    
    this._setRecursive(rootObj, keys.slice(), value);
    await this._setRoot(rootObj);
    
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
      await previousOperation;
      const result = await operation();
      resolver();
      return result;
    } catch (error) {
      resolver();
      throw error;
    }
  }
  
  // Get root object from IndexedDB
  async _getRoot() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(this._rootKey);
      
      request.onsuccess = () => {
        resolve(request.result || {});
      };
      
      request.onerror = () => {
        reject(new Error(`Failed to get root: ${request.error}`));
      };
    });
  }
  
  // Set root object in IndexedDB
  async _setRoot(obj) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(obj, this._rootKey);
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = () => {
        reject(new Error(`Failed to set root: ${request.error}`));
      };
    });
  }
  
  // Delete root object from IndexedDB
  async _deleteRoot() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(this._rootKey);
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = () => {
        reject(new Error(`Failed to delete root: ${request.error}`));
      };
    });
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
}

export default IndexedDBDriver;

