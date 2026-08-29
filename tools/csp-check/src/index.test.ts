import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EXPECTED_HEADER_CSP, EXPECTED_META_CSP } from './check.js';
import { run } from './index.js';

const tempDirs: string[] = [];

function makeDistDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'csp-check-test-'));
  tempDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CLEAN_INDEX_HTML = `<!doctype html>
<html>
  <head>
    <meta
      http-equiv="Content-Security-Policy"
      content="${EXPECTED_META_CSP}"
    />
    <script type="module" src="/assets/main-abc.js"></script>
  </head>
  <body></body>
</html>
`;
const CLEAN_HEADERS = `/*\n  Content-Security-Policy: ${EXPECTED_HEADER_CSP}\n`;

describe('run', () => {
  it('returns 0 and logs success for a clean build directory', () => {
    const distDir = makeDistDir({ 'index.html': CLEAN_INDEX_HTML, _headers: CLEAN_HEADERS });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(run(distDir)).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('OK'));
    logSpy.mockRestore();
  });

  it('returns 1 and prints every violation for a directory with a mismatched policy', () => {
    const distDir = makeDistDir({
      'index.html': CLEAN_INDEX_HTML.replace(EXPECTED_META_CSP, "default-src 'self';"),
      _headers: CLEAN_HEADERS,
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(run(distDir)).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CSP_CHECK_POLICY_MISMATCH'));
    errorSpy.mockRestore();
  });

  it('throws (does not silently pass) when _headers is entirely absent from the build output', () => {
    const distDir = makeDistDir({ 'index.html': CLEAN_INDEX_HTML });
    expect(() => run(distDir)).toThrow();
  });
});

// A test against the real `apps/web/dist` build output is deliberately not
// part of this suite: unlike `tools/schema-cli`'s equivalent test (which
// reads a *source* directory that is always present in a checkout),
// `apps/web/dist` is a gitignored build artefact that only exists after
// `pnpm run build` — `pnpm run check`/`pnpm run test` must stay runnable
// (and green) in a fresh checkout with no build step run yet. The real
// build's output is verified by this slice's own second acceptance command
// (`pnpm run build && ... && node tools/csp-check/dist/index.js apps/web/dist`),
// not by a permanent unit test here.
