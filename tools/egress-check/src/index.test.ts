import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { run } from './index.js';

const tempDirs: string[] = [];

function makeSourceDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'egress-check-test-'));
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

describe('run (v0.5.0 #3)', () => {
  it('returns 0 and logs success for a clean tree', () => {
    const sourceDir = makeSourceDir({
      'schema-core/src/types.ts': 'export interface Foo { bar: string }',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = run(sourceDir);

    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No network egress found'));
    logSpy.mockRestore();
  });

  it('returns 1 and prints every violation for a tree with unauthorized network calls', () => {
    const sourceDir = makeSourceDir({
      'validator/src/pipeline.ts': 'await fetch(url);',
      'validator/src/socket.ts': 'new WebSocket(url);',
      'validator/src/pipeline.test.ts': 'await fetch(url); // exempt, this is a test file',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = run(sourceDir);

    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('ignores non-.ts/.tsx files entirely', () => {
    const sourceDir = makeSourceDir({
      'notes.md': 'call fetch(url) right here in prose',
      'schema-core/src/types.ts': 'export const noop = () => {};',
    });

    expect(run(sourceDir)).toBe(0);
  });

  it('scans nested directories recursively', () => {
    const sourceDir = makeSourceDir({
      'a/b/c/deep.ts': 'await fetch(url);',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = run(sourceDir);

    expect(exitCode).toBe(1);
    errorSpy.mockRestore();
  });

  it('never descends into a dist/ build output directory', () => {
    // A source doc comment mentioning "fetch(" can end up copied into a
    // compiled .d.ts file's leading comment — dist/ must never be scanned,
    // or a local `tsc -b` run before this tool would false-positive.
    const sourceDir = makeSourceDir({
      'schema-registry/src/updater.ts': 'export const noop = () => {};',
      'schema-registry/dist/updater.d.ts': '/** calls the real fetch( here */',
    });

    expect(run(sourceDir)).toBe(0);
  });

  it('never descends into a node_modules/ directory', () => {
    const sourceDir = makeSourceDir({
      'schema-registry/src/clean.ts': 'export const noop = () => {};',
      'node_modules/some-dep/index.ts': 'await fetch(url);',
    });

    expect(run(sourceDir)).toBe(0);
  });

  it('ignores .d.ts declaration files even outside a dist/-named directory', () => {
    const sourceDir = makeSourceDir({
      'schema-registry/types/updater.d.ts': '/** calls the real fetch( here */',
    });

    expect(run(sourceDir)).toBe(0);
  });
});
