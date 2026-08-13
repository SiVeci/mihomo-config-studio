import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findManifests, run } from './index.js';

describe('findManifests / run', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'android-manifest-check-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds a nested AndroidManifest.xml', () => {
    const nested = join(dir, 'app', 'src', 'main');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'AndroidManifest.xml'), '<manifest />');

    const found = findManifests(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('AndroidManifest.xml');
  });

  it('returns an empty array when no manifest exists', () => {
    expect(findManifests(dir)).toEqual([]);
  });

  it('returns 0 for a clean manifest', () => {
    const nested = join(dir, 'app', 'src', 'main');
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, 'AndroidManifest.xml'),
      '<manifest><uses-permission android:name="android.permission.INTERNET" /></manifest>',
    );

    expect(run(dir)).toBe(0);
  });

  it('returns 1 for a manifest declaring BIND_VPN_SERVICE', () => {
    const nested = join(dir, 'app', 'src', 'main');
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, 'AndroidManifest.xml'),
      '<manifest><uses-permission android:name="android.permission.BIND_VPN_SERVICE" /></manifest>',
    );

    expect(run(dir)).toBe(1);
  });

  it('returns 1 when no manifest is found under rootDir', () => {
    expect(run(dir)).toBe(1);
  });

  it('scans every manifest found and fails if any one violates', () => {
    const main = join(dir, 'app', 'src', 'main');
    const debug = join(dir, 'app', 'src', 'debug');
    mkdirSync(main, { recursive: true });
    mkdirSync(debug, { recursive: true });
    writeFileSync(join(main, 'AndroidManifest.xml'), '<manifest></manifest>');
    writeFileSync(
      join(debug, 'AndroidManifest.xml'),
      '<manifest><uses-permission android:name="android.permission.FOREGROUND_SERVICE" /></manifest>',
    );

    expect(run(dir)).toBe(1);
  });
});
