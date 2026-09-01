import { describe, expect, it } from 'vitest';

import { checkEgress, EGRESS_ALLOWLIST, type EgressSourceFile } from './check.js';

const ALLOWLISTED_PATH = EGRESS_ALLOWLIST[0]!;

function file(path: string, content: string): EgressSourceFile {
  return { path, content };
}

describe('checkEgress (NFR-SEC-01, v0.5.0 #3)', () => {
  // v0.9.0 #13's full NFR-SEC-01 re-check: the four negative cases below
  // (unchanged since v0.5.0 #3) plus this one both still hold as of this
  // slice. A real scan of the current `packages/` tree — the part this
  // in-memory assertion cannot cover, since `EGRESS_ALLOWLIST` matching
  // depends on the exact `rootDir` a caller passes `run()` — was re-run by
  // hand as this slice's own acceptance command
  // (`node tools/egress-check/dist/index.js packages`) and reported zero
  // violations; see the traceability doc's NFR-SEC-01 row for that result.
  it('still allowlists exactly one file, and it is still updater.ts (not a second entry someone added instead of asking)', () => {
    expect(EGRESS_ALLOWLIST).toEqual(['packages/schema-registry/src/updater.ts']);
  });

  it('passes an empty file list', () => {
    expect(checkEgress([])).toEqual({ ok: true, violations: [] });
  });

  it('passes files with no network-call symbols at all', () => {
    const result = checkEgress([
      file('packages/config-model/src/entity.ts', 'export function noop() {}'),
    ]);
    expect(result).toEqual({ ok: true, violations: [] });
  });

  // The four original negative cases the previous inline CI grep covered —
  // preserved as tests so the replacement tool is proven to still catch them.
  it('rejects a fetch( call outside the allowlist', () => {
    const result = checkEgress([
      file('packages/validator/src/pipeline.ts', 'export async function f() { await fetch(url); }'),
    ]);
    expect(result).toEqual({
      ok: false,
      violations: [
        {
          path: 'packages/validator/src/pipeline.ts',
          reason: 'network call symbol found outside the egress allowlist (NFR-SEC-01)',
        },
      ],
    });
  });

  it('rejects an XMLHttpRequest( call outside the allowlist', () => {
    const result = checkEgress([
      file('packages/validator/src/pipeline.ts', 'const req = new XMLHttpRequest();'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.path).toBe('packages/validator/src/pipeline.ts');
  });

  it('rejects a WebSocket( call outside the allowlist', () => {
    const result = checkEgress([
      file('packages/validator/src/pipeline.ts', 'const socket = new WebSocket(url);'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it('rejects a navigator.sendBeacon( call outside the allowlist', () => {
    const result = checkEgress([
      file('packages/validator/src/pipeline.ts', 'navigator.sendBeacon(url, data);'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it("exempts test files from the scan, mirroring the previous grep -v '\\.test\\.ts' behaviour", () => {
    const result = checkEgress([
      file('packages/validator/src/pipeline.test.ts', 'await fetch(url);'),
      file('packages/validator/src/pipeline.test.tsx', 'await fetch(url);'),
    ]);
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('accepts a bodyless GET fetch in the allowlisted file', () => {
    const result = checkEgress([file(ALLOWLISTED_PATH, "await fetch(url, { method: 'GET' });")]);
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('accepts a bare fetch with no options object in the allowlisted file (defaults to GET)', () => {
    const result = checkEgress([file(ALLOWLISTED_PATH, 'await fetch(url);')]);
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('rejects a fetch carrying a body, even in the allowlisted file', () => {
    const result = checkEgress([
      file(ALLOWLISTED_PATH, "await fetch(url, { method: 'POST', body: JSON.stringify(x) });"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      {
        path: ALLOWLISTED_PATH,
        reason:
          'fetch call includes a body option — updater requests must never upload configuration (NFR-SEC-01)',
      },
    ]);
  });

  it('rejects a fetch using a non-GET method, even without a body', () => {
    const result = checkEgress([file(ALLOWLISTED_PATH, "await fetch(url, { method: 'HEAD' });")]);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { path: ALLOWLISTED_PATH, reason: 'fetch call uses a method other than GET' },
    ]);
  });

  it('does not let a near-miss path (e.g. after a rename) inherit the allowlist entry', () => {
    // Simulates updater.ts having been renamed without updating the
    // allowlist: the real file, at its new path, is not exactly the
    // allowlisted string, so it is treated like any other unauthorized file.
    const result = checkEgress([
      file('packages/schema-registry/src/updater2.ts', 'await fetch(url);'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      {
        path: 'packages/schema-registry/src/updater2.ts',
        reason: 'network call symbol found outside the egress allowlist (NFR-SEC-01)',
      },
    ]);
  });

  it('reports every violation across multiple files, not just the first', () => {
    const result = checkEgress([
      file('packages/a/src/one.ts', 'await fetch(url);'),
      file('packages/b/src/two.ts', 'new WebSocket(url);'),
      file('packages/c/src/clean.ts', 'export const noop = () => {};'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.path)).toEqual([
      'packages/a/src/one.ts',
      'packages/b/src/two.ts',
    ]);
  });
});
