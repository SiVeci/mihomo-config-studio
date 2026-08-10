import { formatPath, type ConfigPath } from '@mcs/yaml-engine';

import { checkFormat } from './formats.js';
import { resolveRef } from './ref.js';
import type { JsonSchema, JsonSchemaType } from './types.js';

export interface SchemaIssue {
  severity: 'error';
  /** Stable machine code, e.g. `schema.type`. */
  code: string;
  keyword: string;
  path: ConfigPath;
  /** Never contains a configuration value (NFR-SEC-03). */
  message: string;
}

export interface ValidateOptions {
  /** Root schema used to resolve `#/$defs/...`. Defaults to the schema itself. */
  rootSchema?: JsonSchema;
  /** Prefix applied to reported paths so they address the whole document. */
  basePath?: ConfigPath;
  /** Stop after this many issues to bound work on pathological input. */
  maxIssues?: number;
  maxDepth?: number;
}

const DEFAULTS = { maxIssues: 500, maxDepth: 32 };
/** Patterns are only executed against bounded input. */
const MAX_PATTERN_INPUT = 4096;

const patternCache = new Map<string, RegExp | null>();

/**
 * Interpret a JSON Schema against a value.
 *
 * This is a hand-written interpreter rather than a compiling validator such as
 * Ajv. Compiling validators build their checker with `new Function`, which
 * (a) requires `unsafe-eval` and breaks the strict CSP required by NFR-SEC-07,
 * and (b) would mean a downloaded bundle's data is turned into executable code,
 * which is exactly what FR-UPD-07 forbids. See ADR-008.
 */
export function validateValue(
  value: unknown,
  schema: JsonSchema,
  options: ValidateOptions = {},
): SchemaIssue[] {
  const state = {
    root: options.rootSchema ?? schema,
    issues: [] as SchemaIssue[],
    maxIssues: options.maxIssues ?? DEFAULTS.maxIssues,
    maxDepth: options.maxDepth ?? DEFAULTS.maxDepth,
  };
  walk(value, schema, options.basePath ?? [], state, 0);
  return state.issues;
}

interface State {
  root: JsonSchema;
  issues: SchemaIssue[];
  maxIssues: number;
  maxDepth: number;
}

function walk(
  value: unknown,
  rawSchema: JsonSchema,
  path: ConfigPath,
  state: State,
  depth: number,
) {
  if (state.issues.length >= state.maxIssues) return;
  if (depth > state.maxDepth) {
    push(state, path, 'schema.depth', '$depth', `Validation depth limit reached.`);
    return;
  }

  let schema: JsonSchema;
  try {
    schema = resolveRef(rawSchema, state.root);
  } catch (error) {
    push(state, path, 'schema.ref', '$ref', (error as Error).message);
    return;
  }

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    push(
      state,
      path,
      'schema.type',
      'type',
      `Expected ${asList(schema.type)} at ${formatPath(path)}, found ${describeType(value)}.`,
    );
    return; // Further keywords would only produce noise.
  }

  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    push(
      state,
      path,
      'schema.const',
      'const',
      `${formatPath(path)} must be ${json(schema.const)}.`,
    );
  }

  if (schema.enum !== undefined && !schema.enum.some((option) => deepEqual(value, option))) {
    push(
      state,
      path,
      'schema.enum',
      'enum',
      `${formatPath(path)} must be one of: ${schema.enum.map(json).join(', ')}.`,
    );
  }

  if (typeof value === 'string') validateString(value, schema, path, state);
  if (typeof value === 'number') validateNumber(value, schema, path, state);
  if (Array.isArray(value)) validateArray(value, schema, path, state, depth);
  if (isRecord(value)) validateObject(value, schema, path, state, depth);

  validateCombinators(value, schema, path, state, depth);
}

function validateString(value: string, schema: JsonSchema, path: ConfigPath, state: State) {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    push(
      state,
      path,
      'schema.minLength',
      'minLength',
      `${formatPath(path)} must be at least ${schema.minLength} characters.`,
    );
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    push(
      state,
      path,
      'schema.maxLength',
      'maxLength',
      `${formatPath(path)} must be at most ${schema.maxLength} characters.`,
    );
  }
  if (schema.pattern !== undefined) {
    const regex = compilePattern(schema.pattern);
    if (regex === null) {
      push(
        state,
        path,
        'schema.pattern.invalid',
        'pattern',
        `${formatPath(path)} has an unusable pattern in its schema.`,
      );
    } else if (value.length > MAX_PATTERN_INPUT) {
      push(
        state,
        path,
        'schema.pattern.tooLong',
        'pattern',
        `${formatPath(path)} is too long to be pattern-checked (limit ${MAX_PATTERN_INPUT}).`,
      );
    } else if (!regex.test(value)) {
      push(
        state,
        path,
        'schema.pattern',
        'pattern',
        `${formatPath(path)} does not match the required pattern.`,
      );
    }
  }
  if (schema.format !== undefined && !checkFormat(schema.format, value)) {
    push(
      state,
      path,
      'schema.format',
      'format',
      `${formatPath(path)} is not a valid ${schema.format}.`,
    );
  }
}

function validateNumber(value: number, schema: JsonSchema, path: ConfigPath, state: State) {
  const checks: Array<[number | undefined, (n: number, b: number) => boolean, string, string]> = [
    [schema.minimum, (n, b) => n >= b, 'minimum', 'at least'],
    [schema.maximum, (n, b) => n <= b, 'maximum', 'at most'],
    [schema.exclusiveMinimum, (n, b) => n > b, 'exclusiveMinimum', 'greater than'],
    [schema.exclusiveMaximum, (n, b) => n < b, 'exclusiveMaximum', 'less than'],
  ];
  for (const [bound, ok, keyword, phrase] of checks) {
    if (bound !== undefined && !ok(value, bound)) {
      push(
        state,
        path,
        `schema.${keyword}`,
        keyword,
        `${formatPath(path)} must be ${phrase} ${bound}.`,
      );
    }
  }
  if (schema.multipleOf !== undefined && schema.multipleOf > 0) {
    const quotient = value / schema.multipleOf;
    if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * 8) {
      push(
        state,
        path,
        'schema.multipleOf',
        'multipleOf',
        `${formatPath(path)} must be a multiple of ${schema.multipleOf}.`,
      );
    }
  }
}

function validateArray(
  value: unknown[],
  schema: JsonSchema,
  path: ConfigPath,
  state: State,
  depth: number,
) {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    push(
      state,
      path,
      'schema.minItems',
      'minItems',
      `${formatPath(path)} must have at least ${schema.minItems} items.`,
    );
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    push(
      state,
      path,
      'schema.maxItems',
      'maxItems',
      `${formatPath(path)} must have at most ${schema.maxItems} items.`,
    );
  }
  if (schema.uniqueItems === true) {
    const seen = new Set<string>();
    for (let i = 0; i < value.length; i += 1) {
      const key = json(value[i]);
      if (seen.has(key)) {
        push(
          state,
          [...path, i],
          'schema.uniqueItems',
          'uniqueItems',
          `${formatPath([...path, i])} duplicates an earlier item.`,
        );
        break;
      }
      seen.add(key);
    }
  }

  const prefix = schema.prefixItems ?? [];
  for (let i = 0; i < value.length; i += 1) {
    const itemSchema = i < prefix.length ? prefix[i] : schema.items;
    if (itemSchema) walk(value[i], itemSchema, [...path, i], state, depth + 1);
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: JsonSchema,
  path: ConfigPath,
  state: State,
  depth: number,
) {
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) {
      push(
        state,
        [...path, key],
        'schema.required',
        'required',
        `${formatPath(path)} is missing required field "${key}".`,
      );
    }
  }

  const properties = schema.properties ?? {};
  for (const [key, entry] of Object.entries(value)) {
    const propertySchema = properties[key];
    if (propertySchema) {
      walk(entry, propertySchema, [...path, key], state, depth + 1);
      continue;
    }
    if (schema.propertyNames) {
      walk(key, schema.propertyNames, [...path, key], state, depth + 1);
    }
    if (schema.additionalProperties === false) {
      // Deliberately not fatal for the document as a whole: unknown fields are
      // preserved and surfaced, not used to reject the project (PRD §9.5.4).
      push(
        state,
        [...path, key],
        'schema.additionalProperties',
        'additionalProperties',
        `${formatPath(path)} does not define a field named "${key}".`,
      );
    } else if (typeof schema.additionalProperties === 'object') {
      walk(entry, schema.additionalProperties, [...path, key], state, depth + 1);
    }
  }
}

function validateCombinators(
  value: unknown,
  schema: JsonSchema,
  path: ConfigPath,
  state: State,
  depth: number,
) {
  for (const branch of schema.allOf ?? []) {
    walk(value, branch, path, state, depth + 1);
  }

  if (schema.anyOf) {
    const passes = schema.anyOf.some((branch) => subValidate(value, branch, path, state, depth));
    if (!passes) {
      push(
        state,
        path,
        'schema.anyOf',
        'anyOf',
        `${formatPath(path)} does not match any allowed shape.`,
      );
    }
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) =>
      subValidate(value, branch, path, state, depth),
    ).length;
    if (matches !== 1) {
      push(
        state,
        path,
        'schema.oneOf',
        'oneOf',
        matches === 0
          ? `${formatPath(path)} does not match any allowed shape.`
          : `${formatPath(path)} matches ${matches} shapes but must match exactly one.`,
      );
    }
  }

  if (schema.not && subValidate(value, schema.not, path, state, depth)) {
    push(state, path, 'schema.not', 'not', `${formatPath(path)} matches a disallowed shape.`);
  }
}

/** Run a branch in isolation: combinator branches must not leak their issues. */
function subValidate(
  value: unknown,
  schema: JsonSchema,
  path: ConfigPath,
  state: State,
  depth: number,
): boolean {
  const isolated: State = { ...state, issues: [] };
  walk(value, schema, path, isolated, depth + 1);
  return isolated.issues.length === 0;
}

function push(state: State, path: ConfigPath, code: string, keyword: string, message: string) {
  if (state.issues.length >= state.maxIssues) return;
  state.issues.push({ severity: 'error', code, keyword, path, message });
}

function compilePattern(pattern: string): RegExp | null {
  if (patternCache.has(pattern)) return patternCache.get(pattern) ?? null;
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(pattern, 'u');
  } catch {
    try {
      compiled = new RegExp(pattern);
    } catch {
      compiled = null;
    }
  }
  patternCache.set(pattern, compiled);
  return compiled;
}

function matchesType(value: unknown, type: JsonSchemaType | JsonSchemaType[]): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((candidate) => {
    switch (candidate) {
      case 'null':
        return value === null;
      case 'boolean':
        return typeof value === 'boolean';
      case 'string':
        return typeof value === 'string';
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value);
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'array':
        return Array.isArray(value);
      case 'object':
        return isRecord(value);
      default:
        return false;
    }
  });
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function asList(type: JsonSchemaType | JsonSchemaType[]): string {
  return Array.isArray(type) ? type.join(' | ') : type;
}

function json(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return keysA.length === keysB.length && keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
