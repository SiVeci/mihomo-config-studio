import { parseRuleLine, type ParsedRuleLine, type RuleFragment } from '@mcs/config-model';

import type { RuleTypeSpec } from './types.ts';

/**
 * A rule line's type is recognised by the catalog: `parseRuleLine`'s
 * fragments, labelled with what they mean (ADR-021). Editing UI (#8) reads
 * `spec.payloadKind` to choose a control — never a `switch` on `type` — so
 * a Bundle can add a tenth catalog entry with no application code change,
 * the same FR-SCHEMA-06 guarantee `buildFormPlan` already gives ordinary
 * fields.
 */
export interface StructuredRulePlan {
  kind: 'structured';
  spec: RuleTypeSpec;
  payload: RuleFragment | null;
  target: RuleFragment | null;
  params: readonly RuleFragment[];
}

/**
 * A rule line whose type the catalog does not list — a P1/P2 type (logic
 * rules, source/inbound-criteria variants, ...) or anything a future Bundle
 * has not shipped a catalog entry for yet. Carries the original text
 * untouched: FR-RULE-05 requires this app never drop or corrupt a rule it
 * does not structurally understand, the same fidelity promise the
 * unknown-field tree gives ordinary config values.
 */
export interface RawRulePlan {
  kind: 'raw';
  text: string;
}

export type RulePlan = StructuredRulePlan | RawRulePlan;

/**
 * Aligns one already-parsed rule line (`parseRuleLine`, `@mcs/config-model`)
 * against a rule-type catalog. This function does not parse — splitting a
 * rule line into type/payload/target/params is `parseRuleLine`'s job and is
 * already done before this is called; aligning the result with what a
 * catalog entry says those fragments *mean* is the only thing added here.
 */
export function buildRulePlan(catalog: readonly RuleTypeSpec[], rawLine: string): RulePlan {
  const parsed: ParsedRuleLine = parseRuleLine(rawLine);
  const spec = catalog.find((entry) => entry.type === parsed.type);
  if (!spec) return { kind: 'raw', text: rawLine };

  return {
    kind: 'structured',
    spec,
    payload: parsed.payload,
    target: parsed.target,
    params: parsed.params,
  };
}
