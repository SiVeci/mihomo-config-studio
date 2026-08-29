export interface LogRedactionSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface LogRedactionViolation {
  readonly path: string;
  readonly reason: string;
}

export interface LogRedactionCheckResult {
  readonly ok: boolean;
  readonly violations: readonly LogRedactionViolation[];
}

/**
 * The one file allowed to contain a direct `console.*` call (NFR-SEC-03,
 * v0.9.0 #6): `packages/logging`'s own low-level sink, whose entire job is
 * *being* that wrapper — every other call site is meant to go through
 * `createLogger()` instead, so its own `redact()` can never be skipped.
 * Same "path-exact, not a glob or prefix" reasoning `tools/egress-check`'s
 * own allowlist already documents: a stale or mistyped entry grants
 * nothing, rather than silently matching a whole directory.
 */
export const LOG_REDACTION_ALLOWLIST: readonly string[] = ['packages/logging/src/logger.ts'];

const CONSOLE_CALL_PATTERN = /\bconsole\s*\.\s*(log|debug|info|warn|error|trace)\s*\(/;

function isTestFile(path: string): boolean {
  return path.endsWith('.test.ts') || path.endsWith('.test.tsx');
}

/**
 * Source-text scan, same technique `tools/egress-check`'s `checkEgress`
 * already uses for a different release blocker: a static string match, not
 * a runtime interceptor. It cannot catch an obfuscated or
 * dynamically-constructed call (`globalThis['console']['log']`); it does
 * catch every literal `console.<method>(` call, which is the real-world
 * shape every actual violation in this codebase has taken so far. Test
 * files are exempt — they are not shipped runtime code, and legitimately
 * call `console.*` directly for their own benchmark output
 * (`*.perf.test.tsx`) or to spy on it.
 */
export function checkLogRedaction(
  files: readonly LogRedactionSourceFile[],
): LogRedactionCheckResult {
  const violations: LogRedactionViolation[] = [];

  for (const file of files) {
    if (isTestFile(file.path)) continue;
    if (!CONSOLE_CALL_PATTERN.test(file.content)) continue;
    if (LOG_REDACTION_ALLOWLIST.includes(file.path)) continue;

    violations.push({
      path: file.path,
      reason:
        "direct console.* call found outside the log-redaction allowlist (NFR-SEC-03) — route through @mcs/logging's createLogger() instead",
    });
  }

  return { ok: violations.length === 0, violations };
}
