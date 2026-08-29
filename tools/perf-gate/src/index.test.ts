import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PerfBenchReport, PerfThreshold } from './gate.js';
import { run } from './index.js';

const tempDirs: string[] = [];

function makeTempFiles(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'perf-gate-test-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(content));
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const PASSING_REPORT: PerfBenchReport = {
  files: [
    {
      filepath: '/repo/scale.bench.ts',
      groups: [{ benchmarks: [{ name: 'single moveSeqItem', median: 0.01 }] }],
    },
  ],
};

const PASSING_THRESHOLDS: PerfThreshold[] = [
  {
    requirement: 'NFR-PERF-03',
    file: 'scale.bench.ts',
    name: 'single moveSeqItem',
    thresholdMs: 100,
    note: '',
  },
];

describe('run (v0.9.0 #10, ADR-034)', () => {
  it('returns 0 and logs each passing benchmark plus a final success line', () => {
    const dir = makeTempFiles({
      'thresholds.json': PASSING_THRESHOLDS,
      'bench.json': PASSING_REPORT,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const exitCode = run(join(dir, 'thresholds.json'), [join(dir, 'bench.json')]);

    expect(exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[OK  ] NFR-PERF-03 "single moveSeqItem"'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('All performance thresholds met'));
    logSpy.mockRestore();
  });

  it('returns 1 and prints a FAIL line for a benchmark over its threshold', () => {
    const failingReport: PerfBenchReport = {
      files: [
        {
          filepath: '/repo/scale.bench.ts',
          groups: [{ benchmarks: [{ name: 'single moveSeqItem', median: 500 }] }],
        },
      ],
    };
    const dir = makeTempFiles({
      'thresholds.json': PASSING_THRESHOLDS,
      'bench.json': failingReport,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = run(join(dir, 'thresholds.json'), [join(dir, 'bench.json')]);

    expect(exitCode).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[FAIL] NFR-PERF-03 "single moveSeqItem"'),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Performance gate failed'));
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns 1 and prints which threshold had no matching benchmark result', () => {
    const dir = makeTempFiles({
      'thresholds.json': PASSING_THRESHOLDS,
      'bench.json': { files: [] },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const exitCode = run(join(dir, 'thresholds.json'), [join(dir, 'bench.json')]);

    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no benchmark result matched'));
    errorSpy.mockRestore();
  });

  it('merges multiple bench report files into one evaluation, matching the two-vitest-bench-steps CI shape', () => {
    const importReport: PerfBenchReport = {
      files: [
        {
          filepath: '/repo/import.bench.ts',
          groups: [
            { benchmarks: [{ name: 'parse + first validation pass (total)', median: 4000 }] },
          ],
        },
      ],
    };
    const scaleReport: PerfBenchReport = {
      files: [
        {
          filepath: '/repo/scale.bench.ts',
          groups: [{ benchmarks: [{ name: 'single moveSeqItem', median: 0.01 }] }],
        },
      ],
    };
    const thresholds: PerfThreshold[] = [
      ...PASSING_THRESHOLDS,
      {
        requirement: 'NFR-PERF-02',
        file: 'import.bench.ts',
        name: 'parse + first validation pass (total)',
        thresholdMs: 7000,
        note: '',
      },
    ];
    const dir = makeTempFiles({
      'thresholds.json': thresholds,
      'import.json': importReport,
      'scale.json': scaleReport,
    });

    const exitCode = run(join(dir, 'thresholds.json'), [
      join(dir, 'import.json'),
      join(dir, 'scale.json'),
    ]);

    expect(exitCode).toBe(0);
  });
});
