import { DeepBaseDriver, evaluateQuery, removeKey } from 'deepbase';
import { createClient } from 'redis';

export class RedisDriver extends DeepBaseDriver {
  constructor({name, prefix, url, ...opts} = {}) {
    super(opts);
    
    this.name = name || prefix || "db";
    this.url = url || "redis://localhost:6379";
    
    this.client = createClient({ url: this.url });
  }
  
  /**
   * Override escape for Redis JSON
   * Redis JSON has strict limitations on field names in paths
   * We need to escape dots and other special characters
   */
  _escapeDots(str) {
    // Escape special characters that Redis JSON doesn't allow in field names
    // Use a simple encoding scheme: replace problem chars with __HEX__ format
    return str.replace(/[.@$[\]\s]/g, (char) => {
      return '__' + char.charCodeAt(0).toString(16).toUpperCase() + '__';
    });
  }
  
  _unescapeDots(str) {
    // Unescape the hex-encoded characters back to originals
    return str.replace(/__([0-9A-F]+)__/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }
  
  async connect() {
    await this.client.connect();
    this._connected = true;
  }
  
  async disconnect() {
    await this.client.disconnect();
    this._connected = false;
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
    const pathParts = args;
    
    try {
      const redisKey = this.name + ":" + key;
      
      // Root reads: prefer module default behavior (avoids JSONPath array-wrapping)
      if (pathParts.length === 0) {
        const result = await this.client.json.get(redisKey);
        return this._unescapeObject(result);
      }
      
      // Nested reads: try multiple path syntaxes for RedisJSON v1/v2 compatibility
      const result = await this._jsonGet(redisKey, pathParts);
      return this._unescapeObject(result);
    } catch (error) {
      return null;
    }
  }

  /**
   * Run a query descriptor over the object stored at ...path.
   * The value is read from RedisJSON and evaluated in memory; filters are not
   * pushed to the server and no indexes are used.
   * @param {Array<string|number>} path - Path to the queried object
   * @param {object[]} steps - Query descriptor steps
   * @returns {Promise<Array<{id: string, value: any}>>} Matching records
   */
  async query(path, steps) {
    return evaluateQuery(await this.get(...path), steps, { path });
  }
  
  /**
   * Recursively unescape all keys in an object
   */
  _unescapeObject(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(v => this._unescapeObject(v));
    }
    
    const result = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const unescapedKey = this._unescapeDots(key);
        const value = obj[key];
        
        // Recursively unescape nested objects
        result[unescapedKey] = this._unescapeObject(value);
      }
    }
    return result;
  }
  
  /**
   * Recursively escape all keys in an object/array before writing to RedisJSON.
   * This ensures later path-based operations can address those keys safely.
   */
  _escapeValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    
    if (Array.isArray(value)) {
      return value.map(v => this._escapeValue(v));
    }
    
    const out = {};
    for (const k of Object.keys(value)) {
      out[this._escapeDots(String(k))] = this._escapeValue(value[k]);
    }
    return out;
  }
  
  _joinPathParts(parts) {
    return parts.map(p => this._escapeDots(String(p))).join('.');
  }
  
  /**
   * Build candidate RedisJSON paths for compatibility across RedisJSON versions.
   * - Some setups accept bare "a.b"
   * - RedisJSON v1 uses ".a.b" (root ".")
   * - RedisJSON v2 uses JSONPath "$.a.b" (root "$")
   * Array indices need brackets ("$.tags[0]" / "$[0]"), so a bracketed form is
   * appended after the dot-joined one to keep numeric object keys resolving.
   * @param {Array<string|number>} parts - Path segments
   * @returns {string[]} Candidate paths, most compatible first
   */
  _candidatePaths(parts) {
    if (!parts || parts.length === 0) {
      // Prefer JSONPath (RedisJSON v2) but fall back to legacy path (RedisJSON v1)
      return ['$', '.'];
    }
    
    const joined = this._joinPathParts(parts);
    const paths = [
      '$.' + joined,
      '.' + joined
    ];

    const bracketed = this._bracketedPath(parts);
    if (bracketed !== null) {
      paths.push('$' + bracketed, '.' + bracketed);
    }

    return paths;
  }

  /**
   * Build a path that addresses numeric segments as array indices, e.g.
   * "$.tags[0]" or "$[0]" without the root prefix.
   * @param {Array<string|number>} parts - Path segments
   * @returns {string|null} Bracketed path, or null when no segment is numeric
   */
  _bracketedPath(parts) {
    let path = '';
    let bracketed = false;

    for (const part of parts) {
      const segment = this._escapeDots(String(part));

      if (/^\d+$/.test(segment)) {
        path += '[' + segment + ']';
        bracketed = true;
      } else {
        path += '.' + segment;
      }
    }

    return bracketed ? path : null;
  }
  
  async _jsonGet(redisKey, parts) {
    const paths = this._candidatePaths(parts);
    let lastErr;
    
    for (const path of paths) {
      try {
        const result = await this.client.json.get(redisKey, { path });
        
        // RedisJSON v2 JSONPath returns the list of matches: an empty list, and
        // the bare nil of a legacy path, both mean "no match for this syntax".
        if (Array.isArray(result)) {
          if (result.length === 0) continue;
          if (result.length === 1) return result[0];
        } else if (result === null) {
          continue;
        }
        return result;
      } catch (err) {
        lastErr = err;
      }
    }
    
    // If all syntaxes returned "no matches", behave like not-found
    if (lastErr) throw lastErr;
    return null;
  }
  
  async _jsonSet(redisKey, parts, value) {
    const paths = this._candidatePaths(parts);
    let lastErr;
    
    for (const path of paths) {
      try {
        const res = await this.client.json.set(redisKey, path, value);
        // node-redis can return null when RedisJSON refuses the operation (e.g., missing parent path)
        if (res === null) {
          lastErr = new Error('RedisJSON JSON.SET returned null');
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
      }
    }
    
    throw lastErr;
  }
  
  async _jsonDel(redisKey, parts) {
    const paths = this._candidatePaths(parts);
    let lastErr;
    let answered = false;
    
    for (const path of paths) {
      try {
        // JSON.DEL answers with the number of removed paths; zero means this
        // syntax addressed nothing, so the next candidate gets a turn.
        const count = await this.client.json.del(redisKey, path);
        if (count > 0) return count;
        answered = true;
      } catch (err) {
        lastErr = err;
      }
    }
    
    if (!answered && lastErr) throw lastErr;
    return 0;
  }
  
  async _ensureRootDoc(redisKey) {
    // RedisJSON requires creating new documents at the root path
    const exists = await this.client.exists(redisKey);
    if (exists) return;
    await this._jsonSet(redisKey, [], {});
  }
  
  async _ensureParentObjects(redisKey, parts) {
    // Ensure all intermediate objects exist
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i);
      const existing = await this._jsonGet(redisKey, prefix).catch(() => null);
      
      if (existing === null || (typeof existing === 'object' && !Array.isArray(existing))) {
        if (existing === null) {
          await this._jsonSet(redisKey, prefix, {});
        }
      } else {
        // If it's a scalar/array, overwrite with an object so deeper paths work
        await this._jsonSet(redisKey, prefix, {});
      }
    }
  }
  
  
  async set(...args) {
    if (args.length < 2) return;
    
    const keys = args.slice(0, -1);
    const value = args[args.length - 1];
    
    const key = keys.shift();
    const redisKey = this.name + ":" + key;
    const pathParts = keys;
    
    await this._set(redisKey, pathParts, value);
    
    return args.slice(0, -1);
  }
  
  async inc(...args) {
    const i = args.pop();
    const key = args.shift();
    const redisKey = this.name + ":" + key;
    const parts = args;
    
    try {
      // Try multiple path syntaxes for compatibility
      let lastErr;
      for (const path of this._candidatePaths(parts)) {
        try {
          await this.client.json.numIncrBy(redisKey, path, i);
          return [key, ...parts];
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr;
      return [key, ...args];
    } catch (error) {
      return this.upd(key, ...parts, n => n + i);
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
    const parts = args;
    
    if (parts.length === 0) {
      // Delete whole document/key
      await this.client.del(redisKey);
      return [key];
    }

    // Deleting an array index shifts the remaining elements, the way pop() and
    // shift() expect, so the shortened array replaces the stored one.
    const lastKey = String(parts[parts.length - 1]);
    if (/^\d+$/.test(lastKey)) {
      const parentPath = parts.slice(0, -1);
      const parent = await this.get(key, ...parentPath);

      if (Array.isArray(parent)) {
        const spliced = parent.slice();
        if (removeKey(spliced, lastKey)) {
          await this._jsonSet(redisKey, parentPath, this._escapeValue(spliced));
          return [key, ...args];
        }
      }
    }
    
    await this._jsonDel(redisKey, parts);
    
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

  async first(...args) {
    const key = await this._boundaryKey(args, false);
    return key === undefined ? this._boundaryKeyFromValue(args, false) : key;
  }

  async last(...args) {
    const key = await this._boundaryKey(args, true);
    return key === undefined ? this._boundaryKeyFromValue(args, true) : key;
  }

  /**
   * Ask RedisJSON for the field names only, instead of transferring the whole
   * document. Returns undefined whenever the path is not a JSON object, so the
   * caller keeps the get()-based behavior.
   * @param {Array<string|number>} path - Path to the queried object
   * @param {boolean} fromEnd - Take the last key instead of the first
   * @returns {Promise<string|undefined>} Boundary key
   */
  async _boundaryKey(path, fromEnd) {
    const key = path[0];
    if (key === undefined) return undefined;

    const redisKey = this.name + ':' + key;
    for (const candidate of this._candidatePaths(path.slice(1))) {
      let reply;
      try {
        reply = await this.client.sendCommand(['JSON.OBJKEYS', redisKey, candidate]);
      } catch {
        continue;
      }

      // JSONPath candidates wrap their matches in an outer array; the legacy
      // "." syntax already answers with the plain key list.
      const names = Array.isArray(reply) && reply.length === 1 && Array.isArray(reply[0])
        ? reply[0]
        : reply;
      // A reply that is not a list of names means the path holds something else
      // than a JSON object, which the generic path handles.
      if (!Array.isArray(names) || names.length === 0
        || !names.every(name => typeof name === 'string')) continue;

      return this._unescapeDots(fromEnd ? names[names.length - 1] : names[0]);
    }

    return undefined;
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
  
  async _set(redisKey, pathParts, value) {
    if (value === undefined) {
      if (!pathParts || pathParts.length === 0) {
        await this.client.del(redisKey);
      } else {
        await this._jsonDel(redisKey, pathParts);
      }
      return;
    }
    
    const escapedValue = this._escapeValue(value);
    
    // For nested paths, RedisJSON requires the document to exist first (created at root).
    if (pathParts && pathParts.length > 0) {
      await this._ensureRootDoc(redisKey);
    }
    
    try {
      await this._jsonSet(redisKey, pathParts, escapedValue);
    } catch (error) {
      // Most likely: missing parent path. Create intermediate objects then retry.
      if (pathParts && pathParts.length > 0) {
        await this._ensureParentObjects(redisKey, pathParts.slice(0, -1));
      }
      await this._jsonSet(redisKey, pathParts, escapedValue);
    }
  }
  
  async _zeroKeys() {
    const scan = {
      TYPE: "ReJSON-RL",
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
