import {
  buildArrayFormPlan,
  buildFormPlan,
  flattenFields,
  isArrayEntryModule,
} from '@mcs/schema-core';
import type { JsonSchema, PlannedField, SchemaModule } from '@mcs/schema-core';
import { describe, expect, it } from 'vitest';

import {
  DNS_MODULE,
  GENERAL_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  PROXY_GROUPS_MODULE,
  PROXY_PROVIDERS_MODULE,
  RULE_PROVIDERS_MODULE,
  RULES_MODULE,
  SNIFFER_MODULE,
  SUB_RULES_MODULE,
} from './index.js';

/**
 * NFR-SEC-02, v0.9.0 #13. v0.3.0 #18's credential-masking proof only ever
 * covered the six P0 modules that existed then, by hand; four more modules
 * have shipped since (`proxy-groups`, `rule-providers`, plus the two rule-DSL
 * modules) with no one coming back to re-check. `buildFormPlan`/
 * `buildArrayFormPlan`'s masking decision (`spec.sensitive ??
 * SENSITIVE_KEY.test(key)`, form-plan.ts) depends only on a field's own key,
 * never its value, so walking every module's *declared* fields against a
 * minimal probe document is a complete, real check — not a sample, and not
 * re-testing the regex against itself: `EXPECTED_SENSITIVE_FIELDS` below is a
 * ground truth picked by reading each field's own schema/i18n help text for
 * what it actually stores, independent of whether `SENSITIVE_KEY` happens to
 * match its name.
 */

const OBJECT_MODULES: ReadonlyArray<{ id: string; module: SchemaModule }> = [
  { id: 'general', module: GENERAL_MODULE },
  { id: 'dns', module: DNS_MODULE },
  { id: 'sniffer', module: SNIFFER_MODULE },
  { id: 'inbound', module: INBOUND_MODULE },
];

const ARRAY_ENTRY_MODULES: ReadonlyArray<{ id: string; module: SchemaModule }> = [
  { id: 'proxies', module: PROXIES_MODULE },
  { id: 'proxy-providers', module: PROXY_PROVIDERS_MODULE },
  { id: 'proxy-groups', module: PROXY_GROUPS_MODULE },
  { id: 'rule-providers', module: RULE_PROVIDERS_MODULE },
];

/**
 * Manually reviewed, one entry per module (empty set is a real, checked
 * claim — "this module holds nothing credential-shaped" — not an omission):
 *
 * - `general.secret`: the external-controller API secret.
 * - `general.authentication`: `"user:pass"` HTTP/SOCKS inbound entries (i18n
 *   help text confirms the format) — found unmasked by this slice, fixed via
 *   `SecretTagsControl` (`packages/form-renderer/src/controls.tsx`).
 * - `proxies.password`/`uuid`/`token`/`private-key`/`obfs-password`: real
 *   per-protocol credentials. `public-key` (wireguard) is deliberately
 *   excluded — it is public by protocol design, masking it would be wrong.
 * - `proxy-providers.url`: a subscription URL (already `sensitive: true` in
 *   `ui.schema.json`, re-verified here rather than re-added).
 * - Opaque, sub-property-free blobs (`ws-opts`/`grpc-opts`/`h2-opts`/
 *   `plugin-opts`/proxy-providers' `header`) can hold secrets in practice
 *   (e.g. an Authorization header) but declare no properties for
 *   `buildFormPlan` to walk at all — a real, structural gap in what
 *   field-level masking can reach, out of this slice's scope (fixing it
 *   means modelling each blob's real shape, not a masking-audit change).
 */
const EXPECTED_SENSITIVE_FIELDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['general', new Set(['secret', 'authentication'])],
  ['dns', new Set()],
  ['sniffer', new Set()],
  ['inbound', new Set()],
  ['proxies', new Set(['password', 'uuid', 'token', 'private-key', 'obfs-password'])],
  ['proxy-providers', new Set(['url'])],
  ['proxy-groups', new Set()],
  ['rule-providers', new Set()],
]);

/**
 * Test-side-only re-derivation of `analyzeVariant`'s selection rule
 * (form-plan.ts, not exported): the first property with a string `const`
 * shared by every branch, found by flattening each branch's `allOf` + own
 * `properties`. This never decides masking — it only decides which
 * discriminator value picks each branch, so the real planner (not this
 * helper) resolves every field this test then checks.
 */
function findDiscriminatedBranchValues(schema: JsonSchema): readonly string[] {
  const branches = schema.oneOf ?? schema.anyOf;
  if (!branches || branches.length === 0) {
    throw new Error('expected a oneOf/anyOf-rooted schema');
  }
  const defs = (schema.$defs ?? {}) as Record<string, JsonSchema>;

  const resolveRef = (candidate: JsonSchema): JsonSchema => {
    if (typeof candidate.$ref === 'string') {
      const name = candidate.$ref.replace('#/$defs/', '');
      const target = defs[name];
      if (!target) throw new Error(`unresolved $ref: ${candidate.$ref}`);
      return target;
    }
    return candidate;
  };

  const flattenProperties = (candidate: JsonSchema): Record<string, JsonSchema> => {
    const resolved = resolveRef(candidate);
    const out: Record<string, JsonSchema> = {};
    for (const member of resolved.allOf ?? []) Object.assign(out, flattenProperties(member));
    Object.assign(out, resolved.properties ?? {});
    return out;
  };

  const branchProperties = branches.map(flattenProperties);
  const firstKeys = Object.keys(branchProperties[0] ?? {});

  for (const key of firstKeys) {
    const values = branchProperties.map((props) => {
      const value = props[key]?.const;
      return typeof value === 'string' ? value : undefined;
    });
    if (values.every((value): value is string => value !== undefined)) {
      return values;
    }
  }
  throw new Error('no shared const-valued discriminator property found across every branch');
}

/**
 * Every field a module plans, real-fixture-free: `sensitive` depends only on
 * a field's own key/schema, never its document value, so a minimal probe
 * document (empty for object modules, one synthetic entry per union branch
 * for array-entry modules) is a complete check.
 */
function allPlannedFields(module: SchemaModule): PlannedField[] {
  if (!isArrayEntryModule(module)) {
    return buildFormPlan(module, {}, { mode: 'advanced' }).fields;
  }

  const setAtRoot = (value: unknown): unknown =>
    [...module.manifest.root].reduceRight(
      (acc: unknown, segment) => ({ [String(segment)]: acc }),
      value,
    );

  const fields: PlannedField[] = [];
  for (const branchValue of findDiscriminatedBranchValues(module.schema)) {
    const doc = setAtRoot([{ type: branchValue }]);
    const [item] = buildArrayFormPlan(module, doc, { mode: 'advanced' });
    if (!item?.variant?.matched) {
      throw new Error(
        `${module.manifest.id}: branch "${branchValue}" did not resolve against discriminator ` +
          `key 'type' — that assumption is wrong for this module; fix ` +
          `findDiscriminatedBranchValues, do not ignore this failure`,
      );
    }
    fields.push(...flattenFields([item]));
  }
  return fields;
}

describe('every credential-shaped field across every real module is masked (NFR-SEC-02, v0.9.0 #13)', () => {
  for (const { id, module } of [...OBJECT_MODULES, ...ARRAY_ENTRY_MODULES]) {
    it(id, () => {
      const expected = EXPECTED_SENSITIVE_FIELDS.get(id);
      if (!expected) throw new Error(`no ground-truth entry for module "${id}" — add one above`);

      const actualSensitive = new Set(
        allPlannedFields(module)
          .filter((field) => field.sensitive)
          .map((field) => field.key),
      );

      expect(actualSensitive).toEqual(expected);
    });
  }
});

describe('rules/sub-rules are not form-plan-driven, so this audit does not reach them (ADR-021)', () => {
  it.each([
    ['rules', RULES_MODULE],
    ['sub-rules', SUB_RULES_MODULE],
  ] as const)(
    '%s plans zero fields through buildFormPlan (no properties to mask, ever)',
    (_id, module) => {
      expect(isArrayEntryModule(module)).toBe(false);
      expect(buildFormPlan(module, {}, { mode: 'advanced' }).fields).toHaveLength(0);
    },
  );
});
