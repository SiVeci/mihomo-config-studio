import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { evaluatePerfGate, type PerfBenchReport, type PerfThreshold } from './gate.js';

function formatMs(value: number): string {
  return `${value.toFixed(2)}ms`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Merges one or more `vitest bench --outputJson` reports, checks them against `thresholdsPath`, prints a table, and returns a process exit code (0 = every threshold met). */
export function run(thresholdsPath: string, benchReportPaths: readonly string[]): number {
  const thresholds = readJson<PerfThreshold[]>(thresholdsPath);
  const reports = benchReportPaths.map((path) => readJson<PerfBenchReport>(path));
  const merged: PerfBenchReport = { files: reports.flatMap((report) => report.files) };

  const result = evaluatePerfGate(merged, thresholds);

  for (const entry of result.entries) {
    const status = entry.ok ? 'OK  ' : 'FAIL';
    console.log(
      `[${status}] ${entry.requirement} "${entry.name}": median ${formatMs(entry.medianMs)} (threshold ${formatMs(entry.thresholdMs)})`,
    );
  }
  for (const threshold of result.missing) {
    console.error(
      `[FAIL] ${threshold.requirement}: no benchmark result matched ${threshold.file} > "${threshold.name}"`,
    );
  }

  if (result.ok) {
    console.log('All performance thresholds met (ADR-034).');
    return 0;
  }
  console.error('Performance gate failed — see ADR-034 before adjusting thresholds.json.');
  return 1;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [thresholdsPath, ...benchReportPaths] = process.argv.slice(2);
  if (!thresholdsPath || benchReportPaths.length === 0) {
    console.error(
      'Usage: perf-gate <thresholds.json> <bench-output.json> [more-bench-output.json ...]',
    );
    process.exitCode = 1;
  } else {
    process.exitCode = run(thresholdsPath, benchReportPaths);
  }
}
