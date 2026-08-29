import type { ConfigPath, IssueSeverity, MessageParams } from '@mcs/yaml-engine';

import { ConditionError, evaluateCondition, type ConditionContext } from './condition.ts';
import type { RuleFix, ValidationRule } from './types.ts';

/**
 * A problem produced by evaluating `ValidationRule[]` against a module's own
 * value. Not `@mcs/validator`'s `ValidationIssue` — this package cannot
 * depend on that one (validator depends on schema-core, not the reverse) —
 * but it is the same shape `SchemaIssue` already uses, for the same reason:
 * a future adapter (v0.3.0 #12) widens it the way `fromSchemaIssue` does.
 */
export interface RuleIssue {
  severity: IssueSeverity;
  code: string;
  ruleId: string;
  /** Relative to the module root, or absolute when `basePath` was supplied (`evaluateRules`'s options). */
  path: ConfigPath;
  /** i18n lookup key; the rendered text lives in resource files (NFR-SEC-03). */
  messageKey: string;
  messageParams?: MessageParams;
  /** Passed through from the rule unresolved — `fix.path` is still the rule's own relative addressing. */
  fix?: RuleFix;
}

export interface RuleEvaluationOptions {
  /** Prefixed onto every reported issue's path — typically the module's `manifest.root`. */
  basePath?: ConfigPath;
  /**
   * Upper bound on how many elements a single wildcard rule iterates.
   * Without a cap, a 1&nbsp;MB config with a long array and N wildcard rules
   * is a combinatorial blowup vector, not just a slow path.
   */
  maxWildcardMatches?: number;
}

const DEFAULT_MAX_WILDCARD_MATCHES = 500;
const WILDCARD = '*';

/**
 * Evaluate a module's declared `validation.rules` against its own value
 * (the subtree `manifest.root` addresses, e.g. `document.dns`).
 *
 * `when` states the invariant that must hold — a rule fires, producing an
 * issue, exactly when `evaluateCondition(rule.when, ...)` is **false**.
 * Mutual exclusion between `a` and `b` is therefore written as the positive
 * statement "not both are present" (`{ op: 'not', of: { op: 'and', of: [
 * {op:'exists',path:'a'}, {op:'exists',path:'b'}] } }`), which only reads as
 * `false` once the exclusion is actually violated; "a depends on b" is the
 * material implication `a → b` (`{ op: 'or', of: [{op:'not',of:{op:'exists',
 * path:'a'}}, {op:'exists',path:'b'}] }`). No new operator is introduced —
 * both are `condition.ts`'s existing closed set, composed (ADR-002).
 *
 * Cross-object rules (e.g. one condition per `proxies[]` entry) use a single
 * `*` path segment on the rule's own `path` — not inside `when`'s condition
 * paths, which stay relative to whatever element the wildcard selects. `*`
 * is resolved once per array element up to `maxWildcardMatches`, with
 * `when` evaluated against that element as `scope` (and the whole module as
 * `root`, so `$.`-prefixed cross-references still reach outside the array).
 */
export function evaluateRules(
  rules: readonly ValidationRule[],
  moduleValue: unknown,
  options: RuleEvaluationOptions = {},
): RuleIssue[] {
  const basePath = options.basePath ?? [];
  const maxMatches = options.maxWildcardMatches ?? DEFAULT_MAX_WILDCARD_MATCHES;
  const issues: RuleIssue[] = [];

  for (const rule of rules) {
    const segments = rule.path !== undefined ? splitPath(rule.path) : [];
    const wildcardIndex = segments.indexOf(WILDCARD);

    if (wildcardIndex === -1) {
      evaluateOne(
        rule,
        { scope: moduleValue, root: moduleValue },
        [...basePath, ...segments],
        issues,
      );
      continue;
    }

    const collectionSegments = segments.slice(0, wildcardIndex);
    const suffixSegments = segments.slice(wildcardIndex + 1);
    const { value: collection, path: collectionPath } = walkSegments(
      moduleValue,
      collectionSegments,
    );
    if (!Array.isArray(collection)) continue; // Nothing to iterate; a shape mismatch is the schema stage's problem, not this evaluator's.

    const limit = Math.min(collection.length, maxMatches);
    for (let index = 0; index < limit; index += 1) {
      const element = collection[index];
      const context: ConditionContext = { scope: element, root: moduleValue };
      const { path: suffixPath } = walkSegments(element, suffixSegments);
      const path = [...basePath, ...collectionPath, index, ...suffixPath];
      evaluateOne(rule, context, path, issues);
    }
  }

  return issues;
}

function evaluateOne(
  rule: ValidationRule,
  context: ConditionContext,
  path: ConfigPath,
  issues: RuleIssue[],
): void {
  let valid: boolean;
  try {
    valid = evaluateCondition(rule.when, context);
  } catch (error) {
    if (error instanceof ConditionError) return; // A pathological rule must not crash the pipeline; it just never fires.
    throw error;
  }
  if (valid) return;

  issues.push({
    severity: rule.severity,
    code: `rule.${rule.id}`,
    ruleId: rule.id,
    path,
    messageKey: rule.messageKey,
    ...(rule.messageParams !== undefined ? { messageParams: rule.messageParams } : {}),
    ...(rule.fix !== undefined ? { fix: rule.fix } : {}),
  });
}

function splitPath(path: string): string[] {
  return path.split('.').filter((segment) => segment !== '');
}

interface SegmentWalk {
  value: unknown;
  path: ConfigPath;
}

/**
 * Walk a plain (non-`$.`, no-wildcard) segment list against a value.
 *
 * A segment becomes a numeric array index in the returned `path` exactly
 * when the value at that point actually is an array — mirroring
 * `condition.ts`'s `resolve()` — so a reported path uses the same
 * number/string convention as the rest of `ConfigPath` usage in this
 * codebase (`['proxies', 0, 'password']`, not `['proxies', '0', 'password']`,
 * which would silently fail to round-trip through the YAML engine's patch
 * application).
 */
function walkSegments(value: unknown, segments: readonly string[]): SegmentWalk {
  let current = value;
  const path: Array<string | number> = [];

  for (const segment of segments) {
    // Same prototype-pollution guard as condition.ts's resolve(): a bundle
    // must not reach Object.prototype. Once resolution can't continue
    // (this guard, or a non-object value), keep walking with `undefined` so
    // the returned path still has one entry per requested segment.
    const blocked =
      current == null ||
      typeof current !== 'object' ||
      segment === '__proto__' ||
      segment === 'constructor' ||
      segment === 'prototype';
    if (blocked) {
      path.push(segment);
      current = undefined;
      continue;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      path.push(index);
      current = current[index];
    } else {
      path.push(segment);
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return { value: current, path };
}
