import { describe, expect, it } from 'vitest';

import { detectMissingCapabilities, type CapabilityProbeGlobal } from './capabilities.js';

const FULLY_CAPABLE: CapabilityProbeGlobal = {
  indexedDB: {},
  Worker: class {},
  crypto: { subtle: {} },
  String: { prototype: { replaceAll: () => '' } },
  Array: { prototype: { at: () => undefined } },
  Object: { hasOwn: () => false },
};

describe('detectMissingCapabilities (ADR-027)', () => {
  it('returns an empty array when every capability is present', () => {
    expect(detectMissingCapabilities(FULLY_CAPABLE)).toEqual([]);
  });

  it('reports indexedDB missing', () => {
    const { indexedDB: _indexedDB, ...rest } = FULLY_CAPABLE;
    expect(detectMissingCapabilities(rest)).toEqual(['indexedDB']);
  });

  it('reports Worker missing', () => {
    const { Worker: _Worker, ...rest } = FULLY_CAPABLE;
    expect(detectMissingCapabilities(rest)).toEqual(['Worker']);
  });

  it('reports crypto.subtle missing when crypto itself is absent', () => {
    const { crypto: _crypto, ...rest } = FULLY_CAPABLE;
    expect(detectMissingCapabilities(rest)).toEqual(['crypto.subtle']);
  });

  it('reports crypto.subtle missing when crypto exists but subtle does not', () => {
    expect(detectMissingCapabilities({ ...FULLY_CAPABLE, crypto: {} })).toEqual(['crypto.subtle']);
  });

  it('reports String.prototype.replaceAll missing when it is not a function', () => {
    expect(
      detectMissingCapabilities({
        ...FULLY_CAPABLE,
        String: { prototype: { replaceAll: undefined } },
      }),
    ).toEqual(['String.prototype.replaceAll']);
  });

  it('reports Array.prototype.at missing when it is not a function', () => {
    expect(
      detectMissingCapabilities({ ...FULLY_CAPABLE, Array: { prototype: { at: undefined } } }),
    ).toEqual(['Array.prototype.at']);
  });

  it('reports Object.hasOwn missing when it is not a function', () => {
    expect(detectMissingCapabilities({ ...FULLY_CAPABLE, Object: { hasOwn: undefined } })).toEqual([
      'Object.hasOwn',
    ]);
  });

  it('reports every missing capability at once, in declaration order, for a bare object', () => {
    expect(detectMissingCapabilities({})).toEqual([
      'indexedDB',
      'Worker',
      'crypto.subtle',
      'String.prototype.replaceAll',
      'Array.prototype.at',
      'Object.hasOwn',
    ]);
  });
});
