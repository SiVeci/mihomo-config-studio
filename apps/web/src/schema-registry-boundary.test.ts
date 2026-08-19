import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * FR-SCHEMA-05: "a page can register a module via the Registry without a
 * central page edit." That is a design intent until it is checkable — this
 * turns it into a fact by asserting no file under `apps/web/src` hardcodes
 * one of the P0 module ids as a string literal. The only legitimate way to
 * learn a module's id is to read it off a `SchemaModule` the Registry
 * (`@mcs/schema-registry`'s `createRegistry`) produced.
 *
 * Same technique as `worker/client.test.ts`'s "main-thread module boundary"
 * static scan: a text search over source, not a full AST parse — a
 * heuristic that is cheap, has stayed accurate there, and needs no new
 * dependency here (`apps/web` does not consume `@mcs/schema-registry` at all
 * yet; this is a regression fence for when #14 makes it do so).
 */
const SRC_ROOT = dirname(fileURLToPath(import.meta.url));

// PRD §8.3's six P0 modules (v0.3.0 #6-#11). Quoted on both sides and
// nothing else inside the quotes, so an i18n key like 'general.mode' or an
// unrelated word inside a longer literal does not false-positive.
const MODULE_IDS = ['general', 'dns', 'sniffer', 'inbound', 'proxies', 'proxy-providers'];
const FORBIDDEN_LITERALS = MODULE_IDS.flatMap((id) => [`'${id}'`, `"${id}"`]);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
    out.push(full);
  }
  return out;
}

describe('no hardcoded Schema module id (FR-SCHEMA-05)', () => {
  it('never hardcodes a P0 module id as a string literal anywhere under apps/web/src', () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((file) => {
        const content = readFileSync(file, 'utf8');
        return FORBIDDEN_LITERALS.some((literal) => content.includes(literal));
      })
      .map((file) => relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
