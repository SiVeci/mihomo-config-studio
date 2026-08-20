import type { KernelAsset, KernelPlatformKey } from './download.js';

/** One template's outcome from a real `mihomo -t -f <config>` invocation. */
export interface TemplateTestResult {
  readonly templateId: string;
  readonly exitCode: number;
  readonly stderr: string;
}

/** PRD §13.5 release blocker: any non-zero exit is a failure, no partial credit. */
export function allPassed(results: readonly TemplateTestResult[]): boolean {
  return results.every((result) => result.exitCode === 0);
}

/** Human-readable, one line per template — printed to the CI job's own log, not parsed by anything. */
export function formatReport(results: readonly TemplateTestResult[]): string {
  const lines = results.map((result) => {
    if (result.exitCode === 0) return `  PASS  ${result.templateId}`;
    const detail = result.stderr.trim();
    return `  FAIL  ${result.templateId} (exit ${result.exitCode})${detail ? `\n        ${detail}` : ''}`;
  });
  const passCount = results.filter((result) => result.exitCode === 0).length;
  const summary = `${passCount}/${results.length} template(s) passed the real Mihomo v1.19.29 config test`;
  return [summary, ...lines].join('\n');
}

/**
 * Pure preview text for `--dry-run`: the full digest table (not just this
 * job's own platform — see `index.ts`'s own doc comment on why) plus which
 * templates would be tested. Kept separate from `main()`'s real, unavoidably
 * impure orchestration (network, filesystem, a subprocess) so this one
 * genuinely testable piece of that path is actually tested, not just
 * eyeballed.
 */
export function formatDryRunPreview(
  digests: Readonly<Record<KernelPlatformKey, KernelAsset | null>>,
  templateIds: readonly string[],
): string {
  const digestLines = Object.entries(digests).map(([platformKey, asset]) =>
    asset
      ? `  ${platformKey}: ${asset.asset} (${String(asset.bytes)} bytes, sha256:${asset.sha256})`
      : `  ${platformKey}: (no pinned digest yet)`,
  );
  return [
    '[dry-run] pinned kernel digests:',
    ...digestLines,
    `[dry-run] would run ${String(templateIds.length)} template(s) through the kernel matching this job's own platform: ${templateIds.join(', ')}`,
  ].join('\n');
}
