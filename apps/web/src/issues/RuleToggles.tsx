import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';
import type { ToggleableRule } from '../worker/protocol.js';
import './RuleToggles.css';

export interface RuleTogglesProps {
  /**
   * Computed by the Worker (`handleConfigureModules`, `@mcs/validator`'s
   * `listToggleableRules`) and threaded back through `ConfigureModulesResponse`
   * — never imported here directly: `client.test.ts`'s "main-thread module
   * boundary" (NFR-PERF-05) forbids `@mcs/validator` outside `protocol.ts`/
   * `config.worker.ts`, and this is a main-thread component.
   */
  readonly rules: readonly ToggleableRule[];
  readonly disabledRuleIds: ReadonlySet<string>;
  readonly onToggle: (ruleId: string, disabled: boolean) => void;
}

/**
 * FR-VAL-06: one checkbox per disableable warning rule. A blocking rule is
 * never offered at all — `listToggleableRules` already excludes
 * `severity: 'error'` rules before this component ever sees `rules`,
 * matching `runPipeline`'s own invariant that a blocking issue can never be
 * muted.
 *
 * Checkbox semantics are "is this warning shown" (checked = enabled), the
 * inverse of `disabledRuleIds` membership — reporting a double negative
 * ("disable this rule" unchecked) to the user would be more confusing than
 * the small inversion done here.
 */
export function RuleToggles({ rules, disabledRuleIds, onToggle }: RuleTogglesProps): ReactNode {
  return (
    <section className="rule-toggles" aria-label={t('ruleToggles.title')}>
      <h2 className="rule-toggles__title">{t('ruleToggles.title')}</h2>
      <ul className="rule-toggles__list">
        {rules.map((rule) => {
          const disabled = disabledRuleIds.has(rule.id);
          return (
            <li key={rule.id}>
              <label className="rule-toggles__item">
                <input
                  type="checkbox"
                  checked={!disabled}
                  onChange={(event) => onToggle(rule.id, !event.target.checked)}
                />
                {t(rule.messageKey as TranslationKey)}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
