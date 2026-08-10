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
