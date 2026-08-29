import type { CorpusKind } from './corpus.js';
import type { KernelAsset, KernelPlatformKey } from './download.js';

/** One kernel test case's real-world outcome (PRD §13.3/§13.5 release blocker). */
export interface CaseResult {
  readonly id: string;
  readonly kind: CorpusKind;
  readonly expect: 'pass' | 'fail';
  readonly exitCode: number;
  readonly stderr: string;
}

/**
 * A case succeeds when the kernel's real exit code matches what it declared —
 * a non-zero exit is the correct, expected outcome for an `expect: 'fail'`
 * case (an `invalid` module example), not a failure. No partial credit either
 * way (PRD §13.5).
 */
export function caseSucceeded(result: Pick<CaseResult, 'exitCode' | 'expect'>): boolean {
  const kernelExitedZero = result.exitCode === 0;
  return result.expect === 'pass' ? kernelExitedZero : !kernelExitedZero;
}

export function allPassed(results: readonly CaseResult[]): boolean {
  return results.every(caseSucceeded);
}

const KIND_ORDER: readonly CorpusKind[] = ['template', 'module-example', 'migration'];
const KIND_LABELS: Readonly<Record<CorpusKind, string>> = {
  template: 'built-in templates',
  'module-example': 'module examples',
  migration: 'migration results',
};

/** Human-readable, one line per case — printed to the CI job's own log, not parsed by anything. Grouped by `kind` so a release-blocker failure and an unrelated one are never confused (v0.9.0 #2). */
export function formatReport(results: readonly CaseResult[]): string {
  const overallPassCount = results.filter(caseSucceeded).length;
  const summary = `${String(overallPassCount)}/${String(results.length)} case(s) behaved as expected against the real Mihomo v1.19.29 config test`;

  const groupLines = KIND_ORDER.flatMap((kind) => {
    const group = results.filter((result) => result.kind === kind);
    if (group.length === 0) return [];
    const passCount = group.filter(caseSucceeded).length;
    const lines = [`${KIND_LABELS[kind]}: ${String(passCount)}/${String(group.length)}`];
    for (const result of group) {
      const ok = caseSucceeded(result);
      const label = ok ? 'PASS' : 'FAIL';
      if (ok) {
        lines.push(`  ${label}  ${result.id}`);
        continue;
      }
      const expectation = result.expect === 'pass' ? 'expected exit 0' : 'expected a non-zero exit';
      const detail = result.stderr.trim();
      lines.push(
        `  ${label}  ${result.id} (${expectation}, got exit ${String(result.exitCode)})${detail ? `\n        ${detail}` : ''}`,
      );
    }
    return lines;
  });

  return [summary, ...groupLines].join('\n');
}

/**
 * Pure preview text for `--dry-run`: the full digest table (not just this
 * job's own platform — see `index.ts`'s own doc comment on why) plus the full
 * corpus this run would exercise, grouped and counted by `kind`. Kept
 * separate from `main()`'s real, unavoidably impure orchestration (network,
 * filesystem, a subprocess) so this one genuinely testable piece of that path
 * is actually tested, not just eyeballed.
 */
export function formatDryRunPreview(
  digests: Readonly<Record<KernelPlatformKey, KernelAsset | null>>,
  corpus: readonly {
    readonly id: string;
    readonly kind: CorpusKind;
    readonly expect: 'pass' | 'fail';
  }[],
): string {
  const digestLines = Object.entries(digests).map(([platformKey, asset]) =>
    asset
      ? `  ${platformKey}: ${asset.asset} (${String(asset.bytes)} bytes, sha256:${asset.sha256})`
      : `  ${platformKey}: (no pinned digest yet)`,
  );
  const corpusLines = KIND_ORDER.flatMap((kind) => {
    const group = corpus.filter((testCase) => testCase.kind === kind);
    return [
      `  ${kind}: ${String(group.length)} case(s)`,
      ...group.map((testCase) => `    - ${testCase.id} (expect ${testCase.expect})`),
    ];
  });
  return [
    '[dry-run] pinned kernel digests:',
    ...digestLines,
    `[dry-run] would run ${String(corpus.length)} kernel test case(s) matching this job's own platform:`,
    ...corpusLines,
  ].join('\n');
}
