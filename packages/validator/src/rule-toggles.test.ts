import { PROXIES_MODULE } from '@mcs/schema-builtin';
import type { SchemaModule } from '@mcs/schema-core';
import { describe, expect, it } from 'vitest';

import { listToggleableRules } from './rule-toggles.js';

function fakeModule(overrides: Partial<SchemaModule> = {}): SchemaModule {
  return {
    manifest: { id: 'fake', root: ['fake'], version: '1.0.0' },
    schema: { type: 'object' },
    ui: {},
    ...overrides,
  };
}

describe('listToggleableRules (FR-VAL-06, v0.9.0 #15)', () => {
  it('always includes the four fixed rule-order ids, with no modules installed at all', () => {
    expect(listToggleableRules([])).toEqual([
      { id: 'ruleOrder.noMatch', messageKey: 'ruleOrder.noMatch.description' },
      { id: 'ruleOrder.afterMatch', messageKey: 'ruleOrder.afterMatch.description' },
      { id: 'ruleOrder.domainShadowed', messageKey: 'ruleOrder.domainShadowed.description' },
      { id: 'ruleOrder.cidrShadowed', messageKey: 'ruleOrder.cidrShadowed.description' },
    ]);
  });

  it('derives a real module rule id from validation.rules.json, prefixed the same way rules.ts prefixes ValidationIssue.code', () => {
    const toggles = listToggleableRules([PROXIES_MODULE]);
    expect(toggles).toContainEqual({
      id: 'rule.tuic-token-conflicts-with-uuid-password',
      messageKey: 'rule.tuicTokenConflictsWithUuidPassword',
    });
  });

  it('excludes a blocking (severity: error) module rule — a toggle for it would lie, since runPipeline never lets it be disabled', () => {
    const module = fakeModule({
      rules: [
        {
          id: 'always-blocks',
          severity: 'error',
          when: { op: 'exists', path: 'x' },
          messageKey: 'rule.alwaysBlocks',
        },
      ],
    });

    expect(listToggleableRules([module])).not.toContainEqual(
      expect.objectContaining({ id: 'rule.always-blocks' }),
    );
  });

  it('includes a non-blocking (warning/info) module rule', () => {
    const module = fakeModule({
      rules: [
        {
          id: 'soft-check',
          severity: 'info',
          when: { op: 'exists', path: 'x' },
          messageKey: 'rule.softCheck',
        },
      ],
    });

    expect(listToggleableRules([module])).toContainEqual({
      id: 'rule.soft-check',
      messageKey: 'rule.softCheck',
    });
  });

  it('a module with no rules at all contributes nothing beyond the fixed rule-order set', () => {
    expect(listToggleableRules([fakeModule()])).toEqual(listToggleableRules([]));
  });

  it('a newly added rule automatically appears with no code change here (data-driven, not hardcoded)', () => {
    const before = listToggleableRules([fakeModule()]).length;
    const after = listToggleableRules([
      fakeModule({
        rules: [
          {
            id: 'brand-new-rule',
            severity: 'warning',
            when: { op: 'exists', path: 'x' },
            messageKey: 'rule.brandNew',
          },
        ],
      }),
    ]).length;

    expect(after).toBe(before + 1);
  });
});
