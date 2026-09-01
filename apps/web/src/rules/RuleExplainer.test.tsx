// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { t } from '../i18n/index.js';
import type { RuleExplanation } from '../worker/protocol.js';
import { RuleExplainer } from './RuleExplainer.js';

afterEach(() => {
  cleanup();
});

describe('RuleExplainer (FR-RULE-06, v0.9.0 #16)', () => {
  it('renders nothing while the explanation has not resolved yet', () => {
    const { container } = render(<RuleExplainer explanation={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one line per structured explanation entry, in order', () => {
    const explanation: RuleExplanation = {
      kind: 'structured',
      lines: [
        { messageKey: 'ruleExplain.type.DOMAIN-SUFFIX' },
        { messageKey: 'ruleExplain.target' },
      ],
    };
    render(<RuleExplainer explanation={explanation} />);

    expect(screen.getByText(t('ruleExplain.type.DOMAIN-SUFFIX'))).toBeDefined();
    expect(screen.getByText(t('ruleExplain.target'))).toBeDefined();
  });

  it('shows the raw notice instead of any line list when the type is not in the catalog', () => {
    render(<RuleExplainer explanation={{ kind: 'raw' }} />);

    expect(screen.getByText(t('ruleExplain.rawNotice'))).toBeDefined();
    expect(document.querySelector('.rule-explainer__lines')).toBeNull();
  });

  it('always renders the static-analysis caveat, reusing the exact same key IssuePanel uses for ruleOrder issues (PRD §8.6/NG-07) — never a second copy of the same wording', () => {
    render(<RuleExplainer explanation={{ kind: 'raw' }} />);
    expect(screen.getByText(t('ruleOrder.staticAnalysisCaveat'))).toBeDefined();
  });
});
