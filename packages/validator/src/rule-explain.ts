import { buildRulePlan } from '@mcs/schema-core';
import type { RuleTypeSpec } from '@mcs/schema-core';

/** i18n lookup key only — no rendered text lives here (NFR-SEC-03/PRD §11.6 pattern, same as `ValidationIssue`). */
export interface RuleExplanationLine {
  readonly messageKey: string;
}

export type RuleExplanation =
  | { readonly kind: 'structured'; readonly lines: readonly RuleExplanationLine[] }
  /** The catalog does not list this rule's type — same case `buildRulePlan` itself already names `RawRulePlan` for (FR-RULE-05: never drop what this app does not structurally recognise). */
  | { readonly kind: 'raw' };

/**
 * FR-RULE-06: explains a rule line's *composition* — what its type matches,
 * what its target names, what its optional parameters mean. Deliberately
 * **not** a match simulator: it never asks "does domain X hit this rule",
 * which would mean reproducing the kernel's own top-to-bottom, first-match-
 * wins search order — exactly the "equivalent to kernel runtime behaviour"
 * claim PRD §8.6/NG-07 forbids this app from making anywhere. PRD §8.7's own
 * wording is "说明一条规则的组成与预期匹配范围" (explain a rule's own
 * composition and expected match scope), not "simulate matching" — this
 * function answers only the former.
 *
 * Deliberately never includes `payload`/`target`'s own *value* in the
 * output, even though the user is already looking straight at it in the
 * editor: NFR-SEC-03's "never echo configuration content back into an
 * app-generated message" is applied uniformly here, the same way
 * `rule-order.ts`'s own issues do (its own doc comment: "a rule *index*, a
 * *type name*, and a *payloadKind* — never the payload/target text
 * itself") — only catalog vocabulary (`type`, a param's own name, all from
 * a closed, small enum in `rule-types.json`) ever appears, never a raw
 * domain/IP/target string the user typed.
 */
export function explainRule(catalog: readonly RuleTypeSpec[], rawLine: string): RuleExplanation {
  const plan = buildRulePlan(catalog, rawLine);
  if (plan.kind === 'raw') return { kind: 'raw' };

  const lines: RuleExplanationLine[] = [{ messageKey: `ruleExplain.type.${plan.spec.type}` }];

  if (plan.target) {
    lines.push({
      messageKey:
        plan.spec.payloadKind === 'sub-rule' ? 'ruleExplain.target.subRule' : 'ruleExplain.target',
    });
  }

  // Only a param name the catalog itself declares (`spec.params`, a closed,
  // small enum) ever becomes part of a message key — `parseRuleLine` never
  // validates a trailing segment against the catalog, so a rule line can
  // carry an unrecognised 4th+ segment; embedding *that* raw text into a key
  // and letting `t()`'s fallback-to-raw-key behaviour render it would leak
  // user-typed content the same way a bare `param.value` interpolation
  // would (NFR-SEC-03) — silently omitted here rather than explained, the
  // same "describe what the catalog recognises, stay honestly silent on the
  // rest" stance `RawRulePlan` itself takes one level up.
  for (const param of plan.params) {
    if (plan.spec.params.includes(param.value)) {
      lines.push({ messageKey: `ruleExplain.param.${param.value}` });
    }
  }

  return { kind: 'structured', lines };
}
