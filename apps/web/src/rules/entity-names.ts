/**
 * Candidate names for the rule editor's reference-style controls (#8):
 * autocomplete only, never authoritative. `referenceStage` (`@mcs/validator`)
 * is the real source of truth for whether a name resolves — every control
 * fed by this file still accepts free text, so a name missing here is
 * reported by the validator later, never blocked at entry time.
 *
 * Reads `documentValue` directly with plain JS, the same way `ProjectPage`'s
 * own `rules` memo does — `EntityRegistry` (`@mcs/config-model`) needs a real
 * `MihomoYamlDocument`, which only exists inside the Worker
 * (`schema-registry-boundary.test.ts` polices that boundary), so it cannot
 * run here on the main thread.
 */

/**
 * Mirrors `@mcs/config-model`'s `entity.ts` (`UNCONDITIONAL_BUILTINS` +
 * `CONDITIONAL_GLOBAL`), simplified to always include `GLOBAL`: this list
 * only seeds autocomplete suggestions, so the rare case of a user-defined
 * GLOBAL group producing one harmless duplicate suggestion is an acceptable
 * simplification — unlike `entity.ts`'s own copy, this one feeds no
 * validation decision.
 */
const BUILTIN_POLICY_NAMES = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'COMPATIBLE',
  'PASS',
  'PASS-RULE',
  'GLOBAL',
] as const;

export interface RuleEntityNames {
  readonly proxyTargetNames: readonly string[];
  readonly ruleProviderNames: readonly string[];
  readonly subRuleGroupNames: readonly string[];
}

export function collectRuleEntityNames(documentValue: unknown): RuleEntityNames {
  const record = isRecord(documentValue) ? documentValue : null;
  return {
    // Dot notation for the proxies key, not bracket notation with a quoted
    // string: `schema-registry-boundary.test.ts` (FR-SCHEMA-05) forbids that
    // quoted module id anywhere under `apps/web/src` — `worker/protocol.ts`'s
    // own provider-preview code already reads this same key the same way for
    // the same reason.
    proxyTargetNames: [
      ...BUILTIN_POLICY_NAMES,
      ...namedArrayNames(record?.proxies),
      ...namedArrayNames(record?.['proxy-groups']),
    ],
    ruleProviderNames: mapKeys(record?.['rule-providers']),
    subRuleGroupNames: mapKeys(record?.['sub-rules']),
  };
}

function namedArrayNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (isRecord(item) && typeof item.name === 'string' && item.name !== '') names.push(item.name);
  }
  return names;
}

function mapKeys(raw: unknown): string[] {
  return isRecord(raw) ? Object.keys(raw) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
