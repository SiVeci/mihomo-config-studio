import type { SchemaModule, UiFieldSpec } from '@mcs/schema-core';
import { describe, expect, it } from 'vitest';

import {
  DNS_MODULE,
  GENERAL_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  PROXY_PROVIDERS_MODULE,
  SNIFFER_MODULE,
} from './index.js';

/**
 * FR-SCHEMA-04, v0.3.0 #18: every field across all six P0 modules must carry
 * its metadata, checked here field-by-field rather than sampled — a new
 * field with no metadata filled in fails immediately instead of quietly
 * shipping.
 *
 * Completeness is tiered, not uniform (matching the version plan's own
 * criteria, and what a real audit of the six modules actually found):
 *
 * - `docs` and `safety`: **required on every field, no exceptions**. Every
 *   field across all six modules already carries both as of this slice —
 *   confirmed by exhaustive walk, not spot-checked — so this is a pure
 *   regression fence, not new data entry.
 * - `since` / `deprecatedSince`: **not required anywhere right now**. Neither
 *   `packages/test-fixtures/src/upstream.ts` (the frozen P0 field list, #3)
 *   nor any `config.schema.json` in this repo records a field's introduction
 *   or deprecation version for *any* of the six modules' P0 fields, and this
 *   version's own compatibility profile (ADR-012) pins a single Mihomo
 *   version rather than a range — there is nothing true to write yet, and
 *   the version plan explicitly forbids inventing one. What *is* checked:
 *   the two are only ever meaningful together (a deprecation notice with no
 *   version and no replacement is not actionable), so if either is set the
 *   other must be too.
 * - `platforms`: **opt-in, never required**. Only genuinely platform-scoped
 *   fields declare it (`inbound`'s four `tun.*` fields, already covered by
 *   `builtin.test.ts`'s own platform-visibility assertions) — requiring it
 *   everywhere would be wrong, not just unnecessary.
 * - `replacedBy`: **only checked when present** — must name a real field
 *   (by its own bare key) somewhere in the same module, so a deprecation
 *   hint can never point at something that does not exist. No field
 *   currently sets it (nothing is deprecated yet); the assertion exists so
 *   the first one that does gets it right.
 *
 * Per-module "all four example kinds present, path resolves on disk" (the
 * `examples` part of FR-SCHEMA-04) is *not* duplicated here — it already has
 * full six-module coverage in `builtin.test.ts` (`describe.each(MODULES)`
 * for general/dns/sniffer/inbound, plus PROXIES_MODULE's and
 * PROXY_PROVIDERS_MODULE's own describe blocks), predating this slice.
 */

const MODULES: ReadonlyArray<{ id: string; module: SchemaModule }> = [
  { id: 'general', module: GENERAL_MODULE },
  { id: 'dns', module: DNS_MODULE },
  { id: 'sniffer', module: SNIFFER_MODULE },
  { id: 'inbound', module: INBOUND_MODULE },
  { id: 'proxies', module: PROXIES_MODULE },
  { id: 'proxy-providers', module: PROXY_PROVIDERS_MODULE },
];

interface CollectedField {
  /** Dotted path from the module's own `ui.fields` root, e.g. `health-check.enable`. */
  path: string;
  key: string;
  spec: UiFieldSpec;
}

/**
 * Every field a module's `ui.schema.json` declares, walked depth-first
 * through nested `fields` (object children) and `item.fields` (array
 * element children — unused by any of the six modules today, walked anyway
 * so a future module that does use it is not a silent blind spot).
 */
function collectFields(
  fields: Record<string, UiFieldSpec> | undefined,
  prefix: string,
  out: CollectedField[],
): void {
  if (!fields) return;
  for (const [key, spec] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push({ path, key, spec });
    if (spec.fields) collectFields(spec.fields, path, out);
    if (spec.item?.fields) collectFields(spec.item.fields, `${path}[]`, out);
  }
}

describe.each(MODULES)('$id module field metadata (FR-SCHEMA-04, v0.3.0 #18)', ({ id, module }) => {
  const fields: CollectedField[] = [];
  collectFields(module.ui.fields, '', fields);

  it('declares at least one field — an empty module would make every row below vacuously pass', () => {
    expect(fields.length).toBeGreaterThan(0);
  });

  it.each(fields.map((field) => [field.path, field] as const))(
    '%s has both docs and a safety level',
    (_path, field) => {
      expect(field.spec.docs, `${id}.${field.path} is missing docs`).toBeDefined();
      expect(field.spec.safety, `${id}.${field.path} is missing safety`).toBeDefined();
    },
  );

  it.each(
    fields
      .filter((field) => field.spec.docs !== undefined)
      .map((field) => [field.path, field] as const),
  )(
    '%s’s docs URL is on the official wiki domain and carries no query string (NFR-SEC-03 boundary)',
    (_path, field) => {
      const url = new URL(field.spec.docs!);
      expect(url.hostname, `${id}.${field.path}`).toBe('wiki.metacubex.one');
      expect(url.search, `${id}.${field.path}`).toBe('');
    },
  );

  it('every replacedBy points to a real field declared in this same module', () => {
    const knownKeys = new Set(fields.map((field) => field.key));
    const offenders = fields
      .filter(
        (field) => field.spec.replacedBy !== undefined && !knownKeys.has(field.spec.replacedBy),
      )
      .map((field) => `${field.path} -> ${field.spec.replacedBy}`);
    expect(offenders).toEqual([]);
  });

  it('deprecatedSince and replacedBy are only ever meaningful together — neither is set without the other', () => {
    const offenders = fields
      .filter(
        (field) =>
          (field.spec.deprecatedSince !== undefined) !== (field.spec.replacedBy !== undefined),
      )
      .map((field) => field.path);
    expect(offenders).toEqual([]);
  });
});
