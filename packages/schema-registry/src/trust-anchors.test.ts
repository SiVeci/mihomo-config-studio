import { describe, expect, it } from 'vitest';

import { BUILTIN_TRUST_ANCHORS_HEX } from './builtin.js';
import { generateTestKeyPair } from './testing/keys.js';
import { resolveTrustAnchors } from './trust-anchors.js';
import { bytesToHex, hexToBytes } from './verify.js';

// BUILTIN_TRUST_ANCHORS_HEX always has at least one entry (the bootstrap key).
const BUILTIN_ANCHOR = hexToBytes(BUILTIN_TRUST_ANCHORS_HEX[0]!);

describe('resolveTrustAnchors (v0.5.0 #0, ADR-010 §3)', () => {
  it('with no override, returns the built-in bootstrap anchor and no warnings', () => {
    const result = resolveTrustAnchors();

    expect(result.warnings).toEqual([]);
    expect(result.anchors).toEqual([BUILTIN_ANCHOR]);
  });

  it('with a valid override, returns the override keys instead of the built-in one', async () => {
    const current = await generateTestKeyPair();
    const next = await generateTestKeyPair();

    const result = resolveTrustAnchors([
      bytesToHex(current.publicKeyRaw),
      bytesToHex(next.publicKeyRaw),
    ]);

    expect(result.warnings).toEqual([]);
    expect(result.anchors).toEqual([current.publicKeyRaw, next.publicKeyRaw]);
  });

  it('falls back to the built-in anchor (never an empty array) when the override is an empty array', () => {
    const result = resolveTrustAnchors([]);

    expect(result.anchors).toEqual([BUILTIN_ANCHOR]);
    expect(result.warnings).toEqual([{ code: 'TRUST_ANCHOR_OVERRIDE_FALLBACK' }]);
  });

  it('falls back to the built-in anchor when every override entry is malformed hex', () => {
    const result = resolveTrustAnchors(['not-hex-at-all']);

    expect(result.anchors).toEqual([BUILTIN_ANCHOR]);
    expect(result.warnings).toEqual([
      { code: 'TRUST_ANCHOR_INVALID_HEX', index: 0 },
      { code: 'TRUST_ANCHOR_OVERRIDE_FALLBACK' },
    ]);
  });

  it('falls back to the built-in anchor when every override entry has an odd hex length', () => {
    const result = resolveTrustAnchors(['abc']);

    expect(result.warnings).toEqual([
      { code: 'TRUST_ANCHOR_INVALID_HEX', index: 0 },
      { code: 'TRUST_ANCHOR_OVERRIDE_FALLBACK' },
    ]);
  });

  it('falls back to the built-in anchor when every override entry decodes to the wrong byte length', () => {
    const result = resolveTrustAnchors(['ab']);

    expect(result.anchors).toEqual([BUILTIN_ANCHOR]);
    expect(result.warnings).toEqual([
      { code: 'TRUST_ANCHOR_INVALID_LENGTH', index: 0 },
      { code: 'TRUST_ANCHOR_OVERRIDE_FALLBACK' },
    ]);
  });

  it('skips a bad entry and keeps a good one, without falling back to the built-in anchor', async () => {
    const good = await generateTestKeyPair();

    const result = resolveTrustAnchors(['zz', bytesToHex(good.publicKeyRaw)]);

    expect(result.anchors).toEqual([good.publicKeyRaw]);
    expect(result.warnings).toEqual([{ code: 'TRUST_ANCHOR_INVALID_HEX', index: 0 }]);
  });
});
