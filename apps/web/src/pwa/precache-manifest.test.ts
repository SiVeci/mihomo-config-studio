import { describe, expect, it } from 'vitest';

import { isPrecacheManifest } from './precache-manifest.js';

describe('isPrecacheManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(isPrecacheManifest({ buildId: '123', files: ['/index.html', '/assets/main.js'] })).toBe(
      true,
    );
  });

  it('accepts an empty file list', () => {
    expect(isPrecacheManifest({ buildId: '123', files: [] })).toBe(true);
  });

  it('rejects null and non-objects', () => {
    expect(isPrecacheManifest(null)).toBe(false);
    expect(isPrecacheManifest('not an object')).toBe(false);
    expect(isPrecacheManifest(42)).toBe(false);
  });

  it('rejects a missing or non-string buildId', () => {
    expect(isPrecacheManifest({ files: [] })).toBe(false);
    expect(isPrecacheManifest({ buildId: 123, files: [] })).toBe(false);
  });

  it('rejects a missing or non-array files field', () => {
    expect(isPrecacheManifest({ buildId: '123' })).toBe(false);
    expect(isPrecacheManifest({ buildId: '123', files: 'not an array' })).toBe(false);
  });

  it('rejects a files array containing a non-string entry', () => {
    expect(isPrecacheManifest({ buildId: '123', files: ['/ok.js', 42] })).toBe(false);
  });
});
