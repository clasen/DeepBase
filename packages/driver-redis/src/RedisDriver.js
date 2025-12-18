import { DeepBaseDriver } from 'deepbase';
import { createClient } from 'redis';

export class RedisDriver extends DeepBaseDriver {
  constructor({name, prefix, url, ...opts} = {}) {
    super(opts);
    
    this.name = name || prefix || "db";
    this.url = url || "redis://localhost:6379";
    
    this.client = createClient({ url: this.url });
    this._locks = new Map(); // Lock map for concurrent operations on same key
  }
  
  async connect() {
    await this.client.connect();
    this._connected = true;
  }
  
  async disconnect() {
    await this.client.disconnect();
  }
  
  async get(...args) {
    if (args.length === 0) {
      const dic = {};
      for (let key of await this._zeroKeys()) {
        dic[key] = await this.get(key);
      }
      return dic;
    }
    
    const key = args.shift();
    const redisKey = this.name + ":" + key;
    
    try {
      const value = await this.client.get(redisKey);
      if (value === null) return null;
      
      let data = JSON.parse(value);
      
      // Navigate through nested path if provided
      for (let pathKey of args) {
        if (data === null || data === undefined) return null;
        data = data[pathKey];
      }
      
      return data;
    } catch (error) {
      return null;
    }
  }
  
  async _acquireLock(key) {
    // Wait for any pending operation on this key to complete
    while (this._locks.has(key)) {
      await this._locks.get(key);
    }
    
    // Create a new lock for this operation
    let releaseLock;
    const lockPromise = new Promise(resolve => {
      releaseLock = resolve;
    });
    
    this._locks.set(key, lockPromise);
    return () => {
      this._locks.delete(key);
      releaseLock();
    };
  }

  async set(...args) {
    if (args.length < 2) return;
    
    const keys = args.slice(0, -1);
    const value = args[args.length - 1];
    
    const key = keys.shift();
    const redisKey = this.name + ":" + key;
    
    if (keys.length === 0) {
      // Direct set
      if (value === undefined) {
        await this.client.del(redisKey);
      } else {
        await this.client.set(redisKey, JSON.stringify(value));
      }
    } else {
      // Nested set - serialize operations on same key to prevent race conditions
      const releaseLock = await this._acquireLock(redisKey);
      
      try {
        const current = await this.client.get(redisKey);
        let data = current ? JSON.parse(current) : {};
        
        if (typeof data !== 'object' || Array.isArray(data)) {
          data = {};
        }
        
        // Navigate and set nested value
        let current_obj = data;
        for (let i = 0; i < keys.length - 1; i++) {
          const pathKey = keys[i];
          if (!current_obj[pathKey] || typeof current_obj[pathKey] !== 'object') {
            current_obj[pathKey] = {};
          }
          current_obj = current_obj[pathKey];
        }
        
        const lastKey = keys[keys.length - 1];
        if (value === undefined) {
          delete current_obj[lastKey];
        } else {
          current_obj[lastKey] = value;
        }
        
        await this.client.set(redisKey, JSON.stringify(data));
      } finally {
        releaseLock();
      }
    }
    
    return args.slice(0, -1);
  }
  
  async inc(...args) {
    const i = args.pop();
    const key = args.shift();
    
    if (args.length === 0) {
      // Direct increment on root level
      const redisKey = this.name + ":" + key;
      const value = await this.client.get(redisKey);
      const num = value ? JSON.parse(value) : 0;
      await this.client.set(redisKey, JSON.stringify(num + i));
      return [key];
    } else {
      // Nested increment
      args.unshift(key);
      return this.upd(...args, n => (n || 0) + i);
    }
  }
  
  async dec(...args) {
    const i = args.pop();
    args.push(-i);
    return this.inc(...args);
  }
  
  async del(...args) {
    if (args.length === 0) {
      for (let key of await this._zeroKeys()) {
        await this.del(key);
      }
      return;
    }
    
    const key = args.shift();
    const redisKey = this.name + ":" + key;
    
    if (args.length === 0) {
      // Delete entire key
      await this.client.del(redisKey);
    } else {
      // Delete nested path
      let data = await this.get(key);
      if (data === null) return [key, ...args];
      
      // Navigate and delete nested value
      let current = data;
      for (let i = 0; i < args.length - 1; i++) {
        const pathKey = args[i];
        if (!current[pathKey]) return [key, ...args];
        current = current[pathKey];
      }
      
      const lastKey = args[args.length - 1];
      delete current[lastKey];
      
      await this.client.set(redisKey, JSON.stringify(data));
    }
    
    return [key, ...args];
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
  
  async _zeroKeys() {
    const scan = {
      MATCH: this.name + ":*",
      COUNT: 1000,
    };
    
    const keys = [];
    for await (let key of this.client.scanIterator(scan)) {
      keys.push(key.substring(this.name.length + 1));
    }
    
    return keys;
  }
}

export default RedisDriver;
