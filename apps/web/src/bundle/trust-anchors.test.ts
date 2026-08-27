import { describe, expect, it } from 'vitest';

import { BUNDLE_TRUST_ANCHORS, parseOverride } from './trust-anchors.js';

describe('parseOverride (v0.5.0 #10, decision F4)', () => {
  it('returns undefined for null/undefined (no override configured)', () => {
    expect(parseOverride(null)).toBeUndefined();
    expect(parseOverride(undefined)).toBeUndefined();
  });

  it('parses a well-formed JSON array of hex strings', () => {
    const raw = JSON.stringify(['aa'.repeat(32), 'bb'.repeat(32)]);
    expect(parseOverride(raw)).toEqual(['aa'.repeat(32), 'bb'.repeat(32)]);
  });

  it('returns undefined for a string that is not valid JSON', () => {
    expect(parseOverride('not json at all')).toBeUndefined();
  });

  it('returns undefined for valid JSON that is not an array', () => {
    expect(parseOverride(JSON.stringify({ not: 'an array' }))).toBeUndefined();
  });

  it('returns undefined for an array containing a non-string entry', () => {
    expect(parseOverride(JSON.stringify(['aa'.repeat(32), 42]))).toBeUndefined();
  });

  it('returns an empty array as-is — resolveTrustAnchors is what falls back for an empty override, not this parser', () => {
    expect(parseOverride('[]')).toEqual([]);
  });
});

describe('BUNDLE_TRUST_ANCHORS', () => {
  it('resolves to a non-empty anchor list by the time this module is imported (no override configured under vitest)', () => {
    expect(BUNDLE_TRUST_ANCHORS.anchors.length).toBeGreaterThan(0);
    expect(BUNDLE_TRUST_ANCHORS.warnings).toEqual([]);
  });
});
