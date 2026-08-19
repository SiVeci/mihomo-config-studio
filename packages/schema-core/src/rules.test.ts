import { describe, expect, it } from 'vitest';

import { evaluateRules } from './rules.js';
import type { ValidationRule } from './types.js';

describe('mutual exclusion (FR-SCHEMA-03)', () => {
  // The plan's own worked example: `when` states the invariant ("not both
  // present"); the rule fires exactly when that invariant is violated.
  const mutex: ValidationRule = {
    id: 'mutex-a-b',
    severity: 'error',
    when: {
      op: 'not',
      of: {
        op: 'and',
        of: [
          { op: 'exists', path: 'a' },
          { op: 'exists', path: 'b' },
        ],
      },
    },
    messageKey: 'rule.mutexAB',
  };

  it('fires when both mutually-exclusive fields are present', () => {
    const issues = evaluateRules([mutex], { a: 1, b: 2 });
    expect(issues).toEqual([
      expect.objectContaining({ severity: 'error', code: 'rule.mutex-a-b', ruleId: 'mutex-a-b' }),
    ]);
  });

  it('does not fire when only one is present', () => {
    expect(evaluateRules([mutex], { a: 1 })).toEqual([]);
    expect(evaluateRules([mutex], { b: 1 })).toEqual([]);
  });

  it('does not fire when neither is present', () => {
    expect(evaluateRules([mutex], {})).toEqual([]);
  });
});

describe('dependency (FR-SCHEMA-03)', () => {
  // "a depends on b": material implication a -> b, i.e. `not(a) or b`.
  const dependency: ValidationRule = {
    id: 'a-requires-b',
    severity: 'warning',
    when: {
      op: 'or',
      of: [
        { op: 'not', of: { op: 'exists', path: 'a' } },
        { op: 'exists', path: 'b' },
      ],
    },
    messageKey: 'rule.aRequiresB',
  };

  it('fires when the dependent field is present but its dependency is missing', () => {
    const issues = evaluateRules([dependency], { a: 1 });
    expect(issues).toEqual([
      expect.objectContaining({ severity: 'warning', ruleId: 'a-requires-b' }),
    ]);
  });

  it('does not fire when the dependency is satisfied', () => {
    expect(evaluateRules([dependency], { a: 1, b: 2 })).toEqual([]);
  });

  it('does not fire when the dependent field is absent altogether', () => {
    expect(evaluateRules([dependency], { b: 2 })).toEqual([]);
    expect(evaluateRules([dependency], {})).toEqual([]);
  });
});

describe('cross-object rules via a wildcard path segment', () => {
  const requirePassword: ValidationRule = {
    id: 'ss-requires-password',
    severity: 'error',
    when: {
      op: 'or',
      of: [
        { op: 'not', of: { op: 'eq', path: 'type', value: 'ss' } },
        { op: 'exists', path: 'password' },
      ],
    },
    messageKey: 'rule.ssRequiresPassword',
    path: 'proxies.*.password',
  };

  it('evaluates the condition against each array element as scope, reporting a concrete index', () => {
    const moduleValue = {
      proxies: [
        { type: 'ss', password: 'x' }, // valid
        { type: 'ss' }, // violates
        { type: 'http' }, // rule does not apply (not ss)
      ],
    };
    const issues = evaluateRules([requirePassword], moduleValue);
    expect(issues).toEqual([
      expect.objectContaining({ ruleId: 'ss-requires-password', path: ['proxies', 1, 'password'] }),
    ]);
  });

  it('lets $.-prefixed conditions inside a wildcard rule still reach the module root', () => {
    const globalGate: ValidationRule = {
      id: 'lan-requires-bind-address',
      severity: 'error',
      when: {
        op: 'or',
        of: [
          { op: 'not', of: { op: 'eq', path: '$.allow-lan', value: true } },
          { op: 'exists', path: 'bind-address' },
        ],
      },
      messageKey: 'rule.lanRequiresBindAddress',
      path: 'inbounds.*.bind-address',
    };
    const moduleValue = { 'allow-lan': true, inbounds: [{}] };
    const issues = evaluateRules([globalGate], moduleValue);
    expect(issues).toEqual([expect.objectContaining({ path: ['inbounds', 0, 'bind-address'] })]);
  });

  it('does not iterate or crash when the wildcard target is not an array', () => {
    expect(evaluateRules([requirePassword], { proxies: 'not-an-array' })).toEqual([]);
    expect(evaluateRules([requirePassword], {})).toEqual([]);
  });

  it('caps the number of elements a wildcard rule iterates (combinatorics guard)', () => {
    const proxies = Array.from({ length: 10 }, () => ({ type: 'ss' })); // every element violates
    const issues = evaluateRules([requirePassword], { proxies }, { maxWildcardMatches: 3 });
    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.path)).toEqual([
      ['proxies', 0, 'password'],
      ['proxies', 1, 'password'],
      ['proxies', 2, 'password'],
    ]);
  });

  it('resolves a numeric segment before the wildcard as an array index', () => {
    const rule: ValidationRule = {
      id: 'nested-array-prefix',
      severity: 'error',
      when: { op: 'exists', path: 'name' },
      messageKey: 'rule.nestedArrayPrefix',
      path: 'groups.0.members.*.name',
    };
    const moduleValue = { groups: [{ members: [{}] }] };
    expect(evaluateRules([rule], moduleValue)).toEqual([
      expect.objectContaining({ path: ['groups', 0, 'members', 0, 'name'] }),
    ]);
  });

  it('refuses to walk into the prototype chain via a __proto__/constructor/prototype segment', () => {
    const rule: ValidationRule = {
      id: 'proto-walk',
      severity: 'error',
      when: { op: 'exists', path: 'x' },
      messageKey: 'rule.protoWalk',
      path: '__proto__.*.x',
    };
    expect(() => evaluateRules([rule], {})).not.toThrow();
    expect(evaluateRules([rule], {})).toEqual([]);
  });
});

describe('module-root-scoped rule with no explicit path', () => {
  it('anchors the issue at basePath alone when the rule declares no path', () => {
    const rule: ValidationRule = {
      id: 'mode-requires-something',
      severity: 'info',
      when: { op: 'exists', path: 'mode' },
      messageKey: 'rule.modeRequired',
    };
    expect(evaluateRules([rule], {})).toEqual([expect.objectContaining({ path: [] })]);
    expect(evaluateRules([rule], {}, { basePath: ['dns'] })).toEqual([
      expect.objectContaining({ path: ['dns'] }),
    ]);
  });
});

describe('safety and NFR-SEC-03 (no document content in the reported issue)', () => {
  it('never echoes the value that triggered the rule into the issue', () => {
    const rule: ValidationRule = {
      id: 'no-plaintext-password',
      severity: 'warning',
      when: { op: 'not', of: { op: 'exists', path: 'password' } },
      messageKey: 'rule.passwordPresent',
      messageParams: { field: 'password' },
    };
    const secret = 'super-secret-value-must-never-leak';
    const issues = evaluateRules([rule], { password: secret });

    expect(issues).toHaveLength(1);
    expect(JSON.stringify(issues)).not.toContain(secret);
  });

  it('only ever carries the messageParams the rule itself declared, never anything derived from the document', () => {
    const rule: ValidationRule = {
      id: 'fixed-params',
      severity: 'error',
      when: { op: 'exists', path: 'nope' },
      messageKey: 'rule.fixed',
      messageParams: { hint: 'static-value' },
    };
    const issues = evaluateRules([rule], { unrelated: 'document-value-should-not-appear' });
    expect(issues[0]?.messageParams).toEqual({ hint: 'static-value' });
  });

  it('does not crash on a pathologically nested condition — it just never fires', () => {
    let condition: ValidationRule['when'] = { op: 'exists', path: 'x' };
    for (let i = 0; i < 40; i += 1) {
      condition = { op: 'not', of: condition };
    }
    const rule: ValidationRule = {
      id: 'too-deep',
      severity: 'error',
      when: condition,
      messageKey: 'rule.tooDeep',
    };
    expect(() => evaluateRules([rule], { x: 1 })).not.toThrow();
    expect(evaluateRules([rule], { x: 1 })).toEqual([]);
  });
});

describe('fix pass-through', () => {
  it('carries an unresolved RuleFix through to the issue as-is', () => {
    const rule: ValidationRule = {
      id: 'with-fix',
      severity: 'error',
      when: { op: 'exists', path: 'mode' },
      messageKey: 'rule.withFix',
      fix: { kind: 'set-scalar', value: 'rule' },
    };
    const issues = evaluateRules([rule], {});
    expect(issues[0]?.fix).toEqual({ kind: 'set-scalar', value: 'rule' });
  });

  it('omits fix entirely when the rule does not declare one', () => {
    const rule: ValidationRule = {
      id: 'no-fix',
      severity: 'error',
      when: { op: 'exists', path: 'mode' },
      messageKey: 'rule.noFix',
    };
    expect(evaluateRules([rule], {})[0]).not.toHaveProperty('fix');
  });
});
