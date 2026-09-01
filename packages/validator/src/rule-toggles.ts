import type { SchemaModule } from '@mcs/schema-core';

export interface ToggleableRule {
  /** Exactly matches the `ValidationIssue.code` a disabled rule's issues would carry (`pipeline.ts`'s filter keys off the same string). */
  readonly id: string;
  /** i18n lookup key for the rule's own description — never a raw id shown to the user (FR-VAL-06's own "each toggle needs its description text" requirement). */
  readonly messageKey: string;
}

/**
 * `rule-order.ts`'s own fixed four issue codes (`ruleOrderIssue`'s `code`
 * equals its own `messageKey` there) — not module data, so not derivable from
 * any `SchemaModule`, but still real rule ids rather than a hand-picked
 * subset. `messageKey` here is deliberately a *different*, param-free key
 * from the one `ruleOrderIssue` uses for a real occurrence
 * (`ruleOrder.domainShadowed` there renders "第 {ruleIndex} 条…与第
 * {shadowedByIndex} 条…重叠", which needs a real issue's own params to mean
 * anything): a rule *toggle* describes the rule in general, not one
 * occurrence, so it needs its own generic, parameter-free description text
 * (`ruleOrder.domainShadowed.description` etc., `apps/web`'s i18n resources).
 */
const RULE_ORDER_TOGGLES: readonly ToggleableRule[] = [
  { id: 'ruleOrder.noMatch', messageKey: 'ruleOrder.noMatch.description' },
  { id: 'ruleOrder.afterMatch', messageKey: 'ruleOrder.afterMatch.description' },
  { id: 'ruleOrder.domainShadowed', messageKey: 'ruleOrder.domainShadowed.description' },
  { id: 'ruleOrder.cidrShadowed', messageKey: 'ruleOrder.cidrShadowed.description' },
];

/**
 * Every rule a user could disable, derived from real data (FR-VAL-06) — never
 * a hardcoded array: each installed module's own `validation.rules.json`
 * (`rules.ts`'s `evaluateRules` turns `rule.id` into `ValidationIssue.code`
 * as `rule.<id>`, reproduced here rather than imported since that mapping is
 * a one-line literal, not worth a cross-package dependency), plus
 * `rule-order.ts`'s fixed four. A blocking (`severity: 'error'`) module rule
 * is excluded on purpose: `runPipeline`'s own gate never lets a disabled
 * *blocking* issue disappear, so offering a toggle for one would be a control
 * that lies about what it does.
 */
export function listToggleableRules(modules: readonly SchemaModule[]): ToggleableRule[] {
  const moduleRules = modules.flatMap((module) =>
    (module.rules ?? [])
      .filter((rule) => rule.severity !== 'error')
      .map((rule) => ({ id: `rule.${rule.id}`, messageKey: rule.messageKey })),
  );
  return [...RULE_ORDER_TOGGLES, ...moduleRules];
}
