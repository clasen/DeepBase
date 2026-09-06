import { DeepBaseDriver } from './DeepBaseDriver.js';
import {
  DeepBaseSchemaError,
  cloneData,
  compileSchema,
  deleteAtPath,
  describeDeclaredSchema,
  describeInferredSchema,
  getAtPath,
  schemaToMermaid,
  setAtPath,
  validateData,
  validateMutation,
} from './schema.js';

/**
 * Helper to wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} operation - Name of the operation (for error messages)
 * @returns {Promise} Promise that rejects on timeout
 */
function withTimeout(promise, ms, operation = 'operation') {
  if (!ms || ms <= 0) {
    return promise;
  }
  
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
    )
  ]);
}

/**
 * Dynamically import JsonDriver only when needed
 * @param {object} options - Options for JsonDriver
 * @returns {Promise<DeepBaseDriver>} JsonDriver instance
 */
async function createJsonDriver(options = {}) {
  let JsonDriver;

  try {
    ({ JsonDriver } = await import('deepbase-json'));
  } catch (error) {
    const wrapped = new Error(
      'JsonDriver not available. ' +
      'Please provide a driver or install deepbase-json: npm install deepbase-json'
    );
    wrapped.cause = error;
    throw wrapped;
  }

  return new JsonDriver(options);
}

export class DeepBase {
  constructor(drivers = [], {writeAll, readFirst, failOnPrimaryError, lazyConnect, timeout, readTimeout, writeTimeout, schema, ...opts} = {}) {
    // Support shorthand JSON options: new DeepBase({ path: "/absolute/path", name: "db" })
    // If first argument is a plain object (not a driver), treat it as JsonDriver options
    if (!Array.isArray(drivers) && !(drivers instanceof DeepBaseDriver) && 
        typeof drivers === 'object' && drivers !== null) {
      // First argument is options object for JsonDriver
      // Store options and create driver lazily
      this._jsonDriverOptions = drivers;
      drivers = [];
    } else {
      // Normalize to array
      drivers = Array.isArray(drivers) ? drivers : [drivers];
    }
    
    // Store original drivers array
    this._initialDrivers = drivers;
    this._driversInitialized = false;
    
    this.drivers = drivers;
    this._plugins = [];
    this._pluginsLocked = false;
    this._schema = schema === undefined ? null : compileSchema(schema);
    this.schema = this._schema ? cloneData(this._schema.publicSchema) : null;
    if (this._schema) this._schemaMutationQueue = Promise.resolve();
    
    this.opts = {
      writeAll: writeAll !== false, // Write to all drivers by default
      readFirst: readFirst !== false, // Read from first available
      failOnPrimaryError: failOnPrimaryError !== false,
      lazyConnect: lazyConnect !== false, // Auto-connect on first operation by default
      timeout: timeout || 0, // Global timeout in ms (0 = disabled)
      readTimeout: readTimeout || timeout || 0, // Read operations timeout in ms
      writeTimeout: writeTimeout || timeout || 0, // Write operations timeout in ms
      connectTimeout: opts.connectTimeout || timeout || 0, // Connection timeout in ms
      ...opts
    };
  }

  use(plugin) {
    if (this._pluginsLocked) {
      throw new Error('DeepBase plugins must be registered before the first operation');
    }
    if (!plugin || typeof plugin !== 'object') {
      throw new TypeError('DeepBase plugin must be an object');
    }
    if (typeof plugin.name !== 'string' || plugin.name.trim() === '') {
      throw new TypeError('DeepBase plugin requires a non-empty name');
    }

    const hooks = ['setup', 'execute', 'executeSync', 'dispose'];
    for (const hook of hooks) {
      if (plugin[hook] !== undefined && typeof plugin[hook] !== 'function') {
        throw new TypeError(`DeepBase plugin ${plugin.name} ${hook} must be a function`);
      }
    }
    if (!hooks.some((hook) => typeof plugin[hook] === 'function')) {
      throw new TypeError(`DeepBase plugin ${plugin.name} must define at least one hook`);
    }
    if (this._plugins.some((registered) => registered.name === plugin.name)) {
      throw new Error(`DeepBase plugin ${plugin.name} is already registered`);
    }

    if (plugin.setup) {
      const result = plugin.setup(this);
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(() => {});
        throw new TypeError(`DeepBase plugin ${plugin.name} setup() must be synchronous`);
      }
    }

    this._plugins.push(plugin);
    return this;
  }

  _nextPluginContext(context, override) {
    if (override === undefined) return context;
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
      throw new TypeError('DeepBase plugin next() override must be an object');
    }

    const operation = override.operation ?? context.operation;
    const args = override.args ?? context.args;
    if (typeof operation !== 'string' || operation.length === 0) {
      throw new TypeError('DeepBase plugin operation must be a non-empty string');
    }
    if (!Array.isArray(args)) {
      throw new TypeError('DeepBase plugin args must be an array');
    }

    return Object.freeze({ ...context, operation, args });
  }

  _executePlugins(operation, kind, args, terminal) {
    const initialContext = Object.freeze({
      db: this,
      operation,
      kind,
      args,
      sync: false,
    });

    const dispatch = (index, context) => {
      let pluginIndex = index;
      while (pluginIndex < this._plugins.length && !this._plugins[pluginIndex].execute) {
        pluginIndex++;
      }
      if (pluginIndex === this._plugins.length) return terminal(context);

      const plugin = this._plugins[pluginIndex];
      let called = false;
      const next = (override) => {
        if (called) throw new Error(`DeepBase plugin ${plugin.name} called next() more than once`);
        called = true;
        return dispatch(pluginIndex + 1, this._nextPluginContext(context, override));
      };
      return plugin.execute(context, next);
    };

    return dispatch(0, initialContext);
  }

  _executePluginsSync(operation, kind, args, terminal) {
    const initialContext = Object.freeze({
      db: this,
      operation,
      kind,
      args,
      sync: true,
    });

    const dispatch = (index, context) => {
      let pluginIndex = index;
      while (
        pluginIndex < this._plugins.length
        && !this._plugins[pluginIndex].execute
        && !this._plugins[pluginIndex].executeSync
      ) {
        pluginIndex++;
      }
      if (pluginIndex === this._plugins.length) return terminal(context);

      const plugin = this._plugins[pluginIndex];
      if (!plugin.executeSync) {
        throw new Error(`DeepBase plugin ${plugin.name} does not support getSync()`);
      }

      let called = false;
      const next = (override) => {
        if (called) throw new Error(`DeepBase plugin ${plugin.name} called next() more than once`);
        called = true;
        return dispatch(pluginIndex + 1, this._nextPluginContext(context, override));
      };
      return plugin.executeSync(context, next);
    };

    return dispatch(0, initialContext);
  }
  
  async _initializeDrivers() {
    this._pluginsLocked = true;
    if (this._driversInitialized) {
      return;
    }
    
    // If we need to create a JsonDriver from options
    if (this._jsonDriverOptions) {
      const jsonDriver = await createJsonDriver(this._jsonDriverOptions);
      this.drivers = [jsonDriver];
    } else if (this.drivers.length === 0) {
      // No drivers provided, try to create default JsonDriver
      const jsonDriver = await createJsonDriver();
      this.drivers = [jsonDriver];
    }
    
    // Validate drivers
    for (const driver of this.drivers) {
      if (!(driver instanceof DeepBaseDriver)) {
        throw new Error('All drivers must extend DeepBaseDriver');
      }
    }
    
    this._driversInitialized = true;
  }
  
  async connect() {
    await this._initializeDrivers();
    
    const operation = async () => {
      const results = await Promise.allSettled(
        this.drivers.map(driver => driver.connect())
      );
      
      const errors = results
        .filter(r => r.status === 'rejected')
        .map((r, i) => ({ driver: this.drivers[i], error: r.reason }));
      
      if (errors.length > 0 && this.opts.failOnPrimaryError && 
          results[0].status === 'rejected') {
        throw errors[0].error;
      }
      
      return { 
        connected: results.filter(r => r.status === 'fulfilled').length,
        total: this.drivers.length 
      };
    };
    
    // Use timeout for connection (default to general timeout)
    const connectTimeout = this.opts.connectTimeout || this.opts.timeout;
    return withTimeout(operation(), connectTimeout, 'connect()');
  }
  
  async _ensureConnected() {
    // Initialize drivers first if needed
    if (!this._driversInitialized) {
      await this._initializeDrivers();
    }
    
    // Only auto-connect if lazyConnect is enabled
    if (!this.opts.lazyConnect) {
      return;
    }
    
    // Check if all drivers are connected
    const needsConnection = this.drivers.some(driver => !driver._connected);
    
    if (needsConnection) {
      await this.connect();
    }
  }
  
  async disconnect() {
    this._pluginsLocked = true;
    await Promise.allSettled(
      this.drivers.map(driver => driver.disconnect())
    );
  }

  async dispose(options = {}) {
    this._pluginsLocked = true;
    const driverResults = await Promise.allSettled(
      this.drivers.map(driver => driver.dispose(options))
    );
    const pluginResults = [];
    for (const plugin of [...this._plugins].reverse()) {
      if (!plugin.dispose) continue;
      try {
        await plugin.dispose(this);
        pluginResults.push({ status: 'fulfilled' });
      } catch (reason) {
        pluginResults.push({ status: 'rejected', reason });
      }
    }

    const failure = [...driverResults, ...pluginResults].find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  async _readFromDriversRaw(method, args) {
    if (this.opts.readFirst) {
      // Try drivers in order until one succeeds
      for (const driver of this.drivers) {
        try {
          return await driver[method](...args);
        } catch (error) {
          // If this is the last driver, throw the error
          if (driver === this.drivers[this.drivers.length - 1]) {
            throw error;
          }
          // Otherwise, continue to next driver
        }
      }
    } else {
      // Race: return first successful response
      return Promise.any(
        this.drivers.map(driver => driver[method](...args))
      );
    }
  }

  async _readFromDrivers(method, args) {
    return this._executePlugins(method, 'read', args, (context) =>
      this._readFromDriversRaw(context.operation, context.args));
  }

  async _writeToDriversRaw(method, args) {
    if (this.opts.writeAll) {
      // Write to all drivers
      const results = await Promise.allSettled(
        this.drivers.map(driver => driver[method](...args))
      );
      
      // Check if primary driver succeeded
      if (this.opts.failOnPrimaryError && results[0].status === 'rejected') {
        throw results[0].reason;
      }
      
      // Return result from primary driver
      return results[0].status === 'fulfilled' ? results[0].value : null;
    } else {
      // Write only to primary driver
      return this.drivers[0][method](...args);
    }
  }

  async _writeToDrivers(method, args) {
    return this._executePlugins(method, 'write', args, (context) =>
      this._writeToDriversRaw(context.operation, context.args));
  }

  async _runReadOperation(operationName, driverMethod, args) {
    await this._ensureConnected();
    return withTimeout(
      this._readFromDrivers(driverMethod, args),
      this.opts.readTimeout,
      operationName
    );
  }

  async _runWriteOperation(operationName, driverMethod, args) {
    await this._ensureConnected();
    return withTimeout(
      this._writeToDrivers(driverMethod, args),
      this.opts.writeTimeout,
      operationName
    );
  }

  async _runSchemaMutation(operationName, operation) {
    await this._ensureConnected();
    const result = this._schemaMutationQueue.then(operation, operation);
    this._schemaMutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return withTimeout(result, this.opts.writeTimeout, operationName);
  }

  _assertSchemaMutation(operationName, path, before, after) {
    const issues = validateMutation(before, after, path, this._schema);
    if (issues.length > 0) {
      throw new DeepBaseSchemaError(`${operationName} violates the DeepBase schema`, {
        operation: operationName,
        path,
        issues,
      });
    }
  }
  
  async get(...args) {
    return this._runReadOperation('get()', 'get', args);
  }

  getSync(...args) {
    this._pluginsLocked = true;
    if (!this.drivers || this.drivers.length === 0) {
      throw new Error('No drivers. Call connect() first or add drivers.');
    }
    return this._executePluginsSync('get', 'read', args, (context) => {
      if (context.operation !== 'get') {
        throw new Error(`getSync() cannot execute ${context.operation}`);
      }
      return this.drivers[0].getSync(...context.args);
    });
  }
  
  async set(...args) {
    if (this._schema) {
      return this._runSchemaMutation('set()', async () => {
        if (args.length === 0) throw new Error('set() requires at least one argument');
        const path = args.slice(0, -1);
        const before = await this._readFromDrivers('get', []);
        const after = setAtPath(before, path, args.at(-1));
        this._assertSchemaMutation('set()', path, before, after);
        return this._writeToDrivers('set', args);
      });
    }
    return this._runWriteOperation('set()', 'set', args);
  }
  
  async del(...args) {
    if (this._schema) {
      return this._runSchemaMutation('del()', async () => {
        const before = await this._readFromDrivers('get', []);
        const after = deleteAtPath(before, args);
        this._assertSchemaMutation('del()', args, before, after);
        return this._writeToDrivers('del', args);
      });
    }
    return this._runWriteOperation('del()', 'del', args);
  }
  
  async inc(...args) {
    if (this._schema) {
      return this._runSchemaMutation('inc()', async () => {
        const path = args.slice(0, -1);
        const before = await this._readFromDrivers('get', []);
        const after = setAtPath(before, path, getAtPath(before, path) + args.at(-1));
        this._assertSchemaMutation('inc()', path, before, after);
        return this._writeToDrivers('inc', args);
      });
    }
    return this._runWriteOperation('inc()', 'inc', args);
  }
  
  async dec(...args) {
    if (this._schema) {
      return this._runSchemaMutation('dec()', async () => {
        const path = args.slice(0, -1);
        const before = await this._readFromDrivers('get', []);
        const after = setAtPath(before, path, getAtPath(before, path) - args.at(-1));
        this._assertSchemaMutation('dec()', path, before, after);
        return this._writeToDrivers('dec', args);
      });
    }
    return this._runWriteOperation('dec()', 'dec', args);
  }
  
  async add(...args) {
    if (this._schema) {
      return this._runSchemaMutation('add()', async () => {
        const value = args.at(-1);
        const parentPath = args.slice(0, -1);
        const id = this.drivers[0].nanoid();
        const path = [...parentPath, id];
        const before = await this._readFromDrivers('get', []);
        const after = setAtPath(before, path, value);
        this._assertSchemaMutation('add()', path, before, after);
        await this._writeToDrivers('set', [...path, value]);
        return path;
      });
    }
    await this._ensureConnected();
    
    const operation = async () => {
      const value = args[args.length - 1];
      const keys = args.slice(0, -1);
      
      // Generate ID once so all drivers share the same key
      const id = this.drivers[0].nanoid();
      
      // Use set() which already handles writeAll
      await this.set(...keys, id, value);
      
      return [...keys, id];
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'add()');
  }
  
  async upd(...args) {
    if (this._schema) {
      return this._runSchemaMutation('upd()', async () => {
        const update = args.at(-1);
        const path = args.slice(0, -1);
        if (typeof update !== 'function') throw new TypeError('upd() requires an update function');
        const before = await this._readFromDrivers('get', []);
        const value = update(cloneData(getAtPath(before, path)));
        const after = setAtPath(before, path, value);
        this._assertSchemaMutation('upd()', path, before, after);
        return this._writeToDrivers('upd', [...path, () => value]);
      });
    }
    return this._runWriteOperation('upd()', 'upd', args);
  }

  async first(...args) {
    return this._runReadOperation('first()', 'first', args);
  }

  async last(...args) {
    return this._runReadOperation('last()', 'last', args);
  }
  
  async pop(...args) {
    if (this._schema) return this._removeSchemaBoundary('pop()', 'last', args);
    await this._ensureConnected();
    
    const operation = async () => {
      const lastKey = await this.last(...args);

      if (lastKey === undefined) {
        return undefined;
      }

      const value = await this.get(...args, lastKey);
      await this.del(...args, lastKey);
      
      return value;
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'pop()');
  }
  
  async shift(...args) {
    if (this._schema) return this._removeSchemaBoundary('shift()', 'first', args);
    await this._ensureConnected();
    
    const operation = async () => {
      const firstKey = await this.first(...args);

      if (firstKey === undefined) {
        return undefined;
      }

      const value = await this.get(...args, firstKey);
      await this.del(...args, firstKey);
      
      return value;
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'shift()');
  }

  async _removeSchemaBoundary(operationName, boundaryMethod, path) {
    return this._runSchemaMutation(operationName, async () => {
      const key = await this._readFromDrivers(boundaryMethod, path);
      if (key === undefined) return undefined;
      const itemPath = [...path, key];
      const value = await this._readFromDrivers('get', itemPath);
      const before = await this._readFromDrivers('get', []);
      const after = deleteAtPath(before, itemPath);
      this._assertSchemaMutation(operationName, itemPath, before, after);
      await this._writeToDrivers('del', itemPath);
      return value;
    });
  }

  async describeSchema() {
    await this._ensureConnected();
    const root = await this._runReadOperation('describeSchema()', 'get', []);
    return this._schema
      ? describeDeclaredSchema(root, this._schema)
      : describeInferredSchema(root);
  }

  async validateSchema() {
    if (!this._schema) throw new Error('validateSchema() requires a declared schema');
    await this._ensureConnected();
    const root = await this._runReadOperation('validateSchema()', 'get', []);
    const errors = validateData(root, this._schema);
    return { valid: errors.length === 0, errors };
  }

  async schemaDiagram() {
    return schemaToMermaid(await this.describeSchema());
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
   * Migrate/Sync data from one driver to another
   * @param {number} fromIndex - Source driver index (default: 0)
   * @param {number} toIndex - Target driver index (default: 1)
   * @param {object} opts - Migration options
   * @returns {object} Migration statistics
   */
  async migrate(fromIndex = 0, toIndex = 1, opts = {}) {
    await this._ensureConnected();
    
    if (!this.drivers[fromIndex]) {
      throw new Error(`Source driver at index ${fromIndex} not found`);
    }
    if (!this.drivers[toIndex]) {
      throw new Error(`Target driver at index ${toIndex} not found`);
    }
    
    const sourceDriver = this.drivers[fromIndex];
    const targetDriver = this.drivers[toIndex];
    
    const options = {
      clear: opts.clear !== false, // Clear target before migration
      batchSize: opts.batchSize || 100,
      onProgress: opts.onProgress || (() => {}),
      ...opts
    };
    
    // Clear target if requested
    if (options.clear) {
      await targetDriver.del();
    }
    
    // Get all data from source
    const sourceData = await sourceDriver.get();
    
    if (!sourceData || typeof sourceData !== 'object') {
      return { migrated: 0, errors: 0 };
    }
    
    // Migrate data recursively
    let migrated = 0;
    let errors = 0;
    
    async function migrateObject(obj, path = []) {
      const entries = Object.entries(obj);
      
      for (const [key, value] of entries) {
        const currentPath = [...path, key];
        
        try {
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            // If it's an object, recurse
            await migrateObject(value, currentPath);
          } else {
            // Write leaf value
            await targetDriver.set(...currentPath, value);
            migrated++;
            
            // Progress callback
            if (migrated % options.batchSize === 0) {
              options.onProgress({ migrated, errors, current: currentPath.join('.') });
            }
          }
        } catch (error) {
          errors++;
          console.error(`❌ Error migrating ${currentPath.join('.')}: ${error.message}`);
        }
      }
    }
    
    await migrateObject(sourceData);
    
    return { migrated, errors };
  }
  
  /**
   * Sync all drivers - copies data from primary to all others
   * @param {object} opts - Sync options
   * @returns {object} Sync statistics per driver
   */
  async syncAll(opts = {}) {
    if (this.drivers.length < 2) {
      throw new Error('Need at least 2 drivers to sync');
    }
    
    const results = [];
    
    for (let i = 1; i < this.drivers.length; i++) {
      const result = await this.migrate(0, i, opts);
      results.push({ driverIndex: i, ...result });
    }
    
    return results;
  }
  
  /**
   * Get driver by index
   * @param {number} index - Driver index
   * @returns {DeepBaseDriver} Driver instance
   */
  getDriver(index = 0) {
    return this.drivers[index];
  }
  
  /**
   * Get all drivers
   * @returns {DeepBaseDriver[]} Array of driver instances
   */
  getDrivers() {
    return this.drivers;
  }
}
