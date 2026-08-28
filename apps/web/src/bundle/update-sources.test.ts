import { describe, expect, it } from 'vitest';

import { resolveUpdateSources } from './update-sources.js';

const STABLE_SOURCE = {
  manifestUrl: 'https://example.test/stable/manifest.json',
  fileBaseUrl: 'https://example.test/stable/files',
};
const BETA_SOURCE = {
  manifestUrl: 'https://example.test/beta/manifest.json',
  fileBaseUrl: 'https://example.test/beta/files',
};

describe('resolveUpdateSources (v0.6.0 #0)', () => {
  it('returns {} for null/undefined (no override configured)', () => {
    expect(resolveUpdateSources(null)).toEqual({});
    expect(resolveUpdateSources(undefined)).toEqual({});
  });

  it('parses a well-formed object with both channels', () => {
    const raw = JSON.stringify({ stable: STABLE_SOURCE, beta: BETA_SOURCE });
    expect(resolveUpdateSources(raw)).toEqual({ stable: STABLE_SOURCE, beta: BETA_SOURCE });
  });

  it('expresses "only stable is configured" — beta stays absent, not defaulted', () => {
    const raw = JSON.stringify({ stable: STABLE_SOURCE });
    const result = resolveUpdateSources(raw);
    expect(result).toEqual({ stable: STABLE_SOURCE });
    expect(result.beta).toBeUndefined();
  });

  it('returns {} for a string that is not valid JSON', () => {
    expect(resolveUpdateSources('not json at all')).toEqual({});
  });

  it('returns {} for valid JSON that is not a plain object', () => {
    expect(resolveUpdateSources(JSON.stringify(['stable', 'beta']))).toEqual({});
    expect(resolveUpdateSources(JSON.stringify(42))).toEqual({});
    expect(resolveUpdateSources(JSON.stringify(null))).toEqual({});
  });

  it('drops a channel entry missing a required field, keeping the other channel intact', () => {
    const raw = JSON.stringify({
      stable: STABLE_SOURCE,
      beta: { manifestUrl: 'https://example.test/beta/manifest.json' },
    });
    expect(resolveUpdateSources(raw)).toEqual({ stable: STABLE_SOURCE });
  });

  it('drops a channel entry whose fields have the wrong type', () => {
    const raw = JSON.stringify({ stable: { manifestUrl: 123, fileBaseUrl: 'https://x' } });
    expect(resolveUpdateSources(raw)).toEqual({});
  });

  it('ignores unknown top-level keys that are not a recognised channel', () => {
    const raw = JSON.stringify({ stable: STABLE_SOURCE, canary: BETA_SOURCE });
    expect(resolveUpdateSources(raw)).toEqual({ stable: STABLE_SOURCE });
  });

  it('reads the real __BUNDLE_UPDATE_SOURCES__ global by default (unset under vitest)', () => {
    expect(resolveUpdateSources()).toEqual({});
  });
});
