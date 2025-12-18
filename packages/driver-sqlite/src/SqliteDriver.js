import { DeepBaseDriver } from 'deepbase';
import Database from 'better-sqlite3';
import fs from 'fs';
import * as pathModule from 'path';

export class SqliteDriver extends DeepBaseDriver {
  static _instances = {};
  
  constructor({name, path, ...opts} = {}) {
    super(opts);
    
    this.name = name || "default";
    this.path = path || './db';
    
    this.path = pathModule.resolve(this.path);
    this.fileName = pathModule.join(this.path, `${this.name}.db`);
    
    // Singleton pattern per file
    if (SqliteDriver._instances[this.fileName]) {
      return SqliteDriver._instances[this.fileName];
    }
    
    this.db = null;
    SqliteDriver._instances[this.fileName] = this;
  }
  
  async connect() {
    if (!fs.existsSync(this.path)) {
      fs.mkdirSync(this.path, { recursive: true });
    }
    
    this.db = new Database(this.fileName);
    
    // Create table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deepbase (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    
    // Prepare statements for better performance
    this.getStmt = this.db.prepare('SELECT value FROM deepbase WHERE key = ?');
    this.setStmt = this.db.prepare('INSERT OR REPLACE INTO deepbase (key, value) VALUES (?, ?)');
    this.delStmt = this.db.prepare('DELETE FROM deepbase WHERE key = ?');
    this.getAllStmt = this.db.prepare('SELECT key, value FROM deepbase');
    this.getKeysLikeStmt = this.db.prepare('SELECT key, value FROM deepbase WHERE key LIKE ?');
    
    this._connected = true;
  }
  
  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
  
  async get(...args) {
    if (args.length === 0) {
      // Get root object
      return this._getRootObject();
    }
    
    const key = this._pathToKey(args);
    const row = this.getStmt.get(key);
    
    // Check if there are child keys (nested properties)
    const childKey = key + '.';
    const children = this.getKeysLikeStmt.all(childKey + '%');
    
    // If there are children, build object from them
    if (children.length > 0) {
      return this._buildObjectFromChildren(key);
    }
    
    // If direct key exists and no children, return it
    if (row) {
      return JSON.parse(row.value);
    }
    
    // Check if we need to look into a parent object
    // For example: if we're looking for 'users.abc.name' but only 'users.abc' exists as a JSON object
    const parentPath = this._findParentWithValue(args);
    if (parentPath) {
      const parentKey = this._pathToKey(parentPath);
      const parentRow = this.getStmt.get(parentKey);
      if (parentRow) {
        const parentValue = JSON.parse(parentRow.value);
        const relativePath = args.slice(parentPath.length);
        return this._getFromObject(parentValue, relativePath);
      }
    }
    
    return null;
  }
  
  async set(...args) {
    if (args.length === 0) {
      throw new Error('set() requires at least one argument');
    }
    
    if (args.length === 1) {
      // Setting root object
      await this._setRootObject(args[0]);
      return [];
    }
    
    const keys = args.slice(0, -1);
    const value = args[args.length - 1];
    const key = this._pathToKey(keys);
    
    // Check if any parent path exists as an object that needs to be expanded
    this._expandParentObjects(keys);
    
    this.setStmt.run(key, JSON.stringify(value));
    return keys;
  }
  
  async del(...keys) {
    if (keys.length === 0) {
      // Delete everything
      this.db.exec('DELETE FROM deepbase');
      return;
    }
    
    const key = this._pathToKey(keys);
    
    // Delete the key itself
    this.delStmt.run(key);
    
    // Delete all children
    const childKey = key + '.';
    this.db.prepare('DELETE FROM deepbase WHERE key LIKE ?').run(childKey + '%');
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
    const value = keys.pop();
    const id = this.nanoid();
    await this.set(...[...keys, id], value);
    return [...keys, id];
  }
  
  async upd(...args) {
    const func = args.pop();
    return this.set(...args, func(await this.get(...args)));
  }
  
  _getRootObject() {
    const rows = this.getAllStmt.all();
    const result = {};
    
    for (const row of rows) {
      const path = this._keyToPath(row.key);
      const value = JSON.parse(row.value);
      this._setNestedValue(result, path, value);
    }
    
    return result;
  }
  
  async _setRootObject(obj) {
    // Clear existing data
    this.db.exec('DELETE FROM deepbase');
    
    // Flatten and insert
    const entries = this._flattenObject(obj);
    const insertMany = this.db.transaction((entries) => {
      for (const [key, value] of entries) {
        this.setStmt.run(key, JSON.stringify(value));
      }
    });
    
    insertMany(entries);
  }
  
  _buildObjectFromChildren(parentKey) {
    const prefix = parentKey ? parentKey + '.' : '';
    const rows = this.getKeysLikeStmt.all(prefix + '%');
    const result = {};
    
    for (const row of rows) {
      const fullPath = this._keyToPath(row.key);
      const relativePath = parentKey 
        ? fullPath.slice(this._keyToPath(parentKey).length)
        : fullPath;
      
      const value = JSON.parse(row.value);
      this._setNestedValue(result, relativePath, value);
    }
    
    return result;
  }
  
  _setNestedValue(obj, path, value) {
    if (path.length === 1) {
      obj[path[0]] = value;
      return;
    }
    
    const key = path[0];
    if (!obj.hasOwnProperty(key) || typeof obj[key] !== "object") {
      obj[key] = {};
    }
    
    this._setNestedValue(obj[key], path.slice(1), value);
  }
  
  _flattenObject(obj, prefix = '') {
    const entries = [];
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        entries.push(...this._flattenObject(value, fullKey));
      } else {
        entries.push([fullKey, value]);
      }
    }
    
    return entries;
  }
  
  _findParentWithValue(path) {
    // Try to find a parent path that has a stored value
    // For example: if looking for ['users', 'abc', 'name']
    // and 'users.abc' exists as a stored JSON object, return ['users', 'abc']
    for (let i = path.length - 1; i > 0; i--) {
      const parentPath = path.slice(0, i);
      const parentKey = this._pathToKey(parentPath);
      const row = this.getStmt.get(parentKey);
      if (row) {
        const value = JSON.parse(row.value);
        // Only return if it's an object (not a primitive)
        if (value !== null && typeof value === 'object') {
          return parentPath;
        }
      }
    }
    return null;
  }
  
  _getFromObject(obj, path) {
    if (path.length === 0) return obj;
    if (path.length === 1) {
      return obj === null || obj[path[0]] === undefined ? null : obj[path[0]];
    }
    
    const key = path[0];
    if (!obj.hasOwnProperty(key)) return null;
    
    return this._getFromObject(obj[key], path.slice(1));
  }
  
  _expandParentObjects(path) {
    // Check each parent level (not including the path itself) to see if it exists as an object that needs expanding
    // For example, if path is ['config', 'theme'], check if 'config' exists as an object
    for (let i = 1; i < path.length; i++) {
      const parentPath = path.slice(0, i);
      const parentKey = this._pathToKey(parentPath);
      const parentRow = this.getStmt.get(parentKey);
      
      if (parentRow) {
        const parentValue = JSON.parse(parentRow.value);
        
        // If it's an object (not array or primitive), expand it
        if (parentValue !== null && typeof parentValue === 'object' && !Array.isArray(parentValue)) {
          // Delete the parent key
          this.delStmt.run(parentKey);
          
          // Insert all properties as individual keys
          const entries = this._flattenObject(parentValue, parentKey);
          for (const [key, value] of entries) {
            this.setStmt.run(key, JSON.stringify(value));
          }
        }
      }
    }
  }
}

export default SqliteDriver;


