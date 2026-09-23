import { DeepBaseDriver, evaluateQuery, removeKey } from '../src/index.js';

/**
 * In-memory driver used by the core tests to exercise DeepBase against the
 * same driver contract the shipped drivers implement.
 */
export class MemoryDriver extends DeepBaseDriver {
  constructor({ name = 'memory', failQuery = false, queryDelayMs = 0, ...opts } = {}) {
    super(opts);
    this.name = name;
    this.data = {};
    this.queryCalls = 0;
    this.failQuery = failQuery;
    this.queryDelayMs = queryDelayMs;
  }

  async connect() {
    this._connected = true;
  }

  async get(...path) {
    return this._read(path);
  }

  async set(...args) {
    if (args.length < 2) {
      this.data = structuredClone(args[0]);
      return [];
    }

    const path = args.slice(0, -1);
    let target = this.data;
    for (const segment of path.slice(0, -1)) {
      if (!target[segment] || typeof target[segment] !== 'object') target[segment] = {};
      target = target[segment];
    }
    target[path.at(-1)] = structuredClone(args.at(-1));
    return path;
  }

  async del(...args) {
    if (args.length === 0) {
      this.data = {};
      return [];
    }

    const parent = this._navigate(args.slice(0, -1));
    removeKey(parent, args.at(-1));
    return args;
  }

  async query(path, steps) {
    this.queryCalls++;
    if (this.failQuery) throw new Error(`${this.name} driver query failure`);
    if (this.queryDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.queryDelayMs));
    }
    return evaluateQuery(this._read(path), steps, { path });
  }

  _navigate(path) {
    let value = this.data;
    for (const segment of path) {
      if (value === null || typeof value !== 'object'
        || !Object.prototype.hasOwnProperty.call(value, segment)) {
        return null;
      }
      value = value[segment];
    }
    return value;
  }

  _read(path) {
    const value = this._navigate(path);
    return value === undefined ? null : structuredClone(value);
  }
}

/** Driver that only implements get(): it must report query() as unsupported. */
export class GetOnlyDriver extends DeepBaseDriver {
  async connect() {
    this._connected = true;
  }

  async get() {
    return {};
  }
}
