import { describe, expect, it } from 'vitest';

import { formatPath, fromPointer, isPathPrefix, pathsEqual, toPointer } from './path.js';
import { utf8ByteLength } from './limits.js';

describe('path formatting', () => {
  it('renders a readable path for the UI', () => {
    expect(formatPath([])).toBe('$');
    expect(formatPath(['proxies', 0, 'name'])).toBe('proxies[0].name');
    expect(formatPath(['dns', 'nameserver-policy', 'geosite:cn'])).toBe(
      'dns.nameserver-policy["geosite:cn"]',
    );
  });

  it('round-trips through a JSON Pointer', () => {
    for (const path of [[], ['a'], ['proxies', 0, 'name'], ['weird/key~1'], ['hosts', '+.a.com']]) {
      expect(fromPointer(toPointer(path))).toEqual(path);
    }
  });

  it('rejects a malformed pointer', () => {
    expect(() => fromPointer('nope')).toThrow(/Invalid JSON Pointer/);
  });

  it('compares paths structurally', () => {
    expect(pathsEqual(['a', 1], ['a', 1])).toBe(true);
    expect(pathsEqual(['a', 1], ['a', '1'])).toBe(false);
    expect(pathsEqual(['a'], ['a', 1])).toBe(false);
    expect(isPathPrefix(['a'], ['a', 1, 'b'])).toBe(true);
    expect(isPathPrefix(['a', 2], ['a', 1, 'b'])).toBe(false);
    expect(isPathPrefix(['a', 1, 'b'], ['a'])).toBe(false);
  });
});

describe('utf8ByteLength', () => {
  it('matches Buffer.byteLength for ASCII, CJK, and astral characters', () => {
    for (const sample of ['', 'abc', '中文测试', 'éè', 'emoji: \u{1F600}\u{1F680}']) {
      expect(utf8ByteLength(sample)).toBe(Buffer.byteLength(sample, 'utf8'));
    }
  });
});
