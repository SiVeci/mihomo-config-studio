import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';
import type { RuleExplanation } from '../worker/protocol.js';
import './RuleExplainer.css';

export interface RuleExplainerProps {
  /** `null` while the Worker round-trip for the newly selected row is still in flight. */
  readonly explanation: RuleExplanation | null;
}

/**
 * FR-RULE-06: explains a selected rule's own composition — never a match
 * simulator (see `explainRule`'s own doc comment, `@mcs/validator`). The
 * static-analysis caveat renders unconditionally, reusing the exact
 * `ruleOrder.staticAnalysisCaveat` key `IssuePanel` already renders for
 * rule-order issues (PRD §8.6/NG-07) rather than a second copy of the same
 * wording — `rule-analysis-wording.test.tsx` (extended by v0.9.0 #16) is the
 * one place both this component's and `IssuePanel`'s compliance are proven.
 */
export function RuleExplainer({ explanation }: RuleExplainerProps): ReactNode {
  if (!explanation) return null;
  return (
    <section className="rule-explainer" aria-label={t('ruleExplain.title')}>
      <h2 className="rule-explainer__title">{t('ruleExplain.title')}</h2>
      {explanation.kind === 'raw' ? (
        <p className="rule-explainer__raw-notice">{t('ruleExplain.rawNotice')}</p>
      ) : (
        <ul className="rule-explainer__lines">
          {explanation.lines.map((line) => (
            <li key={line.messageKey}>{t(line.messageKey as TranslationKey)}</li>
          ))}
        </ul>
      )}
      <p className="rule-explainer__caveat">{t('ruleOrder.staticAnalysisCaveat')}</p>
    </section>
  );
}
