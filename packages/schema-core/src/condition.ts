import type { Condition, JsonPrimitive } from './types.ts';

export interface ConditionContext {
  /** The object that owns the field being evaluated; `"type"` resolves here. */
  scope: unknown;
  /** The module root; `"$.foo"` resolves here. */
  root: unknown;
}

/** Guard against a bundle nesting conditions deeply enough to blow the stack. */
const MAX_CONDITION_DEPTH = 16;

export class ConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConditionError';
  }
}

/**
 * Evaluate a declarative condition. Every operator is a fixed, total function
 * over plain data — there is no expression parsing, no `eval`, and no regular
 * expression execution, so a hostile bundle cannot spend unbounded time here
 * (NFR-SEC-05, FR-SCHEMA-03).
 */
export function evaluateCondition(
  condition: Condition,
  context: ConditionContext,
  depth = 0,
): boolean {
  if (depth > MAX_CONDITION_DEPTH) {
    throw new ConditionError(`Condition nesting exceeds ${MAX_CONDITION_DEPTH} levels.`);
  }

  switch (condition.op) {
    case 'and':
      return condition.of.every((child) => evaluateCondition(child, context, depth + 1));
    case 'or':
      return condition.of.some((child) => evaluateCondition(child, context, depth + 1));
    case 'not':
      return !evaluateCondition(condition.of, context, depth + 1);

    case 'exists':
      return resolve(condition.path, context) !== undefined;
    case 'empty':
      return isEmpty(resolve(condition.path, context));

    case 'eq':
      return looseEqual(resolve(condition.path, context), condition.value);
    case 'ne':
      return !looseEqual(resolve(condition.path, context), condition.value);

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return compareNumeric(condition.op, resolve(condition.path, context), condition.value);

    case 'in':
      return condition.values.some((candidate) =>
        looseEqual(resolve(condition.path, context), candidate),
      );
    case 'notIn':
      return !condition.values.some((candidate) =>
        looseEqual(resolve(condition.path, context), candidate),
      );

    case 'startsWith':
    case 'endsWith':
    case 'contains':
      return compareString(condition.op, resolve(condition.path, context), condition.value);

    case 'length':
      return compareLength(resolve(condition.path, context), condition.gte, condition.lte);

    default: {
      const exhaustive: never = condition;
      throw new ConditionError(
        `Unsupported condition operator: ${String((exhaustive as { op?: unknown }).op)}`,
      );
    }
  }
}

/** Resolve a dotted path. `$.` addresses the module root, otherwise the scope. */
export function resolve(path: string, context: ConditionContext): unknown {
  const fromRoot = path.startsWith('$.');
  const segments = (fromRoot ? path.slice(2) : path).split('.').filter((s) => s !== '');
  let current: unknown = fromRoot ? context.root : context.scope;

  for (const segment of segments) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    // Reject prototype walking: a bundle must not reach Object.prototype.
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function looseEqual(actual: unknown, expected: JsonPrimitive): boolean {
  if (actual === expected) return true;
  // YAML round-trips `port: "443"` and `port: 443` differently; comparing the
  // string forms keeps conditions authored against the documented value working.
  if (
    (typeof actual === 'string' || typeof actual === 'number' || typeof actual === 'boolean') &&
    expected !== null
  ) {
    return String(actual) === String(expected);
  }
  return false;
}

function compareNumeric(
  op: 'gt' | 'gte' | 'lt' | 'lte',
  actual: unknown,
  expected: JsonPrimitive,
): boolean {
  const left = toNumber(actual);
  const right = toNumber(expected);
  if (left === null || right === null) return false;
  switch (op) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function compareString(
  op: 'startsWith' | 'endsWith' | 'contains',
  actual: unknown,
  expected: string,
): boolean {
  if (typeof actual !== 'string') return false;
  switch (op) {
    case 'startsWith':
      return actual.startsWith(expected);
    case 'endsWith':
      return actual.endsWith(expected);
    case 'contains':
      return actual.includes(expected);
  }
}

function compareLength(actual: unknown, gte?: number, lte?: number): boolean {
  let length: number;
  if (typeof actual === 'string' || Array.isArray(actual)) {
    length = actual.length;
  } else if (actual != null && typeof actual === 'object') {
    length = Object.keys(actual as object).length;
  } else {
    return false;
  }
  if (gte !== undefined && length < gte) return false;
  if (lte !== undefined && length > lte) return false;
  return true;
}
