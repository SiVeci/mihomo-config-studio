import { describe, expect, it } from 'vitest';

import { generateLargeCorpus, generateScaleCorpus } from './generate-large.js';

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

describe('generateScaleCorpus (v0.4.0 #14, NFR-PERF-04)', () => {
  it('is deterministic: the same seed produces byte-identical output', () => {
    const a = generateScaleCorpus({ entityCount: 50, ruleCount: 100, seed: 1 });
    const b = generateScaleCorpus({ entityCount: 50, ruleCount: 100, seed: 1 });

    expect(a).toBe(b);
  });

  it('a different seed produces different output', () => {
    const a = generateScaleCorpus({ entityCount: 50, ruleCount: 100, seed: 1 });
    const b = generateScaleCorpus({ entityCount: 50, ruleCount: 100, seed: 2 });

    expect(a).not.toBe(b);
  });

  it('produces exactly ruleCount rule lines and entityCount proxy+proxy-group entities', () => {
    const corpus = generateScaleCorpus({ entityCount: 100, ruleCount: 250 });
    const lines = corpus.split('\n');

    const proxyNameLines = lines.filter((line) => /^ {2}- name: "/.test(line));
    const groupNameLines = lines.filter((line) => /^ {2}- name: scale-group-/.test(line));
    const ruleLines = lines.filter((line) => /^ {2}- /.test(line) && !/name:/.test(line));

    expect(proxyNameLines.length + groupNameLines.length).toBe(100);
    expect(ruleLines).toHaveLength(250);
  });

  it('defaults to 1,000 entities and 10,000 rules', () => {
    const corpus = generateScaleCorpus();
    const lines = corpus.split('\n');

    const entityNameLines = lines.filter((line) => /^ {2}- name: /.test(line));
    const ruleLines = lines.filter((line) => /^ {2}- /.test(line) && !/name:/.test(line));

    expect(entityNameLines).toHaveLength(1000);
    expect(ruleLines).toHaveLength(10_000);
  });

  it('always ends the rules list with a catch-all MATCH,DIRECT', () => {
    const corpus = generateScaleCorpus({ entityCount: 20, ruleCount: 30 });

    expect(corpus.trimEnd().endsWith('- MATCH,DIRECT')).toBe(true);
  });

  it('every rule targets a real generated proxy-group or the DIRECT builtin — a structurally clean corpus with no missing references', () => {
    const corpus = generateScaleCorpus({ entityCount: 40, ruleCount: 60 });
    const lines = corpus.split('\n');
    const groupNames = new Set(
      lines
        .filter((line) => /^ {2}- name: scale-group-/.test(line))
        .map((line) => line.replace(/^ {2}- name: /, '')),
    );
    const ruleLines = lines.filter((line) => /^ {2}- /.test(line) && !/name:/.test(line));

    for (const line of ruleLines) {
      // The target is not always the last comma-separated segment — IP-CIDR
      // rules append a trailing `,no-resolve` flag after it — so this checks
      // that a known-good target appears *somewhere* in the segments, rather
      // than assuming a fixed position every rule type shares.
      const parts = line.replace(/^ {2}- /, '').split(',');
      expect(parts.some((part) => part === 'DIRECT' || groupNames.has(part))).toBe(true);
    }
  });

  it('every proxy-group lists at least one real member (never an empty proxies: list)', () => {
    const corpus = generateScaleCorpus({ entityCount: 10, ruleCount: 10 });
    const lines = corpus.split('\n');
    const groupStarts = lines
      .map((line, index) => (/^ {2}- name: scale-group-/.test(line) ? index : -1))
      .filter((index) => index >= 0);

    expect(groupStarts.length).toBeGreaterThan(1); // exercises more than one group's slice
    for (const start of groupStarts) {
      expect(lines[start + 2]).toBe('    proxies:');
      expect(lines[start + 3]).toMatch(/^ {6}- \S/);
    }
  });
});
