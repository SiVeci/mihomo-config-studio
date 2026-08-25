import { generateLargeCorpus } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { hasBlockingIssues, runPipeline } from '../pipeline.js';

/**
 * `generate-large.ts` lives in `@mcs/test-fixtures`, which cannot depend on
 * `@mcs/yaml-engine` (the reverse dependency already exists — yaml-engine's
 * own tests use `readFixture` — and TypeScript project references don't
 * tolerate a cycle). So the "does the benchmark's own corpus actually parse
 * cleanly" check lives here instead, alongside the benchmark that consumes
 * it: both packages are already valid, non-circular dependencies of
 * `@mcs/validator`. If this ever goes red, `import.bench.ts`'s numbers are
 * measuring the blocked-short-circuit path, not the happy path NFR-PERF-02 is about.
 */
describe('generateLargeCorpus (bench input sanity)', () => {
  // v0.4.0 #5: on this ~1MB/13k-rule corpus, ruleOrderStage's own shadowing
  // algorithm finishes in <15ms (verified in isolation) — the real cost is
  // MihomoYamlDocument#locate(), called once per issue (this corpus's
  // realistic `10.x.y.0/24` overlap produces ~365 shadowing warnings).
  // `#positionState()` (yaml-engine/src/document.ts) calls `toText()`
  // *before* its cache-hit check, so every `locate()` call re-serialises the
  // whole document from CST tokens regardless of whether a re-parse was
  // actually needed — ~1.7s for 365 calls on a 1MB document. This is a
  // pre-existing `yaml-engine` characteristic (every stage's issue -> range
  // lookup pays it, not something specific to rule-order's algorithm), only
  // exposed here because this is the first stage that produces hundreds of
  // issues on a large, realistic document. Flagged for #14/#15 rather than
  // fixed here — likely fix is a version counter bumped by every mutating
  // method, compared instead of re-serialising to compare by value.
  const SLOW_STAGE_TIMEOUT_MS = 10000;

  it(
    'parses with no syntax issues and is not blocking',
    () => {
      const corpus = generateLargeCorpus();

      const parseResult = MihomoYamlDocument.parse(corpus);
      const issues = runPipeline({ parse: parseResult });

      // Not `toEqual([])`: the corpus deliberately includes realistic-but-risky
      // defaults (`allow-lan: true` + wildcard `bind-address`, an
      // `external-controller` with no `secret`) to be a representative sample
      // — v0.3.0 #13's securityStage correctly flags those as non-blocking
      // warnings. What this benchmark-sanity check actually needs is exactly
      // what its name says: no syntax issues, nothing blocking.
      expect(issues.some((issue) => issue.module === 'yaml')).toBe(false);
      expect(hasBlockingIssues(issues)).toBe(false);
    },
    SLOW_STAGE_TIMEOUT_MS,
  );

  it('round-trips byte for byte, same as any other input (M0-1)', () => {
    const corpus = generateLargeCorpus();

    const { document } = MihomoYamlDocument.parse(corpus);

    expect(document!.toText()).toBe(corpus);
  });
});
