import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { run } from './index.js';

const tempDirs: string[] = [];

function makeSourceDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'log-redaction-check-test-'));
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

describe('run (v0.9.0 #6)', () => {
  it('returns 0 and logs success for a clean tree', () => {
    const sourceDir = makeSourceDir({ 'App.tsx': 'export function noop() {}' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = run(sourceDir);

    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No direct console.* call'));
    logSpy.mockRestore();
  });

  it('returns 1 and prints every violation for a tree with unauthorized console calls', () => {
    const sourceDir = makeSourceDir({
      'App.tsx': "console.log('a');",
      'other.ts': "console.warn('b');",
      'App.test.tsx': "console.log('exempt, this is a test file');",
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = run(sourceDir);

    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it('ignores non-.ts/.tsx files entirely', () => {
    const sourceDir = makeSourceDir({
      'notes.md': 'call console.log(x) right here in prose',
      'clean.ts': 'export const noop = () => {};',
    });

    expect(run(sourceDir)).toBe(0);
  });

  it('scans nested directories recursively', () => {
    const sourceDir = makeSourceDir({ 'a/b/c/deep.ts': "console.error('x');" });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = run(sourceDir);

    expect(exitCode).toBe(1);
    errorSpy.mockRestore();
  });

  it('never descends into a dist/ build output directory', () => {
    const sourceDir = makeSourceDir({
      'src/clean.ts': 'export const noop = () => {};',
      'dist/clean.d.ts': '/** calls console.log( here */',
    });

    expect(run(sourceDir)).toBe(0);
  });

  it('never descends into a node_modules/ directory', () => {
    const sourceDir = makeSourceDir({
      'src/clean.ts': 'export const noop = () => {};',
      'node_modules/some-dep/index.ts': "console.log('x');",
    });

    expect(run(sourceDir)).toBe(0);
  });

  it('ignores .d.ts declaration files even outside a dist/-named directory', () => {
    const sourceDir = makeSourceDir({
      'types/global.d.ts': "declare const x: 'console.log(oops)';",
    });

    expect(run(sourceDir)).toBe(0);
  });
});
