// @vitest-environment jsdom
import type { RuleTypeSpec } from '@mcs/schema-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import { RuleEditor } from './RuleEditor.js';

afterEach(() => {
  cleanup();
});

const DOMAIN_SUFFIX: RuleTypeSpec = {
  type: 'DOMAIN-SUFFIX',
  payloadKind: 'domain-suffix',
  needsPayload: true,
  params: [],
  safety: 'safe',
};

const IP_CIDR: RuleTypeSpec = {
  type: 'IP-CIDR',
  payloadKind: 'ipcidr',
  needsPayload: true,
  params: ['no-resolve', 'src'],
  docsUrl: 'https://example.invalid/docs/ip-cidr',
  safety: 'safe',
};

const RULE_SET: RuleTypeSpec = {
  type: 'RULE-SET',
  payloadKind: 'rule-set',
  needsPayload: true,
  params: [],
  safety: 'safe',
};

const SUB_RULE: RuleTypeSpec = {
  type: 'SUB-RULE',
  payloadKind: 'sub-rule',
  needsPayload: false,
  params: [],
  safety: 'safe',
};

const MATCH: RuleTypeSpec = {
  type: 'MATCH',
  payloadKind: 'none',
  needsPayload: false,
  params: [],
  safety: 'dangerous',
};

const CATALOG: readonly RuleTypeSpec[] = [DOMAIN_SUFFIX, IP_CIDR, RULE_SET, SUB_RULE, MATCH];

function renderEditor(overrides: Partial<React.ComponentProps<typeof RuleEditor>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <RuleEditor
      catalog={CATALOG}
      proxyTargetNames={['node-a', 'auto-group']}
      ruleProviderNames={['ads', 'cn-ip']}
      subRuleGroupNames={['ads-block']}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSubmit, onCancel };
}

describe('RuleEditor (v0.4.0 #8, FR-RULE-01/05)', () => {
  it('creates a rule using structured controls: defaults to the first catalog entry, submits type+payload+target joined', () => {
    const { onSubmit } = renderEditor();

    expect(screen.getByLabelText(t('ruleEditor.typeLabel'))).toHaveProperty(
      'value',
      'DOMAIN-SUFFIX',
    );
    fireEvent.change(screen.getByLabelText(t('ruleEditor.payloadLabel')), {
      target: { value: 'example.com' },
    });
    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'DIRECT' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    expect(onSubmit).toHaveBeenCalledWith('DOMAIN-SUFFIX,example.com,DIRECT');
  });

  it('does not render a payload field for a type that needs none (MATCH), and submits type+target only', () => {
    const { onSubmit } = renderEditor();

    fireEvent.change(screen.getByLabelText(t('ruleEditor.typeLabel')), {
      target: { value: 'MATCH' },
    });
    expect(screen.queryByLabelText(t('ruleEditor.payloadLabel'))).toBeNull();

    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'PROXY' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    expect(onSubmit).toHaveBeenCalledWith('MATCH,PROXY');
  });

  it('shows the danger safety badge for a type marked dangerous, not for one marked safe', () => {
    renderEditor();
    expect(screen.queryByText(t('badge.danger'))).toBeNull();

    fireEvent.change(screen.getByLabelText(t('ruleEditor.typeLabel')), {
      target: { value: 'MATCH' },
    });
    expect(screen.getByText(t('badge.danger'))).not.toBeNull();
  });

  it('disables Save until the required fields for the selected type are filled', () => {
    renderEditor();
    const saveButton = screen.getByRole('button', { name: t('ruleEditor.saveButton') });
    expect(saveButton).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(t('ruleEditor.payloadLabel')), {
      target: { value: 'example.com' },
    });
    expect(saveButton).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'DIRECT' },
    });
    expect(saveButton).toHaveProperty('disabled', false);
  });

  it('toggling param checkboxes includes them in catalog-declared order regardless of click order', () => {
    const { onSubmit } = renderEditor();
    fireEvent.change(screen.getByLabelText(t('ruleEditor.typeLabel')), {
      target: { value: 'IP-CIDR' },
    });
    fireEvent.change(screen.getByLabelText(t('ruleEditor.payloadLabel')), {
      target: { value: '192.168.1.0/24' },
    });
    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'DIRECT' },
    });

    // Click "src" before "no-resolve" — the catalog declares the opposite order.
    fireEvent.click(screen.getByRole('checkbox', { name: 'src' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'no-resolve' }));
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    expect(onSubmit).toHaveBeenCalledWith('IP-CIDR,192.168.1.0/24,DIRECT,no-resolve,src');
  });

  it('switching the type resets payload/target/params instead of carrying over stale values', () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText(t('ruleEditor.payloadLabel')), {
      target: { value: 'example.com' },
    });
    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'DIRECT' },
    });

    fireEvent.change(screen.getByLabelText(t('ruleEditor.typeLabel')), {
      target: { value: 'IP-CIDR' },
    });

    expect(screen.getByLabelText(t('ruleEditor.payloadLabel'))).toHaveProperty('value', '');
    expect(screen.getByLabelText(t('ruleEditor.targetLabel'))).toHaveProperty('value', '');
  });

  it('routes the RULE-SET payload field through the rule-provider name datalist, keyed off payloadKind not the type name', () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText(t('ruleEditor.typeLabel')), {
      target: { value: 'RULE-SET' },
    });
    const payloadInput = screen.getByLabelText(t('ruleEditor.payloadLabel'));
    const listId = payloadInput.getAttribute('list');
    expect(listId).not.toBeNull();
    const datalist = document.getElementById(listId as string);
    const options = Array.from(datalist?.querySelectorAll('option') ?? []).map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(['ads', 'cn-ip']);
  });

  it('routes the SUB-RULE target field through the sub-rule group name datalist instead of the outbound-policy one', () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText(t('ruleEditor.typeLabel')), {
      target: { value: 'SUB-RULE' },
    });
    // SUB-RULE needs no payload segment (needsPayload: false).
    expect(screen.queryByLabelText(t('ruleEditor.payloadLabel'))).toBeNull();

    const targetInput = screen.getByLabelText(t('ruleEditor.targetLabel'));
    const listId = targetInput.getAttribute('list');
    const datalist = document.getElementById(listId as string);
    const options = Array.from(datalist?.querySelectorAll('option') ?? []).map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(['ads-block']);

    fireEvent.change(targetInput, { target: { value: 'ads-block' } });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));
    // No onSubmit assertion needed beyond shape — covered by the join logic
    // tests above; this test's job is only the datalist routing.
  });

  it('pre-fills structured controls from an existing recognised rule line when editing', () => {
    renderEditor({ initialText: 'IP-CIDR,10.0.0.0/8,PROXY,no-resolve' });

    expect(screen.getByLabelText(t('ruleEditor.typeLabel'))).toHaveProperty('value', 'IP-CIDR');
    expect(screen.getByLabelText(t('ruleEditor.payloadLabel'))).toHaveProperty(
      'value',
      '10.0.0.0/8',
    );
    expect(screen.getByLabelText(t('ruleEditor.targetLabel'))).toHaveProperty('value', 'PROXY');
    expect(screen.getByRole('checkbox', { name: 'no-resolve' })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: 'src' })).toHaveProperty('checked', false);
  });

  it('edits an existing rule and submits the full replacement line via onSubmit', () => {
    const { onSubmit } = renderEditor({ initialText: 'DOMAIN-SUFFIX,old.example.com,DIRECT' });

    fireEvent.change(screen.getByLabelText(t('ruleEditor.payloadLabel')), {
      target: { value: 'new.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    expect(onSubmit).toHaveBeenCalledWith('DOMAIN-SUFFIX,new.example.com,DIRECT');
  });

  it('renders an unrecognised rule type as raw text, preserving it verbatim through an edit of unrelated text', () => {
    const { onSubmit } = renderEditor({ initialText: 'AND,(a,b),PROXY' });

    expect(screen.queryByLabelText(t('ruleEditor.typeLabel'))).toBeNull();
    const rawInput = screen.getByLabelText(t('ruleEditor.rawTextLabel'));
    expect(rawInput).toHaveProperty('value', 'AND,(a,b),PROXY');

    fireEvent.change(rawInput, { target: { value: 'AND,(a,b),REJECT' } });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    expect(onSubmit).toHaveBeenCalledWith('AND,(a,b),REJECT');
  });

  it('falls back to raw text for a recognised type carrying a param the catalog does not declare, instead of silently dropping it', () => {
    renderEditor({ initialText: 'IP-CIDR,10.0.0.0/8,PROXY,no-resolve,future-flag' });

    expect(screen.queryByLabelText(t('ruleEditor.typeLabel'))).toBeNull();
    expect(screen.getByLabelText(t('ruleEditor.rawTextLabel'))).toHaveProperty(
      'value',
      'IP-CIDR,10.0.0.0/8,PROXY,no-resolve,future-flag',
    );
  });

  it('never branches on a specific rule type name: a synthetic catalog entry unknown to this file works with no code change', () => {
    const futureSpec: RuleTypeSpec = {
      type: 'X-FUTURE-KIND',
      payloadKind: 'domain',
      needsPayload: true,
      params: ['future-param'],
      safety: 'safe',
    };
    const { onSubmit } = renderEditor({ catalog: [futureSpec] });

    fireEvent.change(screen.getByLabelText(t('ruleEditor.payloadLabel')), {
      target: { value: 'payload-value' },
    });
    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'target-value' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'future-param' }));
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    expect(onSubmit).toHaveBeenCalledWith('X-FUTURE-KIND,payload-value,target-value,future-param');
  });

  it('calls onCancel without calling onSubmit when Cancel is clicked', () => {
    const { onSubmit, onCancel } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.cancelButton') }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
