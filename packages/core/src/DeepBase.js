import { DeepBaseDriver } from './DeepBaseDriver.js';

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
  try {
    const { JsonDriver } = await import('deepbase-json');
    return new JsonDriver(options);
  } catch (error) {
    throw new Error(
      'JsonDriver not available. ' +
      'Please provide a driver or install deepbase-json: npm install deepbase-json'
    );
  }
}

export class DeepBase {
  constructor(drivers = [], {writeAll, readFirst, failOnPrimaryError, lazyConnect, timeout, readTimeout, writeTimeout, ...opts} = {}) {
    // Support backward compatibility: new DeepBase({ name: "db" })
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
  
  async _initializeDrivers() {
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
    await Promise.allSettled(
      this.drivers.map(driver => driver.disconnect())
    );
  }
  
  async get(...args) {
    await this._ensureConnected();
    
    const operation = async () => {
      if (this.opts.readFirst) {
        // Try drivers in order until one succeeds
        for (const driver of this.drivers) {
          try {
            return await driver.get(...args);
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
          this.drivers.map(driver => driver.get(...args))
        );
      }
    };
    
    return withTimeout(operation(), this.opts.readTimeout, 'get()');
  }
  
  async set(...args) {
    await this._ensureConnected();
    
    const operation = async () => {
      if (this.opts.writeAll) {
        // Write to all drivers
        const results = await Promise.allSettled(
          this.drivers.map(driver => driver.set(...args))
        );
        
        // Check if primary driver succeeded
        if (this.opts.failOnPrimaryError && results[0].status === 'rejected') {
          throw results[0].reason;
        }
        
        // Return result from primary driver
        return results[0].status === 'fulfilled' ? results[0].value : null;
      } else {
        // Write only to primary driver
        return this.drivers[0].set(...args);
      }
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'set()');
  }
  
  async del(...args) {
    await this._ensureConnected();
    
    const operation = async () => {
      if (this.opts.writeAll) {
        const results = await Promise.allSettled(
          this.drivers.map(driver => driver.del(...args))
        );
        
        if (this.opts.failOnPrimaryError && results[0].status === 'rejected') {
          throw results[0].reason;
        }
        
        return results[0].status === 'fulfilled' ? results[0].value : null;
      } else {
        return this.drivers[0].del(...args);
      }
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'del()');
  }
  
  async inc(...args) {
    await this._ensureConnected();
    
    const operation = async () => {
      if (this.opts.writeAll) {
        const results = await Promise.allSettled(
          this.drivers.map(driver => driver.inc(...args))
        );
        
        if (this.opts.failOnPrimaryError && results[0].status === 'rejected') {
          throw results[0].reason;
        }
        
        return results[0].status === 'fulfilled' ? results[0].value : null;
      } else {
        return this.drivers[0].inc(...args);
      }
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'inc()');
  }
  
  async dec(...args) {
    await this._ensureConnected();
    
    const operation = async () => {
      if (this.opts.writeAll) {
        const results = await Promise.allSettled(
          this.drivers.map(driver => driver.dec(...args))
        );
        
        if (this.opts.failOnPrimaryError && results[0].status === 'rejected') {
          throw results[0].reason;
        }
        
        return results[0].status === 'fulfilled' ? results[0].value : null;
      } else {
        return this.drivers[0].dec(...args);
      }
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'dec()');
  }
  
  async add(...args) {
    await this._ensureConnected();
    
    const operation = async () => {
      if (this.opts.writeAll) {
        const results = await Promise.allSettled(
          this.drivers.map(driver => driver.add(...args))
        );
        
        if (this.opts.failOnPrimaryError && results[0].status === 'rejected') {
          throw results[0].reason;
        }
        
        return results[0].status === 'fulfilled' ? results[0].value : null;
      } else {
        return this.drivers[0].add(...args);
      }
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'add()');
  }
  
  async upd(...args) {
    await this._ensureConnected();
    
    const operation = async () => {
      if (this.opts.writeAll) {
        const results = await Promise.allSettled(
          this.drivers.map(driver => driver.upd(...args))
        );
        
        if (this.opts.failOnPrimaryError && results[0].status === 'rejected') {
          throw results[0].reason;
        }
        
        return results[0].status === 'fulfilled' ? results[0].value : null;
      } else {
        return this.drivers[0].upd(...args);
      }
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'upd()');
  }
  
  async pop(...args) {
    await this._ensureConnected();
    
    const operation = async () => {
      const allKeys = await this.keys(...args);
      
      if (allKeys.length === 0) {
        return undefined;
      }
      
      const lastKey = allKeys[allKeys.length - 1];
      const value = await this.get(...args, lastKey);
      await this.del(...args, lastKey);
      
      return value;
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'pop()');
  }
  
  async shift(...args) {
    await this._ensureConnected();
    
    const operation = async () => {
      const allKeys = await this.keys(...args);
      
      if (allKeys.length === 0) {
        return undefined;
      }
      
      const firstKey = allKeys[0];
      const value = await this.get(...args, firstKey);
      await this.del(...args, firstKey);
      
      return value;
    };
    
    return withTimeout(operation(), this.opts.writeTimeout, 'shift()');
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
    
    console.log(`🔄 Starting migration from driver ${fromIndex} to driver ${toIndex}...`);
    
    // Clear target if requested
    if (options.clear) {
      console.log('🧹 Clearing target driver...');
      await targetDriver.del();
    }
    
    // Get all data from source
    console.log('📥 Reading from source driver...');
    const sourceData = await sourceDriver.get();
    
    if (!sourceData || typeof sourceData !== 'object') {
      console.log('✅ No data to migrate');
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
    
    console.log(`✅ Migration complete: ${migrated} items migrated, ${errors} errors`);
    
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
      console.log(`\n🔄 Syncing to driver ${i}...`);
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

