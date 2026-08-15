import { describe, expect, it } from 'vitest';

import { generateLargeCorpus } from './generate-large.js';

describe('generateLargeCorpus', () => {
  it('is deterministic: the same seed produces byte-identical output', () => {
    const a = generateLargeCorpus({ seed: 1 });
    const b = generateLargeCorpus({ seed: 1 });

    expect(a).toBe(b);
  });

  it('a different seed produces different output', () => {
    const a = generateLargeCorpus({ seed: 1 });
    const b = generateLargeCorpus({ seed: 2 });

    expect(a).not.toBe(b);
  });

  it('defaults to approximately 1 MiB', () => {
    const corpus = generateLargeCorpus();

    const bytes = Buffer.byteLength(corpus, 'utf8');
    expect(bytes).toBeGreaterThan(1024 * 1024 * 0.95);
    expect(bytes).toBeLessThan(1024 * 1024 * 1.1);
  });

  it('honours a smaller explicit targetBytes', () => {
    const corpus = generateLargeCorpus({ targetBytes: 20_000 });

    const bytes = Buffer.byteLength(corpus, 'utf8');
    expect(bytes).toBeGreaterThan(20_000 * 0.5);
    expect(bytes).toBeLessThan(20_000 * 1.5);
  });

  it('is not one line repeated: it contains a realistic variety of proxies and rule shapes', () => {
    const corpus = generateLargeCorpus({ targetBytes: 50_000 });

    expect(corpus).toContain('proxies:');
    expect(corpus).toContain('proxy-groups:');
    expect(corpus).toContain('rules:');
    expect(corpus).toContain('type: ss');
    expect(corpus).toContain('type: vmess');
    expect(corpus).toContain('type: trojan');
    expect(corpus).toContain('DOMAIN-SUFFIX,');
    expect(corpus).toContain('GEOIP,');
    const uniqueLines = new Set(corpus.split('\n'));
    expect(uniqueLines.size).toBeGreaterThan(100);
  });

  it('always ends the rules list with a catch-all MATCH', () => {
    const corpus = generateLargeCorpus({ targetBytes: 20_000 });

    expect(corpus.trimEnd().endsWith('- MATCH,PROXY')).toBe(true);
  });
});
