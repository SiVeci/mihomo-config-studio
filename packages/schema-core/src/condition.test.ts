import { describe, expect, it } from 'vitest';

import { ConditionError, evaluateCondition, resolve } from './condition.js';
import type { Condition } from './types.js';

const scope = {
  type: 'vmess',
  port: 443,
  tls: true,
  name: 'HK-Node-01',
  proxies: ['a', 'b', 'c'],
  'ws-opts': { path: '/ray' },
  empty: '',
  nothing: null,
};
const context = { scope, root: { sample: scope, mode: 'rule' } };

const check = (condition: Condition) => evaluateCondition(condition, context);

describe('restricted condition DSL (FR-SCHEMA-03, NFR-SEC-05)', () => {
  it('compares equality with tolerant scalar coercion', () => {
    expect(check({ op: 'eq', path: 'type', value: 'vmess' })).toBe(true);
    expect(check({ op: 'eq', path: 'type', value: 'vless' })).toBe(false);
    expect(check({ op: 'ne', path: 'type', value: 'vless' })).toBe(true);
    // `port: 443` and `port: "443"` are both valid YAML for the same intent.
    expect(check({ op: 'eq', path: 'port', value: '443' })).toBe(true);
    expect(check({ op: 'eq', path: 'tls', value: true })).toBe(true);
  });

  it('evaluates numeric comparisons on numbers and numeric strings', () => {
    expect(check({ op: 'gt', path: 'port', value: 80 })).toBe(true);
    expect(check({ op: 'gte', path: 'port', value: 443 })).toBe(true);
    expect(check({ op: 'lt', path: 'port', value: 443 })).toBe(false);
    expect(check({ op: 'lte', path: 'port', value: 443 })).toBe(true);
    // Non-numeric operands compare false rather than throwing.
    expect(check({ op: 'gt', path: 'type', value: 1 })).toBe(false);
    expect(check({ op: 'gt', path: 'missing', value: 1 })).toBe(false);
  });

  it('supports membership, presence and emptiness', () => {
    expect(check({ op: 'in', path: 'type', values: ['vmess', 'vless'] })).toBe(true);
    expect(check({ op: 'notIn', path: 'type', values: ['ss', 'trojan'] })).toBe(true);
    expect(check({ op: 'exists', path: 'nothing' })).toBe(true);
    expect(check({ op: 'exists', path: 'missing' })).toBe(false);
    expect(check({ op: 'empty', path: 'empty' })).toBe(true);
    expect(check({ op: 'empty', path: 'nothing' })).toBe(true);
    expect(check({ op: 'empty', path: 'proxies' })).toBe(false);
  });

  it('supports bounded string predicates but no regular expressions', () => {
    expect(check({ op: 'startsWith', path: 'name', value: 'HK' })).toBe(true);
    expect(check({ op: 'endsWith', path: 'name', value: '01' })).toBe(true);
    expect(check({ op: 'contains', path: 'name', value: 'Node' })).toBe(true);
    expect(check({ op: 'contains', path: 'port', value: '44' })).toBe(false);
  });

  it('measures length of strings, arrays and objects', () => {
    expect(check({ op: 'length', path: 'proxies', gte: 3 })).toBe(true);
    expect(check({ op: 'length', path: 'proxies', gte: 4 })).toBe(false);
    expect(check({ op: 'length', path: 'proxies', lte: 3 })).toBe(true);
    expect(check({ op: 'length', path: 'ws-opts', gte: 1 })).toBe(true);
    expect(check({ op: 'length', path: 'port', gte: 1 })).toBe(false);
  });

  it('combines with and / or / not', () => {
    expect(
      check({
        op: 'and',
        of: [
          { op: 'eq', path: 'type', value: 'vmess' },
          { op: 'eq', path: 'tls', value: true },
        ],
      }),
    ).toBe(true);
    expect(
      check({
        op: 'or',
        of: [
          { op: 'eq', path: 'type', value: 'ss' },
          { op: 'eq', path: 'tls', value: true },
        ],
      }),
    ).toBe(true);
    expect(check({ op: 'not', of: { op: 'eq', path: 'type', value: 'ss' } })).toBe(true);
  });
});

describe('path resolution', () => {
  it('reads siblings, nested objects and array indices', () => {
    expect(resolve('type', context)).toBe('vmess');
    expect(resolve('ws-opts.path', context)).toBe('/ray');
    expect(resolve('proxies.1', context)).toBe('b');
    expect(resolve('proxies.x', context)).toBeUndefined();
    expect(resolve('missing.deep', context)).toBeUndefined();
    expect(resolve('type.deep', context)).toBeUndefined();
  });

  it('addresses the module root with the $. prefix', () => {
    expect(resolve('$.mode', context)).toBe('rule');
    expect(resolve('$.sample.type', context)).toBe('vmess');
  });

  it('refuses to walk the prototype chain', () => {
    expect(resolve('__proto__', context)).toBeUndefined();
    expect(resolve('constructor', context)).toBeUndefined();
    expect(resolve('constructor.prototype', context)).toBeUndefined();
  });
});

describe('resource guards', () => {
  it('rejects conditions nested past the depth limit', () => {
    let condition: Condition = { op: 'eq', path: 'type', value: 'vmess' };
    for (let i = 0; i < 20; i += 1) condition = { op: 'not', of: condition };
    expect(() => evaluateCondition(condition, context)).toThrow(ConditionError);
  });

  it('rejects an operator that is not in the closed set', () => {
    const hostile = { op: 'exec', path: 'type' } as unknown as Condition;
    expect(() => evaluateCondition(hostile, context)).toThrow(/Unsupported condition operator/);
  });
});
