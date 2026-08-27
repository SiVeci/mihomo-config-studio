import { describe, expect, it } from 'vitest';

import { BUILTIN_MANIFEST } from './builtin.js';
import { isBundleManifest, validateBundleManifest, type BundleManifest } from './manifest.js';

function valid(): BundleManifest {
  return { ...BUILTIN_MANIFEST, files: [...BUILTIN_MANIFEST.files] };
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

describe('BundleManifest structural validation (FR-UPD-01)', () => {
  it('accepts the built-in bundle manifest', () => {
    expect(validateBundleManifest(BUILTIN_MANIFEST)).toEqual([]);
    expect(isBundleManifest(BUILTIN_MANIFEST)).toBe(true);
  });

  it('rejects a non-object value entirely', () => {
    expect(validateBundleManifest('not-a-manifest')).toEqual([
      { code: 'BUNDLE_MANIFEST_INVALID_TYPE', path: '$' },
    ]);
    expect(validateBundleManifest(null)).toEqual([
      { code: 'BUNDLE_MANIFEST_INVALID_TYPE', path: '$' },
    ]);
    expect(validateBundleManifest([1, 2, 3])).toEqual([
      { code: 'BUNDLE_MANIFEST_INVALID_TYPE', path: '$' },
    ]);
  });

  it('rejects a manifest missing formatVersion', () => {
    expect(isBundleManifest(omit(valid(), 'formatVersion'))).toBe(false);
    expect(validateBundleManifest(omit(valid(), 'formatVersion'))).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'formatVersion',
    });
  });

  it('rejects a manifest with the wrong type for formatVersion', () => {
    expect(validateBundleManifest({ ...valid(), formatVersion: '1' })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'formatVersion',
    });
  });

  it('rejects a non-integer or negative formatVersion', () => {
    expect(validateBundleManifest({ ...valid(), formatVersion: 1.5 })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'formatVersion',
    });
    expect(validateBundleManifest({ ...valid(), formatVersion: -1 })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'formatVersion',
    });
  });

  it('rejects a manifest missing requiresApp', () => {
    expect(validateBundleManifest(omit(valid(), 'requiresApp'))).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'requiresApp',
    });
  });

  it('rejects a manifest with the wrong type for requiresApp', () => {
    expect(validateBundleManifest({ ...valid(), requiresApp: 100 })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'requiresApp',
    });
  });

  it('rejects an empty string for a required string field', () => {
    expect(validateBundleManifest({ ...valid(), bundleId: '' })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'bundleId',
    });
  });

  it('rejects a missing or mistyped version, signature and signedAt', () => {
    expect(validateBundleManifest(omit(valid(), 'version'))).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'version',
    });
    expect(validateBundleManifest({ ...valid(), signature: 42 })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'signature',
    });
    expect(validateBundleManifest(omit(valid(), 'signedAt'))).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'signedAt',
    });
  });

  it('rejects a missing channel and an unknown channel value', () => {
    expect(validateBundleManifest(omit(valid(), 'channel'))).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'channel',
    });
    expect(validateBundleManifest({ ...valid(), channel: 'nightly' })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'channel',
    });
    expect(validateBundleManifest({ ...valid(), channel: 'beta' })).toEqual([]);
  });

  it('rejects a missing or non-array files field', () => {
    expect(validateBundleManifest(omit(valid(), 'files'))).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'files',
    });
    expect(validateBundleManifest({ ...valid(), files: 'nope' })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'files',
    });
  });

  it('accepts an empty files list but rejects a malformed entry', () => {
    expect(validateBundleManifest({ ...valid(), files: [] })).toEqual([]);

    expect(validateBundleManifest({ ...valid(), files: ['not-an-object'] })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'files[0]',
    });
    expect(validateBundleManifest({ ...valid(), files: [{ path: 'a.json' }] })).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'files[0].sha256',
    });
    expect(validateBundleManifest({ ...valid(), files: [{ sha256: 'abc' }] })).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'files[0].path',
    });
  });

  it('reports every violation at once rather than stopping at the first', () => {
    const issues = validateBundleManifest({});
    const paths = issues.map((issue) => issue.path).sort();
    expect(paths).toEqual(
      [
        'bundleId',
        'version',
        'channel',
        'formatVersion',
        'requiresApp',
        'mihomo',
        'files',
        'signature',
        'signedAt',
      ].sort(),
    );
    expect(issues.every((issue) => issue.code === 'BUNDLE_MANIFEST_MISSING_FIELD')).toBe(true);
  });

  it('rejects a manifest missing the mihomo block entirely', () => {
    expect(validateBundleManifest(omit(valid(), 'mihomo'))).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'mihomo',
    });
  });

  it('rejects a mihomo block that is not an object', () => {
    expect(validateBundleManifest({ ...valid(), mihomo: 'v1.19.29' })).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'mihomo',
    });
  });

  it('rejects a mihomo block missing or mistyping any of its four fields', () => {
    const { mihomo, ...rest } = valid();
    expect(validateBundleManifest({ ...rest, mihomo: omit(mihomo, 'minVersion') })).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'mihomo.minVersion',
    });
    expect(
      validateBundleManifest({ ...rest, mihomo: { ...mihomo, maxTestedVersion: 42 } }),
    ).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'mihomo.maxTestedVersion',
    });
    expect(
      validateBundleManifest({ ...rest, mihomo: omit(mihomo, 'upstreamCommit') }),
    ).toContainEqual({
      code: 'BUNDLE_MANIFEST_MISSING_FIELD',
      path: 'mihomo.upstreamCommit',
    });
    expect(
      validateBundleManifest({ ...rest, mihomo: { ...mihomo, docsSnapshot: '' } }),
    ).toContainEqual({
      code: 'BUNDLE_MANIFEST_INVALID_TYPE',
      path: 'mihomo.docsSnapshot',
    });
  });
});
