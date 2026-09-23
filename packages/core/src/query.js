import { setAtPath } from './schema.js';

const EQUALITY_OPERATORS = new Set(['=', '==']);
const INEQUALITY_OPERATORS = new Set(['!=', '<>']);
const RANGE_OPERATORS = new Set(['>', '>=', '<', '<=']);
const OPERATORS = new Set([
  ...EQUALITY_OPERATORS,
  ...INEQUALITY_OPERATORS,
  ...RANGE_OPERATORS,
  'in',
]);
const DIRECTIONS = new Set(['asc', 'desc']);
const ORDERED_TYPES = new Set(['number', 'string']);

function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function pathLabel(path) {
  return path.length === 0 ? '(root)' : path.join('.');
}

/**
 * Normalize a field reference into path segments.
 * @param {string|string[]} field - Dot separated field or explicit segments
 * @param {string} method - Method name used in error messages
 * @returns {string[]} Path segments
 */
export function normalizeQueryField(field, method = 'query') {
  const segments = Array.isArray(field)
    ? field
    : (typeof field === 'string' && field.length > 0 ? field.split('.') : null);

  if (!segments || segments.length === 0
    || segments.some(segment => typeof segment !== 'string' || segment.length === 0)) {
    throw new TypeError(`${method}() requires a field name or a non-empty array of path segments`);
  }

  return segments;
}

function assertCount(count, method) {
  if (!Number.isInteger(count) || count < 0) {
    throw new TypeError(`${method}() requires a non-negative integer`);
  }
}

function readField(value, path) {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object'
      || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return { present: false, value: undefined };
    }
    current = current[segment];
  }
  return { present: true, value: current };
}

function matchesWhere(record, step) {
  const field = readField(record, step.field);
  if (!field.present) return false;

  const expected = step.value;
  if (step.operator === 'in') return expected.some(item => item === field.value);
  if (EQUALITY_OPERATORS.has(step.operator)) return field.value === expected;
  if (INEQUALITY_OPERATORS.has(step.operator)) return field.value !== expected;

  // Ranges are strict: no type coercion, and only ordered primitives participate.
  if (!ORDERED_TYPES.has(typeof field.value) || typeof field.value !== typeof expected) return false;
  if (step.operator === '>') return field.value > expected;
  if (step.operator === '>=') return field.value >= expected;
  if (step.operator === '<') return field.value < expected;
  return field.value <= expected;
}

function compareForOrder(left, right) {
  const leftMissing = left === undefined || left === null;
  const rightMissing = right === undefined || right === null;
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }

  if (typeof left === typeof right && ORDERED_TYPES.has(typeof left)) {
    if (left < right) return -1;
    if (left > right) return 1;
  }

  return 0;
}

function compareKeys(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function projectValue(value, fields) {
  let projected = {};
  for (const field of fields) {
    const selected = readField(value, field);
    if (selected.present) projected = setAtPath(projected, field, selected.value);
  }
  return projected;
}

function applyQueryStep(records, step) {
  switch (step.type) {
    case 'where':
      return records.filter(record => matchesWhere(record.value, step));
    case 'orderBy': {
      const direction = step.direction === 'desc' ? -1 : 1;
      return records.slice().sort((left, right) => {
        const leftField = readField(left.value, step.field);
        const rightField = readField(right.value, step.field);
        return direction * compareForOrder(leftField.value, rightField.value);
      });
    }
    case 'skip':
      return records.slice(step.count);
    case 'take':
      return records.slice(0, step.count);
    case 'select':
      return records.map(record => ({ id: record.id, value: projectValue(record.value, step.fields) }));
    default:
      throw new TypeError(`Unknown query step "${step && step.type}"`);
  }
}

/**
 * Translate a leading run of skip()/take() steps into a native window.
 * Drivers that can address a sub-range of their storage use this to read only
 * the records the window keeps. Anything after the run still has to run in
 * memory, so it is returned untouched.
 * @param {object[]} steps - Query descriptor steps
 * @returns {{offset: number, limit: number|null, rest: object[]}|null} Window, or
 *   null when the chain does not start with skip()/take()
 */
export function resolveQueryWindow(steps) {
  let start = 0;
  let end = Infinity;
  let index = 0;

  while (index < steps.length) {
    const step = steps[index];
    if (step.type === 'skip') {
      start += step.count;
    } else if (step.type === 'take') {
      end = Math.min(end, start + step.count);
    } else {
      break;
    }
    index++;
  }

  if (index === 0) return null;

  return {
    offset: start,
    limit: end === Infinity ? null : Math.max(0, end - start),
    rest: steps.slice(index),
  };
}

/**
 * Turn an object into records and apply the query steps in chain order.
 * Shared by every driver that supports query(): drivers read the object at the
 * requested path from their own storage and delegate the evaluation here.
 * @param {any} collection - Value stored at the queried path
 * @param {object[]} steps - Query descriptor steps
 * @param {{path?: Array<string|number>}} [options] - Queried path, used in errors
 * @returns {{id: string, value: any}[]} Matching records
 */
export function evaluateQuery(collection, steps = [], { path = [] } = {}) {
  if (collection === null || collection === undefined) return [];
  if (typeof collection !== 'object' || Array.isArray(collection)) {
    throw new TypeError(
      `query() requires an object at "${pathLabel(path)}", received ${describeType(collection)}`,
    );
  }

  let records = Object.keys(collection)
    .sort(compareKeys)
    .map(id => ({ id, value: collection[id] }));

  for (const step of steps) {
    records = applyQueryStep(records, step);
  }

  return records;
}

/**
 * Chainable query over the direct properties of the object at a path.
 * Building the chain performs no I/O; terminal methods run the descriptor
 * through the current read policy (readFirst, read timeout and read hooks).
 */
export class DeepBaseQuery {
  constructor(db, path = []) {
    if (!db || typeof db._runReadOperation !== 'function') {
      throw new TypeError('DeepBaseQuery requires a DeepBase instance');
    }
    for (const segment of path) {
      if (typeof segment !== 'string' && typeof segment !== 'number') {
        throw new TypeError('query() path segments must be strings or numbers');
      }
    }

    this._db = db;
    this._path = [...path];
    this._steps = [];
  }

  where(field, operator, value) {
    const normalized = normalizeQueryField(field, 'where');
    if (typeof operator !== 'string' || !OPERATORS.has(operator)) {
      throw new TypeError(`where() received an unsupported operator "${operator}"`);
    }
    if (operator === 'in' && !Array.isArray(value)) {
      throw new TypeError('where() with the "in" operator requires an array value');
    }

    this._steps.push({ type: 'where', field: normalized, operator, value });
    return this;
  }

  orderBy(field, direction = 'asc') {
    const normalized = normalizeQueryField(field, 'orderBy');
    if (!DIRECTIONS.has(direction)) {
      throw new TypeError('orderBy() requires a direction of "asc" or "desc"');
    }

    this._steps.push({ type: 'orderBy', field: normalized, direction });
    return this;
  }

  skip(count) {
    assertCount(count, 'skip');
    this._steps.push({ type: 'skip', count });
    return this;
  }

  take(count) {
    assertCount(count, 'take');
    this._steps.push({ type: 'take', count });
    return this;
  }

  select(...fields) {
    const list = fields.length === 1 && Array.isArray(fields[0]) ? fields[0] : fields;
    if (list.length === 0) {
      throw new TypeError('select() requires at least one field');
    }

    this._steps.push({
      type: 'select',
      fields: list.map(field => normalizeQueryField(field, 'select')),
    });
    return this;
  }

  toArray() {
    return this._execute();
  }

  async first() {
    const records = await this._execute(this._firstRecordSteps());
    return records.length > 0 ? records[0] : null;
  }

  async count() {
    return (await this._execute()).length;
  }

  async any() {
    return (await this._execute(this._firstRecordSteps())).length > 0;
  }

  // A trailing take(1) is equivalent to reading the first record, and lets
  // drivers that support it stop after the first match.
  _firstRecordSteps() {
    return [...this._steps, { type: 'take', count: 1 }];
  }

  _execute(steps = this._steps) {
    return this._db._runReadOperation('query()', 'query', [this._path, steps]);
  }
}
