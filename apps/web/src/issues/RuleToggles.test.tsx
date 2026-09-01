// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { ToggleableRule } from '../worker/protocol.js';
import { RuleToggles } from './RuleToggles.js';

afterEach(() => {
  cleanup();
});

const DOMAIN_SHADOWED: ToggleableRule = {
  id: 'ruleOrder.domainShadowed',
  messageKey: 'ruleOrder.domainShadowed.description',
};
const TUIC_RULE: ToggleableRule = {
  id: 'rule.tuic-token-conflicts-with-uuid-password',
  messageKey: 'rule.tuicTokenConflictsWithUuidPassword',
};

describe('RuleToggles (FR-VAL-06, v0.9.0 #15)', () => {
  it('renders one item per given rule, in order', () => {
    render(
      <RuleToggles
        rules={[DOMAIN_SHADOWED, TUIC_RULE]}
        disabledRuleIds={new Set()}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText(t('ruleOrder.domainShadowed.description'))).toBeDefined();
    // No real translation exists for this module rule yet — `t()` falls
    // back to the raw key (documented, accepted behaviour, `IssuePanel.tsx`'s
    // own `translateIssueMessage`); this only proves the component calls
    // `t(rule.messageKey)`, not that a translation exists.
    expect(screen.getByText(t('rule.tuicTokenConflictsWithUuidPassword' as never))).toBeDefined();
  });

  it('renders nothing when given no rules', () => {
    const { container } = render(
      <RuleToggles rules={[]} disabledRuleIds={new Set()} onToggle={vi.fn()} />,
    );
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('checks the box for a rule that is not in disabledRuleIds (enabled by default)', () => {
    render(
      <RuleToggles rules={[DOMAIN_SHADOWED]} disabledRuleIds={new Set()} onToggle={vi.fn()} />,
    );

    const checkbox = screen.getByLabelText(
      t('ruleOrder.domainShadowed.description'),
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('unchecks the box for a rule that is in disabledRuleIds', () => {
    render(
      <RuleToggles
        rules={[DOMAIN_SHADOWED]}
        disabledRuleIds={new Set(['ruleOrder.domainShadowed'])}
        onToggle={vi.fn()}
      />,
    );

    const checkbox = screen.getByLabelText(
      t('ruleOrder.domainShadowed.description'),
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('unchecking an enabled rule reports (id, true) — disabling it', () => {
    const onToggle = vi.fn();
    render(
      <RuleToggles rules={[DOMAIN_SHADOWED]} disabledRuleIds={new Set()} onToggle={onToggle} />,
    );

    fireEvent.click(screen.getByLabelText(t('ruleOrder.domainShadowed.description')));

    expect(onToggle).toHaveBeenCalledWith('ruleOrder.domainShadowed', true);
  });

  it('checking a disabled rule reports (id, false) — re-enabling it', () => {
    const onToggle = vi.fn();
    render(
      <RuleToggles
        rules={[DOMAIN_SHADOWED]}
        disabledRuleIds={new Set(['ruleOrder.domainShadowed'])}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByLabelText(t('ruleOrder.domainShadowed.description')));

    expect(onToggle).toHaveBeenCalledWith('ruleOrder.domainShadowed', false);
  });
});
