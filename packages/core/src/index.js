import { DeepBase } from './DeepBase.js';
export { DeepBase } from './DeepBase.js';
export { DeepBaseDriver } from './DeepBaseDriver.js';
export { DeepBaseQuery, evaluateQuery, resolveQueryWindow } from './query.js';
export { DeepBaseSchemaError, removeKey } from './schema.js';

// Note: JsonDriver is not exported from core anymore to allow browser usage
// Import it separately if needed:
// import { JsonDriver } from 'deepbase-json';

export default DeepBase;
