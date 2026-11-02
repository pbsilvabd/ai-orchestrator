// Dependency-free checker for the curated JSON Schema subset used by
// src/contracts/schemas/*.schema.json (RFC-0001, docs/rfcs/0001-contract-schemas.md).
//
// Supported keywords. This list is the whole enforced surface; every other keyword is
// an annotation and is ignored, never enforced:
//   type                  "object" | "array" | "string" | "number" | "integer" |
//                         "boolean" | "null", or an array of those names, which is how
//                         nullable fields are expressed (e.g. ["string", "null"])
//   properties            per-key subschemas
//   required              property names that must be present
//   additionalProperties  only `false` is enforced: unknown keys are rejected
//   enum                  primitive values compared with Object.is
//   pattern               ECMAScript regular expression source for strings
//   minLength/maxLength   string length in UTF-16 code units (JavaScript .length)
//   minItems/maxItems     array length
//   items                 one subschema applied to every array element
//   description           annotation, ignored
//
// Deliberately NOT implemented: oneOf/anyOf/allOf, if/then/else, $ref/definitions,
// const, minimum/maximum/exclusiveMinimum, format, patternProperties, dependencies.
// Combinators and conditional schemas belong to RFC-0002; numeric bounds stay
// imperative in the runtime until a later RFC widens the subset.
//
// Conventions:
//   * paths are relative and dot/bracket joined: `objective`, `acceptanceCriteria[2]`.
//     The root path is the empty string.
//   * `meta` is an annotations-only block at the schema root ({ title, source }) that
//     records where a schema was derived from. It is ignored here because the checker
//     only reads the keywords listed above.
//   * a malformed schema node reached by the checker throws TypeError instead of being
//     silently skipped or treated as permissive.
//   * errors never echo full instance values. String previews are truncated to 32
//     characters and objects are described by type, never serialized.
//   * errors are collected depth first in declaration order and are deterministic:
//     validating the same input twice yields deep-equal errors.

const PREVIEW_LIMIT = 32;

const TYPE_CHECKS = {
  object: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: value => Array.isArray(value),
  string: value => typeof value === 'string',
  number: value => typeof value === 'number' && Number.isFinite(value),
  integer: Number.isInteger,
  boolean: value => typeof value === 'boolean',
  null: value => value === null,
};

const TYPE_NAMES = Object.keys(TYPE_CHECKS);
const isObject = TYPE_CHECKS.object;

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function preview(value) {
  if (typeof value === 'string') {
    const flat = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
    const shown = flat.length > PREVIEW_LIMIT ? `${flat.slice(0, PREVIEW_LIMIT)}…` : flat;
    return `"${shown}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  return 'object';
}

// Path segments that come from instance data must be bounded: an unknown key can be
// long or credential-shaped, so the path keeps at most PREVIEW_LIMIT characters.
function safeKey(key) {
  return key.length > PREVIEW_LIMIT ? `${key.slice(0, PREVIEW_LIMIT)}…` : key;
}

function joinPath(base, key) {
  return base ? `${base}.${key}` : key;
}

function indexPath(base, index) {
  return `${base}[${index}]`;
}

const plural = (word, count) => (count === 1 ? word : `${word}s`);

function schemaError(path, detail) {
  return new TypeError(`invalid contract schema at ${path || '<root>'}: ${detail}`);
}

function normalizeType(schema, path) {
  if (schema.type === undefined) return null;
  const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (declared.length === 0) throw schemaError(path, 'type array is empty');
  for (const entry of declared) {
    if (typeof entry !== 'string' || !TYPE_NAMES.includes(entry)) {
      throw schemaError(path, `unknown type ${preview(entry)}`);
    }
  }
  return declared;
}

function validateKeywordShapes(schema, path) {
  normalizeType(schema, path);
  if (schema.properties !== undefined) {
    if (!isObject(schema.properties)) throw schemaError(path, 'properties must be an object');
    for (const key of Object.keys(schema.properties)) {
      const child = schema.properties[key];
      if (!isObject(child)) throw schemaError(joinPath(path, key), 'subschema must be an object');
    }
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some(entry => typeof entry !== 'string')) {
      throw schemaError(path, 'required must be an array of strings');
    }
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    throw schemaError(path, 'only additionalProperties: false is supported');
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      throw schemaError(path, 'enum must be a non-empty array');
    }
    for (const entry of schema.enum) {
      const primitive = entry === null || ['string', 'number', 'boolean'].includes(typeof entry);
      if (!primitive) throw schemaError(path, 'enum entries must be primitives');
    }
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') throw schemaError(path, 'pattern must be a string');
    try {
      new RegExp(schema.pattern);
    } catch {
      throw schemaError(path, 'pattern is not a valid regular expression');
    }
  }
  for (const keyword of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
    const bound = schema[keyword];
    if (bound !== undefined && (!Number.isInteger(bound) || bound < 0)) {
      throw schemaError(path, `${keyword} must be a non-negative integer`);
    }
  }
  if (schema.items !== undefined && !isObject(schema.items)) {
    throw schemaError(path, 'items must be a single subschema object');
  }
}

function walk(schema, value, path, errors) {
  if (!isObject(schema)) throw schemaError(path, 'schema must be an object');
  validateKeywordShapes(schema, path);

  const types = normalizeType(schema, path);
  if (types && !types.some(name => TYPE_CHECKS[name](value))) {
    // A wrong type makes deeper keyword checks noise, so stop at this node.
    errors.push({ path, message: `expected ${types.join(' or ')}, received ${typeName(value)}` });
    return;
  }

  if (schema.enum !== undefined && !schema.enum.some(entry => Object.is(entry, value))) {
    errors.push({ path, message: `expected one of ${schema.enum.map(preview).join(', ')}` });
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, message: `must be at least ${schema.minLength} ${plural('character', schema.minLength)}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, message: `must be at most ${schema.maxLength} ${plural('character', schema.maxLength)}` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `must match /${schema.pattern}/` });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path, message: `must contain at least ${schema.minItems} ${plural('item', schema.minItems)}` });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({ path, message: `must contain at most ${schema.maxItems} ${plural('item', schema.maxItems)}` });
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => walk(schema.items, item, indexPath(path, index), errors));
    }
  }

  if (isObject(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push({ path: joinPath(path, key), message: 'required property is missing' });
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push({ path: joinPath(path, safeKey(key)), message: 'unknown property' });
        }
      }
    }
    for (const key of Object.keys(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        walk(properties[key], value[key], joinPath(path, safeKey(key)), errors);
      }
    }
  }
}

export function validate(schema, value) {
  if (!isObject(schema)) throw schemaError('', 'schema must be an object');
  // Validate keyword shapes once up front so a malformed schema fails even when the
  // instance type would never reach the affected keyword.
  validateKeywordShapes(schema, '');
  const errors = [];
  walk(schema, value, '', errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// Schema enum used as the runtime's literal source (drift guard and, later, constant
// derivation). The node passed here must declare `enum`; this keeps the caller
// explicit instead of guessing which nested enum is meant.
export function exportEnum(schema) {
  if (!isObject(schema) || !Array.isArray(schema.enum) || schema.enum.length === 0) {
    throw new TypeError('schema node must declare a non-empty enum array');
  }
  return Object.freeze([...schema.enum]);
}
