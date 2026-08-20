const ALLOWED_TYPES = new Set(['array', 'boolean', 'null', 'number', 'object', 'string']);
const TYPE_ORDER = ['null', 'boolean', 'number', 'string', 'array', 'object'];

export class DeepBaseSchemaError extends Error {
  constructor(message, { operation = null, path = [], issues = [], code = 'SCHEMA_VALIDATION_FAILED' } = {}) {
    super(message);
    this.name = 'DeepBaseSchemaError';
    this.code = code;
    this.operation = operation;
    this.path = [...path];
    this.issues = issues;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function assertSchema(condition, message, path = []) {
  if (!condition) {
    throw new DeepBaseSchemaError(message, {
      code: 'INVALID_SCHEMA',
      path,
      issues: [{ code: 'INVALID_SCHEMA', path, message }],
    });
  }
}

function normalizeTypes(type, path) {
  const types = Array.isArray(type) ? type : [type];
  assertSchema(types.length > 0, `Schema type at ${path.join('.')} cannot be empty`, path);
  assertSchema(types.every((item) => typeof item === 'string' && ALLOWED_TYPES.has(item)),
    `Schema type at ${path.join('.')} contains an unsupported type`, path);
  return [...new Set(types)].sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
}

function compileField(field, path) {
  assertSchema(isObject(field), `Field ${path.join('.')} must be an object`, path);
  const allowedKeys = new Set(['items', 'properties', 'ref', 'required', 'type']);
  for (const key of Object.keys(field)) {
    assertSchema(allowedKeys.has(key), `Unknown schema option ${[...path, key].join('.')}`, [...path, key]);
  }

  const types = normalizeTypes(field.type, [...path, 'type']);
  if (field.required !== undefined) {
    assertSchema(typeof field.required === 'boolean', `${[...path, 'required'].join('.')} must be boolean`, [...path, 'required']);
  }
  if (field.ref !== undefined) {
    assertSchema(typeof field.ref === 'string' && field.ref.length > 0,
      `${[...path, 'ref'].join('.')} must name an entity`, [...path, 'ref']);
    assertSchema(types.includes('string') || types.includes('number'),
      `${[...path, 'ref'].join('.')} requires type string or number`, [...path, 'ref']);
  }
  if (field.properties !== undefined) {
    assertSchema(types.includes('object'), `${[...path, 'properties'].join('.')} requires type object`, [...path, 'properties']);
    assertSchema(isObject(field.properties), `${[...path, 'properties'].join('.')} must be an object`, [...path, 'properties']);
  }
  if (field.items !== undefined) {
    assertSchema(types.includes('array'), `${[...path, 'items'].join('.')} requires type array`, [...path, 'items']);
  }

  const properties = Object.create(null);
  for (const name of Object.keys(field.properties ?? {}).sort()) {
    properties[name] = compileField(field.properties[name], [...path, 'properties', name]);
  }

  return {
    type: types,
    required: field.required === true,
    ...(field.ref !== undefined ? { ref: field.ref } : {}),
    ...(field.properties !== undefined ? { properties } : {}),
    ...(field.items !== undefined ? { items: compileField(field.items, [...path, 'items']) } : {}),
  };
}

function publicField(field) {
  const result = {
    type: field.type.length === 1 ? field.type[0] : [...field.type],
  };
  if (field.required) result.required = true;
  if (field.ref) result.ref = field.ref;
  if (field.properties) {
    result.properties = Object.fromEntries(
      Object.keys(field.properties).sort().map((name) => [name, publicField(field.properties[name])]),
    );
  }
  if (field.items) result.items = publicField(field.items);
  return result;
}

export function compileSchema(schema) {
  assertSchema(isObject(schema), 'schema must be an object');
  assertSchema(Object.keys(schema).every((key) => key === 'entities'), 'schema only supports the entities option');
  assertSchema(isObject(schema.entities), 'schema.entities must be an object', ['entities']);

  const entities = Object.create(null);
  const seenPaths = new Set();
  for (const name of Object.keys(schema.entities).sort()) {
    const definition = schema.entities[name];
    const entityPath = ['entities', name];
    assertSchema(name.length > 0, 'Entity names cannot be empty', entityPath);
    assertSchema(isObject(definition), `Entity ${name} must be an object`, entityPath);
    const allowedKeys = new Set(['additionalFields', 'fields', 'path']);
    for (const key of Object.keys(definition)) {
      assertSchema(allowedKeys.has(key), `Unknown schema option ${[...entityPath, key].join('.')}`, [...entityPath, key]);
    }
    assertSchema(Array.isArray(definition.path) && definition.path.length > 0,
      `Entity ${name} path must be a non-empty array`, [...entityPath, 'path']);
    assertSchema(definition.path.every((segment) => typeof segment === 'string' && segment.length > 0),
      `Entity ${name} path segments must be non-empty strings`, [...entityPath, 'path']);
    const parameters = definition.path.filter((segment) => segment.startsWith(':'));
    assertSchema(parameters.every((segment) => /^:[A-Za-z_][A-Za-z0-9_]*$/.test(segment)),
      `Entity ${name} contains an invalid path parameter`, [...entityPath, 'path']);
    assertSchema(new Set(parameters).size === parameters.length,
      `Entity ${name} repeats a path parameter`, [...entityPath, 'path']);
    assertSchema(definition.path.at(-1).startsWith(':'),
      `Entity ${name} path must end in an ID parameter`, [...entityPath, 'path']);
    assertSchema(typeof definition.additionalFields === 'boolean',
      `Entity ${name} additionalFields must be boolean`, [...entityPath, 'additionalFields']);
    assertSchema(isObject(definition.fields), `Entity ${name} fields must be an object`, [...entityPath, 'fields']);

    const pathKey = JSON.stringify(definition.path);
    assertSchema(!seenPaths.has(pathKey), `Entity ${name} duplicates another entity path`, [...entityPath, 'path']);
    seenPaths.add(pathKey);

    const fields = Object.create(null);
    for (const fieldName of Object.keys(definition.fields).sort()) {
      fields[fieldName] = compileField(definition.fields[fieldName], [...entityPath, 'fields', fieldName]);
    }

    entities[name] = {
      name,
      path: [...definition.path],
      idParameter: definition.path.at(-1).slice(1),
      additionalFields: definition.additionalFields,
      fields,
    };
  }

  for (const entity of Object.values(entities)) {
    visitFields(entity.fields, [], (field, fieldPath) => {
      if (!field.ref) return;
      assertSchema(Boolean(entities[field.ref]),
        `Reference ${entity.name}.${fieldPath.join('.')} targets unknown entity ${field.ref}`,
        ['entities', entity.name, 'fields', ...fieldPath, 'ref']);
    });
  }

  return {
    entities,
    publicSchema: {
      entities: Object.fromEntries(Object.values(entities).map((entity) => [entity.name, {
        path: [...entity.path],
        additionalFields: entity.additionalFields,
        fields: Object.fromEntries(Object.keys(entity.fields).map((name) => [name, publicField(entity.fields[name])])),
      }])),
    },
  };
}

function visitFields(fields, prefix, visitor) {
  for (const name of Object.keys(fields).sort()) {
    const field = fields[name];
    visitField(field, [...prefix, name], visitor);
  }
}

function visitField(field, path, visitor) {
  visitor(field, path);
  if (field.properties) visitFields(field.properties, path, visitor);
  if (field.items) visitField(field.items, [...path, '[]'], visitor);
}

export function cloneData(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const clone = Array.isArray(value) ? [] : {};
  seen.set(value, clone);
  for (const key of Object.keys(value)) setOwn(clone, key, cloneData(value[key], seen));
  return clone;
}

function setOwn(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

export function getAtPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return null;
    }
    current = current[segment];
  }
  return current;
}

export function setAtPath(root, path, value) {
  if (path.length === 0) return cloneData(value);
  let result = cloneData(root);
  if (result === null || typeof result !== 'object') result = {};
  let current = result;
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index];
    if (!Object.prototype.hasOwnProperty.call(current, segment)
      || current[segment] === null
      || typeof current[segment] !== 'object') setOwn(current, segment, {});
    current = current[segment];
  }
  setOwn(current, path.at(-1), cloneData(value));
  return result;
}

export function deleteAtPath(root, path) {
  if (path.length === 0) return {};
  const result = cloneData(root);
  let current = result;
  for (const segment of path.slice(0, -1)) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return result;
    }
    current = current[segment];
  }
  if (current !== null && typeof current === 'object') delete current[path.at(-1)];
  return result;
}

function issue(code, entity, path, message, details = {}) {
  return { code, entity, path: [...path], message, ...details };
}

function collectRecords(root, entity, errors = []) {
  const records = [];
  const walk = (current, index, path, params) => {
    if (index === entity.path.length) {
      records.push({ value: current, path, params });
      return;
    }
    if (current === undefined) return;
    if (current === null || typeof current !== 'object') {
      errors.push(issue('INVALID_COLLECTION', entity.name, path,
        `Expected an object collection while resolving ${entity.path.join('.')}`,
        { expected: 'object', actual: valueType(current) }));
      return;
    }
    const segment = entity.path[index];
    if (segment.startsWith(':')) {
      const parameter = segment.slice(1);
      for (const key of Object.keys(current).sort()) {
        walk(current[key], index + 1, [...path, key], { ...params, [parameter]: key });
      }
      return;
    }
    if (Object.prototype.hasOwnProperty.call(current, segment)) {
      walk(current[segment], index + 1, [...path, segment], params);
    }
  };
  walk(root, 0, [], {});
  return records;
}

function validateObject(value, fields, additionalFields, context, errors, refs) {
  if (!isObject(value)) {
    errors.push(issue('INVALID_ENTITY', context.entity.name, context.path,
      `Entity ${context.entity.name} must be an object`, { expected: 'object', actual: valueType(value) }));
    return;
  }

  for (const name of Object.keys(fields).sort()) {
    const field = fields[name];
    const fieldPath = [...context.path, name];
    if (!Object.prototype.hasOwnProperty.call(value, name)) {
      if (field.required) {
        errors.push(issue('REQUIRED_FIELD', context.entity.name, fieldPath,
          `Required field ${name} is missing`, { field: [...context.fieldPath, name] }));
      }
      continue;
    }
    validateField(value[name], field, {
      ...context,
      path: fieldPath,
      fieldPath: [...context.fieldPath, name],
    }, errors, refs, additionalFields);
  }

  if (!additionalFields) {
    for (const name of Object.keys(value).sort()) {
      if (!Object.prototype.hasOwnProperty.call(fields, name)) {
        errors.push(issue('UNKNOWN_FIELD', context.entity.name, [...context.path, name],
          `Field ${name} is not declared by entity ${context.entity.name}`, { field: [...context.fieldPath, name] }));
      }
    }
  }
}

function validateField(value, field, context, errors, refs, additionalFields) {
  const actual = valueType(value);
  if (!field.type.includes(actual)) {
    errors.push(issue('TYPE_MISMATCH', context.entity.name, context.path,
      `Expected ${field.type.join(' or ')}, received ${actual}`,
      { field: context.fieldPath, expected: [...field.type], actual }));
    return;
  }

  if (field.ref && value !== null) {
    refs.push({
      sourceEntity: context.entity.name,
      sourcePath: context.path,
      field: context.fieldPath,
      targetEntity: field.ref,
      value,
    });
  }
  if (actual === 'object' && field.properties) {
    validateObject(value, field.properties, additionalFields, context, errors, refs);
  }
  if (actual === 'array' && field.items) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) continue;
      validateField(value[index], field.items, {
        ...context,
        path: [...context.path, String(index)],
        fieldPath: [...context.fieldPath, String(index)],
      }, errors, refs, additionalFields);
    }
  }
}

function recordId(record, entity) {
  return String(record.params[entity.idParameter]);
}

function pathsOverlap(pattern, mutationPath) {
  const length = Math.min(pattern.length, mutationPath.length);
  for (let index = 0; index < length; index++) {
    if (!pattern[index].startsWith(':') && String(pattern[index]) !== String(mutationPath[index])) return false;
  }
  return true;
}

function recordIsAffected(record, entity, mutationPath) {
  if (!pathsOverlap(entity.path, mutationPath)) return false;
  const length = Math.min(record.path.length, mutationPath.length);
  for (let index = 0; index < length; index++) {
    if (String(record.path[index]) !== String(mutationPath[index])) return false;
  }
  return true;
}

function sortIssues(errors) {
  return errors.sort((a, b) => {
    const pathOrder = JSON.stringify(a.path).localeCompare(JSON.stringify(b.path));
    return pathOrder || a.code.localeCompare(b.code) || a.entity.localeCompare(b.entity);
  });
}

function entityState(root, compiled, includeCollectionErrors) {
  const collectionErrors = [];
  const records = Object.create(null);
  for (const entity of Object.values(compiled.entities)) {
    records[entity.name] = collectRecords(root, entity, includeCollectionErrors ? collectionErrors : []);
  }
  return { records, collectionErrors };
}

function validateReferences(refs, records, compiled, errors) {
  const ids = Object.create(null);
  for (const entity of Object.values(compiled.entities)) {
    ids[entity.name] = new Set(records[entity.name].map((record) => recordId(record, entity)));
  }
  for (const ref of refs) {
    if (!ids[ref.targetEntity].has(String(ref.value))) {
      errors.push(issue('MISSING_REFERENCE', ref.sourceEntity, ref.sourcePath,
        `Reference ${ref.field.join('.')} points to missing ${ref.targetEntity} ID ${String(ref.value)}`,
        { field: ref.field, targetEntity: ref.targetEntity, value: ref.value }));
    }
  }
}

export function validateData(root, compiled) {
  const state = entityState(root, compiled, true);
  const errors = [...state.collectionErrors];
  const refs = [];
  for (const entity of Object.values(compiled.entities)) {
    for (const record of state.records[entity.name]) {
      validateObject(record.value, entity.fields, entity.additionalFields, {
        entity,
        path: record.path,
        fieldPath: [],
      }, errors, refs);
    }
  }
  validateReferences(refs, state.records, compiled, errors);
  return sortIssues(errors);
}

export function validateMutation(before, after, mutationPath, compiled) {
  const beforeState = entityState(before, compiled, false);
  const afterState = entityState(after, compiled, true);
  const errors = afterState.collectionErrors.filter((error) =>
    Object.values(compiled.entities).some((entity) => entity.name === error.entity && pathsOverlap(entity.path, mutationPath)));
  const refs = [];

  for (const entity of Object.values(compiled.entities)) {
    for (const record of afterState.records[entity.name]) {
      if (!recordIsAffected(record, entity, mutationPath)) continue;
      validateObject(record.value, entity.fields, entity.additionalFields, {
        entity,
        path: record.path,
        fieldPath: [],
      }, errors, refs);
    }
  }
  validateReferences(refs, afterState.records, compiled, errors);

  const removedIds = Object.create(null);
  for (const entity of Object.values(compiled.entities)) {
    const beforeIds = new Set(beforeState.records[entity.name].map((record) => recordId(record, entity)));
    const afterIds = new Set(afterState.records[entity.name].map((record) => recordId(record, entity)));
    removedIds[entity.name] = new Set([...beforeIds].filter((id) => !afterIds.has(id)));
  }

  const inboundTargets = new Set();
  for (const source of Object.values(compiled.entities)) {
    visitFields(source.fields, [], (field) => {
      if (field.ref && removedIds[field.ref].size > 0) inboundTargets.add(field.ref);
    });
  }

  if (inboundTargets.size > 0) {
    const remainingRefs = [];
    for (const source of Object.values(compiled.entities)) {
      for (const record of afterState.records[source.name]) {
        const ignoredErrors = [];
        validateObject(record.value, source.fields, true, {
          entity: source,
          path: record.path,
          fieldPath: [],
        }, ignoredErrors, remainingRefs);
      }
    }
    for (const ref of remainingRefs) {
      if (removedIds[ref.targetEntity]?.has(String(ref.value))) {
        errors.push(issue('DELETE_RESTRICTED', ref.sourceEntity, ref.sourcePath,
          `Cannot delete ${ref.targetEntity} ID ${String(ref.value)} while it is referenced by ${ref.sourceEntity}.${ref.field.join('.')}`,
          { field: ref.field, targetEntity: ref.targetEntity, value: ref.value }));
      }
    }
  }

  return sortIssues(errors);
}

function mergeTypes(values) {
  return [...new Set(values.map(valueType))]
    .filter((type) => ALLOWED_TYPES.has(type))
    .sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
}

function inferField(values, presentCount, recordCount) {
  const types = mergeTypes(values);
  const field = {
    type: types.length === 1 ? types[0] : types,
  };
  if (presentCount === recordCount) field.required = true;

  const objects = values.filter(isObject);
  if (objects.length > 0) field.properties = inferFields(objects);
  const arrays = values.filter(Array.isArray);
  if (arrays.length > 0) {
    const items = arrays.flatMap((array) => Object.keys(array).map((key) => array[key]));
    if (items.length > 0) {
      field.items = inferField(items, items.length, items.length);
      delete field.items.required;
    }
  }
  return field;
}

function inferFields(records) {
  const names = [...new Set(records.flatMap((record) => Object.keys(record)))].sort();
  const fields = Object.create(null);
  for (const name of names) {
    const values = records.filter((record) => Object.prototype.hasOwnProperty.call(record, name)).map((record) => record[name]);
    fields[name] = inferField(values, values.length, records.length);
  }
  return fields;
}

function inferredEntityName(path, usedNames) {
  const base = path.join('_').replace(/[^A-Za-z0-9_]/g, '_') || 'root';
  let name = base;
  let suffix = 2;
  while (usedNames.has(name)) name = `${base}_${suffix++}`;
  usedNames.add(name);
  return name;
}

export function inferSchema(root) {
  const warnings = [];
  const entities = Object.create(null);
  const observations = Object.create(null);
  const usedNames = new Set();

  const scan = (value, path) => {
    if (!isObject(value)) return;
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
      if (path.length > 0) warnings.push({ code: 'EMPTY_OBJECT', path, message: `Cannot infer an entity from empty object ${path.join('.')}` });
      return;
    }
    const objectKeys = keys.filter((key) => isObject(value[key]));
    if (path.length > 0 && objectKeys.length === keys.length) {
      const name = inferredEntityName(path, usedNames);
      const records = keys.map((key) => value[key]);
      entities[name] = {
        path: [...path, ':id'],
        additionalFields: false,
        fields: inferFields(records),
      };
      observations[name] = { records: records.length, keys: new Set(keys), values: records };
      return;
    }
    if (path.length > 0 && objectKeys.length > 0 && objectKeys.length !== keys.length) {
      warnings.push({ code: 'HETEROGENEOUS_OBJECT', path, message: `Object ${path.join('.')} mixes records and scalar values` });
    }
    for (const key of objectKeys) scan(value[key], [...path, key]);
  };

  if (isObject(root)) {
    for (const key of Object.keys(root).sort()) scan(root[key], [key]);
  } else {
    warnings.push({ code: 'INVALID_ROOT', path: [], message: 'Cannot infer entities from a non-object root value' });
  }

  const relations = [];
  for (const sourceName of Object.keys(entities).sort()) {
    const source = entities[sourceName];
    for (const fieldName of Object.keys(source.fields).filter((name) => /(?:Id|_id)$/i.test(name)).sort()) {
      const values = observations[sourceName].values
        .filter((record) => Object.prototype.hasOwnProperty.call(record, fieldName) && record[fieldName] !== null)
        .map((record) => record[fieldName]);
      if (values.length === 0 || values.some((value) => !['string', 'number'].includes(typeof value))) continue;
      const targets = Object.keys(entities).filter((targetName) =>
        values.every((value) => observations[targetName].keys.has(String(value))));
      if (targets.length === 1) {
        relations.push({
          from: { entity: sourceName, field: fieldName },
          to: { entity: targets[0], parameter: entities[targets[0]].path.at(-1).slice(1) },
          candidate: true,
        });
      } else if (targets.length > 1) {
        warnings.push({
          code: 'AMBIGUOUS_RELATION',
          path: [...source.path.slice(0, -1), fieldName],
          message: `Field ${sourceName}.${fieldName} matches IDs in multiple entities`,
        });
      }
    }
  }

  return { schema: { entities }, observations, relations, warnings };
}

function flattenFields(fields, prefix = [], output = []) {
  for (const name of Object.keys(fields).sort()) {
    const field = fields[name];
    flattenField(field, [...prefix, name], output);
  }
  return output;
}

function flattenField(field, path, output) {
  output.push({
    path,
    type: Array.isArray(field.type) ? [...field.type] : [field.type],
    required: field.required === true,
    ...(field.ref ? { ref: field.ref } : {}),
  });
  if (field.properties) flattenFields(field.properties, path, output);
  if (field.items) flattenField(field.items, [...path, '[]'], output);
}

function hasFieldPath(value, path, index = 0) {
  if (index === path.length) return true;
  const segment = path[index];
  if (segment === '[]') {
    return Array.isArray(value) && value.some((item) => hasFieldPath(item, path, index + 1));
  }
  return value !== null
    && typeof value === 'object'
    && Object.prototype.hasOwnProperty.call(value, segment)
    && hasFieldPath(value[segment], path, index + 1);
}

function addFieldStatistics(fields, records) {
  return fields.map((field) => {
    const present = records.filter((record) => hasFieldPath(record, field.path)).length;
    return {
      ...field,
      present,
      coverage: records.length === 0 ? 0 : present / records.length,
    };
  });
}

export function describeDeclaredSchema(root, compiled) {
  const entities = [];
  const relations = [];
  for (const entity of Object.values(compiled.entities)) {
    const records = collectRecords(root, entity);
    const fields = addFieldStatistics(
      flattenFields(Object.fromEntries(Object.keys(entity.fields).map((name) => [name, publicField(entity.fields[name])]))),
      records.map((record) => record.value),
    );
    for (const field of fields) {
      if (field.ref) {
        relations.push({
          from: { entity: entity.name, field: field.path.join('.') },
          to: { entity: field.ref, parameter: compiled.entities[field.ref].idParameter },
          candidate: false,
        });
      }
    }
    entities.push({
      name: entity.name,
      path: [...entity.path],
      additionalFields: entity.additionalFields,
      records: records.length,
      fields,
    });
  }
  return {
    source: 'declared',
    schema: cloneData(compiled.publicSchema),
    entities,
    relations,
    warnings: [],
  };
}

export function describeInferredSchema(root) {
  const inferred = inferSchema(root);
  const entities = Object.keys(inferred.schema.entities).sort().map((name) => ({
    name,
    path: [...inferred.schema.entities[name].path],
    additionalFields: inferred.schema.entities[name].additionalFields,
    records: inferred.observations[name].records,
    fields: addFieldStatistics(flattenFields(inferred.schema.entities[name].fields), inferred.observations[name].values),
  }));
  return {
    source: 'inferred',
    schema: cloneData(inferred.schema),
    entities,
    relations: inferred.relations,
    warnings: inferred.warnings,
  };
}

function mermaidName(name, used) {
  let base = name.replace(/[^A-Za-z0-9_]/g, '_') || 'ENTITY';
  if (!/^[A-Za-z_]/.test(base)) base = `ENTITY_${base}`;
  let result = base;
  let suffix = 2;
  while (used.has(result)) result = `${base}_${suffix++}`;
  used.add(result);
  return result;
}

function mermaidToken(value) {
  let token = String(value).replace(/[^A-Za-z0-9_]/g, '_') || 'field';
  if (!/^[A-Za-z_]/.test(token)) token = `field_${token}`;
  return token;
}

function uniqueMermaidToken(value, used) {
  const base = mermaidToken(value);
  let token = base;
  let suffix = 2;
  while (used.has(token)) token = `${base}_${suffix++}`;
  used.add(token);
  return token;
}

export function schemaToMermaid(description) {
  const used = new Set();
  const names = new Map(description.entities.map((entity) => [entity.name, mermaidName(entity.name, used)]));
  const lines = ['erDiagram'];
  for (const entity of description.entities) {
    lines.push(`  ${names.get(entity.name)} {`);
    const usedFields = new Set();
    const idName = entity.path.at(-1)?.startsWith(':') ? entity.path.at(-1).slice(1) : 'id';
    lines.push(`    string ${uniqueMermaidToken(idName, usedFields)} PK`);
    for (const field of entity.fields) {
      const type = mermaidToken(field.type.join('_or_'));
      const name = uniqueMermaidToken(field.path.join('_'), usedFields);
      const markers = [field.required ? 'required' : 'optional', field.ref ? 'FK' : null].filter(Boolean).join(' ');
      lines.push(`    ${type} ${name} "${markers}"`);
    }
    lines.push('  }');
  }
  for (const relation of description.relations) {
    const target = names.get(relation.to.entity);
    const source = names.get(relation.from.entity);
    if (!target || !source) continue;
    const label = mermaidToken(`${relation.from.field}${relation.candidate ? '_candidate' : ''}`);
    lines.push(`  ${target} ||--o{ ${source} : ${label}`);
  }
  return lines.join('\n');
}
