import { customAlphabet } from 'nanoid';

export class DeepBaseDriver {
  constructor({nidAlphabet, nidLength, ...opts} = {}) {
    this.opts = opts;
    this.nidAlphabet = nidAlphabet || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    this.nidLength = nidLength || 10;
    this.nanoid = customAlphabet(this.nidAlphabet, this.nidLength);
    this._connected = false;
  }
  
  async connect() {
    // Default implementation does nothing
    this._connected = true;
  }
  
  async disconnect() {
    // Default implementation does nothing
  }
  
  async get(...args) {
    throw new Error('get() must be implemented by driver');
  }
  
  async set(...args) {
    throw new Error('set() must be implemented by driver');
  }
  
  async del(...args) {
    throw new Error('del() must be implemented by driver');
  }
  
  async inc(...args) {
    throw new Error('inc() must be implemented by driver');
  }
  
  async dec(...args) {
    throw new Error('dec() must be implemented by driver');
  }
  
  async add(...args) {
    throw new Error('add() must be implemented by driver');
  }
  
  async upd(...args) {
    throw new Error('upd() must be implemented by driver');
  }
  
  async pop(...args) {
    throw new Error('pop() must be implemented by driver');
  }
  
  async shift(...args) {
    throw new Error('shift() must be implemented by driver');
  }
  
  async keys(...args) {
    const r = await this.get(...args);
    return (r !== null && typeof r === "object") ? Object.keys(r) : [];
  }
  
  async values(...args) {
    const r = await this.get(...args);
    return (r !== null && typeof r === "object") ? Object.values(r) : [];
  }
  
  async entries(...args) {
    const r = await this.get(...args);
    return (r !== null && typeof r === "object") ? Object.entries(r) : [];
  }
  
  async len(...args) {
    const k = await this.keys(...args);
    return k.length;
  }
  
  /**
   * Escape special characters in a key component
   * Escapes backslashes first, then dots
   * @param {string} str - The string to escape
   * @returns {string} The escaped string
   */
  _escapeDots(str) {
    return str.replace(/\\/g, '\\\\').replace(/\./g, '\\.');
  }
  
  /**
   * Unescape special characters in a key component
   * Unescapes dots first, then backslashes
   * @param {string} str - The string to unescape
   * @returns {string} The unescaped string
   */
  _unescapeDots(str) {
    return str.replace(/\\\./g, '.').replace(/\\\\/g, '\\');
  }
  
  /**
   * Convert a path array to a key string with proper escaping
   * @param {Array} path - Array of path components
   * @returns {string} Escaped key string with dots as separators
   */
  _pathToKey(path) {
    return path.map(key => this._escapeDots(String(key))).join('.');
  }
  
  /**
   * Convert a key string to a path array, handling escaped dots
   * @param {string} key - The key string to parse
   * @returns {Array} Array of unescaped path components
   */
  _keyToPath(key) {
    const parts = [];
    let current = '';
    let i = 0;
    
    while (i < key.length) {
      if (key[i] === '\\' && i + 1 < key.length) {
        // Escaped character
        current += key[i] + key[i + 1];
        i += 2;
      } else if (key[i] === '.') {
        // Unescaped dot = separator
        parts.push(this._unescapeDots(current));
        current = '';
        i++;
      } else {
        current += key[i];
        i++;
      }
    }
    
    if (current) {
      parts.push(this._unescapeDots(current));
    }
    
    return parts;
  }
}

