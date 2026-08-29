export interface BenchmarkResult {
  readonly name: string;
  readonly median: number;
}

export interface BenchmarkGroup {
  readonly benchmarks: readonly BenchmarkResult[];
}

export interface BenchmarkFile {
  readonly filepath: string;
  readonly groups: readonly BenchmarkGroup[];
}

/** The shape `vitest bench --run --outputJson=<path>` writes. */
export interface PerfBenchReport {
  readonly files: readonly BenchmarkFile[];
}

export interface PerfThreshold {
  readonly requirement: string;
  /** Relative path suffix (e.g. `packages/validator/src/bench/import.bench.ts`) — matched with `endsWith` so it works under any absolute checkout root, local or CI. */
  readonly file: string;
  /** Exact `bench()` name, verbatim from the source file — no fuzzy matching. */
  readonly name: string;
  readonly thresholdMs: number;
  readonly note: string;
}

export interface PerfGateEntry {
  readonly requirement: string;
  readonly file: string;
  readonly name: string;
  readonly medianMs: number;
  readonly thresholdMs: number;
  readonly ok: boolean;
}

export interface PerfGateResult {
  readonly ok: boolean;
  readonly entries: readonly PerfGateEntry[];
  /** A `thresholds.json` entry with no matching benchmark result — a renamed/removed bench silently stops being gated otherwise, so this counts as a failure, not a skip. */
  readonly missing: readonly PerfThreshold[];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function findBenchmark(
  report: PerfBenchReport,
  threshold: PerfThreshold,
): BenchmarkResult | undefined {
  const wantedFile = normalizePath(threshold.file);
  for (const file of report.files) {
    if (!normalizePath(file.filepath).endsWith(wantedFile)) continue;
    for (const group of file.groups) {
      for (const benchmark of group.benchmarks) {
        if (benchmark.name === threshold.name) return benchmark;
      }
    }
  }
  return undefined;
}

/**
 * Reads `median`, never `mean`/a single sample — ADR-034's explicit choice,
 * matching the version plan's own instruction ("多次采样中位数，而不是单次
 * 值"). `vitest bench` already collects many samples per `bench()` call
 * within one process (tinybench's own minimum-iteration floor), so no
 * multi-invocation orchestration is needed to get a stable figure.
 */
export function evaluatePerfGate(
  report: PerfBenchReport,
  thresholds: readonly PerfThreshold[],
): PerfGateResult {
  const entries: PerfGateEntry[] = [];
  const missing: PerfThreshold[] = [];

  for (const threshold of thresholds) {
    const match = findBenchmark(report, threshold);
    if (!match) {
      missing.push(threshold);
      continue;
    }
    entries.push({
      requirement: threshold.requirement,
      file: threshold.file,
      name: threshold.name,
      medianMs: match.median,
      thresholdMs: threshold.thresholdMs,
      ok: match.median <= threshold.thresholdMs,
    });
  }

  return {
    ok: missing.length === 0 && entries.every((entry) => entry.ok),
    entries,
    missing,
  };
}
