// Dependency-free checker for the curated JSON Schema subset used by
// src/contracts/schemas/*.schema.json (RFC-0001, docs/rfcs/0001-contract-schemas.md).
//
// Enforced keyword whitelist. Any other key in a schema node is an error, not an
// annotation, so a typo such as `minlength` fails loudly instead of validating nothing:
//   type                  "object" | "array" | "string" | "number" | "integer" |
//                         "boolean" | "null", or an array of those names, which is how
//                         nullable fields are expressed (e.g. ["string", "null"])
//   properties            per-key subschemas
//   required              property names that must be present
//   additionalProperties  only `false` is accepted: unknown keys are rejected
//   enum                  primitive values compared with Object.is
//   pattern               ECMAScript source, unanchored search like JSON Schema; the
//                         shipped patterns spell out ^...$ when they must be anchored
//   minLength/maxLength   string length in UTF-16 code units (JavaScript .length)
//   minItems/maxItems     array length
//   items                 one subschema applied to every array element
//   description           annotation, ignored
//   meta                  project annotation block ({ title, source }), ignored
//   $comment              annotation, ignored (JSON/YAML schema files use it for
//                         provenance notes that tools may strip)
//   $schema               dialect declaration, ignored; accepted so the files remain
//                         valid JSON Schema documents and editors can offer intellisense
//
// Deliberately NOT implemented: oneOf/anyOf/allOf, if/then/else, $ref/definitions,
// const, minimum/maximum/exclusiveMinimum, format, patternProperties, dependencies.
// RFC-0002 reviewed combinators and declined them in favour of a status-keyed dispatch
// table; numeric bounds stay imperative in the runtime.
//
// API:
//   assertSchema(schema)      full recursive schema walk; throws TypeError on an
//                             unknown keyword, a missing/malformed type, or a malformed
//                             keyword value. validate() and exportEnum() both run it
//                             first (fail-closed; schema nodes are small, so the cost
//                             of walking them again on each call is negligible).
//   validate(schema, value)   { ok: true } or { ok: false, errors: [{ path, message }] }
//   exportEnum(schemaNode)    frozen copy of a node's enum
//
// Conventions:
//   * paths are relative and dot/bracket joined: `objective`, `acceptanceCriteria[2]`.
//     The root path is the empty string.
//   * errors are collected depth first: declaration order for required and property
//     checks, instance order for unknown keys. Output is deterministic, so validating
//     the same input twice yields deep-equal errors.
//   * messages never echo instance strings. Only schema-side values (enum entries,
//     patterns), type names and short property-key previews appear; instance previews
//     are cut to 32 characters and objects/arrays are named by type, never serialized.
//   * a malformed schema node throws TypeError instead of being skipped or treated as
//     permissive.

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
const KEYWORDS = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'enum', 'pattern',
  'minLength', 'maxLength', 'minItems', 'maxItems', 'items', 'description', 'meta',
  '$comment', '$schema',
]);
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

function declaredTypes(schema, path) {
  if (schema.type === undefined) throw schemaError(path, 'type is required');
  const declared = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (declared.length === 0) throw schemaError(path, 'type array is empty');
  for (const entry of declared) {
    if (typeof entry !== 'string' || !TYPE_NAMES.includes(entry)) {
      throw schemaError(path, `unknown type ${preview(entry)}`);
    }
  }
  return declared;
}

// Strict schema walk. Anything the checker cannot enforce is rejected here so a
// misspelled or unsupported keyword can never fail open.
function walkSchema(schema, path) {
  if (!isObject(schema)) throw schemaError(path, 'schema must be an object');

  for (const keyword of Object.keys(schema)) {
    if (!KEYWORDS.has(keyword)) throw schemaError(path, `unknown keyword ${preview(keyword)}`);
  }

  declaredTypes(schema, path);

  for (const annotation of ['description', '$comment', '$schema']) {
    if (schema[annotation] !== undefined && typeof schema[annotation] !== 'string') {
      throw schemaError(path, `${annotation} must be a string`);
    }
  }
  if (schema.meta !== undefined && !isObject(schema.meta)) {
    throw schemaError(path, 'meta must be an object');
  }
  if (schema.properties !== undefined) {
    if (!isObject(schema.properties)) throw schemaError(path, 'properties must be an object');
    for (const key of Object.keys(schema.properties)) {
      walkSchema(schema.properties[key], joinPath(path, key));
    }
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some(entry => typeof entry !== 'string')) {
      throw schemaError(path, 'required must be an array of strings');
    }
  }
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
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
  if (schema.items !== undefined) walkSchema(schema.items, joinPath(path, 'items'));
}

export function assertSchema(schema) {
  walkSchema(schema, '');
}

function walk(schema, value, path, errors) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.some(name => TYPE_CHECKS[name](value))) {
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
          // Unknown keys are untrusted input and may contain credentials or control
          // characters. Never copy them into diagnostics; a fixed segment still marks
          // where the extra property appeared without exposing its name.
          errors.push({ path: joinPath(path, '<unknown>'), message: 'unknown property' });
        }
      }
    }
    for (const key of Object.keys(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        walk(properties[key], value[key], joinPath(path, key), errors);
      }
    }
  }
}

export function validate(schema, value) {
  assertSchema(schema);
  const errors = [];
  walk(schema, value, '', errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// Schema enum used as the runtime's literal source (drift guard and, later, constant
// derivation). The node passed here must be a schema node that declares `enum`; this
// keeps the caller explicit instead of guessing which nested enum is meant.
export function exportEnum(schema) {
  assertSchema(schema);
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
    throw new TypeError('schema node must declare a non-empty enum array');
  }
  return Object.freeze([...schema.enum]);
}
