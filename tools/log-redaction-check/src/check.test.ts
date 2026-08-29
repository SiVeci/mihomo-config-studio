import { describe, expect, it } from 'vitest';

import {
  checkLogRedaction,
  LOG_REDACTION_ALLOWLIST,
  type LogRedactionSourceFile,
} from './check.js';

const ALLOWLISTED_PATH = LOG_REDACTION_ALLOWLIST[0]!;

function file(path: string, content: string): LogRedactionSourceFile {
  return { path, content };
}

describe('checkLogRedaction (NFR-SEC-03, v0.9.0 #6)', () => {
  it('passes an empty file list', () => {
    expect(checkLogRedaction([])).toEqual({ ok: true, violations: [] });
  });

  it('passes files with no console.* call at all', () => {
    const result = checkLogRedaction([file('apps/web/src/App.tsx', 'export function noop() {}')]);
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it.each(['log', 'debug', 'info', 'warn', 'error', 'trace'] as const)(
    'rejects a console.%s( call outside the allowlist',
    (method) => {
      const result = checkLogRedaction([
        file('apps/web/src/App.tsx', `console.${method}('leaked');`),
      ]);
      expect(result).toEqual({
        ok: false,
        violations: [
          {
            path: 'apps/web/src/App.tsx',
            reason: expect.stringContaining('NFR-SEC-03'),
          },
        ],
      });
    },
  );

  it('tolerates whitespace around the dot and before the call parenthesis', () => {
    const result = checkLogRedaction([file('apps/web/src/App.tsx', 'console . warn ( "x" ) ;')]);
    expect(result.ok).toBe(false);
  });

  it('exempts .test.ts and .test.tsx files from the scan', () => {
    const result = checkLogRedaction([
      file('apps/web/src/App.test.ts', "console.log('x');"),
      file('apps/web/src/App.test.tsx', "console.log('x');"),
    ]);
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('accepts every console method in the allowlisted file (packages/logging/src/logger.ts)', () => {
    const result = checkLogRedaction([
      file(
        ALLOWLISTED_PATH,
        'console.debug(m); console.info(m); console.warn(m); console.error(m);',
      ),
    ]);
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('does not let a near-miss path (e.g. after a rename) inherit the allowlist entry', () => {
    const result = checkLogRedaction([
      file('packages/logging/src/logger2.ts', "console.log('x');"),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { path: 'packages/logging/src/logger2.ts', reason: expect.stringContaining('NFR-SEC-03') },
    ]);
  });

  it('reports every violation across multiple files, not just the first', () => {
    const result = checkLogRedaction([
      file('apps/web/src/one.ts', "console.log('a');"),
      file('packages/b/src/two.ts', "console.error('b');"),
      file('packages/c/src/clean.ts', 'export const noop = () => {};'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations.map((violation) => violation.path)).toEqual([
      'apps/web/src/one.ts',
      'packages/b/src/two.ts',
    ]);
  });
});
