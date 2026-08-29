import { describe, expect, it } from 'vitest';

import { evaluatePerfGate, type PerfBenchReport, type PerfThreshold } from './gate.js';

function report(
  filepath: string,
  benchmarks: readonly { name: string; median: number }[],
): PerfBenchReport {
  return { files: [{ filepath, groups: [{ benchmarks }] }] };
}

describe('evaluatePerfGate (v0.9.0 #10, ADR-034)', () => {
  it('passes when every benchmark median is at or under its threshold', () => {
    const bench = report('/repo/packages/validator/src/bench/import.bench.ts', [
      { name: 'parse + first validation pass (total)', median: 4000 },
    ]);
    const thresholds: PerfThreshold[] = [
      {
        requirement: 'NFR-PERF-02',
        file: 'packages/validator/src/bench/import.bench.ts',
        name: 'parse + first validation pass (total)',
        thresholdMs: 7000,
        note: 'test',
      },
    ];

    const result = evaluatePerfGate(bench, thresholds);

    expect(result.ok).toBe(true);
    expect(result.entries).toEqual([
      {
        requirement: 'NFR-PERF-02',
        file: 'packages/validator/src/bench/import.bench.ts',
        name: 'parse + first validation pass (total)',
        medianMs: 4000,
        thresholdMs: 7000,
        ok: true,
      },
    ]);
    expect(result.missing).toEqual([]);
  });

  it('a median exactly equal to the threshold passes (the boundary is inclusive)', () => {
    const bench = report('/repo/scale.bench.ts', [{ name: 'single moveSeqItem', median: 100 }]);
    const thresholds: PerfThreshold[] = [
      {
        requirement: 'NFR-PERF-03',
        file: 'scale.bench.ts',
        name: 'single moveSeqItem',
        thresholdMs: 100,
        note: '',
      },
    ];

    expect(evaluatePerfGate(bench, thresholds).ok).toBe(true);
  });

  it('fails, and reports which benchmark, when a median exceeds its threshold', () => {
    const bench = report('/repo/packages/validator/src/bench/import.bench.ts', [
      { name: 'parse + first validation pass (total)', median: 9000 },
    ]);
    const thresholds: PerfThreshold[] = [
      {
        requirement: 'NFR-PERF-02',
        file: 'packages/validator/src/bench/import.bench.ts',
        name: 'parse + first validation pass (total)',
        thresholdMs: 7000,
        note: 'test',
      },
    ];

    const result = evaluatePerfGate(bench, thresholds);

    expect(result.ok).toBe(false);
    expect(result.entries[0]).toMatchObject({ medianMs: 9000, thresholdMs: 7000, ok: false });
  });

  it('matches a threshold file by path suffix, independent of the checkout root', () => {
    const bench = report(
      'C:/Users/someone/mihomo-config-studio/packages/validator/src/bench/import.bench.ts',
      [{ name: 'parse + first validation pass (total)', median: 100 }],
    );
    const thresholds: PerfThreshold[] = [
      {
        requirement: 'NFR-PERF-02',
        file: 'packages/validator/src/bench/import.bench.ts',
        name: 'parse + first validation pass (total)',
        thresholdMs: 7000,
        note: 'test',
      },
    ];

    expect(evaluatePerfGate(bench, thresholds).ok).toBe(true);
  });

  it('matches a Windows-style backslash filepath against a forward-slash threshold file', () => {
    const bench = report('C:\\repo\\packages\\validator\\src\\bench\\import.bench.ts', [
      { name: 'parse + first validation pass (total)', median: 100 },
    ]);
    const thresholds: PerfThreshold[] = [
      {
        requirement: 'NFR-PERF-02',
        file: 'packages/validator/src/bench/import.bench.ts',
        name: 'parse + first validation pass (total)',
        thresholdMs: 7000,
        note: 'test',
      },
    ];

    expect(evaluatePerfGate(bench, thresholds).ok).toBe(true);
  });

  it('fails and records a threshold as missing when no benchmark result matches its name — a renamed bench must not silently stop being gated', () => {
    const bench = report('/repo/packages/validator/src/bench/import.bench.ts', [
      { name: 'a renamed benchmark', median: 100 },
    ]);
    const thresholds: PerfThreshold[] = [
      {
        requirement: 'NFR-PERF-02',
        file: 'packages/validator/src/bench/import.bench.ts',
        name: 'parse + first validation pass (total)',
        thresholdMs: 7000,
        note: 'test',
      },
    ];

    const result = evaluatePerfGate(bench, thresholds);

    expect(result.ok).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.missing).toEqual(thresholds);
  });

  it('fails when no threshold matches the file at all', () => {
    const bench = report('/repo/packages/validator/src/bench/scale.bench.ts', [
      { name: 'single moveSeqItem', median: 1 },
    ]);
    const thresholds: PerfThreshold[] = [
      {
        requirement: 'NFR-PERF-02',
        file: 'packages/validator/src/bench/import.bench.ts',
        name: 'parse + first validation pass (total)',
        thresholdMs: 7000,
        note: 'test',
      },
    ];

    const result = evaluatePerfGate(bench, thresholds);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(thresholds);
  });

  it('evaluates every threshold independently — one failure does not hide the others', () => {
    const bench = report('/repo/scale.bench.ts', [
      { name: 'single moveSeqItem', median: 0.01 },
      { name: '100 consecutive moves', median: 200 },
    ]);
    const thresholds: PerfThreshold[] = [
      {
        requirement: 'NFR-PERF-03',
        file: 'scale.bench.ts',
        name: 'single moveSeqItem',
        thresholdMs: 100,
        note: '',
      },
      {
        requirement: 'NFR-PERF-04',
        file: 'scale.bench.ts',
        name: '100 consecutive moves',
        thresholdMs: 100,
        note: '',
      },
    ];

    const result = evaluatePerfGate(bench, thresholds);

    expect(result.ok).toBe(false);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.find((entry) => entry.name === 'single moveSeqItem')?.ok).toBe(true);
    expect(result.entries.find((entry) => entry.name === '100 consecutive moves')?.ok).toBe(false);
  });

  it('an empty thresholds list trivially passes with no entries', () => {
    const bench = report('/repo/scale.bench.ts', [{ name: 'single moveSeqItem', median: 0.01 }]);

    const result = evaluatePerfGate(bench, []);

    expect(result).toEqual({ ok: true, entries: [], missing: [] });
  });
});
