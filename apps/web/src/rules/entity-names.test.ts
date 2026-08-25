import { describe, expect, it } from 'vitest';

import { collectRuleEntityNames } from './entity-names.js';

describe('collectRuleEntityNames', () => {
  it('returns the built-in policy names plus empty lists for a null document', () => {
    const names = collectRuleEntityNames(null);
    expect(names.proxyTargetNames).toEqual([
      'DIRECT',
      'REJECT',
      'REJECT-DROP',
      'COMPATIBLE',
      'PASS',
      'PASS-RULE',
      'GLOBAL',
    ]);
    expect(names.ruleProviderNames).toEqual([]);
    expect(names.subRuleGroupNames).toEqual([]);
  });

  it('returns the built-ins alone for a non-object document value, without crashing', () => {
    const names = collectRuleEntityNames('not-an-object');
    expect(names.proxyTargetNames).toEqual(expect.arrayContaining(['DIRECT', 'GLOBAL']));
  });

  it('collects proxy and proxy-group names alongside the built-ins', () => {
    const names = collectRuleEntityNames({
      proxies: [{ name: 'node-a' }, { name: 'node-b' }],
      'proxy-groups': [{ name: 'auto' }],
    });
    expect(names.proxyTargetNames).toEqual([
      'DIRECT',
      'REJECT',
      'REJECT-DROP',
      'COMPATIBLE',
      'PASS',
      'PASS-RULE',
      'GLOBAL',
      'node-a',
      'node-b',
      'auto',
    ]);
  });

  it('skips array entries that are not objects or have no string name', () => {
    const names = collectRuleEntityNames({
      proxies: [
        { name: 'node-a' },
        'not-an-object',
        { name: 42 },
        { other: 'field' },
        { name: '' },
      ],
    });
    expect(names.proxyTargetNames).toEqual(expect.arrayContaining(['DIRECT', 'GLOBAL', 'node-a']));
    expect(names.proxyTargetNames).toHaveLength(8);
  });

  it('collects rule-provider and sub-rules map keys', () => {
    const names = collectRuleEntityNames({
      'rule-providers': { ads: {}, cn: {} },
      'sub-rules': { group_a: ['MATCH,DIRECT'], group_b: [] },
    });
    expect(names.ruleProviderNames).toEqual(['ads', 'cn']);
    expect(names.subRuleGroupNames).toEqual(['group_a', 'group_b']);
  });

  it('ignores a non-map value at rule-providers/sub-rules instead of crashing', () => {
    const names = collectRuleEntityNames({
      'rule-providers': 'oops',
      'sub-rules': ['not', 'a', 'map'],
    });
    expect(names.ruleProviderNames).toEqual([]);
    expect(names.subRuleGroupNames).toEqual([]);
  });
});
