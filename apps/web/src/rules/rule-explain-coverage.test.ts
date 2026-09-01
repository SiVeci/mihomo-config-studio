import { RULES_MODULE } from '@mcs/schema-builtin';
import { explainRule } from '@mcs/validator';
import { describe, expect, it } from 'vitest';

import en from '../i18n/en.json';
import zhCN from '../i18n/zh-CN.json';

/**
 * FR-RULE-06, v0.9.0 #16: every real rule type/param the built-in Bundle
 * ships (`RULES_MODULE.ruleTypes`, `@mcs/schema-builtin`) must have a real
 * `ruleExplain.*` translation in both locales — not the graceful
 * fallback-to-raw-key `t()` degradation `IssuePanel.tsx`'s own doc comment
 * documents as acceptable for third-party (`yaml.*`) codes. Those codes are
 * genuinely open-ended (any error a vendored YAML library can raise); this
 * catalog is entirely this repo's own data, so a missing translation here is
 * always an oversight, not an unavoidable gap.
 *
 * `explainRule` itself is imported directly here (not through the Worker) —
 * fine for test-only code: `client.test.ts`'s "main-thread module boundary"
 * scan explicitly excludes `.test.ts`/`.test.tsx` files, since only
 * production bundle code is what NFR-PERF-05 cares about.
 */
const CATALOG = RULES_MODULE.ruleTypes ?? [];

function messageKeysFor(ruleText: string): string[] {
  const explanation = explainRule(CATALOG, ruleText);
  if (explanation.kind === 'raw') return [];
  return explanation.lines.map((line) => line.messageKey);
}

describe('ruleExplain.* i18n coverage over the real built-in rule-type catalog (FR-RULE-06, v0.9.0 #16)', () => {
  it('the real catalog is non-empty — sanity check that this audit covers something', () => {
    expect(CATALOG.length).toBeGreaterThan(0);
  });

  it.each(CATALOG.map((spec) => [spec.type, spec] as const))(
    '%s: every message key explainRule produces has a real zh-CN and en translation, not a raw-key fallback',
    (_type, spec) => {
      // One sample rule line per real type: a bare target for a
      // needsPayload:false type (MATCH/SUB-RULE), a placeholder payload
      // otherwise, and every one of the type's own declared params appended
      // — this is the *union* of every message key `explainRule` could ever
      // produce for this type, not just what one specific line happens to
      // trigger.
      const ruleText = spec.needsPayload
        ? [spec.type, 'placeholder', 'PROXY', ...spec.params].join(',')
        : [spec.type, 'PROXY', ...spec.params].join(',');

      const keys = messageKeysFor(ruleText);
      expect(keys.length).toBeGreaterThan(0); // sanity: the catalog entry actually matched

      for (const key of keys) {
        expect(zhCN, `zh-CN is missing a real translation for "${key}"`).toHaveProperty(key);
        expect(en, `en is missing a real translation for "${key}"`).toHaveProperty(key);
        // A translation that is just the key itself would defeat the point
        // of this audit (indistinguishable from the fallback it exists to
        // catch).
        expect(zhCN[key as keyof typeof zhCN]).not.toBe(key);
        expect(en[key as keyof typeof en]).not.toBe(key);
      }
    },
  );
});
