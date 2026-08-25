import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_ROOT = resolve(here, '..', 'fixtures');

/** Read a fixture verbatim. No normalisation — byte fidelity is the point. */
export function readFixture(relativePath: string): string {
  return readFileSync(join(FIXTURES_ROOT, relativePath), 'utf8');
}

export function listFixtures(relativeDir: string): string[] {
  return readdirSync(join(FIXTURES_ROOT, relativeDir))
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort();
}

export { generateLargeCorpus } from './generate-large.js';
export type { LargeCorpusOptions } from './generate-large.js';

export {
  P0_MODULE_IDS,
  P0_PROTOCOLS,
  UPSTREAM_P0_FIELDS,
  UPSTREAM_RULE_PROVIDER_CONSTRAINTS,
  UPSTREAM_RULE_TYPES,
  UPSTREAM_SOURCE,
} from './upstream.js';
export type {
  P0ModuleId,
  P0Protocol,
  RuleProviderConstraint,
  UpstreamFieldRecord,
  UpstreamRuleTypeRecord,
} from './upstream.js';
